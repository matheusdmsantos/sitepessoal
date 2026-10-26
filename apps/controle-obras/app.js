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

  // Modelos de mensagem criados na primeira vez (o usuário edita depois em "Modelos de mensagem").
  // gatilho: fase que cria o lembrete de envio, "dias" depois; null = só envio manual.
  const VARIAVEIS = {
    saudacao: 'Bom dia / Boa tarde / Boa noite, pela hora', nome: 'primeiro nome do contato (ou o cliente)',
    cliente: 'cliente', assunto: 'assunto do processo', numero: 'número do processo', local: 'local da obra',
    valor_proposta: 'valor da proposta', valor_contrato: 'valor do contrato', data_proposta: 'data da proposta enviada'
  };
  const MODELOS_PADRAO = [
    { id: 'mm_envio_proposta', nome: 'Envio da proposta', gatilho: null, dias: 0, ordem: 1,
      texto: '{saudacao}, {nome}! Tudo bem?\n\nSegue a proposta referente a {assunto}, no valor de {valor_proposta}.\n\nQualquer dúvida, fico à disposição.' },
    { id: 'mm_acomp_proposta', nome: 'Acompanhamento da proposta', gatilho: 'proposta', dias: 2, ordem: 2,
      texto: '{saudacao}, {nome}! Tudo bem?\n\nPassando para saber se você conseguiu analisar a proposta de {assunto} que enviei em {data_proposta}.\n\nSe tiver alguma dúvida ou quiser ajustar algum ponto, é só me falar.' },
    { id: 'mm_acomp_proposta2', nome: 'Segundo acompanhamento', gatilho: 'proposta', dias: 7, ordem: 3,
      texto: '{saudacao}, {nome}! Retomando o contato sobre a proposta de {assunto}.\n\nAinda faz sentido seguirmos com o serviço? Posso rever prazo ou condições, se for o caso.' },
    { id: 'mm_contratado', nome: 'Próximos passos (contratado)', gatilho: null, dias: 0, ordem: 4,
      texto: '{saudacao}, {nome}! Obrigado pela confiança.\n\nVou te passar em seguida os próximos passos de {assunto}: documentação, ART e cronograma de início.' },
    { id: 'mm_pos_entrega', nome: 'Pós-entrega', gatilho: 'entregue', dias: 7, ordem: 5,
      texto: '{saudacao}, {nome}! Tudo certo com {assunto}?\n\nSe ficou alguma pendência, me avise. E se puder indicar o meu trabalho para alguém, agradeço muito!' }
  ];

  // Serviços da proposta (textos em proposta-textos.js). A proposta guarda os dados com que foi montada
  // num comentário no início do conteúdo, para "Editar" reabrir o formulário.
  const SERVICOS_PROPOSTA = window.OB_PROPOSTA_SERVICOS || [];
  const MARCA_PROPOSTA = '<!--ob-proposta:';

  let usuario = null;
  let processos = [], documentos = [], andamentos = [], prazos = [], modelos = [];
  let modelosRemoto = false;
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

  // Números por extenso: 6200 → "seis mil e duzentos"; porExtenso(6200) → "seis mil e duzentos reais"
  const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze',
    'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  function ate999(n) {
    if (n === 100) return 'cem';
    const r = n % 100;
    const partes = [CENTENAS[Math.floor(n / 100)], r < 20 ? UNIDADES[r] : DEZENAS[Math.floor(r / 10)] + (r % 10 ? ' e ' + UNIDADES[r % 10] : '')];
    return partes.filter(Boolean).join(' e ');
  }

  function extenso(inteiro) {
    const grupos = [];
    let ultimo = 0;   // valor do último grupo escrito (milhões, milhares ou unidades)
    const mi = Math.floor(inteiro / 1e6), mil = Math.floor(inteiro / 1000) % 1000, u = inteiro % 1000;
    if (mi) { grupos.push(ate999(mi) + (mi === 1 ? ' milhão' : ' milhões')); ultimo = mi; }
    if (mil) { grupos.push(mil === 1 ? 'mil' : ate999(mil) + ' mil'); ultimo = mil; }
    if (u) { grupos.push(ate999(u)); ultimo = u; }
    // "e" antes do último grupo quando ele é redondo ou menor que cem: "seis mil e duzentos"
    return (grupos.length > 1 && (ultimo < 100 || ultimo % 100 === 0)
      ? grupos.slice(0, -1).join(' ') + ' e ' + grupos[grupos.length - 1]
      : grupos.join(' ')) || 'zero';
  }

  function porExtenso(valor) {
    const total = Math.round(Number(valor) * 100);
    const inteiro = Math.floor(total / 100), cent = total % 100;
    let txt = inteiro ? extenso(inteiro) : '';
    if (inteiro) txt += inteiro === 1 ? ' real' : inteiro % 1e6 === 0 ? ' de reais' : ' reais';
    if (cent) txt += (inteiro ? ' e ' : '') + ate999(cent) + (cent === 1 ? ' centavo' : ' centavos');
    return txt || 'zero real';
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
        ? '⚠️ As tabelas da Gestão de Contratos ainda não existem no Supabase. Rode <code>supabase/obras.sql</code> e depois <code>supabase/rls.sql</code> no SQL Editor.'
        : `⚠️ Não foi possível carregar os processos: ${esc(falha.error.message)}`;
      return false;
    }
    [processos, documentos, andamentos, prazos] = r.map(x => x.data || []);
    await carregarModelos();
    return true;
  }

  /* Modelos ficam numa tabela à parte: sem ela, valem os padrões (só leitura) */
  async function carregarModelos() {
    const { data, error } = await sb.from('modelos_mensagem').select('*');
    if (error) {
      console.warn('Tabela modelos_mensagem indisponível; usando os modelos padrão.', error);
      modelos = MODELOS_PADRAO.map(m => ({ ...m }));
      modelosRemoto = false;
      return;
    }
    modelosRemoto = true;
    modelos = data || [];
    let semeados = false;
    try { semeados = !!localStorage.getItem('ob_modelos_semeados'); } catch { /* sem localStorage */ }
    if (!modelos.length && !semeados) {
      modelos = MODELOS_PADRAO.map(m => ({ ...m }));
      const { error: e2 } = await sb.from('modelos_mensagem').upsert(modelos, { onConflict: 'id' });
      if (e2) console.error('Erro ao criar os modelos padrão:', e2);
      else try { localStorage.setItem('ob_modelos_semeados', '1'); } catch { /* ok */ }
    }
  }

  const modelosOrdenados = () => [...modelos].sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || a.nome.localeCompare(b.nome));

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
     MENSAGENS (WhatsApp)
  ============================================= */
  /* "(98) 99999-0000" → "5598999990000"; null se não parece um celular/telefone brasileiro */
  function numeroWhats(tel) {
    let n = String(tel || '').replace(/\D/g, '').replace(/^0+/, '');
    if (n.length === 10 || n.length === 11) n = '55' + n;
    return /^55\d{10,11}$/.test(n) ? n : null;
  }

  /* Data da proposta: a do último documento "Proposta", ou de quando a fase virou "Proposta enviada" */
  function dataProposta(p) {
    const doc = docsDe(p.id).filter(d => d.tipo === 'Proposta').pop();
    if (doc) return doc.data;
    const a = andamentosDe(p.id).find(x => x.tipo === 'fase' && x.descricao.includes(`→ ${fase('proposta').nome}`));
    return a ? dataLocal(new Date(a.data)) : null;
  }

  function preencherModelo(texto, p) {
    const h = new Date().getHours();
    const valores = {
      saudacao: h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite',
      nome: (p.contato || p.cliente || '').trim().split(/[\s,(]+/)[0] || '',
      cliente: p.cliente || '', assunto: p.assunto || '', numero: p.numero || '', local: p.local || '',
      valor_proposta: p.valor_proposta != null ? fmtMoeda(p.valor_proposta) : '',
      valor_contrato: p.valor_contrato != null ? fmtMoeda(p.valor_contrato) : '',
      data_proposta: dataProposta(p) ? fmtData(dataProposta(p)) : ''
    };
    // Sem o nome, "Bom dia, !" vira "Bom dia!"
    return texto.replace(/\{(\w+)\}/g, (m, k) => (k in valores ? valores[k] : m)).replace(/, !/g, '!').replace(/ +,/g, ',');
  }

  /* Domingo não é dia de cobrar cliente: o lembrete passa para segunda */
  function diaUtil(dias) {
    const d = new Date();
    d.setDate(d.getDate() + dias);
    if (d.getDay() === 0) d.setDate(d.getDate() + 1);
    return dataLocal(d);
  }

  /* Ao entrar numa fase, cria os lembretes de mensagem dela; ao sair, tira os que ficaram pendentes */
  async function agendarMensagens(p, nova, antiga) {
    const sobras = prazos.filter(z => z.processo_id === p.id && z.modelo_id && !z.concluido_em &&
      (modelos.find(m => m.id === z.modelo_id) || {}).gatilho === antiga);
    for (const z of sobras) {
      if (await apagar('prazos', z.id)) prazos = prazos.filter(x => x.id !== z.id);
    }
    const novos = modelos.filter(m => m.gatilho === nova && m.dias > 0)
      .map(m => ({ id: novoId('z'), processo_id: p.id, descricao: `💬 ${m.nome}`, data: diaUtil(m.dias), concluido_em: null, modelo_id: m.id }));
    for (const z of novos) {
      if (await gravar('prazos', z)) prazos.push(z);
    }
    if (sobras.length || novos.length) {
      const partes = [];
      if (novos.length) partes.push(`lembrete${novos.length > 1 ? 's' : ''} de mensagem: ${novos.map(z => `${z.descricao.slice(3)} em ${fmtData(z.data)}`).join('; ')}`);
      if (sobras.length) partes.push(`${sobras.length} lembrete${sobras.length > 1 ? 's' : ''} da fase anterior removido${sobras.length > 1 ? 's' : ''}`);
      await registrar(p, 'prazo', partes.join('. ').replace(/^./, c => c.toUpperCase()) + '.');
    }
  }

  function formMensagem(p, modeloId, prazoId) {
    const tel = numeroWhats(p.telefone);
    const lista = modelosOrdenados();
    const atual = lista.find(m => m.id === modeloId) || lista[0];
    abrirModal('Mensagem por WhatsApp', `
      <form id="ob-form-msg" class="ob-form">
        ${tel ? `<p class="ob-sub inteiro">Para ${esc(p.contato || p.cliente || '')} · ${esc(p.telefone)}</p>`
          : `<p class="ob-status inteiro">Cadastre o WhatsApp do contato em “Editar dados” para abrir a conversa. Você ainda pode copiar o texto.</p>`}
        ${campo('Modelo', `<select class="ob-input" name="modelo">${opcoes(lista.map(m => [m.id, m.nome]), atual && atual.id)}<option value="">Mensagem livre</option></select>`, 'inteiro')}
        ${campo('Mensagem (pode editar antes de enviar)', `<textarea class="ob-input" name="texto" rows="9">${esc(atual ? preencherModelo(atual.texto, p) : '')}</textarea>`, 'inteiro')}
        <div class="ob-form-acoes inteiro">
          <button type="button" class="ob-btn" data-acao="copiar-msg">Copiar texto</button>
          <button type="submit" class="ob-btn whats" ${tel ? '' : 'disabled'}>💬 Abrir no WhatsApp</button>
        </div>
      </form>`);
    const form = $('ob-form-msg');
    form.querySelector('[name=modelo]').addEventListener('change', e => {
      const m = modelos.find(x => x.id === e.target.value);
      form.querySelector('[name=texto]').value = m ? preencherModelo(m.texto, p) : '';
    });
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const texto = form.querySelector('[name=texto]').value.trim();
      if (!tel || !texto) return;
      window.open(`https://wa.me/${tel}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
      const m = modelos.find(x => x.id === form.querySelector('[name=modelo]').value);
      fecharModal();
      await registrar(p, 'mensagem', `Mensagem por WhatsApp${m ? ` (${m.nome})` : ''}: “${texto}”`);
      // O lembrete de onde veio a mensagem fica cumprido
      const z = prazoId ? prazos.find(x => x.id === prazoId)
        : m && prazos.find(x => x.processo_id === p.id && x.modelo_id === m.id && !x.concluido_em);
      if (z && !z.concluido_em) {
        z.concluido_em = hoje();
        await gravar('prazos', z);
      }
      render();
      aviso(z ? 'WhatsApp aberto. Lembrete marcado como cumprido.' : 'WhatsApp aberto. A mensagem ficou registrada no andamento.');
    });
  }

  function formModelos() {
    const fases = [['', 'Nenhum (só envio manual)'], ...FASES.map(f => [f.id, `Ao entrar em “${f.nome}”`])];
    const linha = (m, i) => `
      <fieldset class="ob-modelo" data-i="${i}">
        <div class="ob-modelo-cab">
          <input class="ob-input" name="nome" value="${esc(m.nome)}" required aria-label="Nome do modelo" />
          <button type="button" class="ob-btn sutil" data-acao="modelo-remover" data-i="${i}" aria-label="Remover modelo">✕</button>
        </div>
        <div class="ob-modelo-gatilho">
          <select class="ob-input" name="gatilho" aria-label="Quando lembrar">${opcoes(fases, m.gatilho || '')}</select>
          <label class="ob-modelo-dias"><input type="number" class="ob-input" name="dias" min="0" max="90" value="${m.dias || 0}" aria-label="Dias depois" /> dias depois</label>
        </div>
        <textarea class="ob-input" name="texto" rows="5" aria-label="Texto do modelo">${esc(m.texto)}</textarea>
      </fieldset>`;
    let rascunho = modelosOrdenados().map(m => ({ ...m }));
    const desenhar = () => {
      $('ob-modelos-lista').innerHTML = rascunho.map(linha).join('');
    };
    const ler = () => {
      document.querySelectorAll('#ob-modelos-lista .ob-modelo').forEach(fs => {
        const m = rascunho[fs.dataset.i];
        m.nome = fs.querySelector('[name=nome]').value.trim();
        m.gatilho = fs.querySelector('[name=gatilho]').value || null;
        m.dias = parseInt(fs.querySelector('[name=dias]').value, 10) || 0;
        m.texto = fs.querySelector('[name=texto]').value;
      });
    };
    abrirModal('Modelos de mensagem', `
      <form id="ob-form-modelos">
        <p class="ob-sub">Variáveis que o app preenche: ${Object.entries(VARIAVEIS).map(([k, v]) => `<code title="${esc(v)}">{${k}}</code>`).join(' ')}.
          Com uma fase em “Quando lembrar”, o app cria o lembrete de envio sozinho quando o processo entra nela.</p>
        ${modelosRemoto ? '' : '<p class="ob-status">A tabela modelos_mensagem ainda não existe no Supabase: rode supabase/obras.sql para poder salvar.</p>'}
        <div id="ob-modelos-lista" class="ob-modelos"></div>
        <div class="ob-form-acoes">
          <button type="button" class="ob-btn" data-acao="modelo-novo">+ Novo modelo</button>
          <span style="flex:1"></span>
          <button type="button" class="ob-btn" data-acao="fechar-modal">Cancelar</button>
          <button type="submit" class="ob-btn primario" ${modelosRemoto ? '' : 'disabled'}>Salvar modelos</button>
        </div>
      </form>`, true);
    desenhar();
    const form = $('ob-form-modelos');
    form.addEventListener('click', ev => {
      const b = ev.target.closest('[data-acao]');
      if (!b) return;
      if (b.dataset.acao === 'modelo-novo') {
        ler();
        rascunho.push({ id: novoId('mm'), nome: 'Novo modelo', gatilho: null, dias: 0, texto: '{saudacao}, {nome}! ', ordem: rascunho.length + 1 });
        desenhar();
      } else if (b.dataset.acao === 'modelo-remover') {
        ler();
        rascunho.splice(b.dataset.i, 1);
        desenhar();
      }
    });
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      ler();
      rascunho.forEach((m, i) => { m.ordem = i + 1; });
      const removidos = modelos.filter(m => !rascunho.some(r => r.id === m.id));
      form.querySelector('[type=submit]').disabled = true;
      for (const m of removidos) await apagar('modelos_mensagem', m.id);
      const { error } = rascunho.length ? await sb.from('modelos_mensagem').upsert(rascunho, { onConflict: 'id' }) : { error: null };
      if (error) { console.error('Erro ao salvar modelos:', error); aviso('Não foi possível salvar os modelos.'); form.querySelector('[type=submit]').disabled = false; return; }
      modelos = rascunho;
      fecharModal();
      render();
      aviso('Modelos salvos.');
    });
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
          return `<div class="ob-prazo-linha ${dias < 0 ? 'vencido' : ''}">
            <span class="ob-prazo-data">${fmtData(z.data)}</span>
            <a href="#/p/${esc(z.processo_id)}">${esc(z.descricao)} <small>${esc(p ? p.numero + ' · ' + p.assunto : '')}</small></a>
            <span class="ob-prazo-dias">${dias < 0 ? `${-dias} dia${dias < -1 ? 's' : ''} de atraso` : dias === 0 ? 'hoje' : `em ${dias} dia${dias > 1 ? 's' : ''}`}</span>
            ${z.modelo_id ? `<button type="button" class="ob-btn whats" data-acao="mensagem-prazo" data-id="${esc(z.id)}" data-processo="${esc(z.processo_id)}">💬 Enviar</button>` : '<span></span>'}
          </div>`;
        }).join('')}
      </section>` : ''}

      <section class="ob-card">
        <div class="ob-lista-cab">
          <h2 class="ob-card-titulo">Processos</h2>
          <input type="search" class="ob-input" id="ob-busca" placeholder="Buscar por número, assunto ou cliente" value="${esc(filtro.busca)}" aria-label="Buscar processos" />
          <button type="button" class="ob-btn" data-acao="modelos">💬 Modelos de mensagem</button>
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
          ${linha('WhatsApp', p.telefone ? `${esc(p.telefone)}${numeroWhats(p.telefone) ? '' : ' <small class="ob-erro">(número incompleto)</small>'}` : '')}
          ${linha('Local', esc(p.local))}
          ${linha('Valor da proposta', p.valor_proposta != null ? fmtMoeda(p.valor_proposta) : '')}
          ${linha('Valor do contrato', p.valor_contrato != null ? fmtMoeda(p.valor_contrato) : '')}
          ${linha('Aberto em', fmtData(dataLocal(new Date(p.criado_em))))}
          ${linha('Concluído em', p.concluido_em ? fmtData(p.concluido_em) : '')}
        </dl>
        ${p.descricao ? `<p class="ob-descricao">${esc(p.descricao)}</p>` : ''}
        <div class="ob-dados-acoes">
          <button type="button" class="ob-btn" data-acao="gerar-proposta">📄 Gerar proposta</button>
          <button type="button" class="ob-btn whats" data-acao="mensagem">💬 Mensagem por WhatsApp</button>
        </div>
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
            ${z.modelo_id && !z.concluido_em ? `<button type="button" class="ob-btn whats" data-acao="mensagem-prazo" data-id="${esc(z.id)}" data-processo="${esc(p.id)}">💬 Enviar</button>` : '<span></span>'}
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
          : `<div class="ob-doc-conteudo ${lerProposta(d) ? 'ob-proposta' : ''}">${d.conteudo || '<p class="ob-vazio">Documento vazio.</p>'}</div>`}
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

  /* =============================================
     PROPOSTA (botão "Gerar proposta")
     Montada a partir dos serviços marcados, no formato da proposta do Matheus:
     capa, objeto, seções técnicas, obrigações, valores, pagamento, prazos e aceite.
  ============================================= */
  const servicoDoCatalogo = id => SERVICOS_PROPOSTA.find(s => s.id === id);
  const maiusculaInicial = s => s.charAt(0).toUpperCase() + s.slice(1);
  const semPonto = s => String(s || '').trim().replace(/[.;]+$/, '');
  const ehProjeto = it => it.unidade !== 'meses';
  const ROMANOS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

  // Dados do proponente e últimos prazos/valores: ficam no user_metadata da conta (cada usuário tem os seus)
  function meusDados() {
    const m = (usuario && usuario.user_metadata) || {};
    return { profissao: 'Eng.º Civil', email: window.getSessionUser ? getSessionUser() : '', ...(m.proposta_eu || {}) };
  }
  const ultimosValores = () => ((usuario && usuario.user_metadata) || {}).proposta_ultimos || {};

  async function salvarMeusDados(eu, itens) {
    const ultimos = { ...ultimosValores() };
    itens.forEach(it => { if (servicoDoCatalogo(it.id)) ultimos[it.id] = { valor: it.valor, prazo: it.prazo }; });
    const { data, error } = await sb.auth.updateUser({ data: { proposta_eu: eu, proposta_ultimos: ultimos } });
    if (error) console.warn('Não foi possível guardar os seus dados da proposta:', error);
    else if (data && data.user) usuario = data.user;
  }

  // Os dados com que a proposta foi montada ficam num comentário no início do conteúdo
  function lerProposta(d) {
    const c = d && d.conteudo;
    if (!c || !c.startsWith(MARCA_PROPOSTA)) return null;
    try { return JSON.parse(decodeURIComponent(c.slice(MARCA_PROPOSTA.length, c.indexOf('-->')))); }
    catch { return null; }
  }
  const corpoProposta = d => d.conteudo.slice(d.conteudo.indexOf('-->') + 3);
  const totalProposta = itens => itens.reduce((s, it) => s + (Number(it.valor) || 0), 0);

  function subtituloProposta(itens) {
    if (itens.length === 1) return itens[0].nome.toUpperCase();
    if (itens.some(it => it.id === 'estrutural') && itens.filter(ehProjeto).length > 1) return 'PROJETO ESTRUTURAL E PROJETOS COMPLEMENTARES';
    return itens.every(ehProjeto) ? 'PROJETOS DE ENGENHARIA' : 'SERVIÇOS DE ENGENHARIA';
  }

  function htmlProposta(dados) {
    const { itens, ed, eu } = dados;
    const total = totalProposta(itens);
    const sub = subtituloProposta(itens);
    const paraEdif = ed.tipo ? `PARA EDIFICAÇÃO ${esc(ed.tipo.toUpperCase())}` : '';
    const mes = new Date(dados.data + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).toUpperCase();
    const lista = xs => `<ul>${xs.map(x => `<li>${x}</li>`).join('')}</ul>`;
    const comQuebras = s => esc(s).replace(/\n/g, '<br>');
    const rotulado = linha => {
      const i = linha.indexOf(':');
      return i > 0 && i < 40 ? `<b>${esc(linha.slice(0, i + 1))}</b>${esc(linha.slice(i + 1))}` : esc(linha);
    };
    const valorTxt = v => `${fmtMoeda(v)} (${maiusculaInicial(porExtenso(v))})`;
    const proponente = [eu.profissao, eu.nomeCompleto, eu.registro].filter(Boolean).join(' ');
    const projetos = itens.filter(ehProjeto);
    const sondagem = itens.some(it => (servicoDoCatalogo(it.id) || {}).sondagem);
    let n = 0;
    const secao = t => `${ROMANOS[n++]}- ${t}`;

    const caract = [];
    if (ed.area || ed.pavimentos) {
      caract.push(`<b>Imóvel:</b> ${ed.area ? `Aproximadamente ${esc(ed.area)} m² de área construída${ed.pavimentos ? ', distribuídos em ' : ''}` : ''}${esc(ed.area ? semPonto(ed.pavimentos) : maiusculaInicial(semPonto(ed.pavimentos)))}.`);
    }
    if (ed.endereco) caract.push(`<b>Endereço:</b> ${esc(semPonto(ed.endereco))}.`);
    if (ed.sistema) caract.push(`<b>Trata-se de edificação${ed.tipo ? ' ' + esc(ed.tipo) : ''} em ${esc(semPonto(ed.sistema))}.</b>`);
    const composicao = String(ed.composicao || '').split('\n').map(s => s.trim()).filter(Boolean);

    const secoes = itens.map((it, i) => {
      const s = servicoDoCatalogo(it.id);
      if (!s) {
        return it.descricao ? `<section class="prop-quebra"><h3>${i + 1}) ${esc(it.nome.toUpperCase())}</h3><p>${comQuebras(it.descricao)}</p></section>` : '';
      }
      return `<section class="prop-quebra">
        <h3>${i + 1}) ${esc(s.titulo)}</h3>
        <p>${esc(s.intro)}</p>
        <p>Nossos serviços são desenvolvidos para assegurar:</p>
        ${lista(s.vantagens.map(([r, t]) => `<b>${esc(r)}:</b> ${esc(t)}`))}
        <h4>Escopo Técnico de Serviços:</h4>
        <ol>${s.escopo.map(([g, xs]) => `<li>${esc(g)}:<ul class="prop-sub">${xs.map(x => `<li>${esc(x)}</li>`).join('')}</ul></li>`).join('')}</ol>
      </section>`;
    }).join('');

    const doProponente = [
      'Manter sob sua responsabilidade todo o pessoal necessário à execução dos serviços objeto desta PROPOSTA, arcando com os respectivos encargos sociais;',
      `Responder perante o CONTRATANTE pela execução e entrega de todos os ${projetos.length ? 'Projetos' : 'serviços'};`,
      `Assumir, na qualidade de ${projetos.length ? 'autor' : 'responsável técnico'}, a responsabilidade técnica pelos ${projetos.length ? 'projetos' : 'serviços'}, com a emissão das respectivas ARTs (Anotação de Responsabilidade Técnica)${eu.conselho ? ' junto ao ' + esc(eu.conselho) : ''}, atendendo prontamente às exigências e aos esclarecimentos solicitados pelos órgãos competentes;`
    ];
    if (projetos.length) {
      doProponente.push('Fornecer ao CONTRATANTE o arquivo digital (não editável) de cada uma das pranchas e detalhes relativos ao desenvolvimento dos projetos;',
        'Elaborar os projetos objeto da presente PROPOSTA em obediência às normas e especificações técnicas vigentes, compatibilizando-os entre si e responsabilizando-se pelos serviços prestados, na forma da legislação em vigor.');
    }
    const doContratante = ['Fornecer o projeto arquitetônico definitivo em arquivo editável (DWG/DXF), incluindo plantas, cortes, fachadas e planta de cobertura;'];
    itens.forEach(it => ((servicoDoCatalogo(it.id) || {}).contratante || []).forEach(x => { if (!doContratante.includes(x)) doContratante.push(esc(x)); }));
    doContratante.push('Informar previamente qualquer alteração no projeto arquitetônico.');

    const cents = Math.round(total * 100);
    const pct = Math.min(100, Math.max(0, Number(dados.entrada) || 0));
    const entCents = Math.round(cents * pct / 100);
    const entrega = itens.every(ehProjeto) ? 'na entrega dos projetos' : 'na entrega dos serviços';
    const parcelas = [];
    if (entCents) parcelas.push(`${valorTxt(entCents / 100)} no aceite da proposta (${pct}%)`);
    if (cents - entCents) parcelas.push(`${valorTxt((cents - entCents) / 100)} ${entrega} (${100 - pct}%)`);

    // Etapas dos projetos em sequência; serviços contínuos (acompanhamento) no fim da tabela
    let etapa = 0, totalDias = 0;
    const linhasPrazo = [...projetos, ...itens.filter(it => !ehProjeto(it))].map(it => {
      const qtd = Number(it.prazo) || 0;
      if (!ehProjeto(it)) {
        return `<tr><td>Obra</td><td>${esc(it.nome.toUpperCase())}</td><td>${qtd ? `${qtd} ${qtd === 1 ? 'MÊS' : 'MESES'}` : '—'}</td><td>Durante a execução da obra, com visitas periódicas.</td></tr>`;
      }
      etapa++;
      totalDias += qtd;
      const obs = etapa === 1
        ? `O prazo inicia após o aceite da proposta, o pagamento da entrada e o recebimento do projeto arquitetônico${sondagem ? ' e da sondagem' : ''}.`
        : `Inicia após a conclusão da ${etapa - 1}ª Etapa.`;
      return `<tr><td>${etapa}ª Etapa</td><td>${esc(it.nome.toUpperCase())}</td><td>${qtd} ${qtd === 1 ? 'DIA ÚTIL' : 'DIAS ÚTEIS'}</td><td>${obs}</td></tr>`;
    }).join('');
    const pranchas = Number(dados.pranchas) || 0;

    return `
      <section class="prop-capa">
        <p>PROPOSTA PARA PRESTAÇÃO DE SERVIÇOS</p>
        <p>${esc(sub)}</p>
        <p>${esc(mes)}</p>
      </section>

      <section class="prop-quebra">
        <div class="prop-titulo">
          <p>PROPOSTA PARA PRESTAÇÃO DE SERVIÇOS<br>${esc(sub)}${paraEdif ? '<br>' + paraEdif : ''}</p>
          <p>${dados.cliente ? `CONTRATANTE: ${esc(dados.cliente.toUpperCase())}<br>` : ''}OBRA/SERVIÇO: ${esc(dados.assunto.toUpperCase())}${proponente ? `<br>PROPONENTE: ${esc(proponente.toUpperCase())}` : ''}</p>
        </div>
        <h3>${secao('OBJETO DA PROPOSTA:')}</h3>
        ${lista([`${projetos.length ? 'Elaboração' : 'Prestação'} dos serviços relacionados abaixo para edificação${ed.tipo ? ' ' + esc(ed.tipo) : ''}, conforme o projeto arquitetônico (Plantas Baixas / Plantas de Layout) fornecido pelo contratante;`])}
        ${caract.length ? `<h4>Características da Edificação:</h4>${lista(caract)}` : ''}
        ${composicao.length ? `<h4>Composição da Edificação (conforme projeto arquitetônico)</h4>${lista(composicao.map(rotulado))}` : ''}
        <h4>Descrição dos Serviços</h4>
        <ol>${itens.map(it => `<li>${esc(it.nome)}${it.detalhe ? ` (${esc(it.detalhe)})` : ''};</li>`).join('')}</ol>
      </section>

      ${secoes}

      <section class="prop-quebra">
        <h3>${secao('OBRIGAÇÕES DO PROPONENTE')}</h3>
        <h4>Constituem obrigações do PROPONENTE:</h4>
        ${lista(doProponente)}
        <h3>${secao('OBRIGAÇÕES DO CONTRATANTE')}</h3>
        ${lista(doContratante)}
        ${projetos.length ? `<h3>${secao('APRESENTAÇÃO DOS PROJETOS')}</h3>
        <p>Os Projetos serão apresentados em folhas (pranchas) de desenho no formato A1, ou em tamanho maior quando julgado necessário pelo PROPONENTE; os memoriais, especificações e listas de materiais serão apresentados em papel A4.${pranchas ? ` Estima-se um total de ${pranchas} (${extenso(pranchas)}) folhas.` : ''}</p>` : ''}
      </section>

      <section class="prop-quebra">
        <h3>${secao(itens.every(ehProjeto) ? 'VALOR DA PROPOSTA PARA PROJETOS' : 'VALOR DA PROPOSTA')}</h3>
        ${itens.map((it, i) => `<p><b>${i + 1}. ${esc(it.nome)}</b>${it.detalhe ? ` (${esc(it.detalhe)})` : ''}.<br>- ${valorTxt(it.valor)}.</p>`).join('')}
        ${projetos.length ? '<p><b>Obs. Todos os Projetos acompanham lista de materiais / quantitativos e especificações técnicas.</b></p>' : ''}
        <p><b>TOTAL (R$)<br>- ${valorTxt(total)}.</b></p>
        <div class="prop-obs">
          <p>Observações:</p>
          <p>1. No valor referido estão embutidos os impostos referentes à emissão de nota fiscal de prestação de serviços;</p>
          <p>2. Despesas com taxas e emolumentos de Cartório, Prefeitura, CREA, Corpo de Bombeiros, concessionárias e outros não estão inclusas no preço acima;</p>
          ${projetos.length ? '<p>3. Os valores mencionados podem ser alterados caso haja modificações no projeto arquitetônico após o início dos projetos. Sendo assim, será feita uma nova proposta ao contratante com os valores corrigidos.</p>' : ''}
        </div>
        <h3>${secao('CONDIÇÕES DE PAGAMENTO')}</h3>
        ${lista(parcelas.map((x, i) => x + (i === parcelas.length - 1 ? '.' : ';')))}
      </section>

      <section class="prop-quebra">
        <h3>${secao(projetos.length ? 'PRAZO DE ENTREGA DOS PROJETOS' : 'PRAZO DOS SERVIÇOS')}</h3>
        <table class="prop-prazo">
          <thead><tr><th>ETAPA</th><th>SERVIÇO CONTEMPLADO</th><th>PRAZO ESTIMADO DE EXECUÇÃO</th><th>OBSERVAÇÕES</th></tr></thead>
          <tbody>${linhasPrazo}</tbody>
        </table>
        ${totalDias ? `<p><b>Prazo Total Estimado:</b> O prazo total para entrega de todos os projetos é de <b>${totalDias} (${extenso(totalDias)}) ${totalDias === 1 ? 'dia útil' : 'dias úteis'}</b>.</p>` : ''}
        ${eu.pagamento ? `<h3>${secao('DADOS PARA PAGAMENTO')}</h3>
        ${lista([`Pagamento via depósito/transferência ou PIX:<br>${comQuebras(eu.pagamento)}`])}
        <p class="prop-obs">Obs: O comprovante de pagamento e esta proposta assinada deverão ser enviados via e-mail ou WhatsApp para a consolidação da proposta e dos prazos.</p>` : ''}
        <p class="prop-aceite">Aceito os termos acima descritos nesta proposta, comprometendo-me a fornecer todas as informações necessárias para o objeto desta proposta e a cumprir com os pagamentos dentro dos prazos previstos.<br>Data: ___/___/___</p>
        <p class="prop-assinatura"><span></span>CONTRATANTE${dados.cliente ? '<br>' + esc(dados.cliente.toUpperCase()) : ''}</p>
        <p class="prop-assinatura"><span></span>${esc(proponente || eu.nome || '')}</p>
      </section>`.replace(/\n\s*/g, '');
  }

  // Estilo da proposta: o mesmo na tela (dentro do documento) e na impressão
  const CSS_PROPOSTA = `
    .ob-proposta { font-family: 'Times New Roman', Times, serif; color: #111; font-size: 13.5px; line-height: 1.45; }
    .ob-proposta h3 { font-size: 15px; margin: 18px 0 8px; }
    .ob-proposta h4 { font-size: 13.5px; margin: 12px 0 4px; }
    .ob-proposta p { margin: 0 0 6px; text-align: justify; }
    .ob-proposta ul, .ob-proposta ol { margin: 0 0 8px; padding-left: 28px; }
    .ob-proposta li { margin-bottom: 3px; text-align: justify; }
    .ob-proposta ul.prop-sub { list-style: circle; padding-left: 22px; margin: 2px 0 4px; }
    .ob-proposta .prop-capa { display: flex; flex-direction: column; justify-content: space-between; align-items: center; min-height: 300px; padding: 30px 0; font-weight: bold; font-size: 16px; }
    .ob-proposta .prop-capa p, .ob-proposta .prop-titulo p { text-align: center; }
    .ob-proposta .prop-titulo { font-weight: bold; margin: 4px 0 18px; }
    .ob-proposta .prop-titulo p { margin-bottom: 14px; }
    .ob-proposta table.prop-prazo { width: 100%; border-collapse: collapse; font-size: 11.5px; margin: 6px 0 10px; }
    .ob-proposta .prop-prazo th, .ob-proposta .prop-prazo td { border: 1px solid #999; padding: 7px 8px; vertical-align: middle; }
    .ob-proposta .prop-prazo th { background: #e8e8e8; text-align: center; }
    .ob-proposta .prop-prazo td:nth-child(-n+3) { text-align: center; font-weight: bold; }
    .ob-proposta .prop-prazo th:first-child, .ob-proposta .prop-prazo td:first-child { white-space: nowrap; }
    .ob-proposta .prop-obs, .ob-proposta .prop-obs p { font-size: 11px; }
    .ob-proposta .prop-aceite { text-align: center; font-weight: bold; margin-top: 16px; }
    .ob-proposta .prop-assinatura { text-align: center; font-weight: bold; margin-top: 48px; }
    .ob-proposta .prop-assinatura span { display: block; width: 300px; max-width: 100%; margin: 0 auto 4px; border-top: 1px solid #111; }`;

  const CSS_IMPRESSAO = `
    @page { size: A4; margin: 10mm 16mm 12mm; }
    body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    table.prop-pagina { width: 100%; border-collapse: collapse; }
    table.prop-pagina > * > tr > td { padding: 0; border: 0; }
    .prop-quebra { break-before: page; }
    .ob-proposta .prop-capa { min-height: 180mm; padding: 20mm 0 0; }
    .prop-prazo tr { break-inside: avoid; }
    .prop-cab { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 16px; }
    .prop-cab-dados { font-size: 12px; line-height: 1.6; }
    .prop-cab-marca { position: relative; min-width: 330px; min-height: 92px; padding: 14px 22px 12px 96px; display: flex; flex-direction: column; align-items: flex-end; justify-content: flex-end;
      background: #4b5059; color: #fff; clip-path: polygon(24% 0, 100% 0, 100% 100%, 0 100%); font-family: Arial, Helvetica, sans-serif; }
    .prop-cab-nome { font-size: 19px; font-weight: bold; letter-spacing: 0.02em; }
    .prop-cab-prof { font-size: 8.5px; letter-spacing: 0.32em; margin-top: 2px; }
    .prop-frase { text-align: center !important; font-style: italic; font-size: 9px !important; margin-top: 14px; }`;

  function cabecalhoProposta(eu) {
    const dados = [eu.nome ? `<b>${esc(eu.nome)}</b>` : '', esc(eu.cargo), esc(eu.telefone), esc(eu.email)].filter(Boolean).join('<br>');
    return `<div class="prop-cab">
      <div class="prop-cab-dados">${dados}</div>
      ${eu.nome ? `<div class="prop-cab-marca"><span class="prop-cab-nome">${esc(eu.nome.toUpperCase())}</span>
        ${eu.profissao ? `<span class="prop-cab-prof">${esc(eu.profissao.toUpperCase())}</span>` : ''}
        ${eu.registro ? `<span class="prop-cab-prof">${esc(eu.registro.toUpperCase())}</span>` : ''}</div>` : ''}
    </div>`;
  }

  function imprimirProposta(p, d, dados) {
    const w = window.open('', '_blank');
    if (!w) { aviso('Libere as janelas pop-up para imprimir.'); return; }
    const eu = dados.eu || {};
    w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8" />
      <title>Proposta ${esc(p.numero)} - ${esc(dados.cliente || p.assunto)}</title>
      <style>${CSS_PROPOSTA}${CSS_IMPRESSAO}</style></head><body class="ob-proposta">
      <table class="prop-pagina">
        <thead><tr><td>${cabecalhoProposta(eu)}</td></tr></thead>
        <tbody><tr><td>${corpoProposta(d)}</td></tr></tbody>
        <tfoot><tr><td>${eu.frase ? `<p class="prop-frase">${esc(eu.frase).replace(/\n/g, '<br>')}</p>` : ''}</td></tr></tfoot>
      </table>
      <script>window.onload = () => window.print();<\/script>
      </body></html>`);
    w.document.close();
  }

  function formProposta(p, d) {
    const salvo = d && lerProposta(d);
    const eu = { ...(salvo ? salvo.eu : {}), ...meusDados() };
    const ult = ultimosValores();
    const ed = salvo ? salvo.ed : {
      tipo: 'residencial', area: '', pavimentos: '', endereco: p.local || '',
      sistema: 'estrutura de concreto armado e vedação em alvenaria', composicao: p.descricao || ''
    };
    const marcados = salvo ? salvo.itens : [];
    const sug = !d && sugestaoFase(p, 'Proposta');

    const linhaCatalogo = s => {
      const it = marcados.find(x => x.id === s.id);
      const prazo = it ? it.prazo : (ult[s.id] && ult[s.id].prazo) || s.prazo;
      const valor = it ? it.valor : ult[s.id] && ult[s.id].valor;
      return `<div class="ob-prop-item" data-id="${esc(s.id)}">
        <label class="ob-prop-nome"><input type="checkbox" name="sel" ${it ? 'checked' : ''} />
          <span>${esc(s.nome)}<small>${esc(s.detalhe)}</small></span></label>
        <label class="ob-prop-prazo"><input class="ob-input" type="number" min="0" step="1" name="prazo" value="${esc(prazo)}" aria-label="Prazo: ${esc(s.nome)}" />
          <small>${s.unidade === 'meses' ? 'meses' : 'dias úteis'}</small></label>
        <input class="ob-input" name="valor" inputmode="decimal" placeholder="R$ 0,00" value="${valorBr(valor)}" aria-label="Valor: ${esc(s.nome)}" />
        <span></span>
      </div>`;
    };
    const linhaOutro = it => `<div class="ob-prop-item outro" data-id="${esc(it.id)}">
        <div class="ob-prop-outro">
          <input class="ob-input" name="nome" value="${esc(it.nome)}" placeholder="Nome do serviço" aria-label="Nome do serviço" />
          <textarea class="ob-input" name="descricao" rows="2" placeholder="Descrição (opcional; vira uma seção da proposta)" aria-label="Descrição do serviço">${esc(it.descricao)}</textarea>
        </div>
        <label class="ob-prop-prazo"><input class="ob-input" type="number" min="0" step="1" name="prazo" value="${esc(it.prazo)}" aria-label="Prazo do serviço" /><small>dias úteis</small></label>
        <input class="ob-input" name="valor" inputmode="decimal" placeholder="R$ 0,00" value="${valorBr(it.valor)}" aria-label="Valor do serviço" />
        <button type="button" class="ob-btn sutil" data-prop="remover" aria-label="Remover serviço">✕</button>
      </div>`;
    const campoEu = (rot, nome, ph = '', cls = '') => campo(rot, `<input class="ob-input" name="eu_${nome}" value="${esc(eu[nome])}" placeholder="${esc(ph)}" />`, cls);

    abrirModal(d ? `Editar proposta ${num4(d.numero)}` : `Gerar proposta — ${p.numero}`, `
      <form id="ob-form-proposta" class="ob-form" novalidate>
        <div class="ob-prop-servicos inteiro">
          <div class="ob-prop-item ob-prop-cab"><span>Serviços da proposta</span><span>Prazo</span><span>Valor (R$)</span><span></span></div>
          ${SERVICOS_PROPOSTA.map(linhaCatalogo).join('')}
          ${marcados.filter(it => !servicoDoCatalogo(it.id)).map(linhaOutro).join('')}
          <div class="ob-prop-rodape">
            <button type="button" class="ob-btn sutil" data-prop="outro">+ Outro serviço</button>
            <strong id="ob-prop-total"></strong>
          </div>
        </div>

        <h3 class="ob-prop-secao inteiro">Edificação</h3>
        ${campo('Tipo de edificação', `<input class="ob-input" name="ed_tipo" value="${esc(ed.tipo)}" placeholder="residencial, comercial…" />`)}
        ${campo('Área construída (m²)', `<input class="ob-input" name="ed_area" inputmode="decimal" value="${esc(ed.area)}" placeholder="270" />`)}
        ${campo('Pavimentos', `<input class="ob-input" name="ed_pavimentos" value="${esc(ed.pavimentos)}" placeholder="três pavimentos (Térreo, 1º e 2º Pavimentos)" />`, 'inteiro')}
        ${campo('Endereço da obra', `<input class="ob-input" name="ed_endereco" value="${esc(ed.endereco)}" />`, 'inteiro')}
        ${campo('Sistema construtivo', `<input class="ob-input" name="ed_sistema" value="${esc(ed.sistema)}" />`, 'inteiro')}
        ${campo('Composição da edificação (um item por linha; o que vem antes de “:” sai em negrito)', `<textarea class="ob-input" name="ed_composicao" rows="4" placeholder="Térreo: garagem, área gourmet e WC">${esc(ed.composicao)}</textarea>`, 'inteiro')}

        <h3 class="ob-prop-secao inteiro">Pagamento e documento</h3>
        ${campo('Entrada no aceite (%)', `<input class="ob-input" type="number" min="0" max="100" name="entrada" value="${esc(salvo ? salvo.entrada : 50)}" />`)}
        ${campo('Pranchas estimadas (opcional)', `<input class="ob-input" type="number" min="0" name="pranchas" value="${esc(salvo && salvo.pranchas ? salvo.pranchas : '')}" />`)}
        ${campo('Data da proposta', `<input type="date" class="ob-input" name="data" value="${esc(d ? d.data : hoje())}" required />`)}
        ${campo('Título no processo', `<input class="ob-input" name="titulo" value="${esc(d ? d.titulo : p.assunto)}" />`)}
        ${sug ? `<label class="ob-check inteiro"><input type="checkbox" name="avancar" checked /><span>Mudar a fase para “<b>${esc(fase(sug).nome)}</b>”</span></label>` : ''}

        <details class="ob-prop-eu inteiro" ${eu.nomeCompleto ? '' : 'open'}>
          <summary>Seus dados no cabeçalho, na assinatura e no pagamento</summary>
          <div class="ob-form">
            ${campoEu('Nome no cabeçalho', 'nome', 'Ex.: Matheus Miranda')}
            ${campoEu('Cargo no cabeçalho', 'cargo', 'Ex.: Projetista Estrutural')}
            ${campoEu('Profissão', 'profissao', 'Eng.º Civil')}
            ${campoEu('Nome completo (assinatura)', 'nomeCompleto')}
            ${campoEu('Registro profissional', 'registro', 'Ex.: RN 0000000000')}
            ${campoEu('Conselho das ARTs', 'conselho', 'Ex.: CREA-PI')}
            ${campoEu('Telefone', 'telefone', '+55 (86) 90000-0000')}
            ${campoEu('E-mail', 'email')}
            ${campo('Dados para pagamento', `<textarea class="ob-input" name="eu_pagamento" rows="4" placeholder="Banco, agência, conta, titular e chave PIX">${esc(eu.pagamento)}</textarea>`, 'inteiro')}
            ${campo('Frase do rodapé (opcional)', `<textarea class="ob-input" name="eu_frase" rows="2">${esc(eu.frase)}</textarea>`, 'inteiro')}
            <p class="ob-sub inteiro">Ficam guardados na sua conta e valem para as próximas propostas.</p>
          </div>
        </details>

        <p class="ob-status inteiro" id="ob-prop-status"></p>
        <div class="ob-form-acoes inteiro">
          <button type="button" class="ob-btn" data-acao="fechar-modal">Cancelar</button>
          <button type="submit" class="ob-btn primario">${d ? 'Salvar proposta' : 'Gerar proposta'}</button>
        </div>
      </form>`, true);

    const form = $('ob-form-proposta');
    const linhas = () => [...form.querySelectorAll('.ob-prop-item[data-id]')];
    const escolhida = row => (servicoDoCatalogo(row.dataset.id) ? row.querySelector('[name=sel]').checked : !!row.querySelector('[name=nome]').value.trim());
    const atualizarTotal = () => {
      const sel = linhas().filter(escolhida);
      const total = sel.reduce((s, row) => s + (lerNumero(row.querySelector('[name=valor]').value) || 0), 0);
      const dias = sel.filter(row => (servicoDoCatalogo(row.dataset.id) || {}).unidade !== 'meses')
        .reduce((s, row) => s + (Number(row.querySelector('[name=prazo]').value) || 0), 0);
      $('ob-prop-total').textContent = sel.length ? `Total ${fmtMoeda(total)} · ${dias} dias úteis` : 'Marque os serviços';
    };
    form.addEventListener('input', ev => {
      const row = ev.target.closest('.ob-prop-item');
      // Mexer no prazo ou no valor já marca o serviço
      if (row && ev.target.name !== 'sel' && servicoDoCatalogo(row.dataset.id)) row.querySelector('[name=sel]').checked = true;
      atualizarTotal();
    });
    form.addEventListener('change', atualizarTotal);
    form.addEventListener('click', ev => {
      const el = ev.target.closest('[data-prop]');
      if (!el) return;
      if (el.dataset.prop === 'remover') el.closest('.ob-prop-item').remove();
      else {
        form.querySelector('.ob-prop-rodape').insertAdjacentHTML('beforebegin', linhaOutro({ id: novoId('s'), nome: '', descricao: '', prazo: '', valor: null }));
        [...form.querySelectorAll('.ob-prop-item.outro [name=nome]')].pop().focus();
      }
      atualizarTotal();
    });
    atualizarTotal();

    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const status = $('ob-prop-status');
      const itens = [];
      for (const row of linhas().filter(escolhida)) {
        const s = servicoDoCatalogo(row.dataset.id);
        const nome = s ? s.nome : row.querySelector('[name=nome]').value.trim();
        const valor = lerNumero(row.querySelector('[name=valor]').value);
        if (!valor) { status.textContent = `Informe o valor de “${nome}”.`; row.querySelector('[name=valor]').focus(); return; }
        itens.push({
          id: row.dataset.id, nome, detalhe: s ? s.detalhe : '', unidade: s && s.unidade ? s.unidade : '',
          prazo: Number(row.querySelector('[name=prazo]').value) || 0, valor,
          ...(s ? {} : { descricao: row.querySelector('[name=descricao]').value.trim() })
        });
      }
      if (!itens.length) { status.textContent = 'Marque ao menos um serviço.'; return; }
      const f = new FormData(form);
      const g = k => String(f.get(k) || '').trim();
      const novoEu = {};
      ['nome', 'cargo', 'profissao', 'nomeCompleto', 'registro', 'conselho', 'telefone', 'email', 'pagamento', 'frase'].forEach(k => { novoEu[k] = g('eu_' + k); });
      const dados = {
        v: 1, numero: p.numero, cliente: p.cliente || '', assunto: p.assunto, data: g('data') || hoje(), itens,
        ed: { tipo: g('ed_tipo'), area: g('ed_area'), pavimentos: g('ed_pavimentos'), endereco: g('ed_endereco'), sistema: g('ed_sistema'), composicao: g('ed_composicao') },
        entrada: Number(f.get('entrada')) || 0, pranchas: Number(f.get('pranchas')) || 0, eu: novoEu
      };
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      status.textContent = '';
      const doc = d || { id: novoId('d'), processo_id: p.id, numero: proximoNumeroDoc(p), origem: 'interno', tipo: 'Proposta', criado_em: new Date().toISOString() };
      Object.assign(doc, {
        titulo: g('titulo') || p.assunto, data: dados.data,
        conteudo: MARCA_PROPOSTA + encodeURIComponent(JSON.stringify(dados)) + '-->' + htmlProposta(dados)
      });
      if (!(await gravar('documentos', doc))) { btn.disabled = false; return; }
      const total = totalProposta(itens);
      p.valor_proposta = total;   // registrar() grava o processo com o valor novo
      if (!d) {
        documentos.push(doc);
        await registrar(p, 'documento', `Documento ${num4(doc.numero)} incluído: Proposta — ${doc.titulo} (${fmtMoeda(total)}).`);
        if (f.get('avancar')) await mudarFase(p, sugestaoFase(p, 'Proposta'), `inclusão do documento ${num4(doc.numero)}`);
      } else {
        await registrar(p, 'documento', `Documento ${num4(doc.numero)} alterado: Proposta — ${fmtMoeda(total)}.`);
      }
      salvarMeusDados(novoEu, itens);
      fecharModal();
      location.hash = `#/p/${p.id}/d/${doc.id}`;
      render();
    });
  }

  const gerarProposta = p => formProposta(p, null);

  function formProcesso(p) {
    const novo = !p;
    p = p || { servico: 'execucao', fase: 'prospeccao' };
    abrirModal(novo ? `Novo processo ${proximoNumero()}` : `Editar processo ${p.numero}`, `
      <form id="ob-form-processo" class="ob-form">
        ${campo('Assunto *', `<input class="ob-input" name="assunto" required value="${esc(p.assunto)}" placeholder="Ex.: Reforma da cobertura — Escola X" />`, 'inteiro')}
        ${campo('Serviço', `<select class="ob-input" name="servico">${opcoes(Object.entries(SERVICOS), p.servico)}</select>`)}
        ${novo ? campo('Fase inicial', `<select class="ob-input" name="fase">${opcoes(FASES.filter(f => !f.final).map(f => [f.id, f.nome]), p.fase)}</select>`) : '<span></span>'}
        ${campo('Cliente / interessado', `<input class="ob-input" name="cliente" value="${esc(p.cliente)}" />`)}
        ${campo('Pessoa de contato', `<input class="ob-input" name="contato" value="${esc(p.contato)}" placeholder="Ex.: João Silva (engenheiro)" />`)}
        ${campo('WhatsApp do contato', `<input class="ob-input" name="telefone" type="tel" inputmode="tel" value="${esc(p.telefone)}" placeholder="(98) 99999-0000" />`)}
        ${campo('Local da obra', `<input class="ob-input" name="local" value="${esc(p.local)}" />`, 'inteiro')}
        ${campo('Valor da proposta (R$)', `<input class="ob-input" name="valor_proposta" inputmode="decimal" value="${valorBr(p.valor_proposta)}" placeholder="0,00" />`)}
        ${campo('Valor do contrato (R$)', `<input class="ob-input" name="valor_contrato" inputmode="decimal" value="${valorBr(p.valor_contrato)}" placeholder="0,00" />`)}
        ${campo('Descrição', `<textarea class="ob-input" name="descricao" rows="3">${esc(p.descricao)}</textarea>`, 'inteiro')}
        <div class="ob-form-acoes inteiro">
          <button type="submit" class="ob-btn ob-btn-esquerda" name="proposta" value="1" title="Salva os dados e abre uma proposta preenchida com eles">📄 Gerar proposta</button>
          <button type="button" class="ob-btn" data-acao="fechar-modal">Cancelar</button>
          <button type="submit" class="ob-btn primario">${novo ? 'Abrir processo' : 'Salvar'}</button>
        </div>
      </form>`);
    $('ob-form-processo').addEventListener('submit', async ev => {
      ev.preventDefault();
      const proposta = !!(ev.submitter && ev.submitter.name === 'proposta');
      const f = new FormData(ev.target);
      const dados = {
        assunto: f.get('assunto').trim(), servico: f.get('servico'),
        cliente: f.get('cliente').trim() || null, contato: f.get('contato').trim() || null,
        telefone: f.get('telefone').trim() || null, local: f.get('local').trim() || null,
        valor_proposta: lerNumero(f.get('valor_proposta')), valor_contrato: lerNumero(f.get('valor_contrato')),
        descricao: f.get('descricao').trim() || null
      };
      const botoes = ev.target.querySelectorAll('[type=submit]');
      botoes.forEach(b => { b.disabled = true; });
      let proc = p;
      if (novo) {
        const agora = new Date().toISOString();
        proc = { id: novoId('p'), numero: proximoNumero(), fase: f.get('fase'), criado_em: agora, atualizado_em: agora, concluido_em: null, ...dados };
        if (!(await gravar('processos', proc))) { botoes.forEach(b => { b.disabled = false; }); return; }
        processos.push(proc);
        await registrar(proc, 'criacao', `Processo aberto na fase “${fase(proc.fase).nome}”.`);
        await agendarMensagens(proc, proc.fase, null);
      } else {
        const mudou = Object.keys(dados).filter(k => String(dados[k] ?? '') !== String(p[k] ?? ''));
        Object.assign(p, dados);
        if (mudou.length) await registrar(p, 'anotacao', 'Dados do processo alterados.');
      }
      fecharModal();
      if (novo) location.hash = `#/p/${proc.id}`;
      else render();
      if (proposta) gerarProposta(proc);
    });
  }

  async function mudarFase(p, nova, motivo) {
    if (nova === p.fase) return;
    const antiga = p.fase;
    p.fase = nova;
    p.concluido_em = fase(nova).final ? (p.concluido_em || hoje()) : null;
    await registrar(p, 'fase', `Fase: ${fase(antiga).nome} → ${fase(nova).nome}${motivo ? ` (${motivo})` : ''}.`);
    await agendarMensagens(p, nova, antiga);
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
      ${d.tipo === 'Proposta' ? '' /* vai para o cliente: sem o cabeçalho interno do processo */
        : `<header>Processo ${esc(p.numero)} · ${esc(p.assunto)}<br />Documento ${num4(d.numero)} · ${fmtData(d.data)}<h1>${esc(d.tipo)} — ${esc(d.titulo)}</h1></header>`}
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
    else if (acao === 'modelos') formModelos();
    else if (acao === 'mensagem' && p) formMensagem(p, null, null);
    else if (acao === 'mensagem-prazo') {
      const z = prazos.find(x => x.id === el.dataset.id);
      const dono = processos.find(x => x.id === el.dataset.processo);
      if (z && dono) formMensagem(dono, z.modelo_id, z.id);
    } else if (acao === 'copiar-msg') {
      const texto = document.querySelector('#ob-form-msg [name=texto]').value;
      try { await navigator.clipboard.writeText(texto); aviso('Texto copiado.'); }
      catch { aviso('Não foi possível copiar; selecione o texto e use Ctrl+C.'); }
    }
    else if (acao === 'filtro') { filtro.fase = el.dataset.fase; render(); }
    else if (acao === 'abrir') location.hash = `#/p/${el.dataset.id}`;
    else if (acao === 'editar-processo' && p) formProcesso(p);
    else if (acao === 'excluir-processo' && p) excluirProcesso(p);
    else if (acao === 'doc-externo' && p) formExterno(p, null);
    else if (acao === 'doc-interno' && p) formInterno(p, null);
    else if (acao === 'gerar-proposta' && p) gerarProposta(p);
    else if (acao === 'editar-doc' && p && d) (lerProposta(d) ? formProposta : d.origem === 'interno' ? formInterno : formExterno)(p, d);
    else if (acao === 'excluir-doc' && p && d) excluirDoc(p, d);
    else if (acao === 'imprimir-doc' && p && d) {
      const prop = lerProposta(d);
      if (prop) imprimirProposta(p, d, prop); else imprimirDoc(p, d);
    }
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

    const estilo = document.createElement('style');
    estilo.textContent = CSS_PROPOSTA;
    document.head.appendChild(estilo);

    const user = await window.authReady;
    if (!user) return;
    usuario = user;
    if (!canUseApp('controle-obras', user)) { location.replace('/apps.html'); return; }
    $('ob-usuario').textContent = window.getSessionUser ? getSessionUser() : '';
    $('ob-app').innerHTML = '<p class="ob-vazio">Carregando…</p>';
    if (await carregar()) render();
    else $('ob-app').innerHTML = '';
  }

  init();
})();
