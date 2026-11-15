/* =============================================
   JANELA DE ESTUDO (estudos.sessao.js)
   Abre ao clicar numa meta ou revisão do plano: cronômetro (livre ou Pomodoro)
   e o resumo do tópico dividido em páginas, como num caderno do OneNote.

   As páginas ficam no mesmo resumo de "Meus Resumos" (tabela resumos): cada página
   começa com <h1 class="est-pagina">Título</h1>. Conteúdo antes do primeiro título é a
   primeira página, por isso os resumos antigos continuam iguais.
   Cada página com título é um ASSUNTO (subtópico) do item do edital (estudos.subtopicos.js):
   a coluna "Assuntos" mostra primeiro os do PDF da meta e, recolhidos, os outros do item.
   Carregado depois do estudos.v5.js (usa resumosMap, makeResumoKey e salvarResumo).
============================================= */
(function () {
  const CICLOS = { '25/5': [25, 5], '50/10': [50, 10], '90/20': [90, 20] };   // minutos de foco/pausa
  const CICLO_PADRAO = '50/10';
  const CHAVE_CICLO = 'est_pomodoro_ciclo';
  const AUTOSAVE_MS = 2000;
  const TITULO_PADRAO = 'Anotações';
  const CHAVE_CRONO = 'est_crono';           // { [id da meta/revisão]: estado do cronômetro }
  const TAMANHOS = ['8pt', '9pt', '10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '20pt', '22pt', '24pt', '26pt', '28pt', '36pt', '48pt', '72pt'];

  /* Fontes do editor. As do Google vêm do <link> "fontes do resumo" no estudos.html
     (o navegador só baixa a fonte quando ela é usada). Ficam no texto como font-family,
     então valem no resumo geral, no PDF e no Word (se a fonte estiver instalada no PC).
     serif e monospace são as do Quill antigo (classe ql-font-*): continuam abrindo. */
  const FONTES = [
    { id: 'arial', nome: 'Arial', css: 'Arial, Helvetica, sans-serif' },
    { id: 'calibri', nome: 'Calibri', css: 'Calibri, Carlito, sans-serif' },
    { id: 'roboto', nome: 'Roboto', css: 'Roboto, sans-serif' },
    { id: 'open-sans', nome: 'Open Sans', css: '"Open Sans", sans-serif' },
    { id: 'lato', nome: 'Lato', css: 'Lato, sans-serif' },
    { id: 'montserrat', nome: 'Montserrat', css: 'Montserrat, sans-serif' },
    { id: 'georgia', nome: 'Georgia', css: 'Georgia, serif' },
    { id: 'times', nome: 'Times New Roman', css: '"Times New Roman", Times, serif' },
    { id: 'merriweather', nome: 'Merriweather', css: 'Merriweather, serif' },
    { id: 'lora', nome: 'Lora', css: 'Lora, serif' },
    { id: 'roboto-mono', nome: 'Roboto Mono', css: '"Roboto Mono", monospace' },
    // Manuscritas
    { id: 'caveat', nome: 'Caveat', css: 'Caveat, cursive', mao: true },
    { id: 'patrick-hand', nome: 'Patrick Hand', css: '"Patrick Hand", cursive', mao: true },
    { id: 'kalam', nome: 'Kalam', css: 'Kalam, cursive', mao: true },
    { id: 'indie-flower', nome: 'Indie Flower', css: '"Indie Flower", cursive', mao: true },
    { id: 'architects', nome: 'Architects Daughter', css: '"Architects Daughter", cursive', mao: true },
    { id: 'shadows', nome: 'Shadows Into Light', css: '"Shadows Into Light", cursive', mao: true },
    { id: 'gloria', nome: 'Gloria Hallelujah', css: '"Gloria Hallelujah", cursive', mao: true },
    { id: 'dancing', nome: 'Dancing Script', css: '"Dancing Script", cursive', mao: true },
    { id: 'marker', nome: 'Permanent Marker', css: '"Permanent Marker", cursive', mao: true },
    // Do editor antigo
    { id: 'serif', nome: 'Serif', css: 'Georgia, "Times New Roman", serif', antiga: true },
    { id: 'monospace', nome: 'Monospace', css: '"Courier New", Consolas, monospace', antiga: true }
  ];
  const primeiraFamilia = css => css.split(',')[0].replace(/["']/g, '').trim().toLowerCase();

  // Título de página: precisa existir antes do Quill de "Meus Resumos" ser criado,
  // senão ele troca o <h1 class="est-pagina"> por um título comum e as páginas se perdem.
  if (typeof Quill !== 'undefined') {
    const Block = Quill.import('blots/block');
    class TituloPagina extends Block {}
    TituloPagina.blotName = 'pagina';
    TituloPagina.tagName = 'H1';
    TituloPagina.className = 'est-pagina';
    Quill.register(TituloPagina, true);

    // Tamanhos de fonte em pontos, como no Word
    const Size = Quill.import('attributors/style/size');
    Size.whitelist = TAMANHOS;
    Quill.register(Size, true);

    // Fonte: o valor do formato é o id (ex.: "caveat"); no HTML vai o font-family completo
    const Parchment = Quill.import('parchment');
    class FonteEstilo extends Parchment.Attributor.Style {
      add(node, valor) {
        const f = FONTES.find(x => x.id === valor);
        if (!f) return false;
        node.style.fontFamily = f.css;
        return true;
      }
      value(node) {
        const fam = primeiraFamilia(node.style.fontFamily || '');
        const f = fam && FONTES.find(x => primeiraFamilia(x.css) === fam);
        return f ? f.id : '';
      }
    }
    Quill.register(new FonteEstilo('font', 'font-family', { scope: Parchment.Scope.INLINE }), true);

    // Tabela: o Quill 1.3.6 não tem. Vira um bloco fechado (não editável célula a célula) com o
    // HTML da tabela já limpo; a IA cria, colar de um site também. Apagar: selecionar e Delete.
    const BlockEmbed = Quill.import('blots/block/embed');
    class Tabela extends BlockEmbed {
      static create(html) {
        const node = super.create();
        node.setAttribute('contenteditable', 'false');
        node.innerHTML = limparTabela(html);
        return node;
      }
      static value(node) { return node.innerHTML; }
    }
    Tabela.blotName = 'tabela';
    Tabela.tagName = 'TABLE';
    Tabela.className = 'est-tabela';
    Quill.register(Tabela, true);

    // Desenho à mão (estudos.desenho.js): PNG + traços em data-tracos, para reabrir e continuar.
    // Clicar abre o desenho de novo. Só aceita PNG embutido (nada de endereço externo).
    class Desenho extends BlockEmbed {
      static create(v) {
        const node = super.create();
        const src = v && typeof v.src === 'string' && v.src.startsWith('data:image/png;base64,') ? v.src : '';
        node.setAttribute('src', src);
        if (v && v.tracos) node.setAttribute('data-tracos', v.tracos);
        node.setAttribute('alt', 'Desenho à mão');
        return node;
      }
      static value(node) { return { src: node.getAttribute('src') || '', tracos: node.getAttribute('data-tracos') || '' }; }
      // Largura escolhida nas alças (como a das fotos)
      static formats(node) { return node.hasAttribute('width') ? { width: node.getAttribute('width') } : {}; }
      format(nome, valor) {
        if (nome !== 'width') { super.format(nome, valor); return; }
        if (valor) this.domNode.setAttribute('width', valor); else this.domNode.removeAttribute('width');
      }
    }
    Desenho.blotName = 'desenho';
    Desenho.tagName = 'IMG';
    Desenho.className = 'est-desenho';
    Quill.register(Desenho, true);

    // Nome de cada fonte no seletor: na lista, escrito com ela; na caixa fechada, em fonte normal
    const primeiraMao = FONTES.find(f => f.mao).id;
    const css = `
      .ql-snow .ql-picker.ql-font { width: 150px; }
      .ql-snow .ql-picker.ql-font .ql-picker-label::before,
      .ql-snow .ql-picker.ql-font .ql-picker-item::before { content: "Padrão"; }
      .ql-snow .ql-picker.ql-font .ql-picker-item[data-value="${primeiraMao}"] { border-top: 1px solid #e5e7eb; margin-top: 4px; padding-top: 8px; }` +
      FONTES.map(f => `
      .ql-snow .ql-picker.ql-font .ql-picker-label[data-value="${f.id}"]::before { content: "${f.nome}"; }
      .ql-snow .ql-picker.ql-font .ql-picker-item[data-value="${f.id}"]::before { content: "${f.nome}"; font-family: ${f.css};${f.mao ? ' font-size: 1.15em;' : ''} }`).join('');
    const estilo = document.createElement('style');
    estilo.textContent = css;
    document.head.appendChild(estilo);
  }

  let quill = null;
  let ctx = null;            // { tipo, id, disc, topico, minutos, concluida }; sem id = só o resumo, sem cronômetro
  let paginas = [];          // [{ titulo, html, semTitulo, sub?, uid, sujo }] (sujo: edições ainda não gravadas)
  let atual = 0;
  let timerSalvar = null;
  let tick = null;
  let outrosAbertos = false;  // grupo "Outros assuntos do item" aberto na coluna

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const vazio = html => !html || html.trim() === '' || html === '<p><br></p>';

  /* =============================================
     PÁGINAS
  ============================================= */
  function separarPaginas(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html || '';
    const lista = [];
    let pag = { titulo: TITULO_PADRAO, html: '', semTitulo: true };
    Array.from(tpl.content.childNodes).forEach(no => {
      if (no.nodeType === 1 && no.matches('h1.est-pagina')) {
        if (!pag.semTitulo || !vazio(pag.html)) lista.push(pag);
        pag = { titulo: no.textContent.trim() || TITULO_PADRAO, html: '', semTitulo: false };
      } else {
        pag.html += no.nodeType === 1 ? no.outerHTML : esc(no.textContent);
      }
    });
    lista.push(pag);
    return lista;
  }

  /* Sem argumento, junta as páginas da janela. Assunto sem nada escrito não grava página vazia:
     ele continua existindo pelo cadastro de assuntos (estudos.subtopicos.js). */
  function juntarPaginas(lista = paginas) {
    const pags = lista.filter(p => p.semTitulo || !p.sub || !vazio(p.html));
    if (pags.length === 1 && pags[0].semTitulo) return pags[0].html;
    return pags.map((p, i) =>
      (i === 0 && p.semTitulo ? '' : `<h1 class="est-pagina">${esc(p.titulo)}</h1>`) +
      (vazio(p.html) ? '<p><br></p>' : p.html)
    ).join('');
  }

  function guardarPaginaAtual() {
    if (quill && paginas[atual]) paginas[atual].html = quill.root.innerHTML;
  }

  // Troca o conteúdo do editor sem contar como edição (não marca a página como alterada)
  function porNoEditor(html) {
    quill.root.innerHTML = html;
    quill.update('silent');
    quill.history.clear();
  }

  function tituloDaPagina() {
    const p = paginas[atual];
    const geral = comAssuntos() && p.semTitulo;
    const titulo = $('est-sessao-pag-titulo');
    titulo.value = geral ? 'Anotações gerais (sem assunto)' : p.titulo;
    titulo.disabled = geral;
  }

  function mostrarPagina(i) {
    esconderAlca();
    mostrarResumo();
    guardarPaginaAtual();
    atual = Math.max(0, Math.min(i, paginas.length - 1));
    tituloDaPagina();
    porNoEditor(paginas[atual].html);
    if (window.estTinta) window.estTinta.pagina();
    mostrarTecDoAssunto();
    marcarAssuntoNoCrono();
    renderPaginas();
  }

  function renderPaginas() {
    if (comAssuntos()) { renderAssuntos(); return; }
    $('est-sessao-lista').innerHTML = paginas.map((p, i) => `
      <li class="${i === atual ? 'ativa' : ''}">
        <button type="button" class="est-sessao-pag" onclick="estSessao.irPagina(${i})">${esc(p.titulo)}</button>
        ${paginas.length > 1 ? `<button type="button" class="est-sessao-pag-x" onclick="estSessao.apagarPagina(${i})" title="Apagar página" aria-label="Apagar página ${esc(p.titulo)}">✕</button>` : ''}
      </li>`).join('');
  }

  function novaPagina() {
    if (comAssuntos()) { abrirNovoAssunto(); return; }
    guardarPaginaAtual();
    paginas.push(numerada({ titulo: `Página ${paginas.length + 1}`, html: '', semTitulo: false }));
    mostrarPagina(paginas.length - 1);
    agendarSalvar();
    $('est-sessao-pag-titulo').select();
  }

  async function apagarPagina(i) {
    if (paginas.length < 2) return;
    guardarPaginaAtual();
    const p = paginas[i];
    if (!vazio(p.html) && !(await window.customConfirm(`Apagar a página "${p.titulo}" e tudo o que está nela?`))) return;
    paginas.splice(i, 1);
    apagadas.add(p.uid);
    // A primeira página precisa de título se outra passou a ocupar o lugar dela
    if (i === 0 && paginas[0].semTitulo) { paginas[0].semTitulo = false; paginas[0].sujo++; }
    atual = Math.min(atual > i ? atual - 1 : atual, paginas.length - 1);
    porNoEditor(paginas[atual].html);
    if (window.estTinta) window.estTinta.pagina();
    $('est-sessao-pag-titulo').value = paginas[atual].titulo;
    renderPaginas();
    salvar();
  }

  function renomear() {
    if (comAssuntos() && paginas[atual].semTitulo) return;
    const titulo = $('est-sessao-pag-titulo').value.trim() || TITULO_PADRAO;
    if (titulo === paginas[atual].titulo) return;
    paginas[atual].titulo = titulo;
    paginas[atual].semTitulo = false;
    renderPaginas();
    agendarSalvar();
  }

  /* =============================================
     ASSUNTOS (subtópicos do item, estudos.subtopicos.js)
     Sem item do edital (resumo de assunto que saiu do edital), as páginas funcionam como antes.
  ============================================= */
  const comAssuntos = () => !!(ctx && ctx.topicoId && window.estSub);
  // PDFs da meta de estudo. Revisão e meta de questões valem para o item inteiro: todos os assuntos numa lista só
  const pdfsDaSessao = () => (!ctx || ctx.tipo !== 'meta' || ctx.questoes > 0 ? []
    : [...new Set((ctx.leitura || []).map(x => x.id).filter(Boolean))]);
  const subAtual = () => (paginas[atual] && paginas[atual].sub) || '';
  const nomeNaColuna = s => { const p = paginas.find(x => x.sub === s.id); return p ? p.titulo : s.nome; };

  // Página do assunto; sem página ainda, cria uma vazia no lugar da ordem dos assuntos
  function paginaDoAssunto(id) {
    const i = paginas.findIndex(p => p.sub === id);
    if (i >= 0) return i;
    const s = window.estSub.porId(id);
    if (!s) return 0;
    guardarPaginaAtual();
    const aberta = paginas[atual];
    const ordem = new Map(window.estSub.doTopico(ctx.topicoId).map((x, k) => [x.id, k]));
    const pos = p => (ordem.has(p.sub) ? ordem.get(p.sub) : 1e9);
    const [geral, ...resto] = paginas;
    paginas = [geral, ...[...resto, numerada({ titulo: s.nome, html: '', semTitulo: false, sub: s.id })].sort((a, b) => pos(a) - pos(b))];
    atual = Math.max(0, paginas.indexOf(aberta));
    return paginas.findIndex(p => p.sub === id);
  }

  function renderAssuntos() {
    const mats = pdfsDaSessao();
    const nums = new Map(window.estSub.numerosDe(ctx.topicoId).assuntos.map(n => [n.s.id, n]));
    const acerto = s => { const n = nums.get(s.id); return n && n.q ? Math.round(n.c / n.q * 100) : null; };
    let lista = window.estSub.doTopico(ctx.topicoId);
    // Revisão e meta de questões: começa pelos sem questões e pelos de pior acerto
    const priorizar = ctx.tipo === 'revisao' || ctx.questoes > 0;
    if (priorizar) lista = lista.slice().sort((a, b) => (acerto(a) ?? -1) - (acerto(b) ?? -1));
    const cotas = ctx.questoes > 0 ? window.estSub.distribuir(ctx.topicoId, ctx.questoes) : {};
    const neste = mats.length ? lista.filter(s => s.pdfs.some(p => mats.includes(p.material_id))) : lista;
    const outros = lista.filter(s => !neste.includes(s));
    const sel = subAtual();
    const item = (s, grupo, doGrupo) => {
      const p = acerto(s);
      // Subassunto: recuado; se o pai não está no mesmo grupo, o nome dele vai na frente
      const pai = !priorizar && window.estSub.paiDe(s);
      const paiFora = pai && !doGrupo.includes(pai) ? `<span class="est-sessao-ass-pai">${esc(nomeNaColuna(pai))} ›</span> ` : '';
      const selos = (priorizar ? `<span class="est-sessao-ass-selo ${p === null ? '' : p < 70 ? 'ruim' : p < 85 ? 'medio' : 'bom'}">${p === null ? 'sem questões' : p + '%'}</span>` : '') +
        (cotas[s.id] ? `<span class="est-sessao-ass-selo" title="Questões sugeridas para este assunto">≈${cotas[s.id]} q</span>` : '');
      const acao = !mats.length ? ''
        : grupo === 'neste'
          ? `<button type="button" class="est-sessao-pag-x" onclick="estSessao.tirarDoPdf('${s.id}')" title="Tirar deste PDF (o assunto continua no item)" aria-label="Tirar ${esc(s.nome)} deste PDF">✕</button>`
          : `<button type="button" class="est-sessao-pag-x" onclick="estSessao.usarNestePdf('${s.id}')" title="Usar neste PDF" aria-label="Usar ${esc(s.nome)} neste PDF">＋</button>`;
      // Arrastar muda a ordem ou põe dentro de outro; na lista por acerto (revisão/questões), a ordem mostrada não é a do item
      return `<li class="${s.id === sel ? 'ativa' : ''} ${pai ? 'filho' : ''}" ${priorizar ? '' : `draggable="true" data-sub="${s.id}" title="Arraste para mudar a ordem; solte no meio de outro assunto para virar subassunto dele"`}>
        <button type="button" class="est-sessao-pag" onclick="estSessao.irAssunto('${s.id}')">${paiFora}${esc(nomeNaColuna(s))}${selos ? `<span class="est-sessao-ass-selos">${selos}</span>` : ''}</button>${acao}</li>`;
    };
    $('est-sessao-lista').innerHTML = `
      <li class="${atual === 0 ? 'ativa' : ''}"><button type="button" class="est-sessao-pag est-sessao-geral" onclick="estSessao.irPagina(0)">📝 Anotações gerais</button></li>
      ${mats.length ? `<li class="est-sessao-grupo">Neste PDF</li>` : ''}
      ${neste.map(s => item(s, 'neste', neste)).join('')}
      ${mats.length && !neste.length ? '<li class="est-sessao-grupo-vazio">Nenhum assunto neste PDF ainda. Use “+ Assunto”.</li>' : ''}
      ${outros.length ? `<li class="est-sessao-outros"><details ${outrosAbertos || outros.some(s => s.id === sel) ? 'open' : ''} ontoggle="estSessao.outrosAbertos(this.open)">
        <summary>Outros assuntos do item (${outros.length})</summary><ul>${outros.map(s => item(s, 'outros', outros)).join('')}</ul></details></li>` : ''}`;
    ligarArrastar();
  }

  /* Arrastar um assunto: no alto ou no pé de outro, muda a ordem; no meio, vira subassunto dele
     (um nível só; o assunto leva junto os subassuntos que tiver). Grava a ordem e o pai
     (estSub.ordenar) e reordena as páginas do resumo, que seguem a ordem dos assuntos. */
  let arrastando = null;
  function ligarArrastar() {
    const ul = $('est-sessao-lista');
    if (ul.dataset.arrastar) return;
    ul.dataset.arrastar = '1';
    const sub = id => window.estSub.porId(id);
    const filhos = id => window.estSub.doTopico(ctx.topicoId).filter(x => (window.estSub.paiDe(x) || {}).id === id).map(x => x.id);
    const alvoDe = ev => { const li = ev.target.closest && ev.target.closest('li[data-sub]'); return li && li.dataset.sub !== arrastando ? li : null; };
    const limpar = () => ul.querySelectorAll('.arr-antes, .arr-depois, .arr-dentro').forEach(x => x.classList.remove('arr-antes', 'arr-depois', 'arr-dentro'));
    // Só entra num assunto de 1º nível, e só quem não tem subassuntos (para não virar 3 níveis)
    const aceitaDentro = para => !window.estSub.paiDe(sub(para)) && !filhos(arrastando).length;
    function zona(ev, li) {
      const r = li.getBoundingClientRect(), y = (ev.clientY - r.top) / r.height;
      if (y > 0.3 && y < 0.7 && aceitaDentro(li.dataset.sub)) return 'dentro';
      return y >= 0.5 ? 'depois' : 'antes';
    }
    ul.addEventListener('dragstart', ev => {
      const li = ev.target.closest && ev.target.closest('li[data-sub]');
      if (!li) return;
      arrastando = li.dataset.sub;
      li.classList.add('arrastando');
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', arrastando);
    });
    ul.addEventListener('dragover', ev => {
      const li = arrastando && alvoDe(ev);
      if (!li) return;
      ev.preventDefault();
      limpar();
      li.classList.add('arr-' + zona(ev, li));
    });
    ul.addEventListener('dragend', () => { arrastando = null; limpar(); ul.querySelectorAll('.arrastando').forEach(x => x.classList.remove('arrastando')); });
    ul.addEventListener('drop', async ev => {
      const li = arrastando && alvoDe(ev);
      if (!li) return;
      ev.preventDefault();
      const de = arrastando, z = zona(ev, li);
      let alvo = li.dataset.sub;
      limpar();
      const bloco = [de, ...filhos(de)];
      if (bloco.includes(alvo)) return;   // soltar em cima de um subassunto dele mesmo
      // Assunto com subassuntos não entra no 2º nível: ao lado de um subassunto, vai para o lado do pai
      if (bloco.length > 1 && window.estSub.paiDe(sub(alvo))) alvo = window.estSub.paiDe(sub(alvo)).id;
      const ids = window.estSub.doTopico(ctx.topicoId).map(s => s.id).filter(id => !bloco.includes(id));
      const fimDoGrupo = id => { const g = [id, ...filhos(id)].filter(x => ids.includes(x)); return ids.indexOf(g[g.length - 1]) + 1; };
      let pai, pos;
      if (z === 'dentro') { pai = alvo; pos = fimDoGrupo(alvo); }
      else {
        const paiAlvo = window.estSub.paiDe(sub(alvo));
        pai = paiAlvo ? paiAlvo.id : null;
        pos = z === 'antes' ? ids.indexOf(alvo) : paiAlvo ? ids.indexOf(alvo) + 1 : fimDoGrupo(alvo);
      }
      ids.splice(pos, 0, ...bloco);
      if (pai && window.estSub.remoto() && !window.estSub.temPai()) {
        aviso('Para usar subassuntos, rode no Supabase: alter table public.subtopicos add column if not exists pai text;');
        return;
      }
      await window.estSub.ordenar(ctx.topicoId, ids, { [de]: pai });
      guardarPaginaAtual();
      const aberta = paginas[atual];
      const posPag = p => { const k = ids.indexOf(p.sub); return k < 0 ? 1e9 : k; };
      const [geral, ...resto] = paginas;
      paginas = geral.semTitulo ? [geral, ...resto.sort((a, b) => posPag(a) - posPag(b))] : paginas.slice().sort((a, b) => posPag(a) - posPag(b));
      atual = Math.max(0, paginas.indexOf(aberta));
      ordemSuja = true;
      renderPaginas();
      salvar();
    });
  }

  function mostrarTecDoAssunto() {
    const s = comAssuntos() && subAtual() ? window.estSub.porId(subAtual()) : null;
    $('est-sessao-tec-ass').hidden = !s;
    if (s) {
      $('est-sessao-tec-link').value = s.tec_link || '';
      const a = $('est-sessao-tec-abrir');
      a.hidden = !s.tec_link;
      if (s.tec_link) a.href = s.tec_link;
    }
    const b = $('est-sessao-tec');
    if (ctx && ctx.topicoId && window.estTec) {
      b.textContent = s && s.tec_link ? 'TEC do assunto' : window.estTec.rotulo(ctx.topicoId);
      b.title = s && s.tec_link ? `Mostra aqui o caderno do TEC de “${s.nome}”` : 'Mostra aqui o caderno do TEC do item; se ainda não houver, cria pelo userscript';
    }
  }

  async function gravarTecDoAssunto() {
    const id = subAtual();
    if (!id) return;
    const v = window.estSub.linkDoCaderno($('est-sessao-tec-link').value);   // aceita o código de incorporação do TEC
    if (v === null) { aviso('Cole o endereço completo do caderno (começa com https://).'); return; }
    await window.estSub.definirTec(id, v);
    mostrarTecDoAssunto();
  }

  /* Caderno do TEC na janela, no lugar da folha do resumo; clicar de novo volta ao resumo.
     Do código de incorporação do TEC fica só o quadro: o script de altura dele rodaria nesta
     página, com acesso à sessão do site. */
  function mostrarTec(url) {
    const box = $('est-sessao-tecbox'), frame = $('est-sessao-tec-frame');
    if (!box.hidden && frame.dataset.url === url) { mostrarResumo(); return; }
    esconderAlca();
    if (frame.dataset.url !== url) { frame.src = url; frame.dataset.url = url; }
    $('est-sessao-tec-aba').href = url;
    $('est-sessao-folha').hidden = true;
    box.hidden = false;
  }

  function mostrarResumo() {
    $('est-sessao-tecbox').hidden = true;
    $('est-sessao-folha').hidden = false;
  }

  // "⛶ Tela cheia" do quadro do TEC: pede a tela inteira ao navegador e o CSS (.tela-cheia) faz o TEC
  // cobrir a janela. Continua valendo no resumo, para alternar com "Voltar ao resumo" e o botão TEC.
  const emTelaCheia = () => $('est-modal-sessao').classList.contains('tela-cheia');
  function telaCheia(ligar) {
    $('est-modal-sessao').classList.toggle('tela-cheia', ligar);
    const b = $('est-sessao-tec-cheia');
    b.textContent = ligar ? '⛶ Sair da tela cheia' : '⛶ Tela cheia';
    b.setAttribute('aria-pressed', ligar);
    const raiz = document.documentElement;   // a página inteira: as outras janelas (erro, conclusão) continuam visíveis
    if (ligar && !document.fullscreenElement && raiz.requestFullscreen) raiz.requestFullscreen().catch(() => {});   // recusado: fica só a janela inteira
    if (!ligar && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  // "+ Assunto": escolhe um assunto do item (liga ao PDF da meta) ou cria um novo
  function abrirNovoAssunto() {
    const caixa = $('est-sessao-novo');
    caixa.hidden = !caixa.hidden;
    if (caixa.hidden) return;
    $('est-sessao-novo-nome').value = '';
    $('est-sessao-novo-lista').innerHTML = window.estSub.doTopico(ctx.topicoId).map(s => `<option value="${esc(s.nome)}"></option>`).join('');
    dicaNovoAssunto();
    $('est-sessao-novo-nome').focus();
  }

  function dicaNovoAssunto() {
    const txt = $('est-sessao-novo-nome').value.trim();
    const { exato, parecido } = txt ? window.estSub.sugestao(ctx.topicoId, txt) : {};
    const dica = $('est-sessao-novo-dica');
    dica.textContent = !txt ? 'Escolha um assunto deste item ou digite um nome novo.'
      : exato ? `Enter abre “${exato.nome}”${pdfsDaSessao().length ? ' e o liga a este PDF' : ''}.`
      : parecido ? `⚠ Parecido com “${parecido.nome}”, que já existe. Escolha-o na lista para usar o mesmo assunto.`
      : 'Enter cria o assunto.';
    dica.classList.toggle('alerta', !exato && !!parecido);
    const criar = $('est-sessao-novo-criar');
    criar.hidden = !txt || !!exato;
    criar.textContent = `Criar subtópico “${txt}”`;
  }

  async function confirmarNovoAssunto(peloBotao) {
    const txt = $('est-sessao-novo-nome').value.trim();
    if (!txt) return;
    const { exato, parecido } = window.estSub.sugestao(ctx.topicoId, txt);
    if (!exato && parecido && !peloBotao) { dicaNovoAssunto(); return; }   // parecido: só cria pelo botão
    const mats = pdfsDaSessao();
    let s = exato;
    if (s) await window.estSub.vincular(s.id, mats);
    else s = await window.estSub.criar(ctx.topicoId, txt, mats);
    if (!s) return;
    $('est-sessao-novo').hidden = true;
    mostrarPagina(paginaDoAssunto(s.id));
    quill.focus();
  }

  async function tirarDoPdf(id) {
    await window.estSub.desvincular(id, pdfsDaSessao());
    renderPaginas();
  }

  async function usarNestePdf(id) {
    await window.estSub.vincular(id, pdfsDaSessao());
    renderPaginas();
  }

  // Nome digitado no título da página vai para o assunto; se já é de outro assunto, volta ao antigo
  async function sincronizarNomes() {
    for (const p of paginas) {
      const s = p.sub && window.estSub.porId(p.sub);
      if (!s || p.titulo === s.nome) continue;
      p.sujo++;
      if (!(await window.estSub.renomear(s.id, p.titulo, false))) {
        p.titulo = s.nome;
        if (paginas[atual] === p) $('est-sessao-pag-titulo').value = s.nome;
        renderPaginas();
      }
    }
  }

  /* =============================================
     SALVAMENTO E SINCRONIA ENTRE APARELHOS
     O resumo pode estar aberto no PC e no tablet ao mesmo tempo. Cada aparelho grava só as
     páginas que mudou (sujo): antes de gravar, confere se o servidor ainda está na versão que
     ele conhece (updated_at); se não, junta as páginas do outro aparelho e tenta de novo.
     A cada SINC_MS, busca o que o outro gravou (só as páginas novas, pela função resumo_partes do
     supabase/sincronia.sql; sem ela, o resumo inteiro). Mesma página mudada nos dois: fica a deste.
  ============================================= */
  const SINC_MS = 3000;
  const DIVISAO = /(?=<h1 class="est-pagina">)/;    // a mesma do resumo_partes, no SQL
  let base = new Map();       // uid → { titulo, html, semTitulo }: as páginas como estão no servidor
  let baseBruta = '';         // o conteudo do servidor, exatamente
  let baseUpdated;            // updated_at dessa versão (undefined: ainda não conferido)
  let hashesBase = null;      // cache de resumo_partes para baseBruta
  let apagadas = new Set();   // uids das páginas apagadas aqui e ainda não gravadas
  let ordemSuja = false;
  let uidSeq = 0;
  let fila = Promise.resolve();
  let timerSinc = null, sincOcupado = false, temRpc = true, avisoConflito = '';

  const numerada = p => { if (!p.uid) p.uid = 'p' + (++uidSeq); if (!p.sujo) p.sujo = 0; return p; };
  const chavePag = p => (p.semTitulo ? '\u0000' : String(p.titulo).trim().toLowerCase());
  const chaveResumo = () => makeResumoKey(ctx.disc, ctx.topico);
  const idResumo = () => (ctx && (resumosMap[chaveResumo()] || {}).id) || null;
  const tabelaResumos = () => window.supabaseClient.from('resumos');
  const temMudanca = () => ordemSuja || apagadas.size > 0 || paginas.some(p => p.sujo);
  // Página da tinta (estudos.tinta.js): o assunto não muda com o nome; sem assunto, o título
  const paginaDaTinta = () => { const p = paginas[atual] || {}; return p.sub || (p.semTitulo ? '_geral' : 't:' + chavePag(p)); };

  // Dá a cada página da lista o uid da página de mesmo título em refs ([{ uid, chave }])
  function casar(lista, refs) {
    const livres = new Map();
    refs.forEach(r => { if (!livres.has(r.chave)) livres.set(r.chave, []); livres.get(r.chave).push(r.uid); });
    lista.forEach(p => { const l = livres.get(chavePag(p)); p.uid = (l && l.shift()) || null; numerada(p); p.sujo = 0; });
    return lista;
  }

  function definirBase(conteudo, updated) {
    const ps = casar(separarPaginas(conteudo), paginas.map(p => ({ uid: p.uid, chave: chavePag(p) })));
    base = new Map(ps.map(p => [p.uid, { titulo: p.titulo, html: p.html, semTitulo: p.semTitulo }]));
    baseBruta = conteudo;
    baseUpdated = updated;
    hashesBase = null;
  }

  // O resumo no mapa global do v5 (Meus Resumos lê dele)
  function entrada() {
    const key = chaveResumo();
    if (!resumosMap[key]) resumosMap[key] = { id: null, conteudo: '', disciplina_nome: ctx.disc.trim(), topico_nome: ctx.topico.trim() };
    return resumosMap[key];
  }

  // Mesmo backup local do salvarResumo do v5
  function guardarLocal(html) {
    entrada().conteudo = html;
    try {
      const b = JSON.parse(localStorage.getItem('est_resumos_backup') || '{}');
      b[chaveResumo()] = html;
      localStorage.setItem('est_resumos_backup', JSON.stringify(b));
    } catch (e) { /* sem espaço: fica só no servidor */ }
  }

  // Uma operação de cada vez (gravar e buscar mexem nas mesmas páginas)
  function enfileirar(fn) {
    const p = fila.then(fn, fn);
    fila = p.catch(e => console.error('Sincronia do resumo:', e));
    return p;
  }

  async function sha(s) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  async function dadosDaBase() {
    if (hashesBase && hashesBase.bruta === baseBruta) return hashesBase;
    const partes = baseBruta.split(DIVISAO);
    const hs = await Promise.all(partes.map(sha));
    const uris = [...new Set([...baseBruta.matchAll(/"(data:image\/[^"]+)"/g)].map(m => m[1]))];
    const his = await Promise.all(uris.map(sha));
    hashesBase = { bruta: baseBruta, hashes: hs, porHash: new Map(hs.map((h, i) => [h, partes[i]])), imagens: his, img: new Map(his.map((h, i) => [h, uris[i]])) };
    return hashesBase;
  }

  // O resumo no servidor: { conteudo, updated_at }, null se não existe mais, false se não deu para ler
  async function baixar(id) {
    if (temRpc) {
      const d = await dadosDaBase();
      const { data, error } = await window.supabaseClient.rpc('resumo_partes', { p_id: id, p_hashes: d.hashes, p_imagens: d.imagens });
      if (!error) {
        if (!data) return null;
        let falta = false;
        const conteudo = data.partes.map(p => (p.html === undefined ? d.porHash.get(p.h)
          : p.html.replace(/"ref:([0-9a-f]{64})"/g, (m, h) => (d.img.has(h) ? `"${d.img.get(h)}"` : (falta = true, m))))).join('');
        if (!falta && !data.partes.some(p => p.html === undefined && !d.porHash.has(p.h))) return { conteudo, updated_at: data.updated_at };
      } else if (error.code === 'PGRST202') temRpc = false;   // função não criada: baixa o resumo inteiro
      else return false;
    }
    const { data, error } = await tabelaResumos().select('conteudo, updated_at').eq('id', id).maybeSingle();
    if (error) return false;
    return data ? { conteudo: data.conteudo || '', updated_at: data.updated_at } : null;
  }

  // Busca a versão do servidor e junta com a daqui. Devolve false se não conseguiu.
  async function puxarRemoto() {
    const c = ctx;
    let id = idResumo();
    if (!id) {
      // Ainda sem resumo conhecido: o outro aparelho pode ter criado
      const { data, error } = await tabelaResumos().select('id, conteudo, updated_at')
        .eq('disciplina_nome', c.disc.trim()).eq('topico_nome', c.topico.trim()).maybeSingle();
      if (error || ctx !== c) return false;
      if (!data) { baseUpdated = null; return true; }
      entrada().id = data.id;
      return aplicar(data.conteudo || '', data.updated_at, c);
    }
    const r = await baixar(id);
    if (r === false || ctx !== c) return false;
    if (r === null) {   // apagado em outro lugar: a próxima gravação cria de novo
      entrada().id = null;
      paginas.forEach(p => { if (!vazio(p.html)) p.sujo++; });
      definirBase('', null);
      return true;
    }
    return r.updated_at === baseUpdated || aplicar(r.conteudo, r.updated_at, c);
  }

  async function aplicar(conteudo, updated, c) {
    if (comAssuntos()) await window.estSub.atualizarDoItem(ctx.topicoId, separarPaginas(conteudo));
    if (ctx !== c) return false;
    aplicarRemoto(conteudo, updated);
    return true;
  }

  /* Junta as páginas do servidor (delas) com as daqui. Página alterada aqui e ainda não gravada
     fica a daqui; as outras ficam como no servidor; página nova lá entra no lugar dela;
     página apagada lá some daqui (se não mudou aqui); apagada aqui volta só se mudou lá. */
  function aplicarRemoto(conteudo, updated) {
    if (conteudo === baseBruta) { baseUpdated = updated; return; }   // igual ao que já está aqui (ao abrir, quase sempre)
    quill.update();   // letra digitada que o Quill ainda não registrou conta como alteração
    guardarPaginaAtual();
    const delas = casar(separarPaginas(conteudo), [...base].map(([uid, b]) => ({ uid, chave: chavePag(b) })));
    const porUid = new Map(delas.map(d => [d.uid, d]));
    const aberta = paginas[atual];
    const antesDaAberta = base.get(aberta.uid);
    const minhas = new Set(paginas.map(p => p.uid));
    const conflitos = [];
    let res = [];
    paginas.forEach(m => {
      const d = porUid.get(m.uid), b = base.get(m.uid);
      if (m.sujo) {
        if (d && b && (d.html !== b.html || d.titulo !== b.titulo)) conflitos.push(m.titulo);
        res.push(m);
      } else if (d) {
        Object.assign(m, { titulo: d.titulo, html: d.html, semTitulo: d.semTitulo });
        res.push(m);
      } else if (!b) res.push(m);   // criada aqui (vazia), ainda não gravada
    });
    let anterior = null;
    delas.forEach(d => {
      if (minhas.has(d.uid)) { anterior = d.uid; return; }
      const b = base.get(d.uid);
      if (b && b.html === d.html && b.titulo === d.titulo) return;   // apagada aqui e intacta lá
      apagadas.delete(d.uid);
      const k = anterior ? res.findIndex(p => p.uid === anterior) + 1 : (res[0] && res[0].semTitulo ? 1 : 0);
      res.splice(k, 0, d);
      anterior = d.uid;
    });
    const mudouAberta = porUid.has(aberta.uid) && !aberta.sujo && (!antesDaAberta || antesDaAberta.html !== porUid.get(aberta.uid).html);
    base = new Map(delas.map(d => [d.uid, { titulo: d.titulo, html: d.html, semTitulo: d.semTitulo }]));
    baseBruta = conteudo;
    baseUpdated = updated;
    hashesBase = null;
    entrada().conteudo = conteudo;
    if (comAssuntos()) res = window.estSub.ligarPaginas(ctx.topicoId, res).map(numerada);
    paginas = res;
    atual = Math.max(0, paginas.findIndex(p => p.uid === aberta.uid));
    if (mudouAberta || paginas[atual].uid !== aberta.uid) {
      const rolagem = quill.container.scrollTop;
      const sel = quill.hasFocus() ? quill.getSelection() : null;
      porNoEditor(paginas[atual].html);
      tituloDaPagina();
      if (sel) quill.setSelection(Math.min(sel.index, quill.getLength() - 1), 0, 'silent');
      quill.container.scrollTop = rolagem;
      esconderAlca();
    }
    renderPaginas();
    if (window.estTinta) window.estTinta.pagina();
    // O aviso de conflito fica até a próxima gravação terminar (senão o "Salvo" o apagaria na hora)
    if (conflitos.length) avisoConflito = `⚠ “${conflitos.join('”, “')}” também mudou no outro aparelho; ficou a versão deste.`;
    status(avisoConflito || 'Atualizado com o outro aparelho');
  }

  // Grava as páginas alteradas, juntando antes as do outro aparelho se ele gravou no meio
  async function gravarRemoto() {
    const c = ctx;
    if (baseUpdated === undefined && !(await puxarRemoto())) { guardarLocal(juntarPaginas()); status('Sem conexão: salvo só neste aparelho'); return; }
    for (let tentativa = 0; tentativa < 4 && ctx === c; tentativa++) {
      guardarPaginaAtual();
      const html = juntarPaginas();
      const marcas = new Map(paginas.map(p => [p.uid, p.sujo]));
      const id = idResumo();
      let updated;
      if (!id || vazio(html)) {
        // Primeira gravação (cria) ou resumo vazio (apaga): o caminho de sempre
        await salvarResumo(c.disc, c.topico, html, true);
        const novo = idResumo();
        const r = novo ? await tabelaResumos().select('updated_at').eq('id', novo).maybeSingle() : { data: null };
        updated = r.data ? r.data.updated_at : null;
      } else {
        let q = tabelaResumos().update({ conteudo: html, updated_at: new Date().toISOString() }).eq('id', id);
        q = baseUpdated == null ? q.is('updated_at', null) : q.eq('updated_at', baseUpdated);
        const { data, error } = await q.select('updated_at');
        if (error) { guardarLocal(html); status('Sem conexão: salvo só neste aparelho'); return; }
        if (!data.length) {   // o outro aparelho gravou antes
          if (!(await puxarRemoto())) { guardarLocal(html); status('Sem conexão: salvo só neste aparelho'); return; }
          continue;
        }
        updated = data[0].updated_at;
        guardarLocal(html);
      }
      if (ctx !== c) return;
      paginas.forEach(p => { if (marcas.get(p.uid) === p.sujo) p.sujo = 0; });
      apagadas.clear();
      ordemSuja = false;
      definirBase(html, updated);   // a base passa a ser o que foi gravado
      status(temMudanca() ? 'Alterações não salvas' : avisoConflito || 'Salvo');
      avisoConflito = '';
      return;
    }
  }

  function status(txt) { $('est-sessao-status').textContent = txt; }

  function agendarSalvar() {
    if (paginas[atual]) paginas[atual].sujo++;
    status('Alterações não salvas');
    clearTimeout(timerSalvar);
    timerSalvar = setTimeout(salvar, AUTOSAVE_MS);
  }

  async function salvar() {
    clearTimeout(timerSalvar);
    if (!ctx) return;
    guardarPaginaAtual();
    if (comAssuntos()) await sincronizarNomes();
    if (!temMudanca()) { status('Salvo'); return; }
    status('Salvando…');
    await enfileirar(gravarRemoto);
  }

  // A cada SINC_MS com a janela à vista: o outro aparelho gravou? (só a data; o conteúdo só se mudou)
  async function sincronizarAgora() {
    if (!ctx || document.hidden || sincOcupado) return;
    sincOcupado = true;
    try {
      await enfileirar(async () => {
        if (!ctx) return;
        const id = idResumo();
        if (!id) { await puxarRemoto(); return; }
        const { data, error } = await tabelaResumos().select('updated_at').eq('id', id).maybeSingle();
        if (!error && ctx && (!data || data.updated_at !== baseUpdated)) await puxarRemoto();
      });
      if (window.estTinta && ctx) await window.estTinta.puxar();
    } finally {
      sincOcupado = false;
    }
  }

  /* =============================================
     CRONÔMETRO
     Guarda horários, não contagens: continua certo com a janela fechada ou a página recarregada.
     estado = { acum: ms de estudo, rodando, desde: início do trecho atual,
                pomodoro, fase: 'foco' | 'pausa', faseMs: ms já passados na fase }
  ============================================= */
  function lerCronos() {
    try { return JSON.parse(localStorage.getItem(CHAVE_CRONO)) || {}; } catch (e) { return {}; }
  }

  function gravarCrono(id, estado) {
    const todos = lerCronos();
    if (estado) todos[id] = estado; else delete todos[id];
    try { localStorage.setItem(CHAVE_CRONO, JSON.stringify(todos)); } catch (e) { /* armazenamento cheio ou bloqueado */ }
  }

  function crono() {
    return lerCronos()[ctx.id] || { acum: 0, rodando: false, desde: 0, pomodoro: false, fase: 'foco', faseMs: 0 };
  }

  function cicloEscolhido() {
    let v = null;
    try { v = localStorage.getItem(CHAVE_CICLO); } catch (e) { /* sem armazenamento */ }
    return CICLOS[v] ? v : CICLO_PADRAO;
  }

  // Duração da fase atual do Pomodoro, em ms
  function duracaoFase(fase) {
    const [foco, pausa] = CICLOS[cicloEscolhido()];
    return (fase === 'foco' ? foco : pausa) * 60000;
  }

  // Leva o trecho em andamento para os totais e troca de fase no Pomodoro
  function atualizarCrono(c) {
    if (c.rodando) {
      const agora = Date.now();
      const d = agora - c.desde;
      if (c.fase === 'foco') {
        c.acum += d;
        // Tempo de cada assunto: o que estava selecionado enquanto o cronômetro rodava ('' = anotações gerais)
        const k = c.assunto || '';
        c.porAssunto = { ...(c.porAssunto || {}), [k]: ((c.porAssunto || {})[k] || 0) + d };
      }
      c.faseMs += d;
      c.desde = agora;
    }
    let trocou = false;
    while (c.pomodoro) {
      const dur = duracaoFase(c.fase);
      if (c.faseMs < dur) break;
      const sobra = c.faseMs - dur;
      if (c.fase === 'foco') { c.acum -= sobra; c.fase = 'pausa'; }
      else { c.acum += sobra; c.fase = 'foco'; }
      c.faseMs = sobra;
      trocou = true;
    }
    return trocou;
  }

  function fmt(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, seg = s % 60;
    const dois = n => String(n).padStart(2, '0');
    return (h ? h + ':' + dois(m) : dois(m)) + ':' + dois(seg);
  }

  function renderCrono() {
    if (!ctx || !ctx.id) return;
    const c = crono();
    if (atualizarCrono(c) && c.rodando) bipe();
    c.tipo = ctx.tipo || 'meta';
    c.rotulo = `${ctx.rotulo} · ${ctx.topico}`;
    gravarCrono(ctx.id, c);

    const meta = ctx.minutos * 60000;
    $('est-sessao-barra').style.width = Math.min(100, meta ? c.acum / meta * 100 : 0) + '%';
    $('est-sessao-meta').textContent = `meta: ${window.estPlano.fmtMin(ctx.minutos)}`;
    $('est-sessao-play').textContent = c.rodando ? '⏸ Pausar' : c.acum || c.faseMs ? '▶ Continuar' : '▶ Iniciar';
    $('est-sessao-pomodoro').checked = c.pomodoro;
    $('est-sessao-ciclo').value = cicloEscolhido();
    const relogio = $('est-sessao-relogio');
    relogio.classList.toggle('pausa', c.pomodoro && c.fase === 'pausa');
    relogio.classList.toggle('rodando', c.rodando);
    if (c.pomodoro) {
      const dur = duracaoFase(c.fase);
      $('est-sessao-fase').textContent = c.fase === 'foco' ? `🍅 Foco · ${fmt(c.acum)} estudados` : '☕ Pausa';
      $('est-sessao-tempo').textContent = fmt(Math.max(0, dur - c.faseMs));
    } else {
      $('est-sessao-fase').textContent = 'Tempo estudado';
      $('est-sessao-tempo').textContent = fmt(c.acum);
    }
  }

  /* Cronômetro flutuante: com a janela fechada, fica no topo da página o cronômetro rodando ou,
     sem nenhum rodando, o último pausado com tempo (até ser dispensado no ✕ ou a meta ser concluída).
     "Pausar/Continuar" e "Abrir" (volta à janela de estudo da meta). */
  function rodandoFora() {
    let achado = null;
    const nota = c => (c.rodando ? 2 : !c.oculto && (c.acum > 0 || c.faseMs > 0) ? 1 : 0);
    Object.entries(lerCronos()).forEach(([id, c]) => {
      if (nota(c) && (!achado || nota(c) > nota(achado.c) || (nota(c) === nota(achado.c) && c.desde > achado.c.desde))) achado = { id, c };
    });
    return achado;
  }

  function renderFlutuante() {
    const el = $('est-crono-flutuante');
    if (!el) return;
    const r = !ctx && rodandoFora();
    el.hidden = !r;
    if (!r) return;
    const { id, c } = r;
    if (atualizarCrono(c)) bipe();
    gravarCrono(id, c);
    const pausa = c.pomodoro && c.fase === 'pausa';
    el.classList.toggle('pausa', pausa && c.rodando);
    el.classList.toggle('parado', !c.rodando);
    el.querySelector('[data-a="pausar"]').textContent = c.rodando ? '⏸ Pausar' : '▶ Continuar';
    el.querySelector('[data-a="dispensar"]').hidden = c.rodando;
    el.querySelector('.est-crono-fl-tempo').textContent = c.pomodoro ? fmt(Math.max(0, duracaoFase(c.fase) - c.faseMs)) : fmt(c.acum);
    el.querySelector('.est-crono-fl-fase').textContent = !c.rodando ? '⏸ Pausado' : c.pomodoro ? (pausa ? '☕ Pausa' : '🍅 Foco') : '⏱ Estudando';
    el.querySelector('.est-crono-fl-rotulo').textContent = c.rotulo || '';
    el.dataset.id = id;
    el.dataset.tipo = c.tipo || 'meta';
  }

  function criarFlutuante() {
    const el = document.createElement('div');
    el.id = 'est-crono-flutuante';
    el.className = 'est-crono-flutuante';
    el.hidden = true;
    el.setAttribute('role', 'status');
    el.innerHTML = `<div class="est-crono-fl-info"><span class="est-crono-fl-fase"></span><span class="est-crono-fl-rotulo"></span></div>
      <strong class="est-crono-fl-tempo">00:00</strong>
      <button type="button" data-a="pausar">⏸ Pausar</button>
      <button type="button" data-a="abrir" class="primario">Abrir</button>
      <button type="button" data-a="dispensar" class="fechar" title="Esconder (o tempo continua guardado na meta)" aria-label="Esconder o cronômetro">✕</button>`;
    el.addEventListener('click', ev => {
      const a = ev.target.closest('button') && ev.target.closest('button').dataset.a;
      const id = el.dataset.id;
      if (!a || !id) return;
      if (a === 'pausar' || a === 'dispensar') {
        const c = lerCronos()[id];
        if (c && a === 'pausar') { atualizarCrono(c); c.rodando = !c.rodando; c.oculto = false; c.desde = Date.now(); gravarCrono(id, c); }
        if (c && a === 'dispensar') { c.oculto = true; gravarCrono(id, c); }
        renderFlutuante();
        if (window.estPlano) window.estPlano.renderTudo();   // selo ⏱ da lista
      } else window.estPlano.abrirEstudo(el.dataset.tipo, id);
    });
    document.body.appendChild(el);
    renderFlutuante();
    setInterval(renderFlutuante, 1000);
  }

  function alternarPlay() {
    const c = crono();
    atualizarCrono(c);
    c.rodando = !c.rodando;
    c.oculto = false;
    c.desde = Date.now();
    gravarCrono(ctx.id, c);
    renderCrono();
  }

  async function zerar() {
    const c = crono();
    atualizarCrono(c);
    if (c.acum > 60000 && !(await window.customConfirm('Zerar o cronômetro desta meta?'))) return;
    gravarCrono(ctx.id, { ...c, acum: 0, rodando: false, fase: 'foco', faseMs: 0, porAssunto: {} });
    renderCrono();
  }

  function alternarPomodoro() {
    const c = crono();
    atualizarCrono(c);
    c.pomodoro = $('est-sessao-pomodoro').checked;
    c.fase = 'foco';
    c.faseMs = 0;
    gravarCrono(ctx.id, c);
    renderCrono();
  }

  function trocarCiclo() {
    try { localStorage.setItem(CHAVE_CICLO, $('est-sessao-ciclo').value); } catch (e) { /* sem armazenamento */ }
    renderCrono();
  }

  function bipe() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.35, 0.7].forEach(t => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.2, ac.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + t + 0.25);
        o.connect(g).connect(ac.destination);
        o.start(ac.currentTime + t);
        o.stop(ac.currentTime + t + 0.25);
      });
      setTimeout(() => ac.close(), 1500);
    } catch (e) { /* sem áudio */ }
  }

  // O assunto selecionado passa a receber o tempo do cronômetro
  function marcarAssuntoNoCrono() {
    if (!ctx || !ctx.id) return;
    const c = crono();
    atualizarCrono(c);
    c.assunto = subAtual();
    gravarCrono(ctx.id, c);
  }

  /* Minutos de cada assunto numa meta/revisão: o total estudado dividido pelo tempo em que cada
     assunto ficou selecionado. { [id do assunto]: min }; '' = anotações gerais (sem subtópico). */
  function tempoPorAssunto(id) {
    const c = lerCronos()[id];
    if (!c || !c.porAssunto) return {};
    atualizarCrono(c);
    const soma = Object.values(c.porAssunto).reduce((a, v) => a + v, 0);
    return soma ? Object.fromEntries(Object.entries(c.porAssunto).map(([k, v]) => [k, Math.round(c.acum * v / soma / 60000)])) : {};
  }

  /* Minutos estudados no cronômetro de uma meta/revisão (0 se não houver) */
  function minutosDe(id) {
    const c = lerCronos()[id];
    if (!c) return 0;
    atualizarCrono(c);
    return Math.round(c.acum / 60000);
  }

  /* Selo para a lista do plano: mostra que há um cronômetro em andamento */
  function selo(id) {
    const c = lerCronos()[id];
    if (!c || (!c.rodando && c.acum < 60000)) return '';
    return ` · <span class="est-sessao-selo ${c.rodando ? 'rodando' : ''}" title="${c.rodando ? 'Cronômetro rodando' : 'Cronômetro pausado'}">⏱ ${minutosDe(id)} min</span>`;
  }

  /* =============================================
     IMAGENS
     Fotos coladas, arrastadas ou inseridas são reduzidas (ficam em base64 dentro do resumo).
     Clicar numa imagem mostra alças para redimensionar; a largura fica no atributo width,
     que o Image do Quill 1.3.6 já preserva.
  ============================================= */
  const IMG_LADO_MAX = 1600;        // px no maior lado
  const IMG_QUALIDADE = 0.85;       // JPEG
  const IMG_MANTER_PNG = 400 * 1024; // prints pequenos ficam em PNG (texto nítido)
  const IMG_LARGURA_MIN = 40;
  let alca = null;                  // { caixa, img }

  function reduzirImagem(arquivo) {
    return new Promise((ok, falha) => {
      const url = URL.createObjectURL(arquivo);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const escala = Math.min(1, IMG_LADO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
        if (escala === 1 && arquivo.type === 'image/png' && arquivo.size <= IMG_MANTER_PNG) {
          const leitor = new FileReader();
          leitor.onload = () => ok(leitor.result);
          leitor.onerror = falha;
          leitor.readAsDataURL(arquivo);
          return;
        }
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * escala);
        c.height = Math.round(img.naturalHeight * escala);
        const g = c.getContext('2d');
        g.fillStyle = '#fff';             // PNG transparente não fica preto no JPEG
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        ok(c.toDataURL('image/jpeg', IMG_QUALIDADE));
      };
      img.onerror = () => { URL.revokeObjectURL(url); falha(new Error('Imagem inválida')); };
      img.src = url;
    });
  }

  async function inserirImagens(arquivos) {
    const imagens = Array.from(arquivos).filter(f => f && f.type.startsWith('image/'));
    if (!imagens.length) return false;
    const sel = quill.getSelection(true);
    let i = sel ? sel.index : quill.getLength();
    if (sel && sel.length) quill.deleteText(sel.index, sel.length, 'user');
    status('Inserindo imagem…');
    for (const f of imagens) {
      try {
        quill.insertEmbed(i, 'image', await reduzirImagem(f), 'user');
        i++;
      } catch (e) {
        console.error('Erro ao inserir imagem:', e);
      }
    }
    quill.setSelection(i, 0, 'silent');
    return true;
  }

  function larguraUtil() {
    const st = getComputedStyle(quill.root);
    return quill.root.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight);
  }

  function posicionarAlca() {
    if (!alca || !alca.img) return;
    const folha = alca.caixa.parentElement.getBoundingClientRect();
    const r = alca.img.getBoundingClientRect();
    Object.assign(alca.caixa.style, {
      left: (r.left - folha.left) + 'px', top: (r.top - folha.top) + 'px',
      width: r.width + 'px', height: r.height + 'px'
    });
    alca.caixa.querySelector('.est-img-medida').textContent = `${Math.round(r.width)} px`;
    alca.caixa.querySelector('.est-img-editar').hidden = !alca.img.classList.contains('est-desenho');
  }

  function esconderAlca() {
    if (moverArmado) desarmarMover();
    if (alca) alca.caixa.hidden = true;
    alca = alca && { caixa: alca.caixa, img: null };
  }

  function mostrarAlca(img) {
    const caixa = alca ? alca.caixa : criarAlca();
    alca = { caixa, img };
    caixa.hidden = false;
    posicionarAlca();
  }

  function definirLargura(px) {
    if (!alca || !alca.img) return;
    const w = Math.round(Math.max(IMG_LARGURA_MIN, Math.min(px, larguraUtil())));
    alca.img.removeAttribute('height');
    const blot = Quill.find(alca.img);
    if (blot && blot.format) blot.format('width', String(w)); else alca.img.setAttribute('width', w);
    posicionarAlca();
    agendarSalvar();
  }

  function criarAlca() {
    const caixa = document.createElement('div');
    caixa.className = 'est-img-alca';
    caixa.hidden = true;
    caixa.innerHTML = `
      <div class="est-img-arrasto" title="Arraste para levar a outro ponto do texto"></div>
      ${['no', 'ne', 'so', 'se'].map(c => `<span class="est-img-ponto ${c}" data-canto="${c}" aria-hidden="true"></span>`).join('')}
      <div class="est-img-barra" role="toolbar" aria-label="Tamanho da imagem">
        <span class="est-img-medida"></span>
        ${[25, 50, 75, 100].map(p => `<button type="button" data-pct="${p}">${p}%</button>`).join('')}
        <button type="button" class="est-img-mover" title="Toque aqui e depois no ponto do texto para onde vai a imagem (ou arraste a própria imagem)">✥ Mover</button>
        <span class="est-img-dica" hidden>Toque no texto onde ela deve ficar</span>
        <button type="button" class="est-img-editar" title="Continuar o desenho (ou dois cliques nele)">✏️ Editar</button>
      </div>`;
    $('est-sessao-editor').parentElement.appendChild(caixa);

    caixa.querySelectorAll('[data-pct]').forEach(b => b.addEventListener('click', () => {
      definirLargura(larguraUtil() * Number(b.dataset.pct) / 100);
    }));
    caixa.querySelector('.est-img-editar').addEventListener('click', () => {
      const img = alca && alca.img;
      esconderAlca();
      if (img) desenhar(img);
    });
    caixa.querySelector('.est-img-mover').addEventListener('click', () => (moverArmado ? desarmarMover() : armarMover()));
    // Arrastar a própria imagem também move; fica por cima dela, então tocar não abre o teclado
    const arrasto = caixa.querySelector('.est-img-arrasto');
    arrasto.addEventListener('pointerdown', arrastarImagem);
    arrasto.addEventListener('dblclick', () => {
      const img = alca && alca.img;
      if (img && img.classList.contains('est-desenho')) { esconderAlca(); desenhar(img); }
    });

    // Arrastar um canto: a largura muda pelo deslocamento horizontal (a altura acompanha)
    caixa.querySelectorAll('.est-img-ponto').forEach(p => p.addEventListener('pointerdown', ev => {
      if (!alca || !alca.img) return;
      ev.preventDefault();
      p.setPointerCapture(ev.pointerId);
      const esquerda = p.dataset.canto.endsWith('o');
      const x0 = ev.clientX;
      const w0 = alca.img.getBoundingClientRect().width;
      const mover = e => {
        const w = Math.max(IMG_LARGURA_MIN, Math.min(w0 + (esquerda ? x0 - e.clientX : e.clientX - x0), larguraUtil()));
        alca.img.setAttribute('width', Math.round(w));
        alca.img.removeAttribute('height');
        posicionarAlca();
      };
      const soltar = e => {
        p.removeEventListener('pointermove', mover);
        p.removeEventListener('pointerup', soltar);
        p.removeEventListener('pointercancel', soltar);
        mover(e);
        definirLargura(alca.img.getBoundingClientRect().width);
      };
      p.addEventListener('pointermove', mover);
      p.addEventListener('pointerup', soltar);
      p.addEventListener('pointercancel', soltar);
    }));
    return caixa;
  }

  /* "✥ Mover": arrasta a foto ou o desenho selecionado; uma linha mostra onde vai entrar e,
     ao soltar, ele sai de onde estava e entra ali (com a largura). Perto da borda, a folha rola. */
  function caretEm(x, y) {
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      return r && { no: r.startContainer, pos: r.startOffset };
    }
    const c = document.caretPositionFromPoint && document.caretPositionFromPoint(x, y);
    return c && { no: c.offsetNode, pos: c.offset };
  }

  function indiceEm(x, y) {
    const c = caretEm(x, y);
    if (!c || !quill.root.contains(c.no)) return null;
    const blot = Quill.find(c.no, true);
    if (!blot || blot === quill.scroll) return null;
    return quill.getIndex(blot) + (c.no.nodeType === 3 ? c.pos : 0);
  }

  function rolavelDe(el) {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const st = getComputedStyle(e);
      if (/(auto|scroll)/.test(st.overflowY) && e.scrollHeight > e.clientHeight) return e;
    }
    return null;
  }

  // Tira a imagem de onde está e põe no índice "para" do texto (com a largura). Devolve a imagem nova.
  function moverImagem(img, para) {
    const blot = Quill.find(img);
    if (!blot || para === null) return img;
    const de = quill.getIndex(blot);
    if (para === de || para === de + 1) return img;
    const Delta = Quill.import('delta');
    quill.update('silent');   // a largura das alças muda o DOM direto; sem isto o Quill copiaria a antiga
    const item = quill.getContents(de, 1);
    // Desenho é bloco: solto no fim de uma linha, entra no começo da seguinte (sem partir o parágrafo)
    if (item.ops[0] && item.ops[0].insert && item.ops[0].insert.desenho !== undefined && quill.getText(para, 1) === '\n') para++;
    if (para === de || para === de + 1) return img;
    quill.deleteText(de, 1, 'user');
    const alvo = para > de ? para - 1 : para;
    quill.updateContents(new Delta().retain(alvo).concat(item), 'user');
    return [...quill.root.querySelectorAll('img')].find(i => { const b = Quill.find(i); return b && quill.getIndex(b) === alvo; }) || null;
  }

  /* "✥ Mover" por toque: o botão arma e o próximo toque no texto diz o destino (no tablet,
     arrastar um botão pequeno não funcionava bem). Tocar de novo no botão ou Esc cancela. */
  let moverArmado = null;
  function armarMover() {
    if (!alca || !alca.img) return;
    moverArmado = alca.img;
    alca.caixa.classList.add('armado');
    alca.caixa.querySelector('.est-img-mover').textContent = '✕ Cancelar';
    alca.caixa.querySelector('.est-img-dica').hidden = false;
  }
  function desarmarMover() {
    moverArmado = null;
    if (!alca) return;
    alca.caixa.classList.remove('armado');
    alca.caixa.querySelector('.est-img-mover').textContent = '✥ Mover';
    alca.caixa.querySelector('.est-img-dica').hidden = true;
  }

  function arrastarImagem(ev) {
    if (!alca || !alca.img || ev.button > 0) return;
    ev.preventDefault();
    const img = alca.img, caixa = alca.caixa, folha = caixa.parentElement;
    const blot = Quill.find(img);
    if (!blot) return;
    desarmarMover();
    try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch (e) { /* segue pelos eventos da janela */ }
    const linha = document.createElement('div');
    linha.className = 'est-img-destino';
    linha.hidden = true;
    folha.appendChild(linha);
    const rolavel = rolavelDe(quill.root);
    const x0 = ev.clientX, y0 = ev.clientY;
    let para = null, giro = null, ultimo = null, andou = false;
    const marcar = () => {
      if (!ultimo) return;
      const i = indiceEm(ultimo.x, ultimo.y);
      para = i;
      if (i === null) { linha.hidden = true; return; }
      const b = quill.getBounds(i), f = folha.getBoundingClientRect(), c = quill.container.getBoundingClientRect();
      Object.assign(linha.style, { left: (c.left - f.left + b.left) + 'px', top: (c.top - f.top + b.top) + 'px', height: Math.max(18, b.height) + 'px' });
      linha.hidden = false;
    };
    const rolar = () => {
      giro = null;
      if (!rolavel || !ultimo) return;
      const r = rolavel.getBoundingClientRect();
      const d = ultimo.y < r.top + 40 ? -14 : ultimo.y > r.bottom - 40 ? 14 : 0;
      if (!d) return;
      rolavel.scrollTop += d;
      marcar();
      giro = requestAnimationFrame(rolar);
    };
    const mover = e => {
      // Só começa a mover depois de 6 px: um toque parado deixa a imagem selecionada
      if (!andou && Math.hypot(e.clientX - x0, e.clientY - y0) < 6) return;
      if (!andou) { andou = true; caixa.classList.add('movendo'); img.classList.add('est-img-movendo'); }
      ultimo = { x: e.clientX, y: e.clientY };
      marcar();
      if (!giro) giro = requestAnimationFrame(rolar);
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', soltar);
      if (giro) cancelAnimationFrame(giro);
      linha.remove();
      caixa.classList.remove('movendo');
      img.classList.remove('est-img-movendo');
      if (!andou) return;
      esconderAlca();
      const nova = moverImagem(img, para);
      if (nova) mostrarAlca(nova);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
  }

  /* =============================================
     COLAR TEXTO DE SITES (comentários do TEC etc.)
     O navegador copia as cores calculadas da página: fundo do cartão, texto cinza ou branco
     (modo escuro). Fica só o que é grifo de verdade: negrito, itálico, sublinhado, tachado,
     realce colorido em trechos e texto colorido. Ctrl+Shift+V cola sem formatação.
  ============================================= */
  const TAGS_EM_LINHA = new Set(['SPAN', 'MARK', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'INS', 'A', 'FONT', 'SUB', 'SUP', 'SMALL', 'BIG', 'CODE']);
  const REALCE_PADRAO = 'rgb(255, 241, 118)';   // <mark> sem cor própria
  let ctxCor = null;

  // Qualquer cor CSS -> { r, g, b, a, l (0-1), s (0-1) }, ou null
  function lerCor(css) {
    if (!css || /transparent|inherit|initial|currentcolor/i.test(css)) return null;
    ctxCor = ctxCor || document.createElement('canvas').getContext('2d');
    ctxCor.fillStyle = '#010203';
    ctxCor.fillStyle = css;
    const v = ctxCor.fillStyle;
    if (v === '#010203' && !/^#010203$/i.test(css.trim())) return null;   // cor inválida
    let r, g, b, a = 1, m;
    if ((m = /^#([0-9a-f]{6})$/i.exec(v))) [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].substr(i, 2), 16));
    else if ((m = /rgba?\(([^)]+)\)/.exec(v))) [r, g, b, a = 1] = m[1].split(',').map(Number);
    else return null;
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
    const l = (max + min) / 2;
    const s = max === min ? 0 : (max - min) / (l > 0.5 ? 2 - max - min : max + min);
    return { r, g, b, a, l, s };
  }

  // Realce escuro (modo escuro do site) fica ilegível com texto preto: clareia mantendo o tom
  function realceLegivel(c) {
    const brilho = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;   // percebido: amarelo puro é claro
    if (brilho >= 150) return `rgb(${c.r}, ${c.g}, ${c.b})`;
    const k = 0.65;   // mistura com branco
    const mix = v => Math.round(v + (255 - v) * k);
    return `rgb(${mix(c.r)}, ${mix(c.g)}, ${mix(c.b)})`;
  }

  function envolver(el, tag) {
    const novo = document.createElement(tag);
    while (el.firstChild) novo.appendChild(el.firstChild);
    el.appendChild(novo);
  }

  function limparHtmlColado(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, meta, link, title, noscript, button, input, select, textarea, svg').forEach(n => n.remove());

    doc.body.querySelectorAll('*').forEach(el => {
      const st = el.style;
      const emLinha = TAGS_EM_LINHA.has(el.tagName);
      const pesado = /^(bold|bolder)$/.test(st.fontWeight) || parseInt(st.fontWeight, 10) >= 600;
      const italico = st.fontStyle === 'italic' || st.fontStyle === 'oblique';
      const deco = `${st.textDecorationLine || ''} ${st.textDecoration || ''}`;

      // Realce: só em trechos, colorido e não branco/cinza (fundo de cartão ou de página)
      let fundo = lerCor(st.backgroundColor || (el.tagName === 'MARK' ? REALCE_PADRAO : ''));
      if (!fundo && el.tagName === 'MARK') fundo = lerCor(REALCE_PADRAO);
      const realce = fundo && emLinha && fundo.a >= 0.15 && fundo.s >= 0.2 && !(fundo.l > 0.94) ? realceLegivel(fundo) : '';

      // Texto colorido: só se tiver cor de verdade e for legível no branco
      const texto = lerCor(st.color || el.getAttribute('color'));
      const corTexto = texto && texto.s >= 0.3 && texto.l <= 0.8 && texto.l >= 0.15 ? `rgb(${texto.r}, ${texto.g}, ${texto.b})` : '';

      const alinhar = /^(center|right|justify)$/.test(st.textAlign) && !emLinha ? st.textAlign : '';
      const tamanho = TAMANHOS.includes(st.fontSize) ? st.fontSize : '';   // copiado do próprio resumo
      // Classes do Quill (alinhamento, recuo, fonte) e de página continuam; as do site saem
      const classes = Array.from(el.classList).filter(c => c.startsWith('ql-') || c === 'est-pagina');
      el.removeAttribute('style');
      el.removeAttribute('class');
      if (classes.length) el.className = classes.join(' ');
      if (tamanho) el.style.fontSize = tamanho;
      el.removeAttribute('color');
      el.removeAttribute('bgcolor');
      if (realce) el.style.backgroundColor = realce;
      if (corTexto) el.style.color = corTexto;
      if (alinhar) el.style.textAlign = alinhar;

      // Estilos de CSS viram tags que o Quill entende
      if (pesado && !/^(B|STRONG|H\d)$/.test(el.tagName)) envolver(el, 'strong');
      if (italico && !/^(I|EM)$/.test(el.tagName)) envolver(el, 'em');
      if (/underline/.test(deco) && el.tagName !== 'U') envolver(el, 'u');
      if (/line-through/.test(deco) && !/^(S|STRIKE|DEL)$/.test(el.tagName)) envolver(el, 's');
    });
    // <mark> vira <span> com fundo (o Quill não conhece <mark>)
    doc.body.querySelectorAll('mark').forEach(m => {
      const span = doc.createElement('span');
      span.setAttribute('style', m.getAttribute('style') || '');
      while (m.firstChild) span.appendChild(m.firstChild);
      m.replaceWith(span);
    });
    return doc.body.innerHTML;
  }

  function colarHtml(html) {
    const sel = quill.getSelection(true);
    const i = sel ? sel.index : quill.getLength();
    if (sel && sel.length) quill.deleteText(sel.index, sel.length, 'user');
    quill.clipboard.dangerouslyPasteHTML(i, limparHtmlColado(html), 'user');
  }

  function iniciarImagens() {
    const raiz = quill.root;
    // Captura: roda antes do colar do Quill, que não sabe tratar arquivos nem as cores de outros sites
    raiz.addEventListener('paste', ev => {
      const dados = ev.clipboardData;
      if (!dados) return;
      const arquivos = Array.from(dados.items || [])
        .filter(it => it.kind === 'file' && it.type.startsWith('image/')).map(it => it.getAsFile());
      const html = dados.getData('text/html');
      // Imagem copiada de um site vem com um HTML que só tem o <img>: usa o arquivo (fica no resumo, reduzido)
      const soImagem = arquivos.length && (!html || !new DOMParser().parseFromString(html, 'text/html').body.textContent.trim());
      if (soImagem) {
        ev.preventDefault();
        ev.stopPropagation();
        inserirImagens(arquivos);
      } else if (html) {
        ev.preventDefault();
        ev.stopPropagation();
        colarHtml(html);
      }
    }, true);
    raiz.addEventListener('drop', ev => {
      const arquivos = ev.dataTransfer && ev.dataTransfer.files;
      if (!arquivos || !Array.from(arquivos).some(f => f.type.startsWith('image/'))) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (document.caretRangeFromPoint) {
        const r = document.caretRangeFromPoint(ev.clientX, ev.clientY);
        const blot = r && Quill.find(r.startContainer, true);
        if (blot) quill.setSelection(quill.getIndex(blot) + (r.startContainer.nodeType === 3 ? r.startOffset : 0), 0, 'silent');
      }
      inserirImagens(arquivos);
    }, true);
    quill.getModule('toolbar').addHandler('image', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.onchange = () => inserirImagens(input.files);
      input.click();
    });

    raiz.addEventListener('click', ev => {
      if (ev.target.tagName === 'IMG') mostrarAlca(ev.target); else esconderAlca();
    });
    // Mover armado: o toque no texto é o destino (sem cursor, sem teclado, sem o clique depois)
    let ignorarClique = false;
    raiz.addEventListener('pointerdown', ev => {
      if (!moverArmado) return;
      ev.preventDefault();
      ev.stopPropagation();
      const img = moverArmado;
      desarmarMover();
      esconderAlca();
      ignorarClique = true;
      const nova = moverImagem(img, indiceEm(ev.clientX, ev.clientY));
      if (nova) mostrarAlca(nova);
    }, true);
    raiz.addEventListener('mousedown', ev => { if (ignorarClique) ev.preventDefault(); }, true);
    raiz.addEventListener('click', ev => { if (ignorarClique) { ignorarClique = false; ev.stopImmediatePropagation(); } }, true);
    let toqueImg = null;
    raiz.addEventListener('touchstart', ev => {
      if (moverArmado || ignorarClique) { ev.preventDefault(); return; }
      toqueImg = ev.touches.length === 1 && ev.target.tagName === 'IMG' ? ev.target : null;
      if (!toqueImg) return;
      ev.preventDefault();   // sem foco no texto e sem o clique que viria depois
      if (document.activeElement === raiz) raiz.blur();
    }, { passive: false });
    raiz.addEventListener('touchend', ev => {
      if (toqueImg && ev.target === toqueImg) { ev.preventDefault(); mostrarAlca(toqueImg); }
      toqueImg = null;
    }, { passive: false });
    raiz.addEventListener('dblclick', ev => {
      if (ev.target.tagName === 'IMG' && ev.target.classList.contains('est-desenho')) { esconderAlca(); desenhar(ev.target); }
    });
    raiz.addEventListener('keydown', ev => {
      if (!alca || !alca.img) return;
      if (ev.key === 'Escape' && moverArmado) { ev.preventDefault(); ev.stopPropagation(); desarmarMover(); return; }
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        const blot = Quill.find(alca.img);
        if (blot) { ev.preventDefault(); quill.deleteText(quill.getIndex(blot), 1, 'user'); }
      }
      esconderAlca();
    }, true);
    quill.root.addEventListener('scroll', posicionarAlca);
    quill.container.addEventListener('scroll', posicionarAlca);
    window.addEventListener('resize', posicionarAlca);
    quill.on('text-change', () => {
      if (alca && alca.img && !alca.img.isConnected) esconderAlca(); else posicionarAlca();
    });
  }

  /* =============================================
     MELHORAR COM IA (só o dono)
     O trecho selecionado vai, em HTML, para netlify/functions/ia-resumo.mjs, que chama a API
     do Claude e devolve o mesmo conteúdo organizado. Fotos não vão para a IA: viram
     <img data-ref="N"> e voltam no lugar. A resposta é limpa (sanitizarHtml) antes de entrar
     no editor e troca a seleção numa só alteração: Ctrl+Z desfaz.
  ============================================= */
  const COR_GRIFO = '#fff59d';            // <mark> da IA vira este realce amarelo
  const MAX_TRECHO_IA = 6000;             // caracteres de texto por vez (a função tem 60 s)
  const TAGS_HTML_OK = new Set(['P', 'BR', 'H3', 'H4', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'MARK', 'SPAN',
    'UL', 'OL', 'LI', 'BLOCKQUOTE', 'CODE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'IMG']);
  let quillAux = null;
  let iaRodando = false;

  /* Só tags de texto, listas e tabelas; atributos fora, salvo realce/cor em <span>, colspan e
     rowspan, e o data-ref das fotos. Usada na resposta da IA e no conteúdo de toda tabela. */
  function sanitizarHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    doc.body.querySelectorAll('script, style, iframe, object, embed, svg, math, template, noscript, link, meta').forEach(n => n.remove());
    doc.body.querySelectorAll('*').forEach(el => {
      if (!el.isConnected) return;
      if (!TAGS_HTML_OK.has(el.tagName)) { el.replaceWith(...el.childNodes); return; }
      const fundo = el.style.backgroundColor, cor = el.style.color;
      [...el.attributes].forEach(a => {
        const ok = (a.name === 'data-ref' && el.tagName === 'IMG' && /^\d{1,3}$/.test(a.value)) ||
          ((a.name === 'colspan' || a.name === 'rowspan') && /^\d{1,2}$/.test(a.value));
        if (!ok) el.removeAttribute(a.name);
      });
      if (el.tagName === 'SPAN') { if (fundo) el.style.backgroundColor = fundo; if (cor) el.style.color = cor; }
      if (el.tagName === 'MARK') {
        const span = doc.createElement('span');
        span.style.backgroundColor = COR_GRIFO;
        span.append(...el.childNodes);
        el.replaceWith(span);
      }
      if (el.tagName === 'IMG') {
        if (!el.hasAttribute('data-ref')) el.remove();
        else if (el.closest('table')) el.closest('table').after(el);   // foto dentro de tabela se perderia
      }
    });
    // Espaços soltos entre as tags da tabela aparecem no editor (white-space: pre-wrap)
    doc.body.querySelectorAll('table, thead, tbody, tr').forEach(el =>
      [...el.childNodes].forEach(n => { if (n.nodeType === 3 && !n.textContent.trim()) n.remove(); }));
    // Texto, foto ou negrito soltos fora de parágrafo ganham um <p>: no Quill 1.3.6, uma linha
    // sem quebra logo antes de uma tabela faz a tabela sumir ou sair do lugar
    let solto = null;
    [...doc.body.childNodes].forEach(n => {
      if (n.nodeType === 1 && /^(P|H3|H4|UL|OL|BLOCKQUOTE|TABLE)$/.test(n.tagName)) { solto = null; return; }
      if (n.nodeType === 3 && !n.textContent.trim() && !solto) { n.remove(); return; }
      if (!solto) { solto = doc.createElement('p'); n.before(solto); }
      solto.appendChild(n);
    });
    return doc.body.innerHTML;
  }

  function limparTabela(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = sanitizarHtml(`<table>${html || ''}</table>`);
    const tabela = tpl.content.querySelector('table');
    if (!tabela) return '';
    tabela.querySelectorAll('img').forEach(i => i.remove());
    return tabela.innerHTML;
  }

  // HTML de um trecho do editor: monta num Quill fora da tela, com os mesmos formatos
  function htmlDoTrecho(indice, tamanho) {
    if (!quillAux) quillAux = new Quill(document.createElement('div'));
    quillAux.setContents(quill.getContents(indice, tamanho));
    return quillAux.root.innerHTML;
  }

  async function melhorarComIA() {
    if (iaRodando || !ctx) return;
    const sel = quill.getSelection(true);
    const texto = sel && sel.length ? quill.getText(sel.index, sel.length).trim() : '';
    if (texto.length < 15) { aviso('Selecione o trecho do resumo que a IA deve melhorar.'); return; }
    if (texto.length > MAX_TRECHO_IA) {
      aviso(`O trecho tem ${texto.length.toLocaleString('pt-BR')} caracteres. Selecione até ${MAX_TRECHO_IA.toLocaleString('pt-BR')} e melhore em partes.`);
      return;
    }
    const fotos = [];
    const html = htmlDoTrecho(sel.index, sel.length).replace(/<img\b[^>]*>/gi, tag => `<img data-ref="${fotos.push(tag) - 1}">`);
    const ctxAntes = ctx, paginaAntes = atual, statusAntes = $('est-sessao-status').textContent;
    const botao = quill.getModule('toolbar').container.querySelector('.ql-ia');
    iaRodando = true;
    quill.enable(false);   // texto parado: a resposta entra exatamente no lugar da seleção
    if (botao) { botao.disabled = true; botao.textContent = '✨ Melhorando…'; }
    status('✨ A IA está melhorando o trecho… (até 1 minuto)');
    try {
      const { data } = await window.supabaseClient.auth.getSession();
      const r = await fetch('/api/ia-resumo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data && data.session ? data.session.access_token : ''}` },
        body: JSON.stringify({ html, disciplina: ctx.disc, assunto: ctx.topico })
      });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok || !corpo.html) {
        throw new Error(corpo.erro || (r.status === 404
          ? 'A função da IA não existe aqui: ela só roda no site publicado.'
          : `Erro ${r.status} ao chamar a IA.`));
      }
      if (ctx !== ctxAntes || atual !== paginaAntes) { aviso('Você trocou de resumo ou de página; a melhoria da IA foi descartada.'); return; }
      const usadas = new Set();
      const novo = sanitizarHtml(corpo.html).replace(/<img data-ref="(\d+)">/g, (m, i) => { usadas.add(Number(i)); return fotos[i] || ''; }) +
        fotos.filter((f, i) => !usadas.has(i)).join('');   // nenhuma foto some, mesmo se a IA esquecer
      const Delta = Quill.import('delta');
      quill.enable(true);
      // Seleção começando ou terminando no meio de uma linha: quebra ali, para a resposta entrar em linhas próprias
      const op = i => quill.getContents(i, 1).ops[0];
      const antesQuebra = sel.index === 0 || (o => o && (o.insert === '\n' || (o.insert && o.insert.tabela !== undefined)))(op(sel.index - 1));
      let inserido = quill.clipboard.convert(novo);
      if (!antesQuebra) inserido = new Delta().insert('\n').concat(inserido);
      const ultimo = inserido.ops[inserido.ops.length - 1];
      const terminaEmTabela = ultimo && ultimo.insert && ultimo.insert.tabela !== undefined;
      if (!terminaEmTabela && (op(sel.index + sel.length) || {}).insert !== '\n') inserido = inserido.concat(new Delta().insert('\n'));
      // Etapa própria no histórico: Ctrl+Z desfaz só a IA, não o que foi digitado logo antes
      const antes = quill.getContents();
      quill.history.cutoff();
      quill.updateContents(new Delta().retain(sel.index).delete(sel.length).concat(inserido), 'user');
      // Quill 1.3.6: com tabela (bloco) e texto depois dela, a etapa que o histórico grava desfaz
      // errado (sobram letras; acontece também com o vídeo nativo). Vira a troca do documento inteiro.
      const depois = quill.getContents();
      const pilha = quill.history.stack.undo;
      if (pilha.length) {
        pilha[pilha.length - 1] = {
          undo: new Delta().delete(depois.length()).concat(antes),
          redo: new Delta().delete(antes.length()).concat(depois)
        };
      }
      quill.history.cutoff();
      quill.setSelection(sel.index + inserido.length(), 0, 'silent');
      aviso('✨ Trecho melhorado pela IA. Não gostou? Ctrl+Z desfaz.');
    } catch (e) {
      console.error('IA do resumo:', e);
      aviso(e.message || 'Não foi possível melhorar o trecho agora.');
    } finally {
      iaRodando = false;
      quill.enable(true);
      // Sem alteração no texto (erro ou descarte), o status volta ao que era; com ela, o salvamento já o trocou
      if ($('est-sessao-status').textContent.startsWith('✨')) status(statusAntes);
      if (botao) { botao.disabled = false; botao.textContent = '✨ IA'; }
    }
  }

  /* =============================================
     JANELA
  ============================================= */
  function criarEditor() {
    if (quill || typeof Quill === 'undefined') return;
    quill = new Quill('#est-sessao-editor', {
      theme: 'snow',
      placeholder: 'Escreva aqui enquanto estuda… Cole ou arraste fotos; clique numa foto para mudar o tamanho.',
      modules: {
        toolbar: {
          container: [
            [{ 'font': [false, ...FONTES.filter(f => !f.antiga).map(f => f.id)] }, { 'size': TAMANHOS.map(t => t === '12pt' ? false : t) }],   // false = padrão (12pt), aparece como "Normal"
            [{ 'header': [2, 3, 4, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ 'color': [] }, { 'background': [] }],
            [{ 'list': 'ordered' }, { 'list': 'bullet' }, { 'indent': '-1' }, { 'indent': '+1' }],
            [{ 'align': [] }],
            ['blockquote', 'code-block', 'link', 'image', 'desenho', 'tinta'],
            ['clean'],
            ...(window.isOwner && window.isOwner() ? [['ia']] : [])
          ],
          handlers: { ia: melhorarComIA, desenho: () => desenhar(), tinta: () => window.estTinta && window.estTinta.ligar(!window.estTinta.ligada()) }
        }
      }
    });
    const botaoIa = quill.getModule('toolbar').container.querySelector('.ql-ia');
    if (botaoIa) {
      botaoIa.textContent = '✨ IA';
      botaoIa.title = 'Melhorar com IA o trecho selecionado: organiza, grifa, cria tabelas e emojis (Ctrl+Z desfaz)';
      botaoIa.setAttribute('aria-label', 'Melhorar com IA o trecho selecionado');
    }
    const botaoDes = quill.getModule('toolbar').container.querySelector('.ql-desenho');
    if (botaoDes) {
      botaoDes.textContent = '✍️';
      botaoDes.title = 'Desenhar à mão (caneta do tablet)';
      botaoDes.setAttribute('aria-label', 'Desenhar à mão');
    }
    const botaoTinta = quill.getModule('toolbar').container.querySelector('.ql-tinta');
    if (botaoTinta) {
      botaoTinta.textContent = '🖊️';
      botaoTinta.title = 'Tinta: rabiscar com a caneta por cima do texto (grifar, sublinhar, setas)';
      botaoTinta.setAttribute('aria-label', 'Tinta por cima do texto');
      botaoTinta.setAttribute('aria-pressed', 'false');
    }
    quill.on('text-change', (delta, old, fonte) => { if (fonte === 'user') agendarSalvar(); });
    iniciarImagens();
    if (window.estTinta) {
      window.estTinta.iniciar({
        quill, indiceEm, pagina: paginaDaTinta, resumoId: idResumo,
        garantirResumo: async () => { if (paginas[atual]) paginas[atual].sujo++; await salvar(); },
        aoMudar: v => { if (botaoTinta) { botaoTinta.classList.toggle('ql-active', v); botaoTinta.setAttribute('aria-pressed', String(v)); } }
      });
    }
  }

  /* Desenho à mão: sem img, insere um novo onde está o cursor (sem cursor, no fim da página);
     com img (clique num desenho), reabre e troca, ou apaga se a folha ficou vazia. */
  async function desenhar(img) {
    if (!window.estDesenho) return;
    const blot = img && Quill.find(img);
    let index = blot ? quill.getIndex(blot) : (quill.getSelection() || { index: quill.getLength() - 1 }).index;
    quill.blur();
    const r = await window.estDesenho.abrir(img ? img.getAttribute('data-tracos') : '');
    if (!r) return;
    const largura = img && img.getAttribute('width');
    if (blot) quill.deleteText(index, 1, 'user');
    if (r.apagar) return;
    quill.insertEmbed(index, 'desenho', r, 'user');
    if (largura) quill.formatText(index, 1, 'width', largura, 'user');
    // No tablet, pôr o cursor abriria o teclado; o desenho fica selecionado para mover ou redimensionar
    const novo = [...quill.root.querySelectorAll('img.est-desenho')].find(i => { const b = Quill.find(i); return b && quill.getIndex(b) === index; });
    if (matchMedia('(pointer: coarse)').matches) { if (novo) mostrarAlca(novo); }
    else quill.setSelection(index + 1, 0, 'silent');
  }

  /* dados = { tipo: 'meta' | 'revisao', id, disc, topico, rotulo, minutos, concluida }
     Sem id, abre só o resumo (Edital Verticalizado e Meus Resumos). */
  async function abrir(dados) {
    criarEditor();
    if (!quill) return;
    if (ctx) { await salvar(); if (window.estTinta) await window.estTinta.fechar(); }
    ctx = dados;
    // Aberta pelo nome (ficha, Meus Resumos): acha o item do edital para mostrar os assuntos
    if (!ctx.topicoId && window.estSub) ctx.topicoId = window.estSub.topicoPorNomes(dados.disc, dados.topico);
    $('est-sessao-rotulo').textContent = dados.rotulo;
    $('est-sessao-disc').textContent = dados.disc;
    $('est-sessao-topico').textContent = dados.topico;
    mostrarLeitura();
    $('est-sessao-crono').style.display = dados.id ? '' : 'none';
    $('est-sessao-concluir').style.display = dados.id && !dados.concluida ? '' : 'none';
    $('est-sessao-tec').style.display = dados.topicoId && window.estTec ? '' : 'none';
    if (dados.topicoId && window.estTec) $('est-sessao-tec').textContent = window.estTec.rotulo(dados.topicoId);

    const salvo = (resumosMap[makeResumoKey(dados.disc, dados.topico)] || {}).conteudo || '';
    paginas = separarPaginas(salvo);
    if (comAssuntos()) paginas = window.estSub.ligarPaginas(ctx.topicoId, paginas);
    paginas.forEach(numerada);
    apagadas = new Set();
    ordemSuja = false;
    // A versão daqui pode estar velha (o outro aparelho gravou depois): a 1ª busca abaixo confere
    definirBase(salvo, undefined);
    $('est-sessao-novo').hidden = true;
    outrosAbertos = false;
    atual = -1;
    mostrarPagina(0);
    if (dados.subtopicoId && comAssuntos()) mostrarPagina(paginaDoAssunto(dados.subtopicoId));   // meta de um assunto
    status(vazio(salvo) ? '' : 'Salvo');

    clearInterval(tick);
    if (dados.id) {
      renderCrono();
      tick = setInterval(renderCrono, 1000);
    }
    $('est-modal-sessao').classList.add('active');
    renderFlutuante();
    $('est-modal-sessao').setAttribute('aria-hidden', 'false');
    setTimeout(() => quill.focus(), 50);
    clearInterval(timerSinc);
    timerSinc = setInterval(sincronizarAgora, SINC_MS);
    const c = ctx;
    await enfileirar(puxarRemoto);
    if (ctx === c && window.estTinta) await window.estTinta.abrirResumo();   // ligar a tinta tira o foco do texto
  }

  async function fechar() {
    if (!ctx) return;
    esconderAlca();
    await salvar();
    clearInterval(timerSinc);
    if (window.estTinta) await window.estTinta.fechar();
    clearInterval(tick);
    mostrarResumo();
    telaCheia(false);
    const frame = $('est-sessao-tec-frame');
    if (frame.dataset.url) { frame.src = 'about:blank'; delete frame.dataset.url; }   // para o TEC de rodar escondido
    $('est-modal-sessao').classList.remove('active');
    $('est-modal-sessao').setAttribute('aria-hidden', 'true');
    const comCrono = !!ctx.id;
    ctx = null;
    renderFlutuante();
    if (comCrono) window.estPlano.renderTudo(); // atualiza o selo ⏱ na lista
    if (window.estResumos) window.estResumos.render();
  }

  function abrirResumo(disc, topico) {
    abrir({ disc, topico, rotulo: 'Resumo' });
  }

  async function verMateria() {
    if (!ctx) return;
    const { disc, topico } = ctx;
    await fechar();
    if (window.estResumos) window.estResumos.irPara(disc, topico);
  }

  async function concluir() {
    if (!ctx) return;
    const { tipo, id } = ctx;
    const c = crono();
    atualizarCrono(c);
    c.rodando = false;
    gravarCrono(id, c);
    await fechar();
    window.estPlano.abrirConclusao(tipo, id, Math.round(c.acum / 60000));
  }

  /* =============================================
     ABRIR O PDF DA META ("Ler agora")
     O arquivo é escolhido no computador uma vez; o atalho (FileSystemFileHandle) fica no
     IndexedDB "est-pdfs", pelo nome do material, e as próximas metas abrem direto na página.
     Sem a File System Access API (Firefox), o arquivo é escolhido a cada vez.
  ============================================= */
  function pdfsDb(modo, fn) {
    return new Promise((ok, falha) => {
      const req = indexedDB.open('est-pdfs', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onerror = () => falha(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('kv', modo);
        const r = fn(tx.objectStore('kv'));
        tx.oncomplete = () => { db.close(); ok(r && r.result); };
        tx.onerror = () => { db.close(); falha(tx.error); };
      };
    });
  }
  const lerAtalho = nome => pdfsDb('readonly', st => st.get('pdf:' + nome)).catch(() => null);
  const gravarAtalho = (nome, h) => pdfsDb('readwrite', st => st.put(h, 'pdf:' + nome)).catch(() => {});

  function textoPaginas(x) {
    return x.aprox ? `${x.ate - x.de + 1} p. (sem faixa cadastrada)` : x.de === x.ate ? `p. ${x.de}` : `p. ${x.de}–${x.ate}`;
  }

  async function mostrarLeitura() {
    const el = $('est-sessao-leitura');
    const leitura = (ctx && ctx.leitura) || [];
    el.hidden = !leitura.length;
    // Uma linha por PDF (nome | páginas | alterar), com o modo de abrir no cabeçalho
    el.innerHTML = leitura.length
      ? `<div class="est-sessao-leitura-topo"><strong>📄 ${ctx.leituraParcial ? 'Ler agora' : 'Material'}</strong>` +
        `<button type="button" class="est-sessao-trocar est-sessao-modo" title="Onde o PDF abre neste computador (clique para trocar)">${ROTULO_MODO[modoPdf()]} ⇄</button></div>` +
        '<ul class="est-sessao-pdfs">' + leitura.map((x, i) =>
          `<li><button type="button" class="est-sessao-ler" data-i="${i}" title="Abrir o PDF${x.aprox ? '' : ' na página ' + x.de}">${escapeHtml(x.nome)} ↗</button>` +
          `<span class="est-sessao-pags">${textoPaginas(x)}</span>` +
          `<button type="button" class="est-sessao-trocar" data-i="${i}" ${noApp() ? '' : 'hidden'}>alterar PDF</button></li>`
        ).join('') + '</ul>'
      : '';
    if (!window.showOpenFilePicker) return;
    const atual = ctx;
    for (const [i, x] of leitura.entries()) {
      if (!(await lerAtalho(x.nome)) || ctx !== atual) continue;
      const b = el.querySelector(`.est-sessao-trocar[data-i="${i}"]`);
      if (b) b.hidden = false;
    }
  }

  function escolherNoInput() {
    return new Promise(ok => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'application/pdf,.pdf';
      inp.onchange = () => ok(inp.files[0] || null);
      inp.click();
    });
  }

  async function arquivoDoPdf(x, trocar) {
    if (!window.showOpenFilePicker) return escolherNoInput();
    let h = trocar ? null : await lerAtalho(x.nome);
    if (h) {
      const modo = { mode: 'read' };
      if ((await h.queryPermission(modo)) !== 'granted' && (await h.requestPermission(modo)) !== 'granted') h = null;
    }
    if (!h) {
      try {
        [h] = await window.showOpenFilePicker({ id: 'pdfs-estudo', types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] });
      } catch (e) { return null; }   // cancelou
      await gravarAtalho(x.nome, h);
    }
    try { return await h.getFile(); } catch (e) {
      aviso('Não achei o arquivo (foi movido ou apagado?). Escolha o PDF de novo.');
      return arquivoDoPdf(x, true);
    }
  }

  /* Abrir fora do navegador: link estudopdf: tratado pelo ferramentas/estudopdf (instalado uma vez
     no Windows), que acha o arquivo pelo nome nas pastas escolhidas. 'app' abre no Foxit, na página;
     'escolher' mostra a janela "Abrir com" do Windows (na 1ª página). A escolha vale para este
     computador (localStorage), porque a instalação é por computador. */
  const MODOS = ['navegador', 'app', 'escolher'];
  const ROTULO_MODO = { navegador: 'abre no navegador', app: 'abre no Foxit', escolher: 'pergunta o aplicativo' };
  const modoPdf = () => { try { const v = localStorage.getItem('est_pdf_modo'); return MODOS.includes(v) ? v : 'navegador'; } catch (e) { return 'navegador'; } };
  const noApp = () => modoPdf() !== 'navegador';

  async function trocarModo() {
    const proximo = MODOS[(MODOS.indexOf(modoPdf()) + 1) % MODOS.length];
    if (proximo === 'escolher') {
      const ok = await window.customConfirm('Perguntar o aplicativo a cada PDF?\n\n' +
        'O Windows mostra a janela "Abrir com" para você escolher (Foxit, Adobe, Edge…). Nesse modo o PDF abre na 1ª página, não na da meta.\n\n' +
        'Usa o mesmo atalho do Foxit: rode de novo o ferramentas\\estudopdf\\instalar.cmd neste computador para ele aprender este modo.');
      if (!ok) { try { localStorage.setItem('est_pdf_modo', 'navegador'); } catch (e) { /* sem armazenamento */ } mostrarLeitura(); return; }
    }
    if (proximo === 'app') {
      const ok = await window.customConfirm('Abrir os PDFs no Foxit neste computador?\n\n' +
        'Precisa instalar uma vez: na pasta do site, dê dois cliques em ferramentas\\estudopdf\\instalar.cmd e escolha a pasta onde ficam os PDFs. ' +
        'Na primeira abertura, o navegador pergunta se pode abrir o "estudopdf": marque para sempre permitir.\n\n' +
        'O arquivo é achado pelo nome (o que você escolheu no "Ler agora" ou o nome do material + .pdf).');
      if (!ok) return;
    }
    try { localStorage.setItem('est_pdf_modo', proximo); } catch (e) { /* sem armazenamento */ }
    mostrarLeitura();
  }

  async function abrirNoApp(x) {
    const h = window.showOpenFilePicker ? await lerAtalho(x.nome) : null;
    const arquivo = h ? h.name : x.nome + '.pdf';
    location.href = 'estudopdf:abrir?arquivo=' + encodeURIComponent(arquivo) + '&pagina=' + (x.aprox ? 1 : x.de) +
      (modoPdf() === 'escolher' ? '&app=escolher' : '');
  }

  async function abrirPdf(i, trocar) {
    const x = ctx && ctx.leitura && ctx.leitura[i];
    if (!x) return;
    if (noApp()) {
      // "alterar PDF" no modo Foxit: só escolhe o arquivo certo (o nome dele vai no link)
      if (trocar && !(await arquivoDoPdf(x, true))) return;
      abrirNoApp(x);
      mostrarLeitura();
      return;
    }
    const arq = await arquivoDoPdf(x, trocar);
    if (!arq) return;
    // O leitor (leitor.html, pdf.js) pega o arquivo desta aba por window.opener: abrir o blob
    // direto faz o Chrome/Edge baixar o PDF quando a opção "Baixar PDFs" está ligada
    pdfPendente = { arquivo: arq, nome: x.nome, de: x.aprox ? 1 : x.de, ate: x.aprox ? null : x.ate };
    const janela = window.open('/leitor.html', '_blank');
    if (!janela) {
      // O navegador barrou a aba (o clique "venceu" enquanto o arquivo era escolhido): vira um link
      const b = $('est-sessao-leitura').querySelector(`.est-sessao-ler[data-i="${i}"]`);
      if (b) b.outerHTML = `<a class="est-sessao-ler" href="/leitor.html" target="_blank" rel="opener">Abrir ${escapeHtml(x.nome)} ↗</a>`;
      return;
    }
    mostrarLeitura();
  }

  let pdfPendente = null;

  function aviso(msg) {
    if (window.estPlano && window.estPlano.aviso) window.estPlano.aviso(msg); else alert(msg);
  }

  function init() {
    if (!$('est-modal-sessao')) return;
    $('est-sessao-leitura').addEventListener('click', ev => {
      if (ev.target.closest('.est-sessao-modo')) { trocarModo(); return; }
      const b = ev.target.closest('button[data-i]');
      if (b) abrirPdf(Number(b.dataset.i), b.classList.contains('est-sessao-trocar'));
    });
    $('est-sessao-fechar').addEventListener('click', fechar);
    $('est-sessao-tec-voltar').addEventListener('click', mostrarResumo);
    $('est-sessao-tec-cheia').addEventListener('click', () => telaCheia(!emTelaCheia()));
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && emTelaCheia()) telaCheia(false); });   // Esc do navegador
    $('est-sessao-concluir').addEventListener('click', concluir);
    $('est-sessao-play').addEventListener('click', alternarPlay);
    $('est-sessao-zerar').addEventListener('click', zerar);
    $('est-sessao-pomodoro').addEventListener('change', alternarPomodoro);
    $('est-sessao-ciclo').addEventListener('change', trocarCiclo);
    $('est-sessao-nova-pag').addEventListener('click', novaPagina);
    const novoNome = $('est-sessao-novo-nome');
    novoNome.addEventListener('input', dicaNovoAssunto);
    novoNome.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); confirmarNovoAssunto(false); }
      if (ev.key === 'Escape') { ev.stopPropagation(); $('est-sessao-novo').hidden = true; }
    });
    $('est-sessao-novo-criar').addEventListener('click', () => confirmarNovoAssunto(true));
    $('est-sessao-tec-link').addEventListener('change', gravarTecDoAssunto);
    $('est-sessao-ver-materia').addEventListener('click', verMateria);
    const titulo = $('est-sessao-pag-titulo');
    titulo.addEventListener('input', renomear);
    titulo.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); quill.focus(); } });
    document.addEventListener('keydown', ev => {
      if (ev.key !== 'Escape' || !ctx || document.querySelector('#est-modal-confirm.active')) return;
      if (emTelaCheia()) telaCheia(false);   // Esc sai primeiro da tela cheia
      else if (alca && alca.img) esconderAlca(); else fechar();
    });
    window.addEventListener('beforeunload', () => { if (ctx) salvar(); });
    // Voltou para a aba (ou o tablet acordou): busca logo o que o outro aparelho gravou
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sincronizarAgora(); });
    criarFlutuante();
  }

  document.addEventListener('DOMContentLoaded', init);

  window.estSessao = {
    abrir, abrirResumo, fechar, minutosDe, selo, separarPaginas, juntarPaginas, tempoPorAssunto, mostrarTec,
    irPagina: mostrarPagina, apagarPagina,
    irAssunto: id => mostrarPagina(paginaDoAssunto(id)), tirarDoPdf, usarNestePdf,
    outrosAbertos: v => { outrosAbertos = v; },
    zerarCrono: id => gravarCrono(id, null),
    // Usados pelo Caderno de Erros (estudos.erros.js)
    contexto: () => ctx && { disc: ctx.disc, topico: ctx.topico, topicoId: ctx.topicoId, subtopicoId: subAtual() },
    limparHtmlColado, reduzirImagem,
    pdfAberto: () => pdfPendente   // lido pelo leitor.html
  };
})();
