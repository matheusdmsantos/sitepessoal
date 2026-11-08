/* netlify/functions/ia-resumo.mjs — "✨ IA" do editor de resumos (só o dono do site)
 *
 * Roda no servidor do Netlify, em /.netlify/functions/ia-resumo. Recebe o trecho do resumo
 * selecionado no editor (HTML) e devolve o mesmo conteúdo organizado pela API do Claude:
 * títulos, listas, negrito, grifo (<mark>), tabelas e emojis. A chave da API fica SÓ na
 * variável de ambiente ANTHROPIC_API_KEY do Netlify (nunca no código do site).
 *
 * Quem chama manda o próprio token de login (Authorization: Bearer ...). A função confirma
 * o token no Supabase e só atende app_metadata.papel = 'dono', porque cada chamada é cobrada
 * na conta da API.
 *
 *   POST { html, disciplina, assunto }  ->  200 { html }  |  4xx/5xx { erro }
 *
 * Chamada direta por fetch, sem dependências (como usuarios.mjs e agenda.mjs): o site não
 * tem package.json nem etapa de build. Não roda no servidor local; teste no Netlify.
 */
const SUPABASE_URL = 'https://smbvlquqqhtgmvgddjlq.supabase.co';
// Chave anon: pública por design (a mesma de js/supabase-client.js); só serve para conferir o token
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtYnZscXVxcWh0Z212Z2RkamxxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MDI0NjAsImV4cCI6MjA5OTE3ODQ2MH0.Asz3z7D-fGHN4R9PTE7et_IkzodrQcw_py267jZkfiw';

const MODELO = 'claude-haiku-5-5';   // o mais barato (US$ 0,10 / 0,50 por milhão de tokens); não tem a nova tentativa automática (fallbacks)
const MAX_HTML = 40000;      // caracteres de HTML recebidos (o editor limita o texto a 6.000)
const PRAZO_MS = 50000;      // a função do Netlify tem 60 s

const INSTRUCOES = `Você ajuda um estudante de concursos públicos a revisar o próprio resumo. Ele digita as anotações rápido, durante o estudo, sem tempo de organizar. Você recebe um trecho dessas anotações (em HTML) e devolve o mesmo conteúdo reorganizado, mais claro e didático, pronto para revisão rápida.

Conteúdo:
- Mantenha todas as informações do trecho. Não acrescente fatos, números, prazos, artigos de lei, exceções ou exemplos que não estejam nele: o resumo é a fonte de estudo dele, e um dado inventado vira erro na prova.
- Pode corrigir erros de digitação e de português, desfazer abreviações óbvias e reescrever frases confusas, sempre com o mesmo sentido.
- Escreva em português do Brasil, num tom direto, de anotação de estudo.

Organização:
- Títulos curtos para separar as ideias, listas para enumerações e passos, e parágrafos curtos.
- Negrito nos termos-chave; <mark> (grifo amarelo) só no que mais cai ou mais confunde: exceções, prazos, pegadinhas, palavras como "salvo", "vedado", "exclusivamente".
- Tabela quando o trecho comparar dois ou mais itens (tipos, espécies, prazos, diferenças entre institutos).
- Emojis com moderação, como marcadores visuais no início de títulos ou itens: ⚠️ exceção/pegadinha, 📌 regra geral, ✅/❌ pode/não pode, ⏱️ prazo, ⚖️ lei/jurisprudência, 💡 dica de memorização.

Formato da resposta: apenas o HTML do trecho melhorado, sem cercas de código (\`\`\`) e sem nenhum texto antes ou depois. Use só estas tags: <h3>, <h4>, <p>, <br>, <strong>, <em>, <u>, <mark>, <ul>, <ol>, <li>, <blockquote>, <table>, <thead>, <tbody>, <tr>, <th>, <td>. Nenhum atributo (nem style, nem class). A única exceção são as imagens: cada <img data-ref="N"> do trecho deve aparecer exatamente assim, uma vez, fora de tabelas, no ponto do texto a que pertence.`;

