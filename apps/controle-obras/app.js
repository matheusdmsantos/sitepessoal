/* ─── apps/controle-obras/app.js — Processos de obra no estilo SEI ───
 *
 * Cada processo (2026.0001…) reúne um serviço para um cliente: a árvore de
 * documentos numerados, o andamento (histórico) e os prazos. Documentos externos
 * são arquivos guardados no bucket "obras-docs" do Supabase Storage; documentos
 * internos são escritos aqui, no editor Quill (carregado só quando usado).
 *
 * Tabelas: processos, documentos, andamentos e prazos (supabase/obras.sql).
 * Rotas: #/ (lista), #/p/<processo> e #/p/<processo>/d/<documento>.
 */
(function () {
  const sb = window.supabaseClient;
  const BUCKET = 'obras-docs';
  const QUILL = window.OB_QUILL_BASE || 'https://cdn.quilljs.com/1.3.6/';
  const TAMANHO_MAX = 25 * 1024 * 1024;   // mesmo limite do bucket

  // Fluxo comercial e de execução. "final" encerra o processo (sai dos ativos).
  const FASES = [
    { id: 'prospeccao', nome: 'Prospecção', cor: 'cinza' },
    { id: 'proposta', nome: 'Proposta enviada', cor: 'azul' },
    { id: 'negociacao', nome: 'Em negociação', cor: 'ambar' },
    { id: 'contratado', nome: 'Contratado', cor: 'verde' },
    { id: 'execucao', nome: 'Em execução', cor: 'verde' },
    { id: 'entregue', nome: 'Entregue', cor: 'ciano' },
    { id: 'encerrado', nome: 'Encerrado', cor: 'cinza', final: true },
    { id: 'recusada', nome: 'Proposta recusada', cor: 'vermelho', final: true },
    { id: 'cancelado', nome: 'Cancelado', cor: 'vermelho', final: true }
  ];
  const GANHAS = ['contratado', 'execucao', 'entregue', 'encerrado'];
  const SERVICOS = {
    projeto: 'Projeto', execucao: 'Execução de obra', fiscalizacao: 'Fiscalização',
    laudo: 'Laudo / vistoria', consultoria: 'Consultoria', outro: 'Outro'
  };
  const TIPOS_DOC = ['Proposta', 'Contrato', 'Aditivo', 'ART / RRT', 'Projeto', 'Memorial descritivo', 'Orçamento',
    'Cronograma', 'Medição', 'Nota fiscal', 'Recibo', 'Ofício', 'E-mail', 'Ata de reunião', 'Relatório', 'Laudo',
    'Foto', 'Despacho', 'Anotação', 'Outro'];
  // Incluir um destes documentos sugere avançar a fase (só para a frente)
  const AVANCA_FASE = { 'Proposta': 'proposta', 'Contrato': 'contratado' };

  let processos = [], documentos = [], andamentos = [], prazos = [];
  let filtro = { fase: 'ativos', busca: '' };
  let quill = null;
  const urls = {};   // links assinados em cache: caminho → { url, ate }

  const $ = id => document.getElementById(id);

  /* =============================================
     FORMATOS
  ============================================= */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function dataLocal(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const hoje = () => dataLocal();

  function fmtData(str) {
    if (!str) return '—';
    const [a, m, d] = String(str).slice(0, 10).split('-');
    return `${d}/${m}/${a}`;
  }

  function fmtDataHora(iso) {
    const d = new Date(iso);
    return `${fmtData(dataLocal(d))} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtMoeda = v => (v === null || v === undefined || v === '' ? '—' : moeda.format(Number(v)));

  // "1.234,56" ou "1234.56" → 1234.56; vazio → null
  function lerNumero(s) {
    s = String(s || '').trim().replace(/[R$\s]/g, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  function fmtTamanho(b) {
    if (!b) return '';
    return b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  }

  const num4 = n => String(n).padStart(4, '0');
  const diasAte = d => Math.round((new Date(d + 'T12:00:00') - new Date(hoje() + 'T12:00:00')) / 86400000);
  const fase = id => FASES.find(f => f.id === id) || FASES[0];
  const novoId = p => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function seloFase(id) {
    const f = fase(id);
    return `<span class="ob-fase ${f.cor}">${esc(f.nome)}</span>`;
  }

  function aviso(msg) {
    const el = $('ob-toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 3500);
  }

  /* =============================================
     DADOS
  ============================================= */
  function tabelaFaltando(error) {
    return error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message || ''));
  }

  async function carregar() {
    const r = await Promise.all(['processos', 'documentos', 'andamentos', 'prazos'].map(t => sb.from(t).select('*')));
    const falha = r.find(x => x.error);
    if (falha) {
      console.error('Erro ao carregar processos:', falha.error);
      const el = $('ob-aviso');
      el.hidden = false;
      el.innerHTML = tabelaFaltando(falha.error)
        ? '⚠️ As tabelas do Controle de Obras ainda não existem no Supabase. Rode <code>supabase/obras.sql</code> e depois <code>supabase/rls.sql</code> no SQL Editor.'
        : `⚠️ Não foi possível carregar os processos: ${esc(falha.error.message)}`;
      return false;
    }
    [processos, documentos, andamentos, prazos] = r.map(x => x.data || []);
    return true;
  }

  async function gravar(tabela, linha) {
    const { error } = await sb.from(tabela).upsert(linha, { onConflict: 'id' });
    if (error) { console.error(`Erro ao salvar em ${tabela}:`, error); aviso('Não foi possível salvar. Confira sua conexão.'); }
    return !error;
  }

  async function apagar(tabela, id) {
    const { error } = await sb.from(tabela).delete().eq('id', id);
    if (error) { console.error(`Erro ao apagar de ${tabela}:`, error); aviso('Não foi possível excluir.'); }
    return !error;
  }

  /* Registra no histórico e marca o processo como movimentado */
  async function registrar(proc, tipo, descricao) {
    const a = { id: novoId('a'), processo_id: proc.id, data: new Date().toISOString(), tipo, descricao };
    andamentos.push(a);
    proc.atualizado_em = a.data;
    await Promise.all([gravar('andamentos', a), gravar('processos', proc)]);
  }

  const docsDe = id => documentos.filter(d => d.processo_id === id).sort((a, b) => a.numero - b.numero);
  const andamentosDe = id => andamentos.filter(a => a.processo_id === id).sort((a, b) => b.data.localeCompare(a.data));
  const prazosDe = id => prazos.filter(p => p.processo_id === id).sort((a, b) => (!!a.concluido_em - !!b.concluido_em) || a.data.localeCompare(b.data));

  function proximoNumero() {
    const ano = String(new Date().getFullYear());
    const seq = processos.filter(p => p.numero.startsWith(ano + '.')).map(p => parseInt(p.numero.split('.')[1], 10) || 0);
    return `${ano}.${num4(Math.max(0, ...seq) + 1)}`;
  }

  /* =============================================
     ARQUIVOS (Supabase Storage)
  ============================================= */
  function nomeSeguro(nome) {
    return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-120);
  }

  async function linkArquivo(doc, baixar) {
    const chave = doc.arquivo_caminho + (baixar ? '#baixar' : '');
    const c = urls[chave];
    if (c && c.ate > Date.now()) return c.url;
    const { data, error } = await sb.storage.from(BUCKET)
      .createSignedUrl(doc.arquivo_caminho, 600, baixar ? { download: doc.arquivo_nome } : undefined);
    if (error) { console.error('Erro ao abrir arquivo:', error); aviso('Não foi possível abrir o arquivo.'); return null; }
    urls[chave] = { url: data.signedUrl, ate: Date.now() + 540000 };
    return data.signedUrl;
  }

  /* =============================================
     ROTAS
  ============================================= */
  function rota() {
    const [, p, id, d, docId] = location.hash.split('/');
    if (p === 'p' && id) return { processo: id, documento: d === 'd' ? docId : null };
    return {};
  }

  function render() {
    const r = rota();
    const proc = r.processo && processos.find(p => p.id === r.processo);
    if (r.processo && !proc) { location.hash = '#/'; return; }
    $('ob-app').innerHTML = proc ? htmlProcesso(proc, r.documento) : htmlLista();
    if (proc && r.documento) mostrarArquivo(r.documento);
  }

  /* =============================================
     LISTA DE PROCESSOS
  ============================================= */
  function ultimaMovimentacao(id) {
    const a = andamentosDe(id)[0];
    return a ? a.data : null;
  }

  function htmlLista() {
    const ativos = processos.filter(p => !fase(p.fase).final);
    const abertas = processos.filter(p => ['proposta', 'negociacao'].includes(p.fase));
    const emExecucao = processos.filter(p => ['contratado', 'execucao'].includes(p.fase));
    const ganhos = processos.filter(p => GANHAS.includes(p.fase)).length;
    const recusadas = processos.filter(p => p.fase === 'recusada').length;
    const soma = (lista, campo) => lista.reduce((a, p) => a + (Number(p[campo]) || 0), 0);

    const abertosPrazo = prazos.filter(p => !p.concluido_em && diasAte(p.data) <= 7)
      .sort((a, b) => a.data.localeCompare(b.data));

    return `
      <section class="ob-kpis">
        <div class="ob-kpi"><span>Processos ativos</span><strong>${ativos.length}</strong></div>
        <div class="ob-kpi"><span>Propostas em aberto</span><strong>${abertas.length}</strong><small>${fmtMoeda(soma(abertas, 'valor_proposta'))}</small></div>
        <div class="ob-kpi"><span>Contratados / em execução</span><strong>${emExecucao.length}</strong><small>${fmtMoeda(soma(emExecucao, 'valor_contrato'))}</small></div>
        <div class="ob-kpi"><span>Propostas aceitas</span><strong>${ganhos + recusadas ? Math.round(ganhos / (ganhos + recusadas) * 100) + '%' : '—'}</strong><small>${ganhos} de ${ganhos + recusadas} decididas</small></div>
      </section>

      ${abertosPrazo.length ? `
      <section class="ob-card ob-prazos-alerta">
        <h2 class="ob-card-titulo">⏰ Prazos vencidos e dos próximos 7 dias</h2>
        ${abertosPrazo.map(z => {
          const p = processos.find(x => x.id === z.processo_id);
          const dias = diasAte(z.data);
          return `<a class="ob-prazo-linha ${dias < 0 ? 'vencido' : ''}" href="#/p/${esc(z.processo_id)}">
            <span class="ob-prazo-data">${fmtData(z.data)}</span>
            <span>${esc(z.descricao)} <small>${esc(p ? p.numero + ' · ' + p.assunto : '')}</small></span>
            <span class="ob-prazo-dias">${dias < 0 ? `${-dias} dia${dias < -1 ? 's' : ''} de atraso` : dias === 0 ? 'hoje' : `em ${dias} dia${dias > 1 ? 's' : ''}`}</span>
          </a>`;
        }).join('')}
      </section>` : ''}

      <section class="ob-card">
        <div class="ob-lista-cab">
          <h2 class="ob-card-titulo">Processos</h2>
          <input type="search" class="ob-input" id="ob-busca" placeholder="Buscar por número, assunto ou cliente" value="${esc(filtro.busca)}" aria-label="Buscar processos" />
          <button type="button" class="ob-btn primario" data-acao="novo-processo">+ Novo processo</button>
        </div>
        <div id="ob-lista-corpo">${htmlListaCorpo()}</div>
      </section>`;
  }

  /* Chips de fase e tabela: redesenhados sozinhos enquanto se digita na busca */
  function htmlListaCorpo() {
    const ativos = processos.filter(p => !fase(p.fase).final);
    const contagem = id => id === 'ativos' ? ativos.length : id === 'todos' ? processos.length : processos.filter(p => p.fase === id).length;
    const chips = [{ id: 'ativos', nome: 'Ativos' }, ...FASES, { id: 'todos', nome: 'Todos' }]
      .filter(f => ['ativos', 'todos'].includes(f.id) || contagem(f.id));
    const busca = filtro.busca.trim().toLowerCase();
    const lista = processos
      .filter(p => filtro.fase === 'todos' || (filtro.fase === 'ativos' ? !fase(p.fase).final : p.fase === filtro.fase))
      .filter(p => !busca || [p.numero, p.assunto, p.cliente, p.local].some(x => String(x || '').toLowerCase().includes(busca)))
      .sort((a, b) => String(ultimaMovimentacao(b.id) || b.criado_em).localeCompare(String(ultimaMovimentacao(a.id) || a.criado_em)));
    return `
        <div class="ob-chips" role="group" aria-label="Filtrar por fase">
          ${chips.map(f => `<button type="button" class="ob-chip ${filtro.fase === f.id ? 'ativo' : ''}" data-acao="filtro" data-fase="${f.id}">${esc(f.nome)} <small>${contagem(f.id)}</small></button>`).join('')}
        </div>
        ${lista.length ? `
        <div class="ob-tabela-wrap">
          <table class="ob-tabela">
            <thead><tr><th>Número</th><th>Assunto</th><th>Cliente</th><th>Serviço</th><th>Fase</th><th>Última movimentação</th><th>Docs</th></tr></thead>
            <tbody>
              ${lista.map(p => `
              <tr data-acao="abrir" data-id="${esc(p.id)}" tabindex="0">
                <td class="ob-numero">${esc(p.numero)}</td>
                <td>${esc(p.assunto)}</td>
                <td>${esc(p.cliente || '—')}</td>
                <td>${esc(SERVICOS[p.servico] || p.servico)}</td>
                <td>${seloFase(p.fase)}</td>
                <td>${fmtDataHora(ultimaMovimentacao(p.id) || p.criado_em)}</td>
                <td>${docsDe(p.id).length}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>` : `<p class="ob-vazio">${processos.length ? 'Nenhum processo neste filtro.' : 'Nenhum processo ainda. Comece pelo botão “+ Novo processo”.'}</p>`}`;
  }

  /* =============================================
     PROCESSO
  ============================================= */
  function htmlProcesso(p, docId) {
    const docs = docsDe(p.id);
    const doc = docId && docs.find(d => d.id === docId);
    return `
      <section class="ob-proc-cab">
        <div>
          <a class="ob-link" href="#/">← Processos</a>
          <h2 class="ob-proc-titulo"><span class="ob-numero">${esc(p.numero)}</span> ${esc(p.assunto)}</h2>
          <p class="ob-sub">${esc(SERVICOS[p.servico] || p.servico)}${p.cliente ? ' · ' + esc(p.cliente) : ''}${p.local ? ' · ' + esc(p.local) : ''}</p>
        </div>
        <div class="ob-proc-acoes">
          <label class="ob-fase-sel">
            <span>Fase</span>
            <select class="ob-input" id="ob-fase" aria-label="Fase do processo">
              ${FASES.map(f => `<option value="${f.id}" ${f.id === p.fase ? 'selected' : ''}>${esc(f.nome)}</option>`).join('')}
            </select>
          </label>
          <button type="button" class="ob-btn" data-acao="editar-processo">Editar dados</button>
        </div>
      </section>

      <div class="ob-proc-grade">
        <aside class="ob-card ob-arvore" aria-label="Documentos do processo">
          <a class="ob-arvore-item raiz ${doc ? '' : 'ativo'}" href="#/p/${esc(p.id)}">📁 Processo ${esc(p.numero)}</a>
          ${docs.map(d => `
          <a class="ob-arvore-item ${doc && doc.id === d.id ? 'ativo' : ''}" href="#/p/${esc(p.id)}/d/${esc(d.id)}" title="${esc(d.titulo)}">
            <span class="ob-arvore-num">${num4(d.numero)}</span>
            <span class="ob-arvore-ico">${d.origem === 'interno' ? '📝' : '📄'}</span>
            <span class="ob-arvore-txt"><strong>${esc(d.tipo)}</strong> ${esc(d.titulo)}<small>${fmtData(d.data)}</small></span>
          </a>`).join('')}
          ${docs.length ? '' : '<p class="ob-vazio">Nenhum documento ainda.</p>'}
          <div class="ob-arvore-acoes">
            <button type="button" class="ob-btn primario" data-acao="doc-externo">+ Incluir arquivo</button>
            <button type="button" class="ob-btn" data-acao="doc-interno">+ Escrever documento</button>
          </div>
        </aside>
        <section class="ob-painel">
          ${doc ? htmlDocumento(p, doc) : htmlResumo(p)}
        </section>
      </div>`;
  }

  function htmlResumo(p) {
    const zs = prazosDe(p.id);
    const as = andamentosDe(p.id);
    const linha = (rot, val) => val ? `<div><dt>${rot}</dt><dd>${val}</dd></div>` : '';
    return `
      <div class="ob-card">
        <h3 class="ob-card-titulo">Dados do processo ${seloFase(p.fase)}</h3>
        <dl class="ob-dados">
          ${linha('Cliente', esc(p.cliente))}
          ${linha('Contato', esc(p.contato))}
          ${linha('Local', esc(p.local))}
          ${linha('Valor da proposta', p.valor_proposta != null ? fmtMoeda(p.valor_proposta) : '')}
          ${linha('Valor do contrato', p.valor_contrato != null ? fmtMoeda(p.valor_contrato) : '')}
          ${linha('Aberto em', fmtData(dataLocal(new Date(p.criado_em))))}
          ${linha('Concluído em', p.concluido_em ? fmtData(p.concluido_em) : '')}
        </dl>
        ${p.descricao ? `<p class="ob-descricao">${esc(p.descricao)}</p>` : ''}
      </div>

      <div class="ob-card">
        <h3 class="ob-card-titulo">⏰ Prazos</h3>
        ${zs.map(z => {
          const dias = diasAte(z.data);
          return `<div class="ob-prazo ${z.concluido_em ? 'feito' : dias < 0 ? 'vencido' : ''}">
            <input type="checkbox" data-acao="prazo-feito" data-id="${esc(z.id)}" ${z.concluido_em ? 'checked' : ''} aria-label="Prazo cumprido: ${esc(z.descricao)}" />
            <span class="ob-prazo-data">${fmtData(z.data)}</span>
            <span class="ob-prazo-desc">${esc(z.descricao)}</span>
            <span class="ob-prazo-dias">${z.concluido_em ? `cumprido em ${fmtData(z.concluido_em)}` : dias < 0 ? `${-dias} dia${dias < -1 ? 's' : ''} de atraso` : dias === 0 ? 'hoje' : `em ${dias} dia${dias > 1 ? 's' : ''}`}</span>
            <button type="button" class="ob-btn sutil" data-acao="prazo-apagar" data-id="${esc(z.id)}" aria-label="Excluir prazo">✕</button>
          </div>`;
        }).join('') || '<p class="ob-vazio">Nenhum prazo.</p>'}
        <form class="ob-form-linha" id="ob-form-prazo">
          <input type="text" class="ob-input" name="descricao" placeholder="Ex.: retorno do cliente sobre a proposta" required aria-label="Descrição do prazo" />
          <input type="date" class="ob-input" name="data" required aria-label="Data do prazo" />
          <button type="submit" class="ob-btn">Adicionar</button>
        </form>
      </div>

      <div class="ob-card">
        <h3 class="ob-card-titulo">Andamento</h3>
        <form class="ob-form-linha" id="ob-form-anotacao">
          <input type="text" class="ob-input" name="descricao" placeholder="Registrar no andamento (ligação, visita, reunião…)" required aria-label="Anotação no andamento" />
          <button type="submit" class="ob-btn">Registrar</button>
        </form>
        <ol class="ob-andamento">
          ${as.map(a => `<li class="tipo-${esc(a.tipo)}"><time>${fmtDataHora(a.data)}</time><span>${esc(a.descricao)}</span></li>`).join('')}
        </ol>
      </div>

      <div class="ob-zona-perigo">
        <button type="button" class="ob-btn perigo" data-acao="excluir-processo">Excluir processo</button>
      </div>`;
  }

  function htmlDocumento(p, d) {
    const externo = d.origem !== 'interno';
    return `
      <div class="ob-card ob-doc">
        <div class="ob-doc-cab">
          <div>
            <p class="ob-sub">Documento ${num4(d.numero)} · ${externo ? 'externo' : 'interno'} · ${fmtData(d.data)}</p>
            <h3 class="ob-doc-titulo">${esc(d.tipo)} — ${esc(d.titulo)}</h3>
            ${externo ? `<p class="ob-sub">${esc(d.arquivo_nome)} ${fmtTamanho(d.arquivo_tamanho)}</p>` : ''}
          </div>
          <div class="ob-doc-acoes">
            ${externo
              ? `<button type="button" class="ob-btn" data-acao="abrir-arquivo">Abrir em nova aba</button>
                 <button type="button" class="ob-btn" data-acao="baixar-arquivo">Baixar</button>`
              : `<button type="button" class="ob-btn" data-acao="imprimir-doc">Imprimir / PDF</button>`}
            <button type="button" class="ob-btn" data-acao="editar-doc">Editar</button>
            <button type="button" class="ob-btn perigo" data-acao="excluir-doc">Excluir</button>
          </div>
        </div>
        ${externo ? '<div id="ob-visualizador" class="ob-visualizador"><p class="ob-vazio">Carregando…</p></div>'
          : `<div class="ob-doc-conteudo">${d.conteudo || '<p class="ob-vazio">Documento vazio.</p>'}</div>`}
      </div>`;
  }

  /* Pré-visualização do arquivo: PDF e imagem aparecem na página; o resto, só baixando */
  async function mostrarArquivo(docId) {
    const d = documentos.find(x => x.id === docId);
    const el = $('ob-visualizador');
    if (!d || !el || d.origem === 'interno') return;
    const tipo = d.arquivo_tipo || '';
    if (!/^image\/|pdf/.test(tipo)) {
      el.innerHTML = `<p class="ob-vazio">Pré-visualização indisponível para este tipo de arquivo. Use “Abrir em nova aba” ou “Baixar”.</p>`;
      return;
    }
    const url = await linkArquivo(d);
    if (!url || !$('ob-visualizador')) return;
    el.innerHTML = tipo.startsWith('image/')
      ? `<img src="${esc(url)}" alt="${esc(d.titulo)}" />`
      : `<iframe src="${esc(url)}" title="${esc(d.titulo)}"></iframe>`;
  }

  /* =============================================
     FORMULÁRIOS
  ============================================= */
  function abrirModal(titulo, html, largo) {
    $('ob-modal-titulo').textContent = titulo;
    $('ob-modal-corpo').innerHTML = html;
    $('ob-modal').querySelector('.ob-modal-caixa').classList.toggle('largo', !!largo);
    $('ob-modal').hidden = false;
    const primeiro = $('ob-modal-corpo').querySelector('input:not([type=hidden]), select, textarea');
    if (primeiro) primeiro.focus();
  }

  function fecharModal() {
    $('ob-modal').hidden = true;
    $('ob-modal-corpo').innerHTML = '';
    quill = null;
  }

  const campo = (rotulo, html, cls = '') => `<label class="ob-campo ${cls}"><span>${rotulo}</span>${html}</label>`;
  const opcoes = (lista, atual) => lista.map(([v, n]) => `<option value="${esc(v)}" ${v === atual ? 'selected' : ''}>${esc(n)}</option>`).join('');
  const valorBr = v => (v === null || v === undefined ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  function formProcesso(p) {
    const novo = !p;
    p = p || { servico: 'execucao', fase: 'prospeccao' };
    abrirModal(novo ? `Novo processo ${proximoNumero()}` : `Editar processo ${p.numero}`, `
      <form id="ob-form-processo" class="ob-form">
        ${campo('Assunto *', `<input class="ob-input" name="assunto" required value="${esc(p.assunto)}" placeholder="Ex.: Reforma da cobertura — Escola X" />`, 'inteiro')}
        ${campo('Serviço', `<select class="ob-input" name="servico">${opcoes(Object.entries(SERVICOS), p.servico)}</select>`)}
        ${novo ? campo('Fase inicial', `<select class="ob-input" name="fase">${opcoes(FASES.filter(f => !f.final).map(f => [f.id, f.nome]), p.fase)}</select>`) : '<span></span>'}
        ${campo('Cliente / interessado', `<input class="ob-input" name="cliente" value="${esc(p.cliente)}" />`)}
        ${campo('Contato', `<input class="ob-input" name="contato" value="${esc(p.contato)}" placeholder="Telefone, e-mail" />`)}
        ${campo('Local da obra', `<input class="ob-input" name="local" value="${esc(p.local)}" />`, 'inteiro')}
        ${campo('Valor da proposta (R$)', `<input class="ob-input" name="valor_proposta" inputmode="decimal" value="${valorBr(p.valor_proposta)}" placeholder="0,00" />`)}
        ${campo('Valor do contrato (R$)', `<input class="ob-input" name="valor_contrato" inputmode="decimal" value="${valorBr(p.valor_contrato)}" placeholder="0,00" />`)}
        ${campo('Descrição', `<textarea class="ob-input" name="descricao" rows="3">${esc(p.descricao)}</textarea>`, 'inteiro')}
        <div class="ob-form-acoes inteiro">
          <button type="button" class="ob-btn" data-acao="fechar-modal">Cancelar</button>
          <button type="submit" class="ob-btn primario">${novo ? 'Abrir processo' : 'Salvar'}</button>
        </div>
      </form>`);
    $('ob-form-processo').addEventListener('submit', async ev => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const dados = {
        assunto: f.get('assunto').trim(), servico: f.get('servico'),
        cliente: f.get('cliente').trim() || null, contato: f.get('contato').trim() || null, local: f.get('local').trim() || null,
        valor_proposta: lerNumero(f.get('valor_proposta')), valor_contrato: lerNumero(f.get('valor_contrato')),
        descricao: f.get('descricao').trim() || null
      };
      ev.target.querySelector('[type=submit]').disabled = true;
      if (novo) {
        const agora = new Date().toISOString();
        const proc = { id: novoId('p'), numero: proximoNumero(), fase: f.get('fase'), criado_em: agora, atualizado_em: agora, concluido_em: null, ...dados };
        if (!(await gravar('processos', proc))) { ev.target.querySelector('[type=submit]').disabled = false; return; }
        processos.push(proc);
        await registrar(proc, 'criacao', `Processo aberto na fase “${fase(proc.fase).nome}”.`);
        fecharModal();
        location.hash = `#/p/${proc.id}`;
      } else {
        const mudou = Object.keys(dados).filter(k => String(dados[k] ?? '') !== String(p[k] ?? ''));
        Object.assign(p, dados);
        if (mudou.length) await registrar(p, 'anotacao', 'Dados do processo alterados.');
        fecharModal();
        render();
      }
    });
  }

  async function mudarFase(p, nova, motivo) {
    if (nova === p.fase) return;
    const antes = fase(p.fase).nome;
    p.fase = nova;
    p.concluido_em = fase(nova).final ? (p.concluido_em || hoje()) : null;
    await registrar(p, 'fase', `Fase: ${antes} → ${fase(nova).nome}${motivo ? ` (${motivo})` : ''}.`);
  }

  function sugestaoFase(p, tipo) {
    const alvo = AVANCA_FASE[tipo];
    if (!alvo || fase(p.fase).final) return null;
    const idx = id => FASES.findIndex(f => f.id === id);
    return idx(alvo) > idx(p.fase) ? alvo : null;
  }

  function camposDoc(p, d, padraoTipo) {
    const tipo = d ? d.tipo : padraoTipo;
    const sug = !d && sugestaoFase(p, tipo);
    return `
      ${campo('Tipo', `<select class="ob-input" name="tipo">${opcoes(TIPOS_DOC.map(t => [t, t]), tipo)}</select>`)}
      ${campo('Data do documento', `<input type="date" class="ob-input" name="data" value="${esc(d ? d.data : hoje())}" required />`)}
      ${campo('Título *', `<input class="ob-input" name="titulo" required value="${esc(d ? d.titulo : '')}" placeholder="Ex.: Proposta comercial — revisão 1" />`, 'inteiro')}
      ${d ? '' : `<label class="ob-check inteiro" id="ob-sug-fase" ${sug ? '' : 'hidden'}>
        <input type="checkbox" name="avancar" ${sug ? 'checked' : ''} />
        <span>Mudar a fase para “<b>${esc(sug ? fase(sug).nome : '')}</b>”</span>
      </label>`}`;
  }

  /* Ao trocar o tipo, atualiza a sugestão de avançar a fase */
  function ligarSugestaoFase(form, p) {
    const sel = form.querySelector('[name=tipo]');
    const caixa = form.querySelector('#ob-sug-fase');
    if (!sel || !caixa) return;
    sel.addEventListener('change', () => {
      const sug = sugestaoFase(p, sel.value);
      caixa.hidden = !sug;
      caixa.querySelector('input').checked = !!sug;
      if (sug) caixa.querySelector('b').textContent = fase(sug).nome;
    });
  }

  function proximoNumeroDoc(p) {
    return Math.max(0, ...docsDe(p.id).map(d => d.numero)) + 1;
  }

  function formExterno(p, d) {
    abrirModal(d ? `Editar documento ${num4(d.numero)}` : 'Incluir arquivo no processo', `
      <form id="ob-form-doc" class="ob-form">
        ${campo(d ? 'Substituir arquivo (opcional)' : 'Arquivo *', `<input type="file" class="ob-input" name="arquivo" ${d ? '' : 'required'} />`, 'inteiro')}
        <p class="ob-sub inteiro">PDF, imagem, Word, planilha… até 25 MB. Fica guardado no seu Supabase, acessível só com o seu login.</p>
        ${camposDoc(p, d, 'Proposta')}
        <p class="ob-status inteiro" id="ob-doc-status"></p>
        <div class="ob-form-acoes inteiro">
          <button type="button" class="ob-btn" data-acao="fechar-modal">Cancelar</button>
          <button type="submit" class="ob-btn primario">${d ? 'Salvar' : 'Incluir'}</button>
        </div>
      </form>`);
    const form = $('ob-form-doc');
    ligarSugestaoFase(form, p);
    form.querySelector('[name=arquivo]').addEventListener('change', e => {
      const a = e.target.files[0];
      const tit = form.querySelector('[name=titulo]');
      if (a && !tit.value) tit.value = a.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    });
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const f = new FormData(form);
      const arquivo = f.get('arquivo');
      const temArquivo = arquivo && arquivo.size > 0;
      if (temArquivo && arquivo.size > TAMANHO_MAX) { $('ob-doc-status').textContent = 'O arquivo passa de 25 MB.'; return; }
      form.querySelector('[type=submit]').disabled = true;
      const doc = d || { id: novoId('d'), processo_id: p.id, numero: proximoNumeroDoc(p), origem: 'externo', criado_em: new Date().toISOString() };
      const antigo = d && d.arquivo_caminho;
      if (temArquivo) {
        $('ob-doc-status').textContent = `Enviando ${arquivo.name} (${fmtTamanho(arquivo.size)})…`;
        const caminho = `${p.id}/${doc.id}/${Date.now().toString(36)}-${nomeSeguro(arquivo.name)}`;
        const { error } = await sb.storage.from(BUCKET).upload(caminho, arquivo, { contentType: arquivo.type || 'application/octet-stream', upsert: false });
        if (error) {
          console.error('Erro ao enviar arquivo:', error);
          $('ob-doc-status').textContent = 'Não foi possível enviar o arquivo: ' + (error.message || error);
          form.querySelector('[type=submit]').disabled = false;
          return;
        }
        Object.assign(doc, { arquivo_caminho: caminho, arquivo_nome: arquivo.name, arquivo_tipo: arquivo.type || '', arquivo_tamanho: arquivo.size });
      }
      Object.assign(doc, { tipo: f.get('tipo'), titulo: f.get('titulo').trim(), data: f.get('data') });
      if (!(await gravar('documentos', doc))) { form.querySelector('[type=submit]').disabled = false; return; }
      if (temArquivo && antigo) sb.storage.from(BUCKET).remove([antigo]);
      if (!d) {
        documentos.push(doc);
        await registrar(p, 'documento', `Documento ${num4(doc.numero)} incluído: ${doc.tipo} — ${doc.titulo}.`);
        if (f.get('avancar')) await mudarFase(p, sugestaoFase(p, doc.tipo), `inclusão do documento ${num4(doc.numero)}`);
      } else {
        await registrar(p, 'documento', `Documento ${num4(doc.numero)} alterado${temArquivo ? ' (arquivo substituído)' : ''}.`);
      }
      fecharModal();
      location.hash = `#/p/${p.id}/d/${doc.id}`;
      render();
    });
  }

  /* Quill: carregado só na primeira vez que um documento interno é escrito */
  let carregandoQuill = null;
  function carregarQuill() {
    if (window.Quill) return Promise.resolve();
    if (!carregandoQuill) {
      carregandoQuill = new Promise((ok, falha) => {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = QUILL + 'quill.snow.css';
        document.head.appendChild(css);
        const s = document.createElement('script');
        s.src = QUILL + 'quill.min.js';
        s.onload = ok;
        s.onerror = () => { carregandoQuill = null; falha(new Error('Não foi possível carregar o editor.')); };
        document.head.appendChild(s);
      });
    }
    return carregandoQuill;
  }

  async function formInterno(p, d) {
    abrirModal(d ? `Editar documento ${num4(d.numero)}` : 'Escrever documento', `
      <form id="ob-form-doc" class="ob-form">
        ${camposDoc(p, d, 'Despacho')}
        <div class="ob-editor inteiro"><div id="ob-editor">${d ? d.conteudo || '' : ''}</div></div>
        <p class="ob-status inteiro" id="ob-doc-status"></p>
        <div class="ob-form-acoes inteiro">
          <button type="button" class="ob-btn" data-acao="fechar-modal">Cancelar</button>
          <button type="submit" class="ob-btn primario">${d ? 'Salvar' : 'Incluir'}</button>
        </div>
      </form>`, true);
    const form = $('ob-form-doc');
    ligarSugestaoFase(form, p);
    try {
      await carregarQuill();
      if (!$('ob-editor')) return;
      quill = new window.Quill('#ob-editor', {
        theme: 'snow',
        placeholder: 'Escreva o documento…',
        modules: { toolbar: [[{ header: [1, 2, 3, false] }], ['bold', 'italic', 'underline'], [{ list: 'ordered' }, { list: 'bullet' }], [{ align: [] }], ['link'], ['clean']] }
      });
    } catch (e) {
      $('ob-doc-status').textContent = e.message;
    }
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      if (!quill) return;
      const f = new FormData(form);
      const vazio = !quill.getText().trim();
      const doc = d || { id: novoId('d'), processo_id: p.id, numero: proximoNumeroDoc(p), origem: 'interno', criado_em: new Date().toISOString() };
      Object.assign(doc, { tipo: f.get('tipo'), titulo: f.get('titulo').trim(), data: f.get('data'), conteudo: vazio ? '' : quill.root.innerHTML });
      form.querySelector('[type=submit]').disabled = true;
      if (!(await gravar('documentos', doc))) { form.querySelector('[type=submit]').disabled = false; return; }
      if (!d) {
        documentos.push(doc);
        await registrar(p, 'documento', `Documento ${num4(doc.numero)} incluído: ${doc.tipo} — ${doc.titulo}.`);
        if (f.get('avancar')) await mudarFase(p, sugestaoFase(p, doc.tipo), `inclusão do documento ${num4(doc.numero)}`);
      } else {
        await registrar(p, 'documento', `Documento ${num4(doc.numero)} alterado.`);
      }
      fecharModal();
      location.hash = `#/p/${p.id}/d/${doc.id}`;
      render();
    });
  }

  function imprimirDoc(p, d) {
    const w = window.open('', '_blank');
    if (!w) { aviso('Libere as janelas pop-up para imprimir.'); return; }
    w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8" />
      <title>${esc(p.numero)} — ${num4(d.numero)} ${esc(d.tipo)}</title>
      <style>
        body { font-family: Georgia, 'Times New Roman', serif; color: #111; max-width: 760px; margin: 40px auto; padding: 0 24px; line-height: 1.55; }
        header { border-bottom: 1px solid #999; margin-bottom: 24px; padding-bottom: 10px; font-family: Arial, sans-serif; font-size: 12px; color: #444; }
        h1 { font-size: 20px; margin: 6px 0 0; color: #111; }
        .ql-align-center { text-align: center; } .ql-align-right { text-align: right; } .ql-align-justify { text-align: justify; }
      </style></head><body>
      <header>Processo ${esc(p.numero)} · ${esc(p.assunto)}<br />Documento ${num4(d.numero)} · ${fmtData(d.data)}<h1>${esc(d.tipo)} — ${esc(d.titulo)}</h1></header>
      ${d.conteudo || ''}
      <script>window.onload = () => window.print();<\/script>
      </body></html>`);
    w.document.close();
  }

  /* =============================================
     AÇÕES
  ============================================= */
  function procAtual() {
    const r = rota();
    return r.processo ? processos.find(p => p.id === r.processo) : null;
  }

  function docAtual() {
    const r = rota();
    return r.documento ? documentos.find(d => d.id === r.documento) : null;
  }

  async function excluirDoc(p, d) {
    if (!confirm(`Excluir o documento ${num4(d.numero)} (${d.tipo} — ${d.titulo})? O arquivo também será apagado.`)) return;
    if (!(await apagar('documentos', d.id))) return;
    if (d.arquivo_caminho) sb.storage.from(BUCKET).remove([d.arquivo_caminho]);
    documentos = documentos.filter(x => x.id !== d.id);
    await registrar(p, 'documento', `Documento ${num4(d.numero)} excluído: ${d.tipo} — ${d.titulo}.`);
    location.hash = `#/p/${p.id}`;
  }

  async function excluirProcesso(p) {
    const docs = docsDe(p.id);
    if (!confirm(`Excluir o processo ${p.numero} (${p.assunto}) com ${docs.length} documento(s), andamento e prazos? Não dá para desfazer.`)) return;
    const caminhos = docs.map(d => d.arquivo_caminho).filter(Boolean);
    if (!(await apagar('processos', p.id))) return;   // documentos, andamentos e prazos saem em cascata
    if (caminhos.length) sb.storage.from(BUCKET).remove(caminhos);
    processos = processos.filter(x => x.id !== p.id);
    documentos = documentos.filter(x => x.processo_id !== p.id);
    andamentos = andamentos.filter(x => x.processo_id !== p.id);
    prazos = prazos.filter(x => x.processo_id !== p.id);
    aviso(`Processo ${p.numero} excluído.`);
    location.hash = '#/';
  }

  async function aoClicar(ev) {
    const el = ev.target.closest('[data-acao]');
    if (!el) return;
    const acao = el.dataset.acao;
    const p = procAtual();
    const d = docAtual();
    if (acao === 'fechar-modal') fecharModal();
    else if (acao === 'novo-processo') formProcesso(null);
    else if (acao === 'filtro') { filtro.fase = el.dataset.fase; render(); }
    else if (acao === 'abrir') location.hash = `#/p/${el.dataset.id}`;
    else if (acao === 'editar-processo' && p) formProcesso(p);
    else if (acao === 'excluir-processo' && p) excluirProcesso(p);
    else if (acao === 'doc-externo' && p) formExterno(p, null);
    else if (acao === 'doc-interno' && p) formInterno(p, null);
    else if (acao === 'editar-doc' && p && d) (d.origem === 'interno' ? formInterno : formExterno)(p, d);
    else if (acao === 'excluir-doc' && p && d) excluirDoc(p, d);
    else if (acao === 'imprimir-doc' && p && d) imprimirDoc(p, d);
    else if ((acao === 'abrir-arquivo' || acao === 'baixar-arquivo') && d) {
      const janela = window.open('', '_blank');   // aberta já no clique, para o navegador não bloquear
      const url = await linkArquivo(d, acao === 'baixar-arquivo');
      if (url && janela) janela.location.href = url; else if (janela) janela.close();
    } else if (acao === 'prazo-apagar' && p) {
      const z = prazos.find(x => x.id === el.dataset.id);
      if (!z || !confirm(`Excluir o prazo “${z.descricao}”?`)) return;
      if (!(await apagar('prazos', z.id))) return;
      prazos = prazos.filter(x => x.id !== z.id);
      await registrar(p, 'prazo', `Prazo excluído: ${z.descricao} (${fmtData(z.data)}).`);
      render();
    }
  }

  async function aoMudar(ev) {
    const el = ev.target;
    const p = procAtual();
    if (el.id === 'ob-fase' && p) {
      await mudarFase(p, el.value);
      render();
    } else if (el.dataset.acao === 'prazo-feito' && p) {
      const z = prazos.find(x => x.id === el.dataset.id);
      if (!z) return;
      z.concluido_em = el.checked ? hoje() : null;
      await gravar('prazos', z);
      await registrar(p, 'prazo', el.checked ? `Prazo cumprido: ${z.descricao}.` : `Prazo reaberto: ${z.descricao}.`);
      render();
    }
  }

  async function aoEnviar(ev) {
    const p = procAtual();
    if (!p) return;
    if (ev.target.id === 'ob-form-prazo') {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const z = { id: novoId('z'), processo_id: p.id, descricao: f.get('descricao').trim(), data: f.get('data'), concluido_em: null };
      if (!(await gravar('prazos', z))) return;
      prazos.push(z);
      await registrar(p, 'prazo', `Prazo definido: ${z.descricao} até ${fmtData(z.data)}.`);
      render();
    } else if (ev.target.id === 'ob-form-anotacao') {
      ev.preventDefault();
      const texto = new FormData(ev.target).get('descricao').trim();
      if (!texto) return;
      await registrar(p, 'anotacao', texto);
      render();
    }
  }

  async function init() {
    document.addEventListener('click', aoClicar);
    document.addEventListener('change', aoMudar);
    document.addEventListener('submit', aoEnviar);
    document.addEventListener('input', ev => {
      if (ev.target.id !== 'ob-busca') return;
      filtro.busca = ev.target.value;
      $('ob-lista-corpo').innerHTML = htmlListaCorpo();
    });
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && !$('ob-modal').hidden) fecharModal();
      if (ev.key === 'Enter' && ev.target.matches('tr[data-acao="abrir"]')) location.hash = `#/p/${ev.target.dataset.id}`;
    });
    $('ob-modal').addEventListener('click', ev => { if (ev.target.id === 'ob-modal') fecharModal(); });
    window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

    const user = await window.authReady;
    if (!user) return;
    $('ob-usuario').textContent = window.getSessionUser ? getSessionUser() : '';
    $('ob-app').innerHTML = '<p class="ob-vazio">Carregando…</p>';
    if (await carregar()) render();
    else $('ob-app').innerHTML = '';
  }

  init();
})();
