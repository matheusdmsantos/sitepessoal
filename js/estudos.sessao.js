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
  let paginas = [];          // [{ titulo, html, semTitulo }]
  let atual = 0;
  let ultimoSalvo = '';
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

  function mostrarPagina(i) {
    esconderAlca();
    mostrarResumo();
    guardarPaginaAtual();
    atual = Math.max(0, Math.min(i, paginas.length - 1));
    const p = paginas[atual];
    const geral = comAssuntos() && p.semTitulo;
    const titulo = $('est-sessao-pag-titulo');
    titulo.value = geral ? 'Anotações gerais (sem assunto)' : p.titulo;
    titulo.disabled = geral;
    quill.root.innerHTML = p.html;
    quill.history.clear();
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
    paginas.push({ titulo: `Página ${paginas.length + 1}`, html: '', semTitulo: false });
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
    // A primeira página precisa de título se outra passou a ocupar o lugar dela
    if (i === 0) paginas[0].semTitulo = false;
    atual = Math.min(atual > i ? atual - 1 : atual, paginas.length - 1);
    quill.root.innerHTML = paginas[atual].html;
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
    paginas = [geral, ...[...resto, { titulo: s.nome, html: '', semTitulo: false, sub: s.id }].sort((a, b) => pos(a) - pos(b))];
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
    const item = (s, grupo) => {
      const p = acerto(s);
      const selos = (priorizar ? `<span class="est-sessao-ass-selo ${p === null ? '' : p < 70 ? 'ruim' : p < 85 ? 'medio' : 'bom'}">${p === null ? 'sem questões' : p + '%'}</span>` : '') +
        (cotas[s.id] ? `<span class="est-sessao-ass-selo" title="Questões sugeridas para este assunto">≈${cotas[s.id]} q</span>` : '');
      const acao = !mats.length ? ''
        : grupo === 'neste'
          ? `<button type="button" class="est-sessao-pag-x" onclick="estSessao.tirarDoPdf('${s.id}')" title="Tirar deste PDF (o assunto continua no item)" aria-label="Tirar ${esc(s.nome)} deste PDF">✕</button>`
          : `<button type="button" class="est-sessao-pag-x" onclick="estSessao.usarNestePdf('${s.id}')" title="Usar neste PDF" aria-label="Usar ${esc(s.nome)} neste PDF">＋</button>`;
      return `<li class="${s.id === sel ? 'ativa' : ''}">
        <button type="button" class="est-sessao-pag" onclick="estSessao.irAssunto('${s.id}')">${esc(nomeNaColuna(s))}${selos ? `<span class="est-sessao-ass-selos">${selos}</span>` : ''}</button>${acao}</li>`;
    };
    $('est-sessao-lista').innerHTML = `
      <li class="${atual === 0 ? 'ativa' : ''}"><button type="button" class="est-sessao-pag est-sessao-geral" onclick="estSessao.irPagina(0)">📝 Anotações gerais</button></li>
      ${mats.length ? `<li class="est-sessao-grupo">Neste PDF</li>` : ''}
      ${neste.map(s => item(s, 'neste')).join('')}
      ${mats.length && !neste.length ? '<li class="est-sessao-grupo-vazio">Nenhum assunto neste PDF ainda. Use “+ Assunto”.</li>' : ''}
      ${outros.length ? `<li class="est-sessao-outros"><details ${outrosAbertos || outros.some(s => s.id === sel) ? 'open' : ''} ontoggle="estSessao.outrosAbertos(this.open)">
        <summary>Outros assuntos do item (${outros.length})</summary><ul>${outros.map(s => item(s, 'outros')).join('')}</ul></details></li>` : ''}`;
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
    let v = $('est-sessao-tec-link').value.trim();
    const src = v.match(/<iframe[^>]*\ssrc="(https?:\/\/[^"]+)"/i);   // colou o código de incorporação do TEC
    if (src) v = src[1];
    if (v && !/^https?:\/\//i.test(v)) { aviso('Cole o endereço completo do caderno (começa com https://).'); return; }
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
      if (!(await window.estSub.renomear(s.id, p.titulo, false))) {
        p.titulo = s.nome;
        if (paginas[atual] === p) $('est-sessao-pag-titulo').value = s.nome;
        renderPaginas();
      }
    }
  }

  /* =============================================
     SALVAMENTO (mesmo caminho do editor de "Meus Resumos")
  ============================================= */
  function status(txt) { $('est-sessao-status').textContent = txt; }

  function agendarSalvar() {
    status('Alterações não salvas');
    clearTimeout(timerSalvar);
    timerSalvar = setTimeout(salvar, AUTOSAVE_MS);
  }

  async function salvar() {
    clearTimeout(timerSalvar);
    if (!ctx) return;
    guardarPaginaAtual();
    if (comAssuntos()) await sincronizarNomes();
    const html = juntarPaginas();
    if (html === ultimoSalvo) { status('Salvo'); return; }
    status('Salvando…');
    ultimoSalvo = html;
    await salvarResumo(ctx.disc, ctx.topico, html, true);
    status('Salvo');
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

  function alternarPlay() {
    const c = crono();
    atualizarCrono(c);
    c.rodando = !c.rodando;
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
    if (!alca) return;
    const folha = alca.caixa.parentElement.getBoundingClientRect();
    const r = alca.img.getBoundingClientRect();
    Object.assign(alca.caixa.style, {
      left: (r.left - folha.left) + 'px', top: (r.top - folha.top) + 'px',
      width: r.width + 'px', height: r.height + 'px'
    });
    alca.caixa.querySelector('.est-img-medida').textContent = `${Math.round(r.width)} px`;
  }

  function esconderAlca() {
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
      ${['no', 'ne', 'so', 'se'].map(c => `<span class="est-img-ponto ${c}" data-canto="${c}" aria-hidden="true"></span>`).join('')}
      <div class="est-img-barra" role="toolbar" aria-label="Tamanho da imagem">
        <span class="est-img-medida"></span>
        ${[25, 50, 75, 100].map(p => `<button type="button" data-pct="${p}">${p}%</button>`).join('')}
      </div>`;
    $('est-sessao-editor').parentElement.appendChild(caixa);

    caixa.querySelectorAll('[data-pct]').forEach(b => b.addEventListener('click', () => {
      definirLargura(larguraUtil() * Number(b.dataset.pct) / 100);
    }));

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
    raiz.addEventListener('keydown', ev => {
      if (!alca || !alca.img) return;
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
            ['blockquote', 'code-block', 'link', 'image'],
            ['clean'],
            ...(window.isOwner && window.isOwner() ? [['ia']] : [])
          ],
          handlers: { ia: melhorarComIA }
        }
      }
    });
    const botaoIa = quill.getModule('toolbar').container.querySelector('.ql-ia');
    if (botaoIa) {
      botaoIa.textContent = '✨ IA';
      botaoIa.title = 'Melhorar com IA o trecho selecionado: organiza, grifa, cria tabelas e emojis (Ctrl+Z desfaz)';
      botaoIa.setAttribute('aria-label', 'Melhorar com IA o trecho selecionado');
    }
    quill.on('text-change', (delta, old, fonte) => { if (fonte === 'user') agendarSalvar(); });
    iniciarImagens();
  }

  /* dados = { tipo: 'meta' | 'revisao', id, disc, topico, rotulo, minutos, concluida }
     Sem id, abre só o resumo (Edital Verticalizado e Meus Resumos). */
  function abrir(dados) {
    criarEditor();
    if (!quill) return;
    if (ctx) salvar();
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
    ultimoSalvo = salvo;
    paginas = separarPaginas(salvo);
    if (comAssuntos()) paginas = window.estSub.ligarPaginas(ctx.topicoId, paginas);
    $('est-sessao-novo').hidden = true;
    outrosAbertos = false;
    atual = -1;
    mostrarPagina(0);
    status(vazio(salvo) ? '' : 'Salvo');

    clearInterval(tick);
    if (dados.id) {
      renderCrono();
      tick = setInterval(renderCrono, 1000);
    }
    $('est-modal-sessao').classList.add('active');
    $('est-modal-sessao').setAttribute('aria-hidden', 'false');
    setTimeout(() => quill.focus(), 50);
  }

  async function fechar() {
    if (!ctx) return;
    esconderAlca();
    await salvar();
    clearInterval(tick);
    mostrarResumo();
    const frame = $('est-sessao-tec-frame');
    if (frame.dataset.url) { frame.src = 'about:blank'; delete frame.dataset.url; }   // para o TEC de rodar escondido
    $('est-modal-sessao').classList.remove('active');
    $('est-modal-sessao').setAttribute('aria-hidden', 'true');
    const comCrono = !!ctx.id;
    ctx = null;
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
        `<button type="button" class="est-sessao-trocar est-sessao-modo" title="Onde o PDF abre neste computador">${noApp() ? 'abre no Foxit' : 'abre no navegador'} ⇄</button></div>` +
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

  /* Abrir no Foxit: link estudopdf: tratado pelo ferramentas/estudopdf (instalado uma vez no
     Windows), que acha o arquivo pelo nome nas pastas escolhidas e abre na página. A escolha
     vale para este computador (localStorage), porque a instalação é por computador. */
  const noApp = () => { try { return localStorage.getItem('est_pdf_modo') === 'app'; } catch (e) { return false; } };

  async function trocarModo() {
    if (!noApp()) {
      const ok = await window.customConfirm('Abrir os PDFs no Foxit neste computador?\n\n' +
        'Precisa instalar uma vez: na pasta do site, dê dois cliques em ferramentas\\estudopdf\\instalar.cmd e escolha a pasta onde ficam os PDFs. ' +
        'Na primeira abertura, o navegador pergunta se pode abrir o "estudopdf": marque para sempre permitir.\n\n' +
        'O arquivo é achado pelo nome (o que você escolheu no "Ler agora" ou o nome do material + .pdf).');
      if (!ok) return;
    }
    try { localStorage.setItem('est_pdf_modo', noApp() ? 'navegador' : 'app'); } catch (e) { /* sem armazenamento */ }
    mostrarLeitura();
  }

  async function abrirNoApp(x) {
    const h = window.showOpenFilePicker ? await lerAtalho(x.nome) : null;
    const arquivo = h ? h.name : x.nome + '.pdf';
    location.href = 'estudopdf:abrir?arquivo=' + encodeURIComponent(arquivo) + '&pagina=' + (x.aprox ? 1 : x.de);
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
      if (alca && alca.img) esconderAlca(); else fechar();
    });
    window.addEventListener('beforeunload', () => { if (ctx) salvar(); });
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
