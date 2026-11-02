/* netlify/functions/agenda.mjs — agenda iCal da Gestão de Contratos
 *
 * Endereço: /agenda/<token>.ics (redirecionado no netlify.toml). O Google Agenda
 * assina esse link ("Outras agendas → Do URL") e o relê sozinho algumas vezes
 * por dia. Não há login: quem tem o link vê a agenda, por isso o token é longo
 * e pode ser trocado ou desativado no app (tabela agenda_links, supabase/agenda.sql).
 *
 * Com a chave service_role (variável SUPABASE_SERVICE_ROLE_KEY do Netlify), acha
 * o dono do token e lê só os dados dele: prazos em aberto, recebimentos não
 * pagos (vencimento) e prazos das pendências de obra. Eventos de dia inteiro.
 */
const SUPABASE_URL = 'https://smbvlquqqhtgmvgddjlq.supabase.co';
const SITE = 'https://matheusmirandaeng.com.br';
const APP = `${SITE}/apps/controle-obras/index.html`;

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const buscar = (chave, caminho) => fetch(`${SUPABASE_URL}/${caminho}`, {
  headers: { apikey: chave, Authorization: `Bearer ${chave}` }
});

async function ler(chave, caminho) {
  const r = await buscar(chave, `rest/v1/${caminho}`);
  if (!r.ok) {
    // Tabela que ainda não existe (ex.: financeiro não instalado) só fica de fora
    console.warn(`agenda: falha ao ler ${caminho.split('?')[0]} (${r.status})`);
    return [];
  }
  return r.json();
}

/* Lê só as linhas do dono do link. Tabela sem a coluna "dono" (multiusuario.sql não
 * rodado nela) fica, pelo rls.sql, só com o dono do site: para ele, lê sem o filtro. */
async function lerDoUsuario(chave, tabela, filtros, usuario) {
  const r = await buscar(chave, `rest/v1/${tabela}?dono=eq.${usuario.id}&${filtros}`);
  if (r.ok) return r.json();
  const erro = await r.json().catch(() => ({}));
  if (erro.code === '42703' && /dono/.test(erro.message || '') && await usuario.ehDonoDoSite()) {
    return ler(chave, `${tabela}?${filtros}`);
  }
  console.warn(`agenda: falha ao ler ${tabela} (${r.status} ${erro.code || ''})`);
  return [];
}

// app_metadata.papel = 'dono' (o mesmo critério do auth.js), consultado uma vez só
function usuarioDoLink(chave, id) {
  let papel;
  return {
    id,
    ehDonoDoSite: () => (papel ??= buscar(chave, `auth/v1/admin/users/${id}`)
      .then(r => (r.ok ? r.json() : {}))
      .then(u => (u.app_metadata || {}).papel === 'dono')
      .catch(() => false))
  };
}

// Texto no formato iCal: escapa \ ; , e quebras de linha
const texto = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Linhas de no máximo 75 bytes (UTF-8), continuadas com um espaço
function dobrar(linha) {
  const bytes = new TextEncoder();
  const partes = [];
  let atual = '';
  for (const c of linha) {
    if (bytes.encode(atual + c).length > (partes.length ? 74 : 75)) { partes.push(atual); atual = ''; }
    atual += c;
  }
  partes.push(atual);
  return partes.join('\r\n ');
}

const diaIcs = d => d.slice(0, 10).replace(/-/g, '');
function diaSeguinte(d) {
  const x = new Date(d.slice(0, 10) + 'T12:00:00Z');
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}

