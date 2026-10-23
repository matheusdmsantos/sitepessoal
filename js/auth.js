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
  window.login = async function (email, password) {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (!error) return { ok: true };
    const msg = /invalid login credentials/i.test(error.message)
      ? 'E-mail ou senha incorretos.'
      : /email not confirmed/i.test(error.message)
        ? 'Este e-mail ainda não foi confirmado no Supabase.'
        : 'Não foi possível entrar agora. Verifique sua conexão e tente de novo.';
    return { ok: false, message: msg };
  };

  window.logout = async function () {
    try { await client.auth.signOut(); } catch { /* sai mesmo offline */ }
    localStorage.removeItem(STORAGE_KEY);
    location.replace(LOGIN_PAGE);
  };

  /** E-mail do usuário logado (ou null). */
  window.getSessionUser = function () {
    const s = readStoredSession();
    return s && s.user ? s.user.email : null;
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
    const user = !error && data ? data.user : null;
    if (!user && !isLoginPage) goToLogin();
    return user;
  })();

  // Se a sessão expirar ou o usuário sair em outra aba, volta para o login.
  client.auth.onAuthStateChange((event) => {
    const isLoginPage = location.pathname === LOGIN_PAGE || location.pathname === '/';
    if (event === 'SIGNED_OUT' && !isLoginPage) goToLogin();
  });
})();
