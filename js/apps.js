/* js/apps.js — Hub de aplicações
 *
 * Os apps ficam cadastrados em /apps.json (não aqui). Para adicionar um app:
 *   1. crie a pasta apps/<id>/ (copie apps/_modelo/ como ponto de partida);
 *   2. acrescente um item em apps.json.
 *
 * Campos de cada app em apps.json:
 *   id, nome, descricao, icone, cor, categoria,
 *   url       caminho do app, ou null para "Em breve"
 *   abrirEm   "visualizador" (dentro do hub, padrão) ou "pagina" (tela cheia)
 *   todos     true para aparecer a todos os usuários; sem ele, só o dono do site
 *             vê o app (isOwner, em auth.js). Os dados são protegidos pelo RLS.
 */
(function () {
  const state = { apps: [], categorias: [], filtro: 'todos', busca: '', atual: null };
  const $ = (id) => document.getElementById(id);

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  /* ── Inicialização ─────────────────────────────── */
  document.addEventListener('DOMContentLoaded', async () => {
    const user = await authReady;
    if (!user) return; // auth.js já redirecionou
    document.body.classList.remove('auth-pending');
    preencherUsuario(user.email);

    $('logout-btn').addEventListener('click', logout);
    $('viewer-back-btn').addEventListener('click', () => { location.hash = ''; });
    $('viewer-reload').addEventListener('click', recarregarIframe);
    $('viewer-newtab').addEventListener('click', abrirEmNovaAba);
    $('search-input').addEventListener('input', (e) => {
      state.busca = normalizar(e.target.value.trim());
      renderApps();
    });
    window.addEventListener('hashchange', aplicarRota);

    try {
      const resp = await fetch('apps.json', { cache: 'no-cache' });
      if (!resp.ok) throw new Error(resp.status);
      const dados = await resp.json();
      state.apps = (dados.apps || []).filter((a) => a.todos || isOwner(user));
      state.categorias = [{ id: 'todos', nome: 'Todos', icone: '⬛' }, ...(dados.categorias || [])];
    } catch (err) {
      const box = $('apps-error');
      box.textContent = 'Não foi possível carregar a lista de apps (apps.json). Recarregue a página.';
      box.hidden = false;
      return;
    }

    renderCategorias();
    renderApps();
    aplicarRota();
  });

  function preencherUsuario(email) {
    const nome = (email || '').split('@')[0];
    $('user-display-name').textContent = nome;
    const partes = nome.split(/[._-]+/).filter(Boolean);
    const iniciais = (partes.length > 1 ? partes[0][0] + partes[1][0] : nome.slice(0, 2)).toUpperCase();
    $('user-initials').textContent = iniciais || 'MM';
  }

  /* ── Categorias (sidebar + chips) ──────────────── */
  function contar(catId) {
    return catId === 'todos' ? state.apps.length : state.apps.filter((a) => a.categoria === catId).length;
  }

  function renderCategorias() {
    const nav = $('sidebar-nav');
    const bar = $('filter-bar');
    nav.innerHTML = '<span class="sidebar-section-label">Categorias</span>';
    bar.innerHTML = '';

    state.categorias.forEach((cat) => {
      const n = contar(cat.id);
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'sidebar-item';
      item.dataset.category = cat.id;
      item.innerHTML = `<span class="sidebar-item-icon" aria-hidden="true">${esc(cat.icone)}</span>
        <span>${esc(cat.nome)}</span>${n ? `<span class="sidebar-count">${n}</span>` : ''}`;
      item.addEventListener('click', () => definirFiltro(cat.id));
      nav.appendChild(item);

      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'filter-chip';
      chip.dataset.category = cat.id;
      chip.textContent = cat.nome;
      chip.addEventListener('click', () => definirFiltro(cat.id));
      bar.appendChild(chip);
    });
    marcarFiltroAtivo();
  }

  function definirFiltro(id) {
    state.filtro = id;
    marcarFiltroAtivo();
    renderApps();
  }

  function marcarFiltroAtivo() {
    document.querySelectorAll('.sidebar-item, .filter-chip').forEach((el) => {
      const ativo = el.dataset.category === state.filtro;
      el.classList.toggle('active', ativo);
      el.setAttribute('aria-pressed', String(ativo));
    });
  }

  /* ── Grade de apps ─────────────────────────────── */
  function renderApps() {
    const grid = $('apps-grid');
    const lista = state.apps.filter((app) => {
      const okCat = state.filtro === 'todos' || app.categoria === state.filtro;
      const okBusca = !state.busca ||
        normalizar(app.nome).includes(state.busca) ||
        normalizar(app.descricao).includes(state.busca);
      return okCat && okBusca;
    });

    grid.innerHTML = '';
    lista.forEach((app) => grid.appendChild(criarCard(app)));
    $('apps-empty').classList.toggle('show', lista.length === 0);
  }

  function nomeCategoria(id) {
    const c = state.categorias.find((x) => x.id === id);
    return c ? c.nome : id;
  }

  function criarCard(app) {
    const disponivel = Boolean(app.url);
    const card = document.createElement(disponivel ? 'a' : 'article');
    card.className = 'app-card' + (disponivel ? '' : ' is-soon');
    card.setAttribute('role', 'listitem');
    if (disponivel) {
      card.href = app.abrirEm === 'pagina' ? app.url : '#' + encodeURIComponent(app.id);
      card.setAttribute('aria-label', `Abrir ${app.nome}`);
    } else {
      card.setAttribute('aria-disabled', 'true');
    }

    card.innerHTML = `
      <div class="app-card-header">
        <div class="app-icon-wrap" style="background:${esc(app.cor)}">${esc(app.icone)}</div>
        <div class="app-status ${disponivel ? '' : 'offline'}" title="${disponivel ? 'Disponível' : 'Em breve'}"></div>
      </div>
      <div>
        <div class="app-name">${esc(app.nome)}</div>
        <div class="app-desc">${esc(app.descricao)}</div>
      </div>
      <div class="app-card-footer">
        <span class="app-tag">${esc(nomeCategoria(app.categoria))}</span>
        <span class="app-open-btn">${disponivel ? 'Abrir' : 'Em breve'}</span>
      </div>`;
    return card;
  }

  /* ── Visualizador (rota #id-do-app) ────────────── */
  function aplicarRota() {
    const id = decodeURIComponent(location.hash.slice(1));
    const app = id && state.apps.find((a) => a.id === id && a.url);
    if (app && app.abrirEm === 'pagina') { location.href = app.url; return; }
    app ? abrirApp(app) : fecharVisualizador();
  }

  function abrirApp(app) {
    state.atual = app;
    $('panel-apps').style.display = 'none';
    $('panel-viewer').classList.add('active');
    $('viewer-title-text').textContent = app.nome;
    $('viewer-title-icon').textContent = app.icone;
    $('viewer-url-text').textContent = app.url;
    document.title = `${app.nome} — Matheus Miranda`;
    carregarIframe(app.url);
  }

  function carregarIframe(url) {
    const iframe = $('app-iframe');
    const loading = $('iframe-loading');
    loading.classList.remove('hidden');
    iframe.onload = () => loading.classList.add('hidden');
    iframe.src = url;
  }

  function fecharVisualizador() {
    state.atual = null;
    $('panel-viewer').classList.remove('active');
    $('panel-apps').style.display = '';
    $('app-iframe').src = 'about:blank';
    document.title = 'Apps Pessoais — Matheus Miranda';
  }

  function recarregarIframe() {
    if (state.atual) carregarIframe(state.atual.url);
  }

  function abrirEmNovaAba() {
    if (state.atual) window.open(state.atual.url, '_blank', 'noopener');
  }
})();