function evento({ uid, dia, titulo, descricao, url, local }, carimbo) {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}@matheusmirandaeng.com.br`,
    `DTSTAMP:${carimbo}`,
    `DTSTART;VALUE=DATE:${diaIcs(dia)}`,
    `DTEND;VALUE=DATE:${diaIcs(diaSeguinte(dia))}`,
    `SUMMARY:${texto(titulo)}`,
    descricao ? `DESCRIPTION:${texto(descricao)}` : '',
    local ? `LOCATION:${texto(local)}` : '',
    url ? `URL:${url}` : '',
    'TRANSP:TRANSPARENT',
    'END:VEVENT'
  ].filter(Boolean).map(dobrar).join('\r\n');
}

const naoEncontrado = () => new Response('Agenda não encontrada. Gere um link novo na Gestão de Contratos.', {
  status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
});

export default async (req) => {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!chave) return new Response('Falta a variável SUPABASE_SERVICE_ROLE_KEY no Netlify.', { status: 500 });
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Método não permitido.', { status: 405 });

  // Token pelo caminho (/agenda/<token>.ics) ou por ?t=
  const url = new URL(req.url);
  const token = (url.searchParams.get('t') || url.pathname.split('/').pop() || '').replace(/\.ics$/i, '');
  if (!/^[a-f0-9]{48}$/.test(token)) return naoEncontrado();

  const [link] = await ler(chave, `agenda_links?token=eq.${token}&select=dono,itens`);
  if (!link) return naoEncontrado();
  const usuario = usuarioDoLink(chave, link.dono);
  const itens = Array.isArray(link.itens) ? link.itens : ['prazos', 'recebimentos', 'pendencias'];

  const [processos, prazos, recebimentos, pendencias] = await Promise.all([
    lerDoUsuario(chave, 'processos', 'select=id,numero,assunto,cliente,local,fase', usuario),
    itens.includes('prazos') ? lerDoUsuario(chave, 'prazos', 'concluido_em=is.null&select=*', usuario) : [],
    itens.includes('recebimentos') ? lerDoUsuario(chave, 'recebimentos', 'recebido_em=is.null&select=id,processo_id,descricao,valor,vencimento,nf_numero,nf_emitida_em', usuario) : [],
    itens.includes('pendencias') ? lerDoUsuario(chave, 'obra_pendencias', 'corrigida_em=is.null&prazo=not.is.null&select=id,processo_id,descricao,local,gravidade,prazo', usuario) : []
  ]);
  const proc = id => processos.find(p => p.id === id) || {};
  const sobre = p => [p.numero && `Processo ${p.numero}`, p.assunto, p.cliente && `Cliente: ${p.cliente}`].filter(Boolean).join('\n');

  const eventos = [
    ...prazos.map(z => {
      const p = proc(z.processo_id);
      return { uid: `prazo-${z.id}`, dia: z.data, titulo: `⏰ ${z.descricao}${p.numero ? ` · ${p.numero}` : ''}`,
        descricao: [z.mensagem && `Mensagem${z.para_nome ? ` para ${z.para_nome}` : ''}:\n${z.mensagem}\n`, sobre(p)].filter(Boolean).join('\n'),
        local: p.local, url: `${APP}#/p/${z.processo_id}` };
    }),
    ...recebimentos.map(r => {
      const p = proc(r.processo_id);
      return { uid: `receber-${r.id}`, dia: r.vencimento,
        titulo: `💰 Receber ${moeda.format(Number(r.valor) || 0)} · ${p.cliente || p.numero || ''}`.replace(/ · $/, ''),
        descricao: [r.descricao, r.nf_numero ? `NF ${r.nf_numero}` : r.nf_emitida_em ? 'NF emitida' : 'NF ainda não emitida', '', sobre(p)].join('\n'),
        url: `${APP}#/p/${r.processo_id}` };
    }),
    ...pendencias.map(x => {
      const p = proc(x.processo_id);
      return { uid: `pendencia-${x.id}`, dia: x.prazo, titulo: `🏗️ Pendência: ${x.descricao}${p.numero ? ` · ${p.numero}` : ''}`,
        descricao: [x.local && `Local: ${x.local}`, `Gravidade: ${x.gravidade || 'media'}`, '', sobre(p)].filter(s => s != null && s !== false).join('\n'),
        local: p.local, url: `${APP}#/p/${x.processo_id}/obra/pendencias` };
    })
  ].filter(e => e.dia);

  const carimbo = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Matheus Miranda//Gestão de Contratos//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    dobrar('X-WR-CALNAME:Gestão de Contratos'),
    'X-WR-TIMEZONE:America/Fortaleza',
    'REFRESH-INTERVAL;VALUE=DURATION:PT4H',
    'X-PUBLISHED-TTL:PT4H',
    ...eventos.map(e => evento(e, carimbo)),
    'END:VCALENDAR'
  ].join('\r\n') + '\r\n';

  return new Response(req.method === 'HEAD' ? null : ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="gestao-de-contratos.ics"',
      'Cache-Control': 'public, max-age=900',
      'X-Robots-Tag': 'noindex'
    }
  });
};