const resposta = (status, corpo) => new Response(JSON.stringify(corpo), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

// Mensagens da API em português, pelo status HTTP (429 e 5xx são temporários)
function erroDaApi(status, msg) {
  // shortcut: falta de crédito não tem tipo de erro próprio na API, só este texto; se ele mudar, cai na mensagem genérica (que mostra o motivo)
  if (/credit balance/i.test(msg)) return 'Os créditos da API do Claude acabaram. Compre mais em console.anthropic.com (Billing).';
  if (status === 401 || status === 403) return 'A chave da API do Claude (ANTHROPIC_API_KEY) não foi aceita. Confira a variável no Netlify.';
  if (status === 429) return 'Limite de uso da API do Claude atingido. Espere um minuto e tente de novo.';
  if (status === 529 || status >= 500) return 'A API do Claude está sobrecarregada agora. Tente de novo em instantes.';
  if (status === 413) return 'Trecho grande demais. Selecione um pedaço menor.';
  return `A API do Claude recusou o pedido (erro ${status}${msg ? `: ${msg}` : ''}).`;
}

export default async (req) => {
  if (req.method !== 'POST') return resposta(405, { erro: 'Método não permitido.' });
  const chaveApi = process.env.ANTHROPIC_API_KEY;
  if (!chaveApi) return resposta(500, { erro: 'Falta a variável ANTHROPIC_API_KEY no Netlify (Site configuration > Environment variables).' });

  // Quem está chamando? O Supabase confirma o token.
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return resposta(401, { erro: 'Faça login de novo.' });
  const rUser = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
  if (!rUser.ok) return resposta(401, { erro: 'Sessão expirada. Faça login de novo.' });
  const eu = await rUser.json();
  if (!eu.app_metadata || eu.app_metadata.papel !== 'dono') return resposta(403, { erro: 'A IA do resumo é só do dono do site.' });

  const corpo = await req.json().catch(() => ({}));
  const html = typeof corpo.html === 'string' ? corpo.html.trim() : '';
  if (!html) return resposta(400, { erro: 'Selecione o trecho que a IA deve melhorar.' });
  if (html.length > MAX_HTML) return resposta(413, { erro: 'Trecho grande demais. Selecione um pedaço menor e melhore em partes.' });
  const contexto = [corpo.disciplina && `Disciplina: ${String(corpo.disciplina).slice(0, 200)}`,
    corpo.assunto && `Assunto: ${String(corpo.assunto).slice(0, 300)}`].filter(Boolean).join('\n');

  const parar = new AbortController();
  const prazo = setTimeout(() => parar.abort(), PRAZO_MS);
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: parar.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': chaveApi,
        'anthropic-version': '2026-10-21'
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 16000,                    // o raciocínio (thinking) também conta aqui
        output_config: { effort: 'medium' },  // padrão do Haiku 5.5 (low é mais rápido; high, mais cuidadoso e mais lento)
        system: INSTRUCOES,
        messages: [{ role: 'user', content: `${contexto ? `<contexto>\n${contexto}\n</contexto>\n\n` : ''}<trecho>\n${html}\n</trecho>` }]
      })
    });
  } catch (e) {
    clearTimeout(prazo);
    return e.name === 'AbortError'
      ? resposta(504, { erro: 'A IA demorou demais para responder. Selecione um trecho menor e tente de novo.' })
      : resposta(502, { erro: 'Não foi possível falar com a API do Claude. Tente de novo.' });
  }

  let dados;
  try {
    dados = await r.json();
  } catch (e) {
    clearTimeout(prazo);
    return resposta(e.name === 'AbortError' ? 504 : 502, { erro: 'A resposta da IA veio incompleta. Tente de novo.' });
  }
  clearTimeout(prazo);
  if (!r.ok) {
    console.error('ia-resumo: API', r.status, dados && dados.error);
    return resposta(r.status === 429 ? 429 : 502, { erro: erroDaApi(r.status, (dados && dados.error && dados.error.message) || '') });
  }

  // Recusa (filtro de segurança) e corte por tamanho: o texto que veio não serve
  if (dados.stop_reason === 'refusal') return resposta(422, { erro: 'A IA não quis processar este trecho. Tente reescrever ou selecionar outro pedaço.' });
  if (dados.stop_reason === 'max_tokens') return resposta(413, { erro: 'O trecho ficou grande demais para a IA. Selecione um pedaço menor.' });

  const texto = (dados.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim()
    .replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/, '');
  if (!texto) return resposta(502, { erro: 'A IA não devolveu texto. Tente de novo.' });
  console.log('ia-resumo: tokens', dados.usage && dados.usage.input_tokens, '->', dados.usage && dados.usage.output_tokens, dados.model);
  return resposta(200, { html: texto });
};
