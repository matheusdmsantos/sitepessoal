/* =============================================
   JANELA DE ESTUDO (estudos.sessao.js)
   Abre ao clicar numa meta ou revisão do plano: cronômetro (livre ou Pomodoro)
   e o resumo do tópico dividido em páginas, como num caderno do OneNote.

   As páginas ficam no mesmo resumo de "Meus Resumos" (tabela resumos): cada página
   começa com <h1 class="est-pagina">Título</h1>. Conteúdo antes do primeiro título é a
   primeira página, por isso os resumos antigos continuam iguais.
   Carregado depois do estudos.v5.js (usa resumosMap, makeResumoKey e salvarResumo).
============================================= */
(function () {
  const POMODORO_FOCO = 25 * 60000;
  const POMODORO_PAUSA = 5 * 60000;
  const AUTOSAVE_MS = 2000;
  const TITULO_PADRAO = 'Anotações';
  const CHAVE_CRONO = 'est_crono';           // { [id da meta/revisão]: estado do cronômetro }
  const TAMANHOS = ['8pt', '9pt', '10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '20pt', '22pt', '24pt', '26pt', '28pt', '36pt', '48pt', '72pt'];

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
  }

  let quill = null;
  let ctx = null;            // { tipo, id, disc, topico, minutos, concluida }; sem id = só o resumo, sem cronômetro
  let paginas = [];          // [{ titulo, html, semTitulo }]
  let atual = 0;
  let ultimoSalvo = '';
  let timerSalvar = null;
  let tick = null;

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

  function juntarPaginas() {
    if (paginas.length === 1 && paginas[0].semTitulo) return paginas[0].html;
    return paginas.map((p, i) =>
      (i === 0 && p.semTitulo ? '' : `<h1 class="est-pagina">${esc(p.titulo)}</h1>`) +
      (vazio(p.html) ? '<p><br></p>' : p.html)
    ).join('');
  }

  function guardarPaginaAtual() {
    if (quill && paginas[atual]) paginas[atual].html = quill.root.innerHTML;
  }

  function mostrarPagina(i) {
    esconderAlca();
    guardarPaginaAtual();
    atual = Math.max(0, Math.min(i, paginas.length - 1));
    $('est-sessao-pag-titulo').value = paginas[atual].titulo;
    quill.root.innerHTML = paginas[atual].html;
    quill.history.clear();
    renderPaginas();
  }

  function renderPaginas() {
    $('est-sessao-lista').innerHTML = paginas.map((p, i) => `
      <li class="${i === atual ? 'ativa' : ''}">
        <button type="button" class="est-sessao-pag" onclick="estSessao.irPagina(${i})">${esc(p.titulo)}</button>
        ${paginas.length > 1 ? `<button type="button" class="est-sessao-pag-x" onclick="estSessao.apagarPagina(${i})" title="Apagar página" aria-label="Apagar página ${esc(p.titulo)}">✕</button>` : ''}
      </li>`).join('');
  }

  function novaPagina() {
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
    const titulo = $('est-sessao-pag-titulo').value.trim() || TITULO_PADRAO;
    if (titulo === paginas[atual].titulo) return;
    paginas[atual].titulo = titulo;
    paginas[atual].semTitulo = false;
    renderPaginas();
    agendarSalvar();
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

  // Leva o trecho em andamento para os totais e troca de fase no Pomodoro
  function atualizarCrono(c) {
    if (c.rodando) {
      const agora = Date.now();
      const d = agora - c.desde;
      if (c.fase === 'foco') c.acum += d;
      c.faseMs += d;
      c.desde = agora;
    }
    let trocou = false;
    while (c.pomodoro) {
      const dur = c.fase === 'foco' ? POMODORO_FOCO : POMODORO_PAUSA;
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
    const relogio = $('est-sessao-relogio');
    relogio.classList.toggle('pausa', c.pomodoro && c.fase === 'pausa');
    relogio.classList.toggle('rodando', c.rodando);
    if (c.pomodoro) {
      const dur = c.fase === 'foco' ? POMODORO_FOCO : POMODORO_PAUSA;
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
    gravarCrono(ctx.id, { ...c, acum: 0, rodando: false, fase: 'foco', faseMs: 0 });
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
     JANELA
  ============================================= */
  function criarEditor() {
    if (quill || typeof Quill === 'undefined') return;
    quill = new Quill('#est-sessao-editor', {
      theme: 'snow',
      placeholder: 'Escreva aqui enquanto estuda… Cole ou arraste fotos; clique numa foto para mudar o tamanho.',
      modules: {
        toolbar: [
          [{ 'font': [] }, { 'size': TAMANHOS.map(t => t === '12pt' ? false : t) }],   // false = padrão (12pt), aparece como "Normal"
          [{ 'header': [2, 3, 4, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ 'color': [] }, { 'background': [] }],
          [{ 'list': 'ordered' }, { 'list': 'bullet' }, { 'indent': '-1' }, { 'indent': '+1' }],
          [{ 'align': [] }],
          ['blockquote', 'code-block', 'link', 'image'],
          ['clean']
        ]
      }
    });
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
    $('est-sessao-rotulo').textContent = dados.rotulo;
    $('est-sessao-disc').textContent = dados.disc;
    $('est-sessao-topico').textContent = dados.topico;
    $('est-sessao-crono').style.display = dados.id ? '' : 'none';
    $('est-sessao-concluir').style.display = dados.id && !dados.concluida ? '' : 'none';

    const salvo = (resumosMap[makeResumoKey(dados.disc, dados.topico)] || {}).conteudo || '';
    ultimoSalvo = salvo;
    paginas = separarPaginas(salvo);
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

  function init() {
    if (!$('est-modal-sessao')) return;
    $('est-sessao-fechar').addEventListener('click', fechar);
    $('est-sessao-concluir').addEventListener('click', concluir);
    $('est-sessao-play').addEventListener('click', alternarPlay);
    $('est-sessao-zerar').addEventListener('click', zerar);
    $('est-sessao-pomodoro').addEventListener('change', alternarPomodoro);
    $('est-sessao-nova-pag').addEventListener('click', novaPagina);
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
    abrir, abrirResumo, fechar, minutosDe, selo, separarPaginas,
    irPagina: mostrarPagina, apagarPagina,
    zerarCrono: id => gravarCrono(id, null)
  };
})();
