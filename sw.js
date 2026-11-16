/* Service worker do app instalável (manifest.webmanifest; registrado no js/auth.js).
   Abrir sem internet mostrando a última cópia (só leitura):
   - páginas, js e css do site: rede primeiro (sempre a versão publicada) e cópia em TELAS;
   - bibliotecas dos CDNs (versões fixas): cópia primeiro;
   - leituras do Supabase (GET em /rest/v1/): rede primeiro e cópia em DADOS. Sem rede, as telas
     recebem a última resposta, então cada módulo funciona sem mudar nada. Gravações (POST/PATCH)
     não passam por aqui: sem internet, falham e cada tela avisa como já fazia.
   DADOS é apagado ao sair e ao entrar (js/auth.js), para outra conta não ver a cópia. */
const TELAS = 'mm-telas-v1';
const DADOS = 'mm-dados';
const SUPABASE = 'https://smbvlquqqhtgmvgddjlq.supabase.co';
const CDNS = ['https://cdn.jsdelivr.net', 'https://cdn.quilljs.com', 'https://cdnjs.cloudflare.com', 'https://unpkg.com',
  'https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', ev => ev.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('mm-telas-') && k !== TELAS) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === SUPABASE) {
    if (url.pathname.startsWith('/rest/v1/')) ev.respondWith(redePrimeiro(req, DADOS));
    return;
  }
  if (url.origin === self.location.origin) {
    if (/^\/(api|agenda)\//.test(url.pathname)) return;   // funções: sempre na rede
    ev.respondWith(redePrimeiro(req, TELAS));
    return;
  }
  if (CDNS.includes(url.origin)) ev.respondWith(copiaPrimeiro(req));
});

// Resposta que veio de um redirecionamento (/estudos.html → /estudos) não pode ser devolvida a uma
// navegação; a cópia "limpa" pode, e fica guardada nos dois endereços
const limpa = r => (r.redirected ? new Response(r.body, { status: r.status, statusText: r.statusText, headers: r.headers }) : r);

async function redePrimeiro(req, nome) {
  const cache = await caches.open(nome);
  try {
    const r = await fetch(req);
    if (r.ok) {
      const copia = limpa(r.clone());
      const url = new URL(req.url);
      if (nome === TELAS && url.search) {
        // js/css com ?v=: tira as versões antigas do mesmo arquivo
        for (const k of await cache.keys()) { const u = new URL(k.url); if (u.pathname === url.pathname && u.search !== url.search) cache.delete(k); }
      }
      await cache.put(req, copia.clone());
      if (r.redirected) await cache.put(r.url, copia);
    }
    return req.mode === 'navigate' ? limpa(r) : r;
  } catch (e) {
    const guardada = await cache.match(req, { ignoreVary: true });
    if (guardada) return guardada;
    if (req.mode === 'navigate') return semCopia();
    throw e;
  }
}

async function copiaPrimeiro(req) {
  const cache = await caches.open(TELAS);
  const guardada = await cache.match(req, { ignoreVary: true });
  if (guardada) return guardada;
  const r = await fetch(req);
  if (r.ok || r.type === 'opaque') await cache.put(req, r.clone());
  return r;
}

function semCopia() {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sem internet</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#1c2033;color:#e5e7eb;font-family:system-ui,sans-serif;text-align:center;padding:24px">
<div><p style="font-size:2.5rem;margin:0">📡</p><h1 style="font-size:1.2rem">Sem internet</h1>
<p style="color:#9ca3af;max-width:32em">Esta tela ainda não foi aberta neste aparelho com internet, então não há cópia guardada. Conecte-se uma vez e ela passa a abrir offline.</p>
<button onclick="location.reload()" style="padding:10px 18px;border:0;border-radius:8px;background:#3b82f6;color:#fff;font:inherit">Tentar de novo</button></div></body>`,
  { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
