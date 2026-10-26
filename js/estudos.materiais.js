/* ─── js/estudos.materiais.js — PDFs de estudo ligados aos tópicos ───
 *
 * Recebe os PDFs de uma disciplina, conta as páginas de cada um e sugere o tópico
 * do edital pelo nome do arquivo ou pelo índice da apostila (ver lerPdf). Um PDF
 * pode ser ligado a vários tópicos, com a faixa de páginas de cada um.
 *
 * Com as páginas e a incidência do TEC, a tela mostra a prioridade de estudo
 * (questões por página), a mesma que o planejamento usa (estudos.plano.js).
 *
 * O arquivo é lido no navegador com o pdf.js (estudos.importar.js) e não é
 * enviado: só o nome e o número de páginas são guardados.
 */
(function () {
  let ctx = null;   // { edital, disc, lista: [material], comparar }

  const $ = id => document.getElementById(id);
  const novoId = () => 'mat_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const fmtNum = (n, casas = 2) => n.toFixed(casas).replace('.', ',');

  function nomeCurto(t, max = 70) {
    return t.nome.length > max ? t.nome.slice(0, max - 1) + '…' : t.nome;
  }

  /* =============================================
     PDF → PÁGINAS E TÓPICOS SUGERIDOS
     Apostila de cursinho ("curso-393065-aula-03-….pdf") não diz o assunto no nome;
     quem diz é o índice (sumário) das primeiras páginas. Cada item do índice é
     comparado aos tópicos do edital e o PDF é ligado a todos os que ele cobre.
     Sem índice, vale o texto das primeiras páginas, sem cabeçalho e rodapé.
  ============================================= */
  const PAGINAS_LIDAS = 4;     // o índice costuma estar na 2ª ou 3ª página
  const MAX_TOPICOS = 6;
  // Palavra inteira, inclusive com acento (o \b do JavaScript não entende "índice")
  const palavras = lista => new RegExp(`(?<![\\p{L}\\d])(${lista})(?![\\p{L}\\d])`, 'giu');
  // Partes do nome do arquivo que não dizem o assunto
  const RUIDO_NOME = palavras('curso|aula|prof|professor|completo|simplificado|somente|pdf|versao|v\\d+|[0-9a-f]{4}|\\d+');
  // Partes de itens do índice que não dizem o assunto
  const GENERICOS = palavras('considera[cç][oõ]es (iniciais|finais)|apresenta[cç][aã]o( do curso)?|introdu[cç][aã]o|' +
    'resumo|gabarito|lista de quest[oõ]es|quest[oõ]es( comentadas| com coment[aá]rios)?|exerc[ií]cios|cronograma|' +
    'refer[eê]ncias( bibliogr[aá]ficas)?|bibliografia|sum[aá]rio|[ií]ndice|parte \\d+|in[eé]ditas?|multibancas?|' +
    'cebraspe|cespe|fgv|fcc|vunesp|cesgranrio|quadrix|idecan|ibfc|aocp');
  const PONTILHADO = /(\.\s?){4,}|…{2,}|_{4,}/;

  // Linhas da página: o pdf.js entrega pedaços de texto; quebra quando muda a altura
  async function linhasDaPagina(pdf, n) {
    const c = await (await pdf.getPage(n)).getTextContent();
    const linhas = [];
    let atual = '', y = null, fimX = null;
    const quebra = () => { const l = atual.replace(/\s+/g, ' ').trim(); if (l) linhas.push(l); atual = ''; fimX = null; };
    c.items.forEach(i => {
      if (typeof i.str !== 'string') return;
      const [, , , , x, yi] = i.transform;
      if (y !== null && Math.abs(yi - y) > 3) quebra();
      // Pedaços colados ("Ad" + "ministração") não ganham espaço
      atual += (fimX !== null && x - fimX > 1 ? ' ' : '') + i.str;
      y = yi;
      fimX = x + (i.width || 0);
      if (i.hasEOL) { quebra(); y = null; }
    });
    quebra();
    return linhas;
  }

  // Itens do índice: linhas com pontilhado ou, depois de "Sumário"/"Índice", terminadas no número da página
  function itensDoIndice(paginas) {
    const itens = [];
    paginas.forEach(linhas => {
      let noIndice = false;
      linhas.forEach(l => {
        if (/^(sum[aá]rio|[ií]ndice)(?!\p{L})/iu.test(l)) { noIndice = true; return; }
        if (!PONTILHADO.test(l) && !(noIndice && /\D\s\d{1,3}$/.test(l))) return;
        const t = l.replace(PONTILHADO, ' ').replace(/[.…_]{2,}/g, ' ')
          .replace(/^\s*\d+(\.\d+)*\s*[).\-–]?\s*/, '')   // "1) ", "2.3 - "
          .replace(/\s\d{1,3}\s*$/, '')                       // número da página
          .replace(GENERICOS, ' ').replace(/[()\-–—:]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (/[a-zà-ú]{4,}/i.test(t)) itens.push(t);
      });
    });
    return itens;
  }

  // Texto sem as linhas que se repetem em várias páginas (cabeçalho, rodapé, nome do aluno)
  function textoSemCabecalho(paginas) {
    const vezes = {};
    paginas.forEach(ls => new Set(ls).forEach(l => { vezes[l] = (vezes[l] || 0) + 1; }));
    return paginas.flat().filter(l => vezes[l] < 2 && !PONTILHADO.test(l)).join(' ');
  }

  // Tópicos na ordem em que aparecem no índice; se passar do limite, ficam os mais fortes.
  // PDF de outra matéria acerta um item ou outro por acaso ("Contradição" ~ "Contratação"),
  // por isso pelo menos um terço dos itens precisa bater com o edital.
  function sugerirTopicos(itens) {
    itens = [...new Set(itens.map(t => t.toLowerCase()))];
    const achados = new Map();
    let batem = 0;
    itens.forEach((t, k) => {
      const r = ctx.comparar(t, true);
      if (!r.id) return;
      batem++;
      const a = achados.get(r.id) || { nota: 0, ordem: k };
      a.nota += r.nota;
      achados.set(r.id, a);
    });
    if (batem < itens.length / 3) return [];
    return [...achados].sort((a, b) => b[1].nota - a[1].nota).slice(0, MAX_TOPICOS)
      .sort((a, b) => a[1].ordem - b[1].ordem).map(([id]) => id);
  }

  async function lerPdf(arquivo) {
    await window.estImportar.carregarPdfjs();
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise;
    const nome = arquivo.name.replace(/\.pdf$/i, '');
    const peloNome = ctx.comparar(nome.replace(/[_-]+/g, ' ').replace(RUIDO_NOME, ' '));
    let topicos = peloNome ? [peloNome] : [];
    if (!topicos.length) {
      const paginas = [];
      for (let p = 1; p <= Math.min(PAGINAS_LIDAS, pdf.numPages); p++) paginas.push(await linhasDaPagina(pdf, p));
      const itens = itensDoIndice(paginas);
      topicos = sugerirTopicos(itens);
      if (!itens.length) {
        const peloTexto = ctx.comparar(textoSemCabecalho(paginas).slice(0, 4000));
        if (peloTexto) topicos = [peloTexto];
      }
    }
    const paginas = pdf.numPages;
    pdf.destroy();
    return { nome, paginas, topicos };
  }

  const ligacoes = ids => ids.map(topico_id => ({ topico_id, de: null, ate: null }));

  async function lerArquivos(arquivos) {
    if (!ctx || !arquivos.length) return;
    const novos = [];
    const repetidos = [];
    for (let i = 0; i < arquivos.length; i++) {
      status(`Lendo ${i + 1} de ${arquivos.length}: ${arquivos[i].name}…`);
      try {
        const r = await lerPdf(arquivos[i]);
        const ja = ctx.lista.find(m => m.nome === r.nome && m.paginas === r.paginas);
        if (ja) { repetidos.push({ m: ja, topicos: r.topicos }); continue; }
        const m = { id: novoId(), nome: r.nome, paginas: r.paginas, topicos: ligacoes(r.topicos) };
        ctx.lista.push(m);
        novos.push(m);
      } catch (e) {
        console.error('Erro ao ler PDF:', e);
        status(`Não foi possível ler ${arquivos[i].name}. Detalhe: ${e.message || e}`, true);
        render();
        return;
      }
    }
    // PDF já na lista: troca as ligações pela nova sugestão, se o usuário quiser
    const mudam = repetidos.filter(x => x.topicos.length &&
      x.topicos.join() !== x.m.topicos.map(l => l.topico_id).join());
    let trocados = 0;
    if (mudam.length && confirm(`${mudam.length} PDF${mudam.length > 1 ? 's' : ''} já estava${mudam.length > 1 ? 'm' : ''} na lista com outros tópicos.

` +
      'Trocar pelos tópicos sugeridos agora? As faixas de páginas digitadas nesses PDFs serão apagadas.')) {
      mudam.forEach(x => { x.m.topicos = ligacoes(x.topicos); });
      trocados = mudam.length;
    }
    const ligados = novos.filter(m => m.topicos.length).length;
    status(`${novos.length} PDF${novos.length === 1 ? '' : 's'} adicionado${novos.length === 1 ? '' : 's'}` +
      (novos.length ? `, ${ligados} ligado${ligados === 1 ? '' : 's'} automaticamente a tópicos: confira abaixo.` : '.') +
      (repetidos.length ? ` ${repetidos.length} já estava${repetidos.length === 1 ? '' : 'm'} na lista` +
        (trocados ? ` (${trocados} com os tópicos trocados).` : '.') : ''));
    $('est-mat-salvar').disabled = !(novos.length || trocados) && $('est-mat-salvar').disabled;
    render();
  }

  // Material sem PDF: o nome e as páginas vêm digitados
  function adicionarManual() {
    if (!ctx) return;
    const nome = $('est-mat-manual-nome').value.trim();
    const paginas = parseInt($('est-mat-manual-pag').value, 10);
    if (!nome || !(paginas > 0)) return;
    const topico = $('est-mat-manual-topico').value || ctx.comparar(nome);
    ctx.lista.push({ id: novoId(), nome, paginas, topicos: topico ? [{ topico_id: topico, de: null, ate: null }] : [] });
    $('est-mat-manual').reset();
    $('est-mat-manual-nome').focus();
    status(`"${nome}" adicionado${topico ? '' : '. Ligue-o a um tópico abaixo'}.`);
    $('est-mat-salvar').disabled = false;
    render();
  }

  /* =============================================
     TELA
  ============================================= */
  function abrir(editalId, discId) {
    const edital = editaisData.find(e => e.id === editalId);
    const disc = edital && edital.disciplinas.find(d => d.id === discId);
    if (!disc) return;
    ctx = {
      edital, disc,
      lista: JSON.parse(JSON.stringify(window.estPlano.materiaisDaDisciplina(discId))),
      comparar: window.estIncidencia.montarComparador(disc.topicos)
    };
    $('est-mat-titulo').textContent = `Material de estudo — ${disc.nome}`;
    $('est-mat-arquivo').value = '';
    $('est-mat-manual').reset();
    $('est-mat-manual-topico').innerHTML = '<option value="">Tópico (sugerido pelo nome)</option>' +
      disc.topicos.map(t => `<option value="${t.id}">${escapeHtml(nomeCurto(t, 60))}</option>`).join('');
    $('est-mat-salvar').disabled = true;
    status(ctx.lista.length
      ? `${ctx.lista.length} PDF${ctx.lista.length > 1 ? 's' : ''} nesta disciplina. Adicione mais ou ajuste as ligações.`
      : 'Escolha todos os PDFs da disciplina de uma vez. Depois ligue cada um aos tópicos que ele cobre.');
    render();
    $('est-modal-materiais').classList.add('active');
  }

  function fechar() {
    $('est-modal-materiais').classList.remove('active');
    ctx = null;
  }

  function status(msg, erro) {
    const el = $('est-mat-status');
    el.textContent = msg;
    el.classList.toggle('erro', !!erro);
  }

  function renderRanking() {
    const pr = window.estPlano.prioridadeDosTopicos(ctx.disc, ctx.lista);
    const max = Math.max(1e-9, ...pr.itens.map(x => x.porPagina));
    const aviso = !pr.comIncidencia
      ? '<p class="est-plano-sub est-mat-aviso">Importe a incidência do TEC desta disciplina (botão 📊 na configuração do plano) para ver a prioridade. Sem ela, o plano segue a ordem do edital.</p>'
      : !pr.comPaginas
        ? '<p class="est-plano-sub est-mat-aviso">Ligue os PDFs aos tópicos para a prioridade considerar as páginas. Por enquanto vale só a incidência.</p>'
        : '';
    $('est-mat-ranking').innerHTML = aviso + pr.itens.map((x, i) => {
      const pags = x.paginas ? `${x.paginas} p.` : x.estimado ? `sem PDF (~${Math.round(pr.mediana)} p.)` : 'sem PDF';
      const detalhe = pr.comIncidencia ? `${x.questoes} q · ${pags}` : pags;
      return `
      <div class="est-inc-rank ${pr.comIncidencia && !x.questoes ? 'zero' : ''}">
        <span class="est-inc-pos">${pr.comIncidencia ? i + 1 + 'º' : ''}</span>
        <span class="est-inc-nome" title="${escapeHtml(x.t.nome)}">${escapeHtml(nomeCurto(x.t, 90))}</span>
        <span class="est-inc-num">${pr.comIncidencia ? fmtNum(x.porPagina) + ' <small>q/pág.</small>' : ''}</span>
        <span class="est-mat-detalhe ${x.paginas ? '' : 'sem'}">${detalhe}</span>
        ${pr.comIncidencia ? `<div class="est-inc-barra"><div style="width:${x.porPagina / max * 100}%"></div></div>` : ''}
      </div>`;
    }).join('');
  }

  function renderLista() {
    const opcoes = ['<option value="">— Escolha o tópico —</option>']
      .concat(ctx.disc.topicos.map(t => `<option value="${t.id}">${escapeHtml(nomeCurto(t, 60))}</option>`)).join('');
    $('est-mat-lista').innerHTML = ctx.lista.length ? ctx.lista.map((m, i) => `
      <div class="est-mat-item ${m.topicos.some(l => l.topico_id) ? '' : 'solto'}">
        <div class="est-mat-cab">
          <span class="est-mat-nome" title="${escapeHtml(m.nome)}">📄 ${escapeHtml(m.nome)}</span>
          <span class="est-mat-pag"><input type="number" class="est-form-input" min="1" value="${m.paginas}" data-m="${i}" data-campo="paginas" aria-label="Páginas de ${escapeHtml(m.nome)}" title="Número de páginas" /> p.</span>
          <button type="button" class="est-plano-btn sutil" data-acao="remover" data-m="${i}" aria-label="Remover ${escapeHtml(m.nome)}" title="Remover material">✕</button>
        </div>
        ${m.topicos.map((l, j) => `
        <div class="est-mat-link">
          <select class="est-form-select" data-m="${i}" data-l="${j}" data-campo="topico_id" aria-label="Tópico coberto por ${escapeHtml(m.nome)}">${opcoes}</select>
          <span class="est-mat-faixa">
            <input type="number" class="est-form-input" min="1" max="${m.paginas}" placeholder="pág." value="${l.de || ''}" data-m="${i}" data-l="${j}" data-campo="de" aria-label="Página inicial" />
            <span>a</span>
            <input type="number" class="est-form-input" min="1" max="${m.paginas}" placeholder="pág." value="${l.ate || ''}" data-m="${i}" data-l="${j}" data-campo="ate" aria-label="Página final" />
          </span>
          <button type="button" class="est-plano-btn sutil" data-acao="desligar" data-m="${i}" data-l="${j}" aria-label="Remover ligação" title="Remover ligação">✕</button>
        </div>`).join('')}
        <button type="button" class="est-plano-btn" data-acao="ligar" data-m="${i}">+ Tópico</button>
      </div>`).join('')
      : '<p class="est-plano-vazio">Nenhum PDF ainda.</p>';
    $('est-mat-lista').querySelectorAll('select').forEach(sel => {
      sel.value = ctx.lista[sel.dataset.m].topicos[sel.dataset.l].topico_id || '';
    });
  }

  function render() {
    renderLista();
    renderRanking();
  }

  async function salvar() {
    if (!ctx) return;
    $('est-mat-salvar').disabled = true;
    await window.estPlano.salvarMateriais(ctx.edital, ctx.disc, ctx.lista);
    fechar();
  }

  function init() {
    if (!$('est-modal-materiais')) return;
    $('est-mat-arquivo').addEventListener('change', e => lerArquivos([...e.target.files]));
    const lista = $('est-mat-lista');
    lista.addEventListener('click', e => {
      const b = e.target.closest('button[data-acao]');
      if (!b || !ctx) return;
      const m = ctx.lista[b.dataset.m];
      if (b.dataset.acao === 'remover') ctx.lista.splice(b.dataset.m, 1);
      else if (b.dataset.acao === 'ligar') m.topicos.push({ topico_id: '', de: null, ate: null });
      else if (b.dataset.acao === 'desligar') m.topicos.splice(b.dataset.l, 1);
      $('est-mat-salvar').disabled = false;
      render();
    });
    lista.addEventListener('change', e => {
      const el = e.target.closest('[data-campo]');
      if (!el || !ctx) return;
      const m = ctx.lista[el.dataset.m];
      const l = m.topicos[el.dataset.l];
      if (el.dataset.campo === 'paginas') {
        const n = parseInt(el.value, 10);
        if (n > 0) m.paginas = n;
        el.value = m.paginas;
        m.topicos.forEach(x => {
          if (x.de > m.paginas) x.de = null;
          if (x.ate > m.paginas) x.ate = null;
        });
        $('est-mat-salvar').disabled = false;
        return render();
      }
      if (el.dataset.campo === 'topico_id') {
        l.topico_id = el.value;
        el.closest('.est-mat-item').classList.toggle('solto', !m.topicos.some(x => x.topico_id));
      } else {
        const n = parseInt(el.value, 10);
        l[el.dataset.campo] = n > 0 ? Math.min(n, m.paginas) : null;
      }
      $('est-mat-salvar').disabled = false;
      renderRanking();
    });
    $('est-mat-manual').addEventListener('submit', e => { e.preventDefault(); adicionarManual(); });
    $('est-mat-salvar').addEventListener('click', salvar);
    $('est-mat-cancelar').addEventListener('click', fechar);
    $('est-modal-materiais-close').addEventListener('click', fechar);
    $('est-modal-materiais').addEventListener('click', e => { if (e.target.id === 'est-modal-materiais') fechar(); });
  }

  document.addEventListener('DOMContentLoaded', init);

  window.estMateriais = { abrir };
})();
