/* apps/usuarios/app.js — cadastro de usuários, só para o dono do site
 *
 * Quem cria, troca senha e apaga é a Netlify Function netlify/functions/usuarios.mjs,
 * que guarda a chave service_role do Supabase. Esta página só chama a função com
 * o token de login; a função confere de novo se o usuário é o dono.
 */
(function () {
  const API = '/.netlify/functions/usuarios';
  const SITE = 'https://matheusmirandaeng.com.br';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtData = iso => iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca';
  let usuarios = [];
  let euId = null;

  function aviso(msg, tipo = 'erro') {
    const el = $('us-aviso');
    el.textContent = msg || '';
    el.className = 'us-aviso ' + tipo;
    el.hidden = !msg;
  }

  // Senha legível: sem 0/O, 1/l/I
  function gerarSenha(n = 12) {
    const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const v = crypto.getRandomValues(new Uint32Array(n));
    return Array.from(v, x => letras[x % letras.length]).join('');
  }

  async function chamar(metodo, corpo) {
    const { data } = await window.supabaseClient.auth.getSession();
    const token = data && data.session && data.session.access_token;
    if (!token) throw new Error('Sessão expirada. Faça login de novo.');
    let r;
    try {
      r = await fetch(API, {
        method: metodo,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: corpo ? JSON.stringify(corpo) : undefined
      });
    } catch (e) {
      throw new Error('Sem conexão com o servidor.');
    }
    if (r.status === 404) throw new Error('A função de usuários só roda no Netlify (site publicado ou prévia da branch), não no servidor local.');
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(dados.erro || `Erro ${r.status}.`);
    return dados;
  }

  function mostrarCredenciais(email, senha) {
    $('us-credenciais-texto').textContent =
      `Endereço: ${SITE}\nE-mail: ${email}\nSenha: ${senha}\n\nNo hub, abra o Painel de Estudos.`;
    $('us-credenciais').hidden = false;
  }

  function render() {
    $('us-lista').innerHTML = usuarios.length ? usuarios.map(u => `
      <div class="us-item">
        <div class="us-item-info">
          <span class="us-item-email">${esc(u.email)}
            ${u.id === euId ? '<span class="us-selo">você</span>' : ''}
            ${u.dono ? '<span class="us-selo dono">dono</span>' : ''}</span>
          <span class="us-item-datas">Criado em ${fmtData(u.criado_em)} · último acesso: ${fmtData(u.ultimo_acesso)}</span>
        </div>
        ${u.dono ? '' : `
        <div class="us-item-acoes">
          <button type="button" class="us-btn sutil" data-acao="senha" data-id="${u.id}">🔑 Nova senha</button>
          <button type="button" class="us-btn perigo" data-acao="excluir" data-id="${u.id}">Excluir</button>
        </div>`}
      </div>`).join('')
      : '<p class="us-vazio">Nenhum usuário.</p>';
  }

  async function carregar() {
    $('us-lista').innerHTML = '<p class="us-vazio">Carregando…</p>';
    try {
      usuarios = (await chamar('GET')).usuarios || [];
      render();
    } catch (e) {
      $('us-lista').innerHTML = '';
      aviso(e.message);
    }
  }

  async function criar(ev) {
    ev.preventDefault();
    const email = $('us-email').value.trim();
    const senha = $('us-senha').value;
    $('us-criar').disabled = true;
    aviso('');
    try {
      await chamar('POST', { acao: 'criar', email, senha });
      $('us-form').reset();
      mostrarCredenciais(email, senha);
      aviso(`Usuário ${email} criado.`, 'ok');
      await carregar();
    } catch (e) {
      aviso(e.message);
    } finally {
      $('us-criar').disabled = false;
    }
  }

  async function acao(ev) {
    const b = ev.target.closest('button[data-acao]');
    if (!b) return;
    const u = usuarios.find(x => x.id === b.dataset.id);
    if (!u) return;
    aviso('');
    try {
      if (b.dataset.acao === 'senha') {
        const senha = gerarSenha();
        if (!confirm(`Trocar a senha de ${u.email}? A senha atual deixa de funcionar.`)) return;
        await chamar('POST', { acao: 'senha', id: u.id, senha });
        mostrarCredenciais(u.email, senha);
        aviso(`Senha de ${u.email} trocada. Envie a nova para a pessoa.`, 'ok');
      } else {
        if (!confirm(`Excluir ${u.email}?\n\nTodo o Painel de Estudos dessa pessoa (editais, metas, revisões, resumos…) será apagado. Não dá para desfazer.`)) return;
        await chamar('POST', { acao: 'excluir', id: u.id });
        aviso(`${u.email} excluído.`, 'ok');
        await carregar();
      }
    } catch (e) {
      aviso(e.message);
    }
  }

  async function init() {
    const user = await window.authReady;
    if (!user) return;
    if (!isOwner(user)) { location.replace('/apps.html'); return; }
    euId = user.id;
    document.body.classList.remove('auth-pending');
    $('us-eu').textContent = user.email;

    $('us-form').addEventListener('submit', criar);
    $('us-gerar').addEventListener('click', () => { $('us-senha').value = gerarSenha(); });
    $('us-recarregar').addEventListener('click', carregar);
    $('us-lista').addEventListener('click', acao);
    $('us-copiar').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText($('us-credenciais-texto').textContent);
        $('us-copiar').textContent = '✓ Copiado';
        setTimeout(() => { $('us-copiar').textContent = '📋 Copiar'; }, 2000);
      } catch (e) { aviso('Não foi possível copiar; selecione o texto e copie à mão.'); }
    });
    carregar();
  }

  init();
})();
