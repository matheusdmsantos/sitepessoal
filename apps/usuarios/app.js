/* apps/usuarios/app.js — cadastro de usuários, só para o dono do site
 *
 * Ao criar, o dono escolhe os apps liberados (lista do apps.json, sem os "soDono");
 * a escolha pode ser trocada depois em "🧩 Apps".
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
  const APPS_NOVO = ['estudos'];   // marcados de início ao criar
  let usuarios = [];
  let euId = null;
  let catalogo = [];                // apps do apps.json que podem ser liberados
  let editando = null;              // id do usuário com os apps abertos para edição

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

  // Apps que podem ser liberados: os que existem (url) e não são exclusivos do dono
  async function carregarCatalogo() {
    try {
      const r = await fetch('/apps.json', { cache: 'no-cache' });
      const dados = await r.json();
      catalogo = (dados.apps || []).filter(a => a.url && !a.soDono);
    } catch (e) {
      catalogo = [];
      aviso('Não foi possível ler a lista de apps (apps.json).');
    }
  }

  function opcoesApps(marcados, nome) {
    return catalogo.map(a => `
      <label class="us-app">
        <input type="checkbox" name="${nome}" value="${esc(a.id)}" ${marcados.includes(a.id) ? 'checked' : ''} />
        <span>${esc(a.icone || '')} ${esc(a.nome)}</span>
      </label>`).join('');
  }

  const marcadosEm = el => Array.from(el.querySelectorAll('input[type=checkbox]:checked'), c => c.value);
  // Contas antigas, sem escolha gravada, ficam com o padrão do auth.js
  const appsDe = u => u.apps || userApps({ app_metadata: {} }) || [];
  const nomeApp = id => { const a = catalogo.find(x => x.id === id); return a ? `${a.icone || ''} ${a.nome}`.trim() : id; };

  function mostrarCredenciais(email, senha) {
    $('us-credenciais-texto').textContent =
      `Endereço: ${SITE}\nE-mail: ${email}\nSenha: ${senha}\n\nDepois de entrar, os seus apps aparecem na tela inicial.`;
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
          <span class="us-item-apps">${u.dono ? '<span class="us-chip">Todos os apps</span>'
            : appsDe(u).length ? appsDe(u).map(id => `<span class="us-chip">${esc(nomeApp(id))}</span>`).join('')
            : '<span class="us-chip vazio">Nenhum app</span>'}</span>
        </div>
        ${u.dono ? '' : `
        <div class="us-item-acoes">
          <button type="button" class="us-btn sutil" data-acao="apps" data-id="${u.id}" aria-expanded="${editando === u.id}">🧩 Apps</button>
          <button type="button" class="us-btn sutil" data-acao="senha" data-id="${u.id}">🔑 Nova senha</button>
          <button type="button" class="us-btn perigo" data-acao="excluir" data-id="${u.id}">Excluir</button>
        </div>
        ${editando === u.id ? `
        <div class="us-editar" data-id="${u.id}">
          <div class="us-apps-opcoes">${opcoesApps(appsDe(u), 'apps-' + u.id)}</div>
          <div class="us-editar-acoes">
            <button type="button" class="us-btn sutil" data-acao="cancelar-apps" data-id="${u.id}">Cancelar</button>
            <button type="button" class="us-btn primario" data-acao="salvar-apps" data-id="${u.id}">Salvar apps</button>
          </div>
        </div>` : ''}`}
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
    const apps = marcadosEm($('us-apps-novo'));
    if (!apps.length && !confirm('Nenhum app marcado: a pessoa vai entrar e não ver nada. Criar assim mesmo?')) return;
    $('us-criar').disabled = true;
    aviso('');
    try {
      await chamar('POST', { acao: 'criar', email, senha, apps });
      $('us-form').reset();
      $('us-apps-novo').innerHTML = opcoesApps(APPS_NOVO, 'apps-novo');
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
    if (b.dataset.acao === 'apps' || b.dataset.acao === 'cancelar-apps') {
      editando = b.dataset.acao === 'apps' && editando !== u.id ? u.id : null;
      return render();
    }
    try {
      if (b.dataset.acao === 'salvar-apps') {
        const apps = marcadosEm(b.closest('.us-editar'));
        b.disabled = true;
        const r = await chamar('POST', { acao: 'apps', id: u.id, apps });
        u.apps = r.usuario.apps;
        editando = null;
        render();
        aviso(`Apps de ${u.email} atualizados. Valem na próxima vez que a pessoa abrir o hub.`, 'ok');
      } else if (b.dataset.acao === 'senha') {
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
    await carregarCatalogo();
    $('us-apps-novo').innerHTML = opcoesApps(APPS_NOVO, 'apps-novo');
    carregar();
  }

  init();
})();
