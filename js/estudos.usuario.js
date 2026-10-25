/* ─── js/estudos.usuario.js — dados deste navegador separados por usuário ───
 *
 * O Painel de Estudos guarda algumas coisas no localStorage (chaves "est_*" e
 * "disc_order_*"): cronômetro, preferências, cópias de segurança e dados que
 * ainda não foram para o Supabase. Se outra pessoa entrar no mesmo navegador,
 * esses dados não podem aparecer para ela nem ser enviados para a conta dela.
 *
 * Ao trocar de usuário, as chaves do anterior são guardadas num pacote
 * ("usuario_guardado_<e-mail>") e as do atual, se houver, são devolvidas.
 * Se faltar espaço, o pacote vai sem as cópias do que já está no Supabase
 * (edital e resumos), que voltam na próxima carga.
 *
 * Roda antes do estudos.v5.js, logo depois do requireAuth().
 */
(function () {
  const CHAVE_USUARIO = 'est_usuario';
  const PACOTE = 'usuario_guardado_';
  const SO_CACHE = ['est_editais', 'est_resumos_backup'];
  const doPainel = k => (k.startsWith('est_') || k.startsWith('disc_order_')) && k !== CHAVE_USUARIO;

  function devolver(nome, sobrescrever) {
    const bruto = localStorage.getItem(PACOTE + nome);
    if (!bruto) return;
    try {
      const pacote = JSON.parse(bruto);
      Object.keys(pacote).forEach(k => {
        if (sobrescrever || localStorage.getItem(k) === null) localStorage.setItem(k, pacote[k]);
      });
      localStorage.removeItem(PACOTE + nome);
    } catch (e) { console.warn('Não foi possível devolver os dados guardados deste usuário.', e); }
  }

  const atual = getSessionUser();
  if (!atual) return;
  const anterior = localStorage.getItem(CHAVE_USUARIO);

  if (anterior !== atual) {
    const chaves = Object.keys(localStorage).filter(doPainel);
    // Antes desta separação existir, os dados do navegador eram do dono do site
    const de = anterior || (chaves.length && !isOwner() ? 'dono' : null);
    if (de) {
      const pacote = {};
      chaves.forEach(k => { pacote[k] = localStorage.getItem(k); });
      try { localStorage.setItem(PACOTE + de, JSON.stringify(pacote)); }
      catch (e) {
        // Sem espaço: guarda sem as cópias, que voltam do Supabase
        SO_CACHE.forEach(k => delete pacote[k]);
        try { localStorage.setItem(PACOTE + de, JSON.stringify(pacote)); }
        catch (e2) { console.warn('Não foi possível guardar os dados do usuário anterior neste navegador.', e2); }
      }
      chaves.forEach(k => localStorage.removeItem(k));
    }
    devolver(atual, true);
    localStorage.setItem(CHAVE_USUARIO, atual);
  }

  // O dono pode ter entrado antes de a sessão saber que ele é o dono
  if (isOwner()) devolver('dono', false);
})();
