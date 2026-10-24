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
     JANELA
  ============================================= */
  function criarEditor() {
    if (quill || typeof Quill === 'undefined') return;
    quill = new Quill('#est-sessao-editor', {
      theme: 'snow',
      placeholder: 'Escreva aqui enquanto estuda… Cole imagens com Ctrl+V.',
      modules: {
        toolbar: [
          [{ 'font': [] }, { 'size': TAMANHOS }],
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
      if (ev.key === 'Escape' && ctx && !document.querySelector('#est-modal-confirm.active')) fechar();
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
