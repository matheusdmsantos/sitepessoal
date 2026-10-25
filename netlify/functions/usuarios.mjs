/* netlify/functions/usuarios.mjs — cadastro de usuários (só o dono do site)
 *
 * Roda no servidor do Netlify, em /.netlify/functions/usuarios. Criar e apagar
 * usuários exige a chave service_role do Supabase, que fica SÓ na variável de
 * ambiente SUPABASE_SERVICE_ROLE_KEY do Netlify (nunca no código do site).
 *
 * Quem chama manda o próprio token de login (Authorization: Bearer ...). A função
 * confirma esse token no Supabase e só atende se o usuário tiver
 * app_metadata.papel = 'dono' (ver supabase/multiusuario.sql).
 *
 *   GET                                        lista os usuários
 *   POST { acao: 'criar', email, senha, apps } cria, já confirmado
 *   POST { acao: 'apps', id, apps }            troca os apps liberados
 *   POST { acao: 'senha', id, senha }          troca a senha
 *   POST { acao: 'excluir', id }               apaga o usuário e, em cascata, os dados dele
 *
 * "apps" são ids do apps.json, guardados em app_metadata.apps (só o servidor
 * altera). O hub e cada app conferem com canUseApp (js/auth.js).
 */
const SUPABASE_URL = 'https://smbvlquqqhtgmvgddjlq.supabase.co';
const SENHA_MIN = 8;
const SO_DONO = ['usuarios'];

// Lista de ids válida: sem repetidos, sem apps exclusivos do dono
function limparApps(apps) {
  if (!Array.isArray(apps)) return null;
  const ok = apps.map(String).filter(id => /^[a-z0-9-]{1,40}$/.test(id) && !SO_DONO.includes(id));
  return [...new Set(ok)].slice(0, 50);
}

const resposta = (status, corpo) => new Response(JSON.stringify(corpo), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

async function admin(chave, caminho, metodo = 'GET', corpo) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/${caminho}`, {
    method: metodo,
    headers: { apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = dados.msg || dados.message || dados.error_description || `Erro ${r.status} no Supabase.`;
    throw Object.assign(new Error(msg), { status: r.status });
  }
  return dados;
}

const resumo = u => ({
  id: u.id,
  email: u.email,
  criado_em: u.created_at,
  ultimo_acesso: u.last_sign_in_at || null,
  dono: !!(u.app_metadata && u.app_metadata.papel === 'dono'),
  apps: u.app_metadata && Array.isArray(u.app_metadata.apps) ? u.app_metadata.apps : null
});

function traduzir(msg) {
  if (/already (been )?registered|already exists/i.test(msg)) return 'Já existe um usuário com este e-mail.';
  if (/password/i.test(msg) && /(short|least|weak)/i.test(msg)) return `A senha precisa ter pelo menos ${SENHA_MIN} caracteres.`;
  if (/invalid.*email|email.*invalid/i.test(msg)) return 'E-mail inválido.';
  return msg;
}

export default async (req) => {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!chave) return resposta(500, { erro: 'Falta a variável SUPABASE_SERVICE_ROLE_KEY no Netlify.' });
  if (req.method !== 'GET' && req.method !== 'POST') return resposta(405, { erro: 'Método não permitido.' });

  // Quem está chamando? O Supabase confirma o token.
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return resposta(401, { erro: 'Faça login de novo.' });
  const rUser = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: chave, Authorization: `Bearer ${token}` } });
  if (!rUser.ok) return resposta(401, { erro: 'Sessão expirada. Faça login de novo.' });
  const eu = await rUser.json();
  if (!eu.app_metadata || eu.app_metadata.papel !== 'dono') return resposta(403, { erro: 'Só o dono do site pode gerenciar usuários.' });

  try {
    if (req.method === 'GET') {
      const dados = await admin(chave, 'users?per_page=200');
      const lista = (dados.users || []).map(resumo).sort((a, b) => (a.criado_em < b.criado_em ? -1 : 1));
      return resposta(200, { usuarios: lista });
    }

    const corpo = await req.json().catch(() => ({}));
    const senhaOk = s => typeof s === 'string' && s.length >= SENHA_MIN;

    if (corpo.acao === 'criar') {
      const email = String(corpo.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return resposta(400, { erro: 'E-mail inválido.' });
      if (!senhaOk(corpo.senha)) return resposta(400, { erro: `A senha precisa ter pelo menos ${SENHA_MIN} caracteres.` });
      const apps = limparApps(corpo.apps);
      if (!apps) return resposta(400, { erro: 'Escolha os apps do usuário.' });
      const u = await admin(chave, 'users', 'POST', { email, password: corpo.senha, email_confirm: true, app_metadata: { apps } });
      return resposta(200, { usuario: resumo(u.user || u) });
    }

    if (corpo.acao === 'senha' || corpo.acao === 'excluir' || corpo.acao === 'apps') {
      const id = String(corpo.id || '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) return resposta(400, { erro: 'Usuário inválido.' });
      if (corpo.acao === 'excluir') {
        if (id === eu.id) return resposta(400, { erro: 'Você não pode excluir a própria conta.' });
        const alvo = await admin(chave, `users/${id}`);
        if (resumo(alvo.user || alvo).dono) return resposta(400, { erro: 'A conta do dono não pode ser excluída por aqui.' });
        await admin(chave, `users/${id}`, 'DELETE');
        return resposta(200, { ok: true });
      }
      if (corpo.acao === 'apps') {
        const apps = limparApps(corpo.apps);
        if (!apps) return resposta(400, { erro: 'Escolha os apps do usuário.' });
        if (id === eu.id) return resposta(400, { erro: 'O dono já vê todos os apps.' });
        // O Auth junta as chaves do app_metadata: o papel e o resto ficam como estão
        const u = await admin(chave, `users/${id}`, 'PUT', { app_metadata: { apps } });
        return resposta(200, { usuario: resumo(u.user || u) });
      }
      if (!senhaOk(corpo.senha)) return resposta(400, { erro: `A senha precisa ter pelo menos ${SENHA_MIN} caracteres.` });
      await admin(chave, `users/${id}`, 'PUT', { password: corpo.senha });
      return resposta(200, { ok: true });
    }

    return resposta(400, { erro: 'Ação desconhecida.' });
  } catch (e) {
    console.error('usuarios:', e);
    return resposta(e.status && e.status < 500 ? 400 : 502, { erro: traduzir(e.message) });
  }
};
