/* js/auth.js — Autenticação via Supabase Auth
 *
 * Nenhuma senha fica no código: o login é validado pelo Supabase.
 * Mantém a mesma API da versão antiga (isAuthenticated, requireAuth,
 * logout, getSessionUser), então páginas como estudos.html continuam
 * funcionando sem alteração. login() agora é assíncrono.
 *
 * Ordem dos scripts em qualquer página protegida:
 *   1. https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2
 *   2. js/supabase-client.js
 *   3. js/auth.js
 *   4. <script>if (!requireAuth()) throw new Error('Não autenticado');</script>
 */
(function () {
  const LOGIN_PAGE = '/index.html';
  const HOME_PAGE  = '/apps.html';

  const client = window.supabaseClient;
  if (!client) throw new Error('auth.js precisa de js/supabase-client.js carregado antes.');

  // Chave onde o supabase-js guarda a sessão: sb-<ref-do-projeto>-auth-token
  const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0];
  const STORAGE_KEY = `sb-${projectRef}-auth-token`;

  function readStoredSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      return s && s.refresh_token ? s : null;
    } catch {
      return null;
    }
  }

  function goToLogin() {
    const back = location.pathname + location.search + location.hash;
    const url = LOGIN_PAGE + (back && back !== LOGIN_PAGE ? '?next=' + encodeURIComponent(back) : '');
    location.replace(url);
  }

  /** Checagem rápida e síncrona (sem rede). Serve para decidir o redirecionamento
   *  inicial; a validação real acontece em authReady e nas políticas RLS. */
  window.isAuthenticated = function () {
    return readStoredSession() !== null;
  };

  /** Protege a página. Redireciona para o login se não houver sessão. */
  window.requireAuth = function () {
    if (!window.isAuthenticated()) {
      goToLogin();
      return false;
    }
    return true;
  };

  /** Login com e-mail e senha. Retorna { ok: true } ou { ok: false, message }. */
  // Cópia das leituras do Supabase guardada pelo sw.js para abrir offline: sai junto com a conta
  async function apagarCopiaDosDados() {
    try { if (window.caches) await caches.delete('mm-dados'); } catch { /* sem Cache API */ }
  }

  window.login = async function (email, password) {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (!error) { await apagarCopiaDosDados(); return { ok: true }; }
    const msg = /invalid login credentials/i.test(error.message)
      ? 'E-mail ou senha incorretos.'
      : /email not confirmed/i.test(error.message)
        ? 'Este e-mail ainda não foi confirmado no Supabase.'
        : 'Não foi possível entrar agora. Verifique sua conexão e tente de novo.';
    return { ok: false, message: msg };
  };

  window.logout = async function () {
    try { await client.auth.signOut(); } catch { /* sai mesmo offline */ }
    await apagarCopiaDosDados();
    localStorage.removeItem(STORAGE_KEY);
    location.replace(LOGIN_PAGE);
  };

  /** E-mail do usuário logado (ou null). */
  window.getSessionUser = function () {
    const s = readStoredSession();
    return s && s.user ? s.user.email : null;
  };

  /** O usuário é o dono do site? Marcado no Supabase (app_metadata.papel = 'dono',
   *  ver supabase/multiusuario.sql), que só o servidor consegue alterar.
   *  Aceita o usuário vindo de authReady; sem ele, usa a sessão guardada. */
  window.isOwner = function (user) {
    const u = user || (readStoredSession() || {}).user;
    return !!(u && u.app_metadata && u.app_metadata.papel === 'dono');
  };

  /** Apps liberados para o usuário (ids do apps.json), escolhidos no app Usuários e
   *  guardados em app_metadata.apps. null = todos (dono). Contas criadas antes
   *  dessa escolha existir ficam só com o Painel de Estudos. */
  const APPS_PADRAO = ['estudos'];
  window.userApps = function (user) {
    const u = user || (readStoredSession() || {}).user;
    if (window.isOwner(u)) return null;
    const apps = u && u.app_metadata && u.app_metadata.apps;
    return Array.isArray(apps) ? apps : APPS_PADRAO.slice();
  };

  /** O usuário pode abrir o app? Os dados continuam protegidos pelo RLS. */
  window.canUseApp = function (id, user) {
    const apps = window.userApps(user);
    return apps === null || apps.includes(id);
  };

  /** Destino depois do login: ?next= da URL, se for um caminho interno. */
  window.getPostLoginUrl = function () {
    const next = new URLSearchParams(location.search).get('next');
    return next && next.startsWith('/') && !next.startsWith('//') ? next : HOME_PAGE;
  };

  /** Promise que confirma a sessão no servidor. Páginas protegidas podem
   *  aguardá-la antes de mostrar conteúdo: `await authReady`. */
  window.authReady = (async function () {
    const isLoginPage = location.pathname === LOGIN_PAGE || location.pathname === '/';
    const { data, error } = await client.auth.getUser();
    let user = !error && data ? data.user : null;
    // Sem internet (app aberto offline, sw.js): vale a sessão guardada; os dados são a última cópia
    const semRede = error && (!navigator.onLine || error.name === 'AuthRetryableFetchError' || error.status === 0 || /fetch|network/i.test(error.message || ''));
    if (!user && semRede) user = (readStoredSession() || {}).user || null;
    if (!user && !isLoginPage) goToLogin();
    return user;
  })();

  // Se a sessão expirar ou o usuário sair em outra aba, volta para o login.
  client.auth.onAuthStateChange((event) => {
    const isLoginPage = location.pathname === LOGIN_PAGE || location.pathname === '/';
    if (event === 'SIGNED_OUT' && !isLoginPage) goToLogin();
  });
})();

// App instalável e offline (manifest.webmanifest + sw.js): sem internet, abre a última cópia
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// Aviso fixo no topo enquanto estiver sem internet (o que mudar não chega ao servidor)
(function () {
  let faixa = null;
  function mostrar() {
    if (navigator.onLine) { if (faixa) faixa.hidden = true; return; }
    if (!faixa) {
      faixa = document.createElement('div');
      faixa.setAttribute('role', 'status');
      faixa.textContent = '📡 Sem internet: mostrando a última cópia. O que você mudar agora não será salvo.';
      faixa.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483000;padding:6px 12px;background:#b45309;color:#fff;font:600 13px/1.4 system-ui,sans-serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.3)';
      document.body.appendChild(faixa);
    }
    faixa.hidden = false;
  }
  window.addEventListener('online', mostrar);
  window.addEventListener('offline', mostrar);
  if (document.body) mostrar(); else document.addEventListener('DOMContentLoaded', mostrar);
})();
