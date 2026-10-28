/* ─── apps/controle-obras/financeiro.js — Recebimentos e notas fiscais ───
 *
 * Tudo o que o processo tem a receber: mensalidades (contrato mensal ou
 * acompanhamento de obra), parcelas da proposta (entrada e saldo na entrega) e
 * lançamentos avulsos. Cada recebimento tem vencimento, data e valor recebidos e
 * a nota fiscal: número, emissão, envio ao cliente e o arquivo (PDF/XML), que
 * vira um documento "Nota fiscal" do processo.
 *
 * Tabela: recebimentos (supabase/financeiro.sql). Rota da visão geral: #/financeiro;
 * no processo, o card "💰 Financeiro". Carregado antes do app.js, que chama
 * window.OB_FIN(nucleo) com as funções que compartilha.
 */
window.OB_FIN = function (n) {
  const { sb, BUCKET, esc, fmtData, fmtMoeda, campo, opcoes } = n;

  const FORMAS = ['PIX', 'Transferência', 'Boleto', 'Dinheiro', 'Cartão', 'Outro'];
  const ORIGENS = { mensal: 'Mensalidade', proposta: 'Proposta', avulso: 'Avulso' };
  const NF_ANTES = 7;   // dias antes do vencimento em que a nota passa a aparecer como "a emitir"
  const FILTROS = [['abertos', 'A receber'], ['vencidos', 'Vencidos'], ['nf-emitir', 'NF a emitir'],
    ['nf-enviar', 'NF a enviar'], ['recebidos', 'Recebidos'], ['todos', 'Todos']];

  let disponivel = false;
  let recebimentos = [];
  const filtro = { situacao: 'abertos', mes: '', busca: '' };

  /* =============================================
     DADOS E CONTAS
  ============================================= */
  async function carregar() {
    const { data, error } = await sb.from('recebimentos').select('*');
    disponivel = !error;
    if (error && !n.tabelaFaltando(error)) console.error('Erro ao carregar recebimentos:', error);
    recebimentos = data || [];
  }

  const ordem = (a, b) => a.vencimento.localeCompare(b.vencimento) || a.descricao.localeCompare(b.descricao);
  const doProcesso = pid => recebimentos.filter(r => r.processo_id === pid).sort(ordem);
  const esquecer = pid => { recebimentos = recebimentos.filter(r => r.processo_id !== pid); };
  const recebido = r => (r.recebido_em ? Number(r.valor_recebido ?? r.valor) || 0 : 0);
  const soma = (l, f = r => Number(r.valor) || 0) => l.reduce((s, r) => s + f(r), 0);
  const vencido = r => !r.recebido_em && n.diasAte(r.vencimento) < 0;
  const nfEmitir = r => !r.nf_emitida_em && (!!r.recebido_em || n.diasAte(r.vencimento) <= NF_ANTES);
  const nfEnviar = r => !!r.nf_emitida_em && !r.nf_enviada_em;

  function addMeses(dia, k) {
    const [a, m, d] = dia.split('-').map(Number);
    const ultimo = new Date(a, m - 1 + k + 1, 0).getDate();
    return n.dataLocal(new Date(a, m - 1 + k, Math.min(d, ultimo)));
  }
  const mesAno = comp => { const [a, m] = comp.split('-'); return `${new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long' })}/${a}`; };
  const mesCurto = comp => { const [a, m] = comp.split('-'); return `${new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}/${a.slice(2)}`; };

  function situacao(r) {
    if (r.recebido_em) {
      const parcial = r.valor_recebido != null && Number(r.valor_recebido) !== Number(r.valor);
      return { cls: 'pago', txt: `Recebido em ${fmtData(r.recebido_em)}${parcial ? ` (${fmtMoeda(r.valor_recebido)})` : ''}` };
    }
    const d = n.diasAte(r.vencimento);
    if (d < 0) return { cls: 'vencido', txt: `Vencido há ${-d} dia${d < -1 ? 's' : ''}` };
    return { cls: d <= 7 ? 'perto' : '', txt: d === 0 ? 'Vence hoje' : `Vence em ${d} dia${d > 1 ? 's' : ''}` };
  }

  function htmlNf(r) {
    if (!r.nf_emitida_em && !r.nf_numero) {
      return nfEmitir(r) ? '<span class="ob-tag ambar">NF a emitir</span>' : '<span class="ob-sub">—</span>';
    }
    return `<span class="ob-fin-nf"><span>NF ${esc(r.nf_numero || 's/ nº')}${r.nf_documento_id ? ` <a class="ob-link" href="#/p/${esc(r.processo_id)}/d/${esc(r.nf_documento_id)}" title="Abrir o arquivo da nota">📎</a>` : ''}</span>
      <small>${r.nf_emitida_em ? `emitida ${fmtData(r.nf_emitida_em).slice(0, 5)}` : ''}${r.nf_enviada_em ? ` · enviada ${fmtData(r.nf_enviada_em).slice(0, 5)}` : ''}</small>
      ${nfEnviar(r) ? '<span class="ob-tag azul">a enviar</span>' : ''}</span>`;
  }

  // Mensalidades de início até o fim (exclusivo): competência = mês trabalhado; vence no dia escolhido do mês seguinte
  function mensalidades({ inicio, fim, valor, dia }) {
    const lista = [];
    for (let i = 0; i < 120; i++) {
      const ini = addMeses(inicio, i);
      if (i && ini >= fim) break;
      const comp = ini.slice(0, 7);
      const venc = addMeses(comp + '-01', 1).slice(0, 8) + String(Math.min(28, Math.max(1, Number(dia) || 5))).padStart(2, '0');
      lista.push({ competencia: comp, vencimento: venc, valor, descricao: `Honorário de ${mesAno(comp)}`, origem: 'mensal' });
    }
    return lista;
  }

  // Cria as mensalidades que ainda não existem (pela competência). Devolve quantas criou.
  async function gerarMensalidades(p, opcoesGer) {
    if (!disponivel || !opcoesGer.inicio || !opcoesGer.valor) return 0;
    const fim = opcoesGer.fim && opcoesGer.fim > opcoesGer.inicio ? opcoesGer.fim : addMeses(opcoesGer.inicio, 1);
    const ja = new Set(doProcesso(p.id).filter(r => r.competencia).map(r => r.competencia));
    const novas = mensalidades({ ...opcoesGer, fim }).filter(m => !ja.has(m.competencia)).map(m => linhaNova(p, m));
    if (!novas.length || !(await n.gravar('recebimentos', novas))) return 0;
    recebimentos.push(...novas);
    await n.registrar(p, 'financeiro', `${novas.length} mensalidade${novas.length > 1 ? 's' : ''} de ${fmtMoeda(opcoesGer.valor)} lançada${novas.length > 1 ? 's' : ''} (${mesAno(novas[0].competencia)} a ${mesAno(novas[novas.length - 1].competencia)}).`);
    return novas.length;
  }

  const linhaNova = (p, x) => ({
    id: n.novoId('r'), processo_id: p.id, descricao: x.descricao, origem: x.origem || 'avulso', competencia: x.competencia || null,
    valor: x.valor, vencimento: x.vencimento, recebido_em: null, valor_recebido: null, forma: null,
    nf_numero: null, nf_emitida_em: null, nf_enviada_em: null, nf_documento_id: null, observacao: null
  });

  function resumo(lista) {
    const abertos = lista.filter(r => !r.recebido_em);
    const vencidos = abertos.filter(vencido);
    return { total: soma(lista), recebido: soma(lista, recebido), aberto: soma(abertos), qtdAberto: abertos.length,
      vencido: soma(vencidos), qtdVencido: vencidos.length };
  }
  const resumoProcesso = pid => resumo(doProcesso(pid));

  /* =============================================
     TELAS
  ============================================= */
  const avisoTabela = () => `<p class="ob-aviso-inline">A tabela de recebimentos ainda não existe no Supabase. Rode <code>supabase/financeiro.sql</code> no SQL Editor e recarregue a página.</p>`;

  // Linhas da tabela; comProcesso = visão geral (mostra o processo e o cliente)
  function htmlTabela(lista, comProcesso) {
    return `<div class="ob-tabela-wrap"><table class="ob-tabela ob-fin">
      <thead><tr><th>Recebido</th><th>Vencimento</th>${comProcesso ? '<th>Processo</th>' : ''}<th>Descrição</th><th>Valor</th><th>Nota fiscal</th><th>Situação</th><th></th></tr></thead>
      <tbody>${lista.map(r => {
        const s = situacao(r);
        const p = comProcesso && n.processo(r.processo_id);
        return `<tr class="${s.cls}">
          <td><input type="checkbox" data-acao="fin-recebido" data-id="${esc(r.id)}" ${r.recebido_em ? 'checked' : ''} aria-label="Recebido: ${esc(r.descricao)}" /></td>
          <td class="ob-fin-data">${fmtData(r.vencimento)}</td>
          ${comProcesso ? `<td><a class="ob-link" href="#/p/${esc(r.processo_id)}"><span class="ob-numero">${esc(p ? p.numero : '')}</span></a><small>${esc(p ? p.cliente || p.assunto : '')}</small></td>` : ''}
          <td>${esc(r.descricao)}${r.observacao ? `<small>${esc(r.observacao)}</small>` : ''}</td>
          <td class="ob-fin-valor">${fmtMoeda(r.valor)}</td>
          <td>${htmlNf(r)}</td>
          <td class="ob-fin-sit">${esc(s.txt)}</td>
          <td class="ob-fin-acoes">
            ${r.recebido_em ? '' : `<button type="button" class="ob-btn whats" data-acao="fin-cobrar" data-id="${esc(r.id)}" title="Lembrar o cliente por WhatsApp">💬</button>`}
            <button type="button" class="ob-btn sutil" data-acao="fin-nf" data-id="${esc(r.id)}" title="Nota fiscal">🧾</button>
            <button type="button" class="ob-btn sutil" data-acao="fin-editar" data-id="${esc(r.id)}" aria-label="Editar recebimento">✎</button>
            <button type="button" class="ob-btn sutil" data-acao="fin-excluir" data-id="${esc(r.id)}" aria-label="Excluir recebimento">✕</button>
          </td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  }

  const htmlResumo = s => `<dl class="ob-dados ob-fin-resumo">
      <div><dt>Total lançado</dt><dd>${fmtMoeda(s.total)}</dd></div>
      <div><dt>Recebido</dt><dd class="ob-ok">${fmtMoeda(s.recebido)}</dd></div>
      <div><dt>A receber</dt><dd>${fmtMoeda(s.aberto)}</dd></div>
      <div><dt>Vencido</dt><dd class="${s.qtdVencido ? 'ob-erro' : ''}">${fmtMoeda(s.vencido)}</dd></div>
    </dl>`;

  // Card do processo (também usado na aba "Financeiro" do acompanhamento de obra)
  function htmlCardProcesso(p) {
    if (!disponivel) return `<div class="ob-card"><h3 class="ob-card-titulo">💰 Financeiro</h3>${avisoTabela()}</div>`;
    const lista = doProcesso(p.id);
    const temProposta = n.propostasDe(p.id).length > 0;
    return `<div class="ob-card">
      <h3 class="ob-card-titulo">💰 Financeiro
        <span class="ob-fin-botoes">
          ${p.mensal ? '<button type="button" class="ob-btn" data-acao="fin-mensalidades">Gerar mensalidades</button>' : ''}
          ${temProposta ? '<button type="button" class="ob-btn" data-acao="fin-parcelas">Parcelas da proposta</button>' : ''}
          <button type="button" class="ob-btn primario" data-acao="fin-novo">+ Recebimento</button>
        </span></h3>
      ${lista.length ? htmlResumo(resumo(lista)) + htmlTabela(lista, false)
        : `<p class="ob-vazio">Nenhum recebimento lançado. ${p.mensal ? 'Use “Gerar mensalidades” para o contrato mensal.' : temProposta ? 'Use “Parcelas da proposta” para lançar a entrada e o saldo.' : ''}</p>`}
    </div>`;
  }

  // Aviso na lista de processos: vencidos e notas pendentes
  function htmlAlerta() {
    if (!disponivel) return '';
    const venc = recebimentos.filter(vencido);
    const emitir = recebimentos.filter(nfEmitir).length, enviar = recebimentos.filter(nfEnviar).length;
    if (!venc.length && !emitir && !enviar) return '';
    const partes = [];
    if (venc.length) partes.push(`<b class="ob-erro">${fmtMoeda(soma(venc))} vencido</b> em ${venc.length} recebimento${venc.length > 1 ? 's' : ''}`);
    if (emitir) partes.push(`${emitir} nota${emitir > 1 ? 's' : ''} a emitir`);
    if (enviar) partes.push(`${enviar} nota${enviar > 1 ? 's' : ''} a enviar`);
    return `<a class="ob-card ob-fin-alerta" href="#/financeiro">💰 ${partes.join(' · ')} <span class="ob-link">abrir o financeiro →</span></a>`;
  }

  function htmlTela() {
    const cab = `<section class="ob-proc-cab"><div><a class="ob-link" href="#/">← Processos</a>
      <h2 class="ob-proc-titulo">💰 Financeiro</h2><p class="ob-sub">Recebimentos de todos os processos: vencimentos, notas fiscais e o que já entrou.</p></div></section>`;
    if (!disponivel) return `${cab}<div class="ob-card">${avisoTabela()}</div>`;
    const hoje = n.hoje(), mes = hoje.slice(0, 7), ano = hoje.slice(0, 4);
    const abertos = recebimentos.filter(r => !r.recebido_em);
    const doMes = abertos.filter(r => r.vencimento.slice(0, 7) === mes);
    const venc = abertos.filter(vencido);
    const recMes = recebimentos.filter(r => r.recebido_em && r.recebido_em.slice(0, 7) === mes);
    const recAno = recebimentos.filter(r => r.recebido_em && r.recebido_em.slice(0, 4) === ano);
    const emitir = recebimentos.filter(nfEmitir).length, enviar = recebimentos.filter(nfEnviar).length;
    return `${cab}
      <section class="ob-kpis">
        <div class="ob-kpi"><span>A receber em ${esc(mesAno(mes))}</span><strong>${fmtMoeda(soma(doMes))}</strong><small>${doMes.length} recebimento${doMes.length === 1 ? '' : 's'} · total em aberto ${fmtMoeda(soma(abertos))}</small></div>
        <div class="ob-kpi"><span>Vencido</span><strong class="${venc.length ? 'ob-erro' : ''}">${fmtMoeda(soma(venc))}</strong><small>${venc.length} recebimento${venc.length === 1 ? '' : 's'}</small></div>
        <div class="ob-kpi"><span>Recebido em ${esc(mesAno(mes))}</span><strong class="ob-ok">${fmtMoeda(soma(recMes, recebido))}</strong><small>no ano: ${fmtMoeda(soma(recAno, recebido))}</small></div>
        <div class="ob-kpi"><span>Notas fiscais</span><strong>${emitir + enviar}</strong><small>${emitir} a emitir · ${enviar} a enviar</small></div>
      </section>
      <section class="ob-card">
        <h3 class="ob-card-titulo">Mês a mês</h3>
        ${htmlFluxo()}
      </section>
      <section class="ob-card">
        <div class="ob-lista-cab">
          <h3 class="ob-card-titulo">Recebimentos</h3>
          <input type="month" class="ob-input ob-fin-mes" id="ob-fin-mes" value="${esc(filtro.mes)}" aria-label="Mês do vencimento" title="Mês do vencimento (vazio = todos)" />
          <input type="search" class="ob-input" id="ob-fin-busca" placeholder="Buscar por processo, cliente ou descrição" value="${esc(filtro.busca)}" aria-label="Buscar recebimentos" />
        </div>
        <div id="ob-fin-corpo">${htmlListaGeral()}</div>
      </section>`;
  }

  function htmlListaGeral() {
    const busca = filtro.busca.trim().toLowerCase();
    const passa = {
      abertos: r => !r.recebido_em, vencidos: vencido, recebidos: r => !!r.recebido_em,
      'nf-emitir': nfEmitir, 'nf-enviar': nfEnviar, todos: () => true
    };
    const base = recebimentos.filter(r => !filtro.mes || (r.recebido_em && filtro.situacao === 'recebidos' ? r.recebido_em : r.vencimento).slice(0, 7) === filtro.mes)
      .filter(r => {
        if (!busca) return true;
        const p = n.processo(r.processo_id) || {};
        return [p.numero, p.cliente, p.assunto, r.descricao, r.nf_numero].some(x => String(x || '').toLowerCase().includes(busca));
      });
    const lista = base.filter(passa[filtro.situacao]).sort(filtro.situacao === 'recebidos' ? (a, b) => b.recebido_em.localeCompare(a.recebido_em) : ordem);
    return `<div class="ob-chips" role="group" aria-label="Filtrar recebimentos">
        ${FILTROS.map(([id, nome]) => `<button type="button" class="ob-chip ${filtro.situacao === id ? 'ativo' : ''}" data-acao="fin-filtro" data-filtro="${id}">${nome} <small>${base.filter(passa[id]).length}</small></button>`).join('')}
      </div>
      ${lista.length ? `${htmlTabela(lista, true)}<p class="ob-sub ob-fin-total">${lista.length} recebimento${lista.length > 1 ? 's' : ''} · ${fmtMoeda(soma(lista))}</p>`
        : `<p class="ob-vazio">${recebimentos.length ? 'Nada neste filtro.' : 'Nenhum recebimento ainda. Lance pelo card “💰 Financeiro” de cada processo.'}</p>`}`;
  }

  // Previsto (pelo vencimento) × recebido (pela data do recebimento), dos 2 meses passados aos 5 próximos
  function htmlFluxo() {
    const atual = n.hoje().slice(0, 7);
    const meses = Array.from({ length: 8 }, (_, i) => addMeses(atual + '-01', i - 2).slice(0, 7));
    const linhas = meses.map(m => {
      const previsto = soma(recebimentos.filter(r => r.vencimento.slice(0, 7) === m));
      const entrou = soma(recebimentos.filter(r => r.recebido_em && r.recebido_em.slice(0, 7) === m), recebido);
      const aberto = soma(recebimentos.filter(r => !r.recebido_em && r.vencimento.slice(0, 7) === m));
      return { m, previsto, entrou, aberto };
    });
    const maior = Math.max(1, ...linhas.map(l => Math.max(l.previsto, l.entrou)));
    return `<div class="ob-fluxo">${linhas.map(l => `<button type="button" class="ob-fluxo-mes ${l.m === atual ? 'atual' : ''} ${filtro.mes === l.m ? 'ativo' : ''}" data-acao="fin-mes" data-mes="${l.m}" title="Ver os recebimentos de ${esc(mesAno(l.m))}">
        <span class="ob-fluxo-barras">
          <i class="prev" style="height:${l.previsto / maior * 100}%" title="Previsto ${fmtMoeda(l.previsto)}"></i>
          <i class="rec" style="height:${l.entrou / maior * 100}%" title="Recebido ${fmtMoeda(l.entrou)}"></i>
        </span>
        <strong>${esc(mesCurto(l.m))}</strong>
        <small>${l.previsto ? fmtMoeda(l.previsto) : '—'}</small>
        <small class="${l.aberto && l.m < atual ? 'ob-erro' : 'ob-ok'}">${l.entrou ? fmtMoeda(l.entrou) : l.aberto && l.m < atual ? 'em atraso' : ''}</small>
      </button>`).join('')}</div>
      <p class="ob-sub ob-legenda"><i class="prev"></i> previsto pelo vencimento <i class="rec"></i> recebido. Clique num mês para filtrar.</p>`;
  }

  /* =============================================
     FORMULÁRIOS
  ============================================= */
  const botaoSalvar = (form, ligado) => form.querySelectorAll('[type=submit]').forEach(b => { b.disabled = !ligado; });
  const status = (form, txt) => { form.querySelector('[data-status]').textContent = txt; };
  const acoesForm = (rotulo = 'Salvar') => `<p class="ob-status inteiro" data-status></p>
    <div class="ob-form-acoes inteiro">
      <button type="button" class="ob-btn" data-acao="fechar-modal">Cancelar</button>
      <button type="submit" class="ob-btn primario">${rotulo}</button>
    </div>`;
  const dataComHoje = (nome, valor) => `<span class="ob-fin-data-hoje"><input type="date" class="ob-input" name="${nome}" value="${esc(valor || '')}" />
    <button type="button" class="ob-btn sutil" data-hoje="${nome}" title="Preencher com a data de hoje">hoje</button></span>`;

  // Guarda o PDF/XML da nota como documento "Nota fiscal" do processo; devolve o id do documento
  async function guardarArquivoNf(p, r, arquivo, numero, emitida) {
    const docAntigo = r && r.nf_documento_id && n.docsDe(p.id).find(d => d.id === r.nf_documento_id);
    const doc = docAntigo || { id: n.novoId('d'), processo_id: p.id, numero: n.proximoNumeroDoc(p), origem: 'externo', criado_em: new Date().toISOString() };
    const caminho = `${p.id}/${doc.id}/${Date.now().toString(36)}-${n.nomeSeguro(arquivo.name)}`;
    const { error } = await sb.storage.from(BUCKET).upload(caminho, arquivo, { contentType: arquivo.type || 'application/octet-stream', upsert: false });
    if (error) { console.error('Erro ao enviar a nota:', error); return null; }
    const antigo = docAntigo && docAntigo.arquivo_caminho;
    Object.assign(doc, { tipo: 'Nota fiscal', titulo: `NF ${numero || 's/ nº'} — ${r.descricao}`, data: emitida || n.hoje(),
      arquivo_caminho: caminho, arquivo_nome: arquivo.name, arquivo_tipo: arquivo.type || '', arquivo_tamanho: arquivo.size });
    if (!(await n.gravar('documentos', doc))) return null;
    if (antigo) sb.storage.from(BUCKET).remove([antigo]);
    if (!docAntigo) {
      n.incluirDocumento(doc);
      await n.registrar(p, 'documento', `Documento ${n.num4(doc.numero)} incluído: ${doc.tipo} — ${doc.titulo}.`);
    }
    return doc.id;
  }

  function formRecebimento(p, r, focoNf) {
    const x = r || { vencimento: n.hoje(), valor: p.mensal ? p.valor_contrato ?? p.valor_proposta : null };
    const docNf = r && r.nf_documento_id && n.docsDe(p.id).find(d => d.id === r.nf_documento_id);
    n.abrirModal(r ? 'Recebimento' : `Novo recebimento — ${p.numero}`, `
      <form id="ob-form-fin" class="ob-form">
        ${campo('Descrição *', `<input class="ob-input" name="descricao" required value="${esc(x.descricao)}" placeholder="Ex.: Entrada do projeto estrutural" />`, 'inteiro')}
        ${campo('Valor (R$) *', `<input class="ob-input" name="valor" inputmode="decimal" required value="${n.valorBr(x.valor)}" placeholder="0,00" />`)}
        ${campo('Vencimento *', `<input type="date" class="ob-input" name="vencimento" required value="${esc(x.vencimento)}" />`)}
        ${campo('Competência (mês trabalhado)', `<input type="month" class="ob-input" name="competencia" value="${esc(x.competencia || '')}" />`)}
        ${campo('Forma de pagamento', `<select class="ob-input" name="forma"><option value="">—</option>${opcoes(FORMAS.map(f => [f, f]), x.forma)}</select>`)}

        <fieldset class="ob-grupo inteiro"><legend>Recebimento</legend>
          <div class="ob-form">
            ${campo('Recebido em', dataComHoje('recebido_em', x.recebido_em))}
            ${campo('Valor recebido (R$)', `<input class="ob-input" name="valor_recebido" inputmode="decimal" value="${n.valorBr(x.valor_recebido)}" placeholder="o valor cheio" />`)}
          </div>
        </fieldset>

        <fieldset class="ob-grupo inteiro" id="ob-fin-nf"><legend>Nota fiscal</legend>
          <div class="ob-form">
            ${campo('Número da NF', `<input class="ob-input" name="nf_numero" value="${esc(x.nf_numero)}" />`)}
            ${campo('Emitida em', dataComHoje('nf_emitida_em', x.nf_emitida_em))}
            ${campo('Enviada ao cliente em', dataComHoje('nf_enviada_em', x.nf_enviada_em))}
            ${campo(docNf ? 'Trocar o arquivo da nota' : 'Arquivo da nota (PDF ou XML)', '<input type="file" class="ob-input" name="nf_arquivo" accept=".pdf,.xml,application/pdf,text/xml,application/xml,image/*" />')}
            ${docNf ? `<p class="ob-sub inteiro">Arquivo atual: <a class="ob-link" href="#/p/${esc(p.id)}/d/${esc(docNf.id)}">documento ${n.num4(docNf.numero)} — ${esc(docNf.arquivo_nome || docNf.titulo)}</a></p>` : ''}
          </div>
        </fieldset>

        ${campo('Observação', `<input class="ob-input" name="observacao" value="${esc(x.observacao)}" placeholder="Ex.: pago em duas transferências" />`, 'inteiro')}
        ${acoesForm(r ? 'Salvar' : 'Lançar')}
      </form>`, true);
    const form = document.getElementById('ob-form-fin');
    form.addEventListener('click', ev => {
      const b = ev.target.closest('[data-hoje]');
      if (b) form.querySelector(`[name=${b.dataset.hoje}]`).value = n.hoje();
    });
    if (focoNf) {
      const nf = document.getElementById('ob-fin-nf');
      nf.scrollIntoView({ block: 'center' });
      nf.querySelector('[name=nf_numero]').focus();
    }
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const f = new FormData(form);
      const valor = n.lerNumero(f.get('valor'));
      if (!valor) { status(form, 'Informe o valor.'); return; }
      const arquivo = f.get('nf_arquivo');
      if (arquivo && arquivo.size > n.TAMANHO_MAX) { status(form, 'O arquivo da nota passa de 25 MB.'); return; }
      const linha = {
        ...(r || linhaNova(p, { origem: 'avulso' })),
        descricao: f.get('descricao').trim(), valor, vencimento: f.get('vencimento'), competencia: f.get('competencia') || null,
        forma: f.get('forma') || null, recebido_em: f.get('recebido_em') || null, valor_recebido: n.lerNumero(f.get('valor_recebido')),
        nf_numero: f.get('nf_numero').trim() || null, nf_emitida_em: f.get('nf_emitida_em') || null, nf_enviada_em: f.get('nf_enviada_em') || null,
        observacao: f.get('observacao').trim() || null
      };
      botaoSalvar(form, false);
      if (arquivo && arquivo.size) {
        status(form, 'Enviando o arquivo da nota…');
        const docId = await guardarArquivoNf(p, linha, arquivo, linha.nf_numero, linha.nf_emitida_em);
        if (!docId) { status(form, 'Não foi possível enviar o arquivo da nota.'); botaoSalvar(form, true); return; }
        linha.nf_documento_id = docId;
        if (!linha.nf_emitida_em) linha.nf_emitida_em = n.hoje();
      }
      if (!(await n.gravar('recebimentos', linha))) { botaoSalvar(form, true); return; }
      await registrarMudancas(p, r, linha);
      if (r) Object.assign(r, linha); else recebimentos.push(linha);
      n.fecharModal();
      n.render();
    });
  }

  // Andamento: o que mudou no recebimento (lançado, recebido, nota emitida/enviada)
  async function registrarMudancas(p, antes, depois) {
    const a = antes || {};
    const msgs = [];
    if (!antes) msgs.push(`Recebimento lançado: ${depois.descricao} — ${fmtMoeda(depois.valor)}, vence ${fmtData(depois.vencimento)}.`);
    if (!a.recebido_em && depois.recebido_em) msgs.push(`Recebido: ${depois.descricao} — ${fmtMoeda(depois.valor_recebido ?? depois.valor)} em ${fmtData(depois.recebido_em)}${depois.forma ? ` (${depois.forma})` : ''}.`);
    if (a.recebido_em && !depois.recebido_em) msgs.push(`Recebimento reaberto: ${depois.descricao}.`);
    if (!a.nf_emitida_em && depois.nf_emitida_em) msgs.push(`Nota fiscal ${depois.nf_numero ? 'nº ' + depois.nf_numero + ' ' : ''}emitida: ${depois.descricao}.`);
    if (!a.nf_enviada_em && depois.nf_enviada_em) msgs.push(`Nota fiscal ${depois.nf_numero ? 'nº ' + depois.nf_numero + ' ' : ''}enviada ao cliente em ${fmtData(depois.nf_enviada_em)}.`);
    for (const m of msgs) await n.registrar(p, 'financeiro', m);
  }

  // Entrada e saldo dos projetos da proposta vigente (o acompanhamento mensal fica nas mensalidades)
  function formParcelas(p) {
    const ultima = n.propostasDe(p.id).pop();
    if (!ultima) return;
    const { dados, d } = ultima;
    const conta = n.contaProposta(dados);
    const fator = conta.subtotal ? conta.total / conta.subtotal : 1;
    const projetos = dados.itens.filter(it => it.unidade !== 'meses');
    const mensais = dados.itens.filter(it => it.unidade === 'meses');
    const valorProj = Math.round(projetos.reduce((s, it) => s + (Number(it.valor) || 0), 0) * fator * 100) / 100;
    const pct = Math.min(100, Math.max(0, Number(dados.entrada) || 0));
    const entrada = Math.round(valorProj * pct) / 100;
    const dias = projetos.reduce((s, it) => s + (Number(it.prazo) || 0), 0);
    const entrega = new Date(n.hoje() + 'T12:00:00');
    for (let k = 0; k < dias;) { entrega.setDate(entrega.getDate() + 1); if (entrega.getDay() % 6) k++; }   // dias úteis
    const rev = dados.revisao ? ` (Rev. ${String(dados.revisao).padStart(2, '0')})` : '';
    const sugestao = [];
    if (entrada) sugestao.push({ descricao: `Entrada (${pct}%) — proposta${rev}`, valor: entrada, vencimento: n.hoje() });
    if (valorProj - entrada > 0) sugestao.push({ descricao: `Saldo na entrega (${100 - pct}%) — proposta${rev}`, valor: Math.round((valorProj - entrada) * 100) / 100, vencimento: n.dataLocal(entrega) });
    const ja = doProcesso(p.id).filter(r => r.origem === 'proposta');
    const linha = x => `<div class="ob-fin-parcela">
        <input class="ob-input" name="descricao" value="${esc(x.descricao)}" aria-label="Descrição" required />
        <input class="ob-input" name="valor" inputmode="decimal" value="${n.valorBr(x.valor)}" aria-label="Valor" required />
        <input type="date" class="ob-input" name="vencimento" value="${esc(x.vencimento)}" aria-label="Vencimento" required />
        <button type="button" class="ob-btn sutil" data-parcela="remover" aria-label="Remover parcela">✕</button>
      </div>`;
    n.abrirModal('Parcelas da proposta', `
      <form id="ob-form-parcelas" class="ob-form">
        <p class="ob-sub inteiro">Proposta ${esc(d.titulo)} (documento ${n.num4(d.numero)}): projetos ${fmtMoeda(valorProj)}, entrada de ${pct}%. Ajuste as datas: a do saldo é a estimativa de entrega (${dias} dias úteis a partir de hoje).</p>
        ${mensais.length ? `<p class="ob-sub inteiro">${esc(mensais.map(it => it.nome).join(', '))} é cobrado por mês: use “Gerar mensalidades” (contrato mensal) ou o acompanhamento de obra.</p>` : ''}
        ${ja.length ? `<p class="ob-aviso-inline inteiro">Este processo já tem ${ja.length} parcela(s) da proposta. As de baixo serão somadas a elas.</p>` : ''}
        <div class="inteiro ob-fin-parcelas" data-linhas>${sugestao.map(linha).join('')}</div>
        <div class="inteiro"><button type="button" class="ob-btn" data-parcela="adicionar">+ Parcela</button></div>
        ${acoesForm('Lançar parcelas')}
      </form>`, true);
    const form = document.getElementById('ob-form-parcelas');
    form.addEventListener('click', ev => {
      const b = ev.target.closest('[data-parcela]');
      if (!b) return;
      if (b.dataset.parcela === 'remover') b.closest('.ob-fin-parcela').remove();
      else form.querySelector('[data-linhas]').insertAdjacentHTML('beforeend', linha({ descricao: `Parcela — proposta${rev}`, valor: null, vencimento: n.hoje() }));
    });
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const novas = [...form.querySelectorAll('.ob-fin-parcela')].map(l => linhaNova(p, {
        origem: 'proposta', descricao: l.querySelector('[name=descricao]').value.trim(),
        valor: n.lerNumero(l.querySelector('[name=valor]').value), vencimento: l.querySelector('[name=vencimento]').value
      }));
      if (!novas.length) { status(form, 'Inclua ao menos uma parcela.'); return; }
      if (novas.some(x => !x.valor || !x.vencimento)) { status(form, 'Cada parcela precisa de valor e vencimento.'); return; }
      botaoSalvar(form, false);
      if (!(await n.gravar('recebimentos', novas))) { botaoSalvar(form, true); return; }
      recebimentos.push(...novas);
      await n.registrar(p, 'financeiro', `Parcelas da proposta lançadas: ${novas.map(x => `${x.descricao.split(' — ')[0]} ${fmtMoeda(x.valor)} (${fmtData(x.vencimento)})`).join('; ')}.`);
      n.fecharModal();
      n.render();
    });
  }

  function formMensalidades(p) {
    const ultima = doProcesso(p.id).filter(r => r.competencia).pop();
    const inicio = ultima ? addMeses(ultima.competencia + '-01', 1) : n.hoje();
    n.abrirModal('Gerar mensalidades', `
      <form id="ob-form-mens" class="ob-form">
        ${campo('Primeiro mês trabalhado', `<input type="date" class="ob-input" name="inicio" value="${esc(inicio)}" required />`)}
        ${campo('Quantos meses', '<input type="number" min="1" max="120" class="ob-input" name="meses" value="3" required />')}
        ${campo('Valor mensal (R$)', `<input class="ob-input" name="valor" inputmode="decimal" required value="${n.valorBr(p.valor_contrato ?? p.valor_proposta)}" />`)}
        ${campo('Vencimento (dia do mês seguinte)', '<input type="number" min="1" max="28" class="ob-input" name="dia" value="5" required />')}
        <p class="ob-sub inteiro">Cada mês trabalhado vira um recebimento com vencimento no mês seguinte. Meses que já existem não se repetem.</p>
        ${acoesForm('Gerar')}
      </form>`);
    const form = document.getElementById('ob-form-mens');
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const f = new FormData(form);
      const valor = n.lerNumero(f.get('valor'));
      if (!valor) { status(form, 'Informe o valor mensal.'); return; }
      botaoSalvar(form, false);
      const qtd = await gerarMensalidades(p, { inicio: f.get('inicio'), fim: addMeses(f.get('inicio'), Math.max(1, parseInt(f.get('meses'), 10) || 1)), valor, dia: f.get('dia') });
      n.fecharModal();
      n.aviso(qtd ? `${qtd} mensalidade${qtd > 1 ? 's' : ''} gerada${qtd > 1 ? 's' : ''}.` : 'Nenhuma mensalidade nova: esses meses já existem.');
      n.render();
    });
  }

  function cobrar(p, r) {
    const eu = n.meusDados();
    const texto = `{saudacao}, {nome}! Tudo bem?\n\nPassando para lembrar do pagamento de ${fmtMoeda(r.valor)} (${r.descricao.charAt(0).toLowerCase() + r.descricao.slice(1)}), com vencimento em ${fmtData(r.vencimento)}.`
      + (r.nf_numero ? `\nA nota fiscal é a de nº ${r.nf_numero}.` : '')
      + (eu.pagamento ? `\n\nDados para pagamento:\n${eu.pagamento}` : '') + '\n\nObrigado!';
    n.formMensagem(p, null, null, texto);
  }

  /* =============================================
     AÇÕES
  ============================================= */
  const procDe = (r, p) => p || n.processo(r.processo_id);

  async function aoClicar(acao, el, p) {
    const r = recebimentos.find(x => x.id === el.dataset.id);
    if (acao === 'fin-filtro') { filtro.situacao = el.dataset.filtro; redesenharLista(); }
    else if (acao === 'fin-mes') { filtro.mes = filtro.mes === el.dataset.mes ? '' : el.dataset.mes; n.render(); }
    else if (acao === 'fin-novo' && p) formRecebimento(p, null);
    else if (acao === 'fin-parcelas' && p) formParcelas(p);
    else if (acao === 'fin-mensalidades' && p) formMensalidades(p);
    else if (!r) return;
    else if (acao === 'fin-editar') formRecebimento(procDe(r, p), r);
    else if (acao === 'fin-nf') formRecebimento(procDe(r, p), r, true);
    else if (acao === 'fin-cobrar') cobrar(procDe(r, p), r);
    else if (acao === 'fin-excluir') {
      if (!confirm(`Excluir o recebimento “${r.descricao}” (${fmtMoeda(r.valor)})?${r.nf_documento_id ? ' O documento da nota continua no processo.' : ''}`)) return;
      if (!(await n.apagar('recebimentos', r.id))) return;
      recebimentos = recebimentos.filter(x => x.id !== r.id);
      await n.registrar(procDe(r, p), 'financeiro', `Recebimento excluído: ${r.descricao} — ${fmtMoeda(r.valor)}.`);
      n.render();
    }
  }

  async function aoMudar(el, p) {
    if (el.id === 'ob-fin-mes') { filtro.mes = el.value; n.render(); return; }
    if (el.dataset.acao !== 'fin-recebido') return;
    const r = recebimentos.find(x => x.id === el.dataset.id);
    if (!r) return;
    const linha = { ...r, recebido_em: el.checked ? n.hoje() : null };
    if (!(await n.gravar('recebimentos', linha))) { el.checked = !el.checked; return; }
    await registrarMudancas(procDe(r, p), r, linha);
    Object.assign(r, linha);
    n.render();
  }

  function redesenharLista() {
    const el = document.getElementById('ob-fin-corpo');
    if (el) el.innerHTML = htmlListaGeral(); else n.render();
  }

  function aoDigitar(el) {
    if (el.id !== 'ob-fin-busca') return false;
    filtro.busca = el.value;
    redesenharLista();
    return true;
  }

  return {
    carregar, disponivel: () => disponivel, doProcesso, resumoProcesso, esquecer, gerarMensalidades,
    htmlTela, htmlAlerta, htmlCardProcesso, aoClicar, aoMudar, aoDigitar
  };
};
