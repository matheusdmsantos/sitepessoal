/* Cloudflare Pages: o site é publicado da própria pasta (sem build), então SQL, código das
 * funções, ferramentas e documentação ficariam acessíveis. Estes caminhos dão 404.
 * Só roda nas rotas listadas em _routes.json (o resto do site é estático e não gasta a cota de funções). */
const BLOQUEADOS = /^\/(supabase|netlify|functions|ferramentas|editais|docs)(\/|$)|^\/(README\.md|CLAUDE\.md|netlify\.toml|_routes\.json|\.gitignore)$/i;

export const onRequest = context =>
  BLOQUEADOS.test(new URL(context.request.url).pathname)
    ? new Response('Não encontrado.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    : context.next();
