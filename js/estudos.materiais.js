/* ─── js/estudos.materiais.js — PDFs de estudo ligados aos tópicos ───
 *
 * Recebe os PDFs de uma disciplina, conta as páginas de cada um e sugere o tópico
 * do edital pelo nome do arquivo (ou pelo texto das primeiras páginas). Um PDF
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
     PDF → PÁGINAS E TÓPICO SUGERIDO
  ============================================= */
  async function lerPdf(arquivo) {
    await window.estImportar.carregarPdfjs();
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise;
    const nome = arquivo.name.replace(/\.pdf$/i, '');
    let sugestao = ctx.comparar(nome.replace(/[_-]+/g, ' '));
    if (!sugestao) {
      // Sem pista no nome ("Aula 03.pdf"), tenta pelo começo do texto
      let texto = '';
      for (let p = 1; p <= Math.min(2, pdf.numPages); p++) {
        const c = await (await pdf.getPage(p)).getTextContent();
        texto += ' ' + c.items.map(i => i.str).join(' ');
      }
      sugestao = ctx.comparar(texto.slice(0, 1500));
    }
    const paginas = pdf.numPages;
    pdf.destroy();
    return { nome, paginas, sugestao };
  }

  async function lerArquivos(arquivos) {
    if (!ctx || !arquivos.length) return;
    const novos = [];
    let repetidos = 0;
    for (let i = 0; i < arquivos.length; i++) {
      status(`Lendo ${i + 1} de ${arquivos.length}: ${arquivos[i].name}…`);
      try {
        const r = await lerPdf(arquivos[i]);
        if (ctx.lista.some(m => m.nome === r.nome && m.paginas === r.paginas)) { repetidos++; continue; }
        const m = { id: novoId(), nome: r.nome, paginas: r.paginas, topicos: r.sugestao ? [{ topico_id: r.sugestao, de: null, ate: null }] : [] };
        ctx.lista.push(m);
        novos.push(m);
      } catch (e) {
        console.error('Erro ao ler PDF:', e);
        status(`Não foi possível ler ${arquivos[i].name}. Detalhe: ${e.message || e}`, true);
        render();
        return;
      }
    }
    const ligados = novos.filter(m => m.topicos.length).length;
    status(`${novos.length} PDF${novos.length === 1 ? '' : 's'} adicionado${novos.length === 1 ? '' : 's'}` +
      (novos.length ? `, ${ligados} ligado${ligados === 1 ? '' : 's'} automaticamente a um tópico: confira abaixo.` : '.') +
      (repetidos ? ` ${repetidos} já estava${repetidos === 1 ? '' : 'm'} na lista.` : ''));
    $('est-mat-salvar').disabled = false;
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
