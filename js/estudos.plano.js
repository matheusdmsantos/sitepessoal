/* ─── js/estudos.plano.js — Plano semanal, revisões e desempenho ───
 *
 * Inspirado no método da Guruja: metas semanais geradas a partir das horas
 * disponíveis e do peso/nível de cada disciplina, revisões espaçadas que
 * dependem do acerto (revisões condicionais) e reforços automáticos.
 *
 * Depende de estudos.v5.js (carregado antes): editaisData, currentEditalId,
 * studyData, saveData, saveEditais, renderDashboard, renderEdital,
 * escapeHtml, dataLocal, getTargetDate e currentSection.
 *
 * Os dados ficam nas tabelas sessoes, metas, revisoes e plano_estudos do
 * Supabase (supabase/estudos-plano.sql). Se elas ainda não existirem, tudo
 * funciona só neste navegador e é enviado ao Supabase quando elas aparecerem.
 */
(function () {
  const sb = window.supabaseClient;

  /* =============================================
     REGRAS DO MÉTODO
  ============================================= */
  const BLOCO_MIN = { 1: 120, 2: 90, 3: 60 };   // minutos por tópico, pelo nível (1 = iniciante)
  // Revisões adaptativas: o intervalo até a próxima revisão é multiplicado conforme o acerto
  // (×2 de 70% a 84%, ×3 de 85% a 94%, ×4 a partir de 95%). Abaixo de 70% entra um reforço.
  // Quando o próximo intervalo passaria de INTERVALO_MAX, o tópico está dominado e sai da fila.
  const ACERTO_REFORCO = 70;
  const ACERTO_BOM = 85;
  const ACERTO_OTIMO = 95;
  const INTERVALO_MAX = 120;                     // dias
  const MIN_REVISAO = 25;                        // duração padrão de uma revisão
  const MIN_REVISAO_RAPIDA = 15;                 // com acerto de 90% ou mais
  const MIN_REFORCO = 40;
  const LIMITE_REVISAO_DIA = 0.5;                // revisões ocupam no máximo metade do tempo do dia
  const PAGINAS_POR_HORA = 20;                   // ritmo de leitura dos PDFs ligados aos tópicos
  const PARTE_MAX = 120;                         // tópico com PDF longo é dividido em partes de até 2h
  const PADRAO_DISC = { peso: 2, nivel: 2, ativa: true };
  const NOMES_PESO = { 1: 'Baixo', 2: 'Médio', 3: 'Alto' };
  const NOMES_NIVEL = { 1: 'Iniciante', 2: 'Intermediário', 3: 'Avançado' };
  const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  /* =============================================
     ESTADO
  ============================================= */
  let remoto = false;
  let metas = [];
  let revisoes = [];
  let planos = [];
  let semanaVista = null;
  let configAberta = false;
  let contextoConclusao = null;
  let incidencias = [];       // { topico_id, edital_id, disciplina_id, questoes } (planilha do TEC)
  let incPorTopico = {};
  let remotoInc = false;
  let materiais = [];         // PDFs de estudo ligados aos tópicos (ver MATERIAL)
  let pagPorTopico = {};
  let remotoMat = false;

  const TABELAS = { metas: () => metas, revisoes: () => revisoes, plano_estudos: () => planos };

  /* =============================================
     DATAS
  ============================================= */
  const hoje = () => dataLocal();

  function somarDias(str, n) {
    const d = new Date(str + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return dataLocal(d);
  }

  function segundaDe(str) {
    const dow = new Date(str + 'T12:00:00').getDay();
    return somarDias(str, dow === 0 ? -6 : 1 - dow);
  }

  function diasEntre(a, b) {
    return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
  }

  function diaDaSemana(str) {
    return new Date(str + 'T12:00:00').getDay();
  }

  function fmtData(str) {
    const [, m, d] = str.split('-');
    return `${d}/${m}`;
  }

  function fmtMin(min) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    if (h === 0) return `${m}min`;
    return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  }

  function novoId(prefixo) {
    return prefixo + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* =============================================
     PERSISTÊNCIA
  ============================================= */
  function lerLocal(tabela) {
    try { return JSON.parse(localStorage.getItem('est_plano_' + tabela)) || []; }
    catch { return []; }
  }

  function salvarLocal(tabela) {
    if (!TABELAS[tabela]) return;
    try { localStorage.setItem('est_plano_' + tabela, JSON.stringify(TABELAS[tabela]())); }
    catch (e) { console.warn('Não foi possível salvar no localStorage:', e); }
  }

  async function gravar(tabela, linhas) {
    const lista = Array.isArray(linhas) ? linhas : [linhas];
    if (!lista.length) return;
    if (!remoto) { salvarLocal(tabela); return; }
    const onConflict = tabela === 'plano_estudos' ? 'edital_id' : 'id';
    let { error } = await sb.from(tabela).upsert(lista, { onConflict });
    if (error && tabela === 'metas' && /parte|paginas_lidas/.test(error.message || '')) {
      // Tabela criada antes das colunas parte/partes/paginas_lidas: grava sem elas até o SQL ser rodado de novo
      console.warn('Colunas parte/partes/paginas_lidas ausentes em metas; rode supabase/estudos-plano.sql de novo.');
      ({ error } = await sb.from(tabela).upsert(lista.map(({ parte, partes, paginas_lidas, ...m }) => m), { onConflict }));
    }
    if (error) {
      console.error(`Erro ao salvar em ${tabela}:`, error);
      aviso('Não foi possível salvar no servidor. Confira sua conexão.');
    }
  }

  async function apagar(tabela, ids) {
    if (!ids.length) return;
    if (!remoto) { salvarLocal(tabela); return; }
    const { error } = await sb.from(tabela).delete().in('id', ids);
    if (error) console.error(`Erro ao apagar de ${tabela}:`, error);
  }

  function sessaoParaLinha(s) {
    return {
      id: s.id, data: s.date, criado_em: s.timestamp,
      edital_id: s.editalId || null, disciplina_id: s.discId || null, topico_id: s.topicId || null,
      disciplina: s.discipline || '', topico: s.topic || '',
      minutos: s.timeMinutes || 0, questoes: s.questionsTotal || 0, acertos: s.questionsCorrect || 0,
      tipo: s.tipo || 'estudo', meta_concluida: !!s.metaDone
    };
  }

  function linhaParaSessao(r) {
    return {
      id: r.id, date: r.data, timestamp: r.criado_em,
      editalId: r.edital_id, discId: r.disciplina_id, topicId: r.topico_id,
      discipline: r.disciplina, topic: r.topico,
      timeMinutes: r.minutos, questionsTotal: r.questoes, questionsCorrect: r.acertos,
      tipo: r.tipo, metaDone: r.meta_concluida
    };
  }

  /* Carrega tudo em paralelo. Chamado pelo estudos.v5.js depois de loadEditais(). */
  async function init() {
    let resultado;
    try {
      resultado = await Promise.all(
        ['sessoes', 'metas', 'revisoes', 'plano_estudos'].map(t => sb.from(t).select('*'))
      );
      const falha = resultado.find(r => r.error);
      if (falha) throw falha.error;
      remoto = true;
    } catch (e) {
      console.warn('Tabelas do plano indisponíveis no Supabase; usando só este navegador.', e);
      remoto = false;
      metas = lerLocal('metas');
      revisoes = lerLocal('revisoes');
      planos = lerLocal('plano_estudos');
      await carregarExtras();
      garantirSemanaAtual();
      return;
    }

    const [rSessoes, rMetas, rRevisoes, rPlanos] = resultado.map(r => r.data || []);
    metas = rMetas;
    revisoes = rRevisoes;
    planos = rPlanos;

    // Primeira vez com as tabelas no ar: envia o que estava só neste navegador.
    if (!localStorage.getItem('est_plano_migrado')) {
      const idsRemotos = new Set(rSessoes.map(r => r.id));
      const soLocais = studyData.filter(s => !idsRemotos.has(s.id));
      const pendentes = [['sessoes', soLocais.map(sessaoParaLinha)]];
      Object.keys(TABELAS).forEach(t => {
        const chave = t === 'plano_estudos' ? 'edital_id' : 'id';
        const ids = new Set(TABELAS[t]().map(x => x[chave]));
        const locais = lerLocal(t).filter(x => !ids.has(x[chave]));
        TABELAS[t]().push(...locais);
        pendentes.push([t, locais]);
      });
      let ok = true;
      for (const [tabela, linhas] of pendentes) {
        if (!linhas.length) continue;
        const onConflict = tabela === 'plano_estudos' ? 'edital_id' : 'id';
        const { error } = await sb.from(tabela).upsert(linhas, { onConflict });
        if (error) { ok = false; console.error(`Erro ao migrar ${tabela}:`, error); }
      }
      if (ok) {
        localStorage.setItem('est_plano_migrado', '1');
        Object.keys(TABELAS).forEach(t => localStorage.removeItem('est_plano_' + t));
      }
      studyData = [...rSessoes.map(linhaParaSessao), ...soLocais];
    } else {
      studyData = rSessoes.map(linhaParaSessao);
    }
    saveData();
    await carregarExtras();
    garantirSemanaAtual();
  }

  /* =============================================
     TABELAS OPCIONAIS (incidencias e materiais)
     Carregadas à parte: se uma delas ainda não existir no Supabase, só os dados
     dela ficam neste navegador; o resto do plano continua sincronizando.
  ============================================= */
  async function carregarOpcional(tabela, chave) {
    if (remoto) {
      const { data, error } = await sb.from(tabela).select('*');
      if (!error) {
        const linhas = data || [];
        // Envia o que tinha sido guardado só aqui antes de a tabela existir
        const locais = lerLocal(tabela).filter(l => !linhas.some(r => r[chave] === l[chave]));
        if (locais.length) {
          const r = await sb.from(tabela).upsert(locais, { onConflict: chave });
          if (!r.error) { linhas.push(...locais); localStorage.removeItem('est_plano_' + tabela); }
        } else {
          localStorage.removeItem('est_plano_' + tabela);
        }
        return { linhas, remoto: true };
      }
      console.warn(`Tabela ${tabela} indisponível; esses dados ficam só neste navegador.`, error);
    }
    return { linhas: lerLocal(tabela), remoto: false };
  }

  /* Substitui as linhas de uma disciplina. "todas" é a lista completa, guardada no
     localStorage quando a tabela não existe no Supabase. */
  async function gravarDaDisciplina(tabela, chave, ehRemoto, discId, linhas, todas) {
    if (!ehRemoto) {
      try { localStorage.setItem('est_plano_' + tabela, JSON.stringify(todas)); } catch (e) { console.warn(e); }
      return true;
    }
    const r1 = await sb.from(tabela).delete().eq('disciplina_id', discId);
    const r2 = linhas.length ? await sb.from(tabela).upsert(linhas, { onConflict: chave }) : { error: null };
    if (r1.error || r2.error) {
      console.error(`Erro ao salvar em ${tabela}:`, r1.error || r2.error);
      return false;
    }
    return true;
  }

  async function carregarExtras() {
    const [inc, mat] = await Promise.all([carregarOpcional('incidencias', 'topico_id'), carregarOpcional('materiais', 'id')]);
    incidencias = inc.linhas;
    remotoInc = inc.remoto;
    materiais = mat.linhas;
    remotoMat = mat.remoto;
    indexarIncidencias();
    pagPorTopico = contarPaginas(materiais);
  }

  /* =============================================
     INCIDÊNCIA (planilha do TEC, importada por estudos.incidencia.js)
  ============================================= */
  function indexarIncidencias() {
    incPorTopico = {};
    incidencias.forEach(r => { incPorTopico[r.topico_id] = r.questoes; });
  }

  function incidenciaDaDisciplina(d) {
    let soma = 0;
    d.topicos.forEach(t => { soma += incPorTopico[t.id] || 0; });
    return soma > 0 ? { soma, media: soma / d.topicos.length } : null;
  }

  /* % das questões da disciplina que caíram no tópico, ou null se a disciplina não tem incidência */
  function pctIncidencia(topicId) {
    const ref = acharTopico(topicId);
    const inc = ref && incidenciaDaDisciplina(ref.d);
    return inc ? ((incPorTopico[topicId] || 0) / inc.soma) * 100 : null;
  }

  async function salvarIncidencias(edital, disc, porTopico) {
    const ids = new Set(disc.topicos.map(t => t.id));
    const linhas = Object.entries(porTopico).map(([topico_id, questoes]) => ({
      topico_id, edital_id: edital.id, disciplina_id: disc.id, questoes: Math.round(questoes),
      atualizado_em: new Date().toISOString()
    }));
    incidencias = incidencias.filter(r => r.disciplina_id !== disc.id && !ids.has(r.topico_id)).concat(linhas);
    indexarIncidencias();
    const ok = await gravarDaDisciplina('incidencias', 'topico_id', remotoInc, disc.id, linhas, incidencias);
    renderTudo();
    aviso(ok ? 'Incidência salva. As próximas semanas já usam; clique em ↻ Regerar para refazer esta semana.'
      : 'Não foi possível salvar a incidência no servidor.');
  }

  /* =============================================
     MATERIAL (PDFs ligados aos tópicos, por estudos.materiais.js)
     Cada material: { id, edital_id, disciplina_id, nome, paginas, topicos: [{ topico_id, de, ate }] }.
     Só o nome e o número de páginas são guardados; o PDF fica no computador do usuário.
  ============================================= */

  /* Páginas de cada tópico. Um PDF ligado a vários tópicos usa a faixa de páginas
     informada em cada ligação; as ligações sem faixa dividem igualmente o que sobra. */
  function contarPaginas(lista) {
    const r = {};
    lista.forEach(m => {
      const total = m.paginas || 0;
      const faixa = l => (l.de > 0 && l.ate >= l.de ? Math.min(l.ate, total || l.ate) - l.de + 1 : 0);
      const links = (m.topicos || []).filter(l => l.topico_id);
      const usadas = links.reduce((a, l) => a + faixa(l), 0);
      const semFaixa = links.filter(l => !faixa(l)).length;
      const resto = semFaixa ? Math.max(0, total - usadas) / semFaixa : 0;
      links.forEach(l => { r[l.topico_id] = (r[l.topico_id] || 0) + (faixa(l) || resto); });
    });
    return r;
  }

  function materiaisDaDisciplina(discId) {
    return materiais.filter(m => m.disciplina_id === discId);
  }

  function paginasDoTopico(topicId) {
    return pagPorTopico[topicId] || 0;
  }

  /* Ordem de estudo dos tópicos de uma disciplina. Com incidência do TEC, vem primeiro o
     que rende mais questões por página: muito cobrado e pouco material. Tópico sem PDF
     conta com a mediana de páginas da disciplina. Sem incidência, fica a ordem do edital.
     "lista" permite simular materiais ainda não salvos (tela de materiais). */
  function prioridadeDosTopicos(d, lista) {
    const pags = lista ? contarPaginas(lista) : pagPorTopico;
    const inc = incidenciaDaDisciplina(d);
    const conhecidas = d.topicos.map(t => pags[t.id]).filter(p => p > 0).sort((a, b) => a - b);
    const mediana = conhecidas.length ? conhecidas[Math.floor(conhecidas.length / 2)] : 0;
    const itens = d.topicos.map((t, i) => {
      const questoes = incPorTopico[t.id] || 0;
      const paginas = pags[t.id] > 0 ? Math.round(pags[t.id]) : 0;
      const efetivas = paginas || mediana || 1;
      return { t, i, questoes, paginas, estimado: !paginas && mediana > 0, porPagina: questoes / efetivas, efetivas };
    });
    if (inc) itens.sort((a, b) => b.porPagina - a.porPagina || a.efetivas - b.efetivas || a.i - b.i);
    return { itens, comIncidencia: !!inc, comPaginas: conhecidas.length > 0, mediana };
  }

  async function salvarMateriais(edital, disc, lista) {
    const linhas = lista.map(m => ({
      id: m.id, edital_id: edital.id, disciplina_id: disc.id, nome: m.nome, paginas: m.paginas || 0,
      topicos: (m.topicos || []).filter(l => l.topico_id)
        .map(l => ({ topico_id: l.topico_id, de: Number(l.de) || null, ate: Number(l.ate) || null })),
      criado_em: m.criado_em || new Date().toISOString()
    }));
    materiais = materiais.filter(m => m.disciplina_id !== disc.id).concat(linhas);
    pagPorTopico = contarPaginas(materiais);
    const ok = await gravarDaDisciplina('materiais', 'id', remotoMat, disc.id, linhas, materiais);
    renderTudo();
    aviso(ok ? 'Material salvo. As próximas semanas já usam; clique em ↻ Regerar para refazer esta semana.'
      : 'Não foi possível salvar o material no servidor.');
  }

  /* =============================================
     CONSULTAS
  ============================================= */
  function editalAtivo() {
    return editaisData.find(e => e.id === currentEditalId) || editaisData[0] || null;
  }

  function planoDe(editalId) {
    return planos.find(p => p.edital_id === editalId) || null;
  }

  function configDisc(plano, discId) {
    return { ...PADRAO_DISC, ...((plano && plano.disciplinas && plano.disciplinas[discId]) || {}) };
  }

  function acharTopico(topicId) {
    for (const e of editaisData) {
      for (const d of e.disciplinas) {
        const t = d.topicos.find(x => x.id === topicId);
        if (t) return { e, d, t };
      }
    }
    return null;
  }

  function pctTopico(t) {
    return t.questoesFeitas > 0 ? Math.round((t.questoesCertas / t.questoesFeitas) * 100) : null;
  }

  /* Revisões de um tópico, da mais antiga para a mais nova (Edital Verticalizado) */
  function revisoesDoTopico(topicId) {
    return revisoes.filter(r => r.topico_id === topicId)
      .sort((a, b) => (a.concluida_em || a.data_prevista).localeCompare(b.concluida_em || b.data_prevista));
  }

  function revisaoPendente(topicId) {
    return revisoes.find(r => r.topico_id === topicId && !r.concluida_em);
  }

  function metasDaSemana(editalId, semana) {
    return metas.filter(m => m.edital_id === editalId && m.semana === semana);
  }

  function minutosEstudados(inicio, fim) {
    return studyData
      .filter(s => s.date >= inicio && s.date <= fim)
      .reduce((a, s) => a + (s.timeMinutes || 0), 0);
  }

  /* Usado pelo card "Metas concluídas" da visão geral */
  window.resumoSemanaPlano = function () {
    const e = editalAtivo();
    if (!e) return null;
    const lista = metasDaSemana(e.id, segundaDe(hoje()));
    return { feitas: lista.filter(m => m.concluida).length, total: lista.length };
  };

  /* =============================================
     GERAÇÃO DAS METAS DA SEMANA
  ============================================= */
  function diaDeEstudo(plano, dia) {
    while (!plano.dias_semana.includes(diaDaSemana(dia))) dia = somarDias(dia, 1);
    return dia;
  }

  /* Acerto médio da disciplina, usado para prever quantas revisões um tópico ainda vai gerar */
  function acertoEsperado(disc) {
    if (!disc) return null;
    const q = disc.topicos.reduce((a, t) => a + (t.questoesFeitas || 0), 0);
    const c = disc.topicos.reduce((a, t) => a + (t.questoesCertas || 0), 0);
    return q >= 10 ? Math.round((c / q) * 100) : null;
  }

  function reservar(ctx, dia, minutos, item) {
    ctx.reservas[dia] = (ctx.reservas[dia] || 0) + minutos;
    ctx.contagem[dia] = (ctx.contagem[dia] || 0) + 1;
    if (item) (ctx.itens[dia] = ctx.itens[dia] || []).push(item);
  }

  /* Simula as revisões que um tópico estudado em "dia" vai gerar, com o acerto esperado,
     até ficar dominado, e as coloca no planejamento respeitando o limite diário. */
  function reservarRevisoes(ctx, plano, dia, pct, topicoId, discId) {
    const limite = minutosPorDia(plano) * LIMITE_REVISAO_DIA;
    let d = dia, etapa = 0, intervalo = 0;
    for (let i = 0; i < 12; i++) {
      const prox = proximaRevisao(etapa, intervalo, pct);
      if (!prox) break;
      let alvo = diaDeEstudo(plano, somarDias(d, prox.intervalo));
      for (let k = 0; k < 14 && (ctx.reservas[alvo] || 0) + prox.minutos > limite; k++) {
        alvo = diaDeEstudo(plano, somarDias(alvo, 1));
      }
      reservar(ctx, alvo, prox.minutos, {
        topico_id: topicoId, disciplina_id: discId, tipo: prox.tipo, etapa: prox.etapa,
        minutos: prox.minutos, data_prevista: alvo, previsto: true
      });
      d = alvo;
      etapa = prox.etapa;
      intervalo = prox.intervalo;
      if (prox.tipo === 'reforco') pct = ACERTO_REFORCO; // supõe que o reforço resolve
    }
  }

  /* Páginas já lidas do tópico: a maior marcação feita ao concluir uma meta ("Páginas lidas
     deste assunto"). Metas antigas, sem marcação, contam pelo tempo (PAGINAS_POR_HORA). */
  function paginasLidas(topicId) {
    const feitas = metas.filter(m => m.topico_id === topicId && m.concluida);
    const marcadas = feitas.filter(m => m.paginas_lidas !== null && m.paginas_lidas !== undefined);
    const lidas = marcadas.length
      ? Math.max(...marcadas.map(m => m.paginas_lidas))
      : Math.round(feitas.reduce((a, m) => a + m.minutos, 0) * PAGINAS_POR_HORA / 60);
    return Math.min(lidas, Math.round(paginasDoTopico(topicId)));
  }

  /* Estado do planejamento: minutos planejados e ainda não feitos de cada tópico, metas já
     feitas ou planejadas (para numerar as partes), tempo reservado para revisões por dia e
     minutos já dados a cada disciplina (para o rodízio). */
  function novoContexto(edital, plano, semanaBase) {
    const ctx = { planejado: {}, partesFeitas: {}, reservas: {}, contagem: {}, itens: {}, alocado: {} };
    const h = hoje();
    revisoes.filter(r => r.edital_id === edital.id && !r.concluida_em).forEach(r => {
      reservar(ctx, r.data_prevista < h ? h : r.data_prevista, r.minutos || MIN_REVISAO);
    });
    const contarParte = m => { ctx.partesFeitas[m.topico_id] = (ctx.partesFeitas[m.topico_id] || 0) + 1; };
    metas.filter(m => m.edital_id === edital.id && m.semana < semanaBase && m.concluida).forEach(contarParte);
    metasDaSemana(edital.id, semanaBase).forEach(m => {
      contarParte(m);
      if (!m.concluida) ctx.planejado[m.topico_id] = (ctx.planejado[m.topico_id] || 0) + m.minutos;
      ctx.alocado[m.disciplina_id] = (ctx.alocado[m.disciplina_id] || 0) + m.minutos;
      // As revisões só começam depois da última parte do tópico
      if (!m.concluida && (!m.partes || m.parte >= m.partes)) {
        reservarRevisoes(ctx, plano, m.dia, acertoEsperado(edital.disciplinas.find(d => d.id === m.disciplina_id)), m.topico_id, m.disciplina_id);
      }
    });
    return ctx;
  }

  /* Tempo do tópico sem PDF: o bloco do nível ajustado pela incidência
     (0,5× quando quase não cai, 1× na média da disciplina, até 1,5×) */
  function blocoDoTopico(x, t) {
    if (!x.inc) return x.base;
    const r = (incPorTopico[t.id] || 0) / x.inc.media;
    return Math.max(30, Math.round((x.base * Math.min(1.5, Math.max(0.5, 0.5 + 0.5 * r))) / 15) * 15);
  }

  /* Minutos que ainda faltam planejar do tópico.
     Com PDF: o tempo de leitura das páginas que faltam (PAGINAS_POR_HORA), menos o que já
     está planejado. O tópico só sai do plano quando o usuário marca "Terminei este PDF"
     (fica estudado); se as páginas acabaram sem essa marcação, entra uma meta curta para fechar.
     Sem PDF: qualquer meta já cobre o tópico inteiro. */
  function faltaDoTopico(ctx, x, t) {
    if (t.estudado) return 0;
    const pags = Math.round(paginasDoTopico(t.id));
    if (!pags) return ctx.partesFeitas[t.id] ? 0 : blocoDoTopico(x, t);
    const restantes = Math.max(0, pags - paginasLidas(t.id));
    const leitura = Math.max(15, Math.ceil((restantes / PAGINAS_POR_HORA) * 60 / 15) * 15);
    const falta = leitura - (ctx.planejado[t.id] || 0);
    return falta >= 15 ? falta : 0;
  }

  /* Próxima meta do tópico: { minutos, parte, partes }. Com PDF, o que falta é dividido por
     igual em partes de até PARTE_MAX. */
  function proximaParte(ctx, x, t) {
    const falta = faltaDoTopico(ctx, x, t);
    if (!paginasDoTopico(t.id)) return { minutos: falta, parte: 1, partes: 1 };
    const parte = (ctx.partesFeitas[t.id] || 0) + 1;
    const resto = Math.ceil(falta / PARTE_MAX);
    return { minutos: resto <= 1 ? falta : Math.round(falta / resto), parte, partes: parte - 1 + resto };
  }
  function filaDoTopico(plano, d) {
    const cfg = configDisc(plano, d.id);
    const inc = incidenciaDaDisciplina(d);
    // Com incidência do TEC, primeiro o que mais cai por página de material
    const ordem = inc ? prioridadeDosTopicos(d).itens.map(x => x.t) : d.topicos;
    return { d, cfg, inc, prioridade: cfg.peso * (4 - cfg.nivel), base: BLOCO_MIN[cfg.nivel] || 90, acerto: acertoEsperado(d), ordem };
  }

  /* Monta uma semana. A disciplina da vez é a que recebeu menos tempo em relação à sua
     prioridade (peso × (4 − nível)): as de peso alto andam mais rápido, mas todas giram,
     como num ciclo de estudos. Cada meta vai para o primeiro dia em que cabe; um tópico
     grande vira várias metas (partes), na sequência. */
  function planejarSemana(edital, plano, semana, ctx) {
    const h = hoje();
    const dias = [];
    for (let i = 0; i < 7; i++) {
      const dia = somarDias(semana, i);
      if (dia >= h && plano.dias_semana.includes(diaDaSemana(dia))) dias.push(dia);
    }
    if (!dias.length) return [];

    const porDia = minutosPorDia(plano);
    const usado = {};
    metasDaSemana(edital.id, semana).forEach(m => { usado[m.dia] = (usado[m.dia] || 0) + m.minutos; });
    const cabe = (dia, min) => {
      const livre = Math.max(0, porDia - (ctx.reservas[dia] || 0));
      const u = usado[dia] || 0;
      return u + min <= livre * 1.15 || (u === 0 && livre >= min / 2);
    };

    const fila = edital.disciplinas
      .map(d => filaDoTopico(plano, d))
      .filter(x => x.cfg.ativa)
      .map(x => ({ ...x, pendentes: x.ordem.filter(t => faltaDoTopico(ctx, x, t) > 0) }))
      .filter(x => x.pendentes.length);
    const vez = x => ((ctx.alocado[x.d.id] || 0) + proximaParte(ctx, x, x.pendentes[0]).minutos) / x.prioridade;

    const novas = [];
    while (fila.length) {
      fila.sort((a, b) => vez(a) - vez(b));
      const x = fila[0];
      const t = x.pendentes[0];
      const p = proximaParte(ctx, x, t);
      // Partes do mesmo tópico ficam em ordem: nunca antes do dia da parte anterior
      const depoisDe = p.parte > 1 ? (novas.filter(m => m.topico_id === t.id).pop() || {}).dia : null;
      const dia = dias.find(d => (!depoisDe || d > depoisDe) && cabe(d, p.minutos));
      if (!dia) { fila.shift(); continue; }   // não cabe mais nesta semana
      usado[dia] = (usado[dia] || 0) + p.minutos;
      ctx.alocado[x.d.id] = (ctx.alocado[x.d.id] || 0) + p.minutos;
      ctx.planejado[t.id] = (ctx.planejado[t.id] || 0) + p.minutos;
      ctx.partesFeitas[t.id] = (ctx.partesFeitas[t.id] || 0) + 1;
      const ultima = faltaDoTopico(ctx, x, t) === 0;
      if (ultima) {
        x.pendentes.shift();
        reservarRevisoes(ctx, plano, dia, x.acerto, t.id, x.d.id);
      }
      novas.push({
        id: novoId('m'), edital_id: edital.id, semana, dia,
        disciplina_id: x.d.id, topico_id: t.id,
        tipo: 'estudo', minutos: p.minutos, concluida: false, ordem: novas.length,
        ...(p.partes > 1 || p.parte > 1 ? { parte: p.parte, partes: p.partes } : {})
      });
      if (!x.pendentes.length) fila.shift();
    }
    return novas;
  }
  function gerarSemana(edital, semana) {
    const plano = planoDe(edital.id);
    if (!plano || !plano.dias_semana || !plano.dias_semana.length) return [];
    return planejarSemana(edital, plano, semana, novoContexto(edital, plano, semana));
  }

  /* Previsão das próximas semanas até cobrir todo o edital. Não é gravada: é refeita a cada
     tela, a partir do progresso real, então se ajusta sozinha a atrasos e adiantamentos. */
  function projetar(edital) {
    const plano = planoDe(edital.id);
    if (!plano || !plano.dias_semana || !plano.dias_semana.length) return null;
    const atual = segundaDe(hoje());
    const ctx = novoContexto(edital, plano, atual);
    const ativas = edital.disciplinas.filter(d => configDisc(plano, d.id).ativa);
    const filas = ativas.map(d => filaDoTopico(plano, d));
    const restantes = () => filas.reduce((a, x) => a + x.d.topicos.filter(t => faltaDoTopico(ctx, x, t) > 0).length, 0);
    const foraDoPlano = edital.disciplinas.filter(d => !configDisc(plano, d.id).ativa)
      .reduce((a, d) => a + d.topicos.filter(t => !t.estudado).length, 0);

    const semanas = [];
    for (let i = 1; i <= 156 && restantes() > 0; i++) {
      const s = somarDias(atual, 7 * i);
      semanas.push({ semana: s, metas: planejarSemana(edital, plano, s, ctx).map(m => ({ ...m, previsto: true })) });
    }
    const somaSemana = (mapa, s) => {
      let n = 0;
      for (let i = 0; i < 7; i++) n += mapa[somarDias(s, i)] || 0;
      return n;
    };
    const revisoesNa = s => somaSemana(ctx.contagem, s);
    const minutosRevisaoNa = s => somaSemana(ctx.reservas, s);
    semanas.forEach(w => { w.revisoes = revisoesNa(w.semana); w.minRevisao = minutosRevisaoNa(w.semana); });

    const abertasAtual = metasDaSemana(edital.id, atual).filter(m => !m.concluida);
    const todas = [...abertasAtual, ...semanas.flatMap(w => w.metas)];
    const fim = todas.length ? todas.reduce((a, m) => (m.dia > a ? m.dia : a), todas[0].dia) : null;
    return {
      semanas, fim, restantes: restantes(), foraDoPlano,
      itens: ctx.itens, contagem: ctx.contagem, revisoesNa, minutosRevisaoNa
    };
  }

  /* Gera a semana atual automaticamente, se o plano existe e ela ainda está vazia */
  function garantirSemanaAtual() {
    const e = editalAtivo();
    if (!e || !planoDe(e.id)) return;
    const semana = segundaDe(hoje());
    if (metasDaSemana(e.id, semana).length) return;
    const novas = gerarSemana(e, semana);
    if (!novas.length) return;
    metas.push(...novas);
    gravar('metas', novas);
  }

  async function regerarSemana() {
    const e = editalAtivo();
    if (!e) return;
    const semana = segundaDe(hoje());
    const abertas = metasDaSemana(e.id, semana).filter(m => !m.concluida);
    const ids = new Set(abertas.map(m => m.id));
    metas = metas.filter(m => !ids.has(m.id));
    await apagar('metas', [...ids]);
    const novas = gerarSemana(e, semana);
    metas.push(...novas);
    await gravar('metas', novas);
    semanaVista = semana;
    renderTudo();
    aviso(novas.length ? `${novas.length} metas geradas para esta semana.` : 'Não há tópicos pendentes para gerar metas.');
  }

  /* =============================================
     REVISÕES ADAPTATIVAS
  ============================================= */
  function fatorIntervalo(pct) {
    if (pct === null) return 2.5;          // revisão sem questões: meio-termo
    if (pct >= ACERTO_OTIMO) return 4;
    if (pct >= ACERTO_BOM) return 3;
    return 2;
  }

  function minutosRevisao(pct) {
    return pct !== null && pct >= 90 ? MIN_REVISAO_RAPIDA : MIN_REVISAO;
  }

  /* intervaloAnterior = dias até a revisão que acabou de ser feita (0 = tópico recém-estudado).
     Devolve null quando o tópico está dominado. */
  function proximaRevisao(etapaAtual, intervaloAnterior, pct) {
    if (pct !== null && pct < ACERTO_REFORCO) {
      return { tipo: 'reforco', etapa: etapaAtual, intervalo: etapaAtual === 0 ? 1 : 2, minutos: MIN_REFORCO };
    }
    const intervalo = intervaloAnterior
      ? Math.round(intervaloAnterior * fatorIntervalo(pct))
      : (pct !== null && pct >= ACERTO_BOM ? 2 : 1);
    if (intervalo > INTERVALO_MAX) return null;
    return { tipo: 'revisao', etapa: etapaAtual + 1, intervalo, minutos: minutosRevisao(pct) };
  }

  function minutosPorDia(plano) {
    return (Number(plano.horas_semana) * 60) / plano.dias_semana.length;
  }

  function cargaRevisoes(editalId, dia, ignorarId) {
    return revisoes
      .filter(r => r.edital_id === editalId && !r.concluida_em && r.data_prevista === dia && r.id !== ignorarId)
      .reduce((a, r) => a + (r.minutos || MIN_REVISAO), 0);
  }

  /* Primeiro dia de estudo, a partir de "dia", em que a revisão cabe no limite diário.
     É isso que impede as revisões de se acumularem num dia só. */
  function diaComFolga(editalId, dia, minutos, ignorarId) {
    const plano = planoDe(editalId);
    if (!plano || !plano.dias_semana || !plano.dias_semana.length) return dia;
    const limite = minutosPorDia(plano) * LIMITE_REVISAO_DIA;
    const primeiro = diaDeEstudo(plano, dia);
    let d = primeiro;
    for (let i = 0; i < 14; i++) {
      if (cargaRevisoes(editalId, d, ignorarId) + minutos <= limite) return d;
      d = diaDeEstudo(plano, somarDias(d, 1));
    }
    return primeiro;
  }

  /* anterior = revisão que acabou de ser concluída, ou null se o tópico acabou de ser estudado */
  function agendarRevisao(ref, anterior, pct) {
    const prox = proximaRevisao(anterior ? anterior.etapa : 0, anterior ? (anterior.intervalo || 1) : 0, pct);
    if (!prox) return null;
    const r = {
      id: novoId('r'), edital_id: ref.e.id, disciplina_id: ref.d.id, topico_id: ref.t.id,
      etapa: prox.etapa, tipo: prox.tipo, intervalo: prox.intervalo, minutos: prox.minutos,
      data_prevista: diaComFolga(ref.e.id, somarDias(hoje(), prox.intervalo), prox.minutos),
      concluida_em: null, acerto: null
    };
    revisoes.push(r);
    gravar('revisoes', r);
    return r;
  }

  /* Chamado quando um tópico é concluído (checkbox do edital, sessão ou meta) */
  async function topicoConcluido(topicId, pct) {
    const ref = acharTopico(topicId);
    if (!ref) return;
    const abertas = metas.filter(m => m.topico_id === topicId && !m.concluida);
    abertas.forEach(m => { m.concluida = true; });
    if (abertas.length) gravar('metas', abertas);
    if (!revisaoPendente(topicId)) {
      agendarRevisao(ref, null, pct === undefined || pct === null ? pctTopico(ref.t) : pct);
    }
    renderTudo();
  }

  function agendarReforco(topicId) {
    const ref = acharTopico(topicId);
    if (!ref || revisaoPendente(topicId)) return;
    const etapa = Math.max(0, ...revisoes.filter(r => r.topico_id === topicId && r.concluida_em).map(r => r.etapa));
    const r = {
      id: novoId('r'), edital_id: ref.e.id, disciplina_id: ref.d.id, topico_id: topicId,
      etapa, tipo: 'reforco', intervalo: 1, minutos: MIN_REFORCO,
      data_prevista: diaComFolga(ref.e.id, somarDias(hoje(), 1), MIN_REFORCO),
      concluida_em: null, acerto: null
    };
    revisoes.push(r);
    gravar('revisoes', r);
    renderTudo();
    aviso(`Reforço agendado para ${fmtData(r.data_prevista)}.`);
  }

  /* Tópicos marcados como estudados antes do plano existir */
  function topicosSemRevisao(edital) {
    const comRevisao = new Set(revisoes.map(r => r.topico_id));
    const lista = [];
    edital.disciplinas.forEach(d => d.topicos.forEach(t => {
      if (t.estudado && !comRevisao.has(t.id)) lista.push({ e: edital, d, t });
    }));
    return lista;
  }

  function agendarEstudados() {
    const e = editalAtivo();
    if (!e) return;
    // Uma a uma, para cada revisão já contar no limite diário da seguinte
    const novas = topicosSemRevisao(e).map(ref => {
      const pct = pctTopico(ref.t);
      const prox = proximaRevisao(0, 0, pct);
      const r = {
        id: novoId('r'), edital_id: e.id, disciplina_id: ref.d.id, topico_id: ref.t.id,
        etapa: prox.etapa, tipo: prox.tipo, intervalo: prox.intervalo, minutos: prox.minutos,
        data_prevista: diaComFolga(e.id, somarDias(hoje(), 1), prox.minutos),
        concluida_em: null, acerto: null
      };
      revisoes.push(r);
      return r;
    });
    gravar('revisoes', novas);
    renderTudo();
    aviso(`${novas.length} revisões agendadas.`);
  }

  function adiarRevisao(id) {
    const r = revisoes.find(x => x.id === id);
    if (!r) return;
    r.data_prevista = diaComFolga(r.edital_id, somarDias(hoje(), 1), r.minutos || MIN_REVISAO, r.id);
    gravar('revisoes', r);
    renderTudo();
  }

  async function removerMeta(id) {
    metas = metas.filter(m => m.id !== id);
    await apagar('metas', [id]);
    renderTudo();
  }

  /* =============================================
     SESSÕES (ganchos chamados pelo estudos.v5.js)
  ============================================= */
  function sessaoCriada(s) {
    if (remoto) gravar('sessoes', sessaoParaLinha(s));
  }

  function sessaoRemovida(id) {
    if (remoto) {
      sb.from('sessoes').delete().eq('id', id).then(({ error }) => {
        if (error) console.error('Erro ao apagar sessão:', error);
      });
    }
  }

  /* =============================================
     MODAL: CONCLUIR META OU REVISÃO
  ============================================= */
  /* Janela de estudo (estudos.sessao.js): cronômetro e resumo do tópico */
  function abrirEstudo(tipo, id) {
    const item = tipo === 'meta' ? metas.find(m => m.id === id) : revisoes.find(r => r.id === id);
    if (!item || !window.estSessao) return;
    const ref = acharTopico(item.topico_id);
    if (!ref) { aviso('Este tópico não existe mais no edital.'); return; }
    const rotulo = tipo === 'meta'
      ? 'Estudo' + (item.partes > 1 ? ` · parte ${item.parte}/${item.partes}` : '')
      : rotuloRevisao(item);
    window.estSessao.abrir({
      tipo, id, disc: ref.d.nome, topico: ref.t.nome, rotulo,
      minutos: tipo === 'meta' ? item.minutos : item.minutos || MIN_REVISAO,
      concluida: tipo === 'meta' ? !!item.concluida : !!item.concluida_em
    });
  }

  /* minutosCrono: tempo do cronômetro da janela de estudo, quando houver */
  function abrirConclusao(tipo, id, minutosCrono = 0) {
    const item = tipo === 'meta' ? metas.find(m => m.id === id) : revisoes.find(r => r.id === id);
    if (!item) return;
    const ref = acharTopico(item.topico_id);
    if (!ref) { aviso('Este tópico não existe mais no edital.'); return; }
    contextoConclusao = { tipo, id };

    const titulo = tipo === 'meta' ? 'Concluir meta'
      : item.tipo === 'reforco' ? 'Concluir reforço' : `Concluir revisão ${item.etapa}`;
    document.getElementById('est-concluir-titulo').textContent = titulo;
    document.getElementById('est-concluir-topico').textContent = `${ref.d.nome} — ${ref.t.nome}`;
    // Tópico com PDF: pergunta até onde leu; só "Terminei este PDF" fecha o tópico
    const totalPags = tipo === 'meta' ? Math.round(paginasDoTopico(item.topico_id)) : 0;
    const lidas = totalPags ? paginasLidas(item.topico_id) : 0;
    const alvo = Math.min(totalPags, lidas + Math.round(item.minutos / 60 * PAGINAS_POR_HORA));
    contextoConclusao.totalPags = totalPags;
    document.getElementById('est-concluir-pdf').style.display = totalPags ? '' : 'none';
    if (totalPags) {
      document.getElementById('est-concluir-pag').max = totalPags;
      document.getElementById('est-concluir-pag').value = alvo;
      document.getElementById('est-concluir-pag-total').textContent = `de ${totalPags} páginas`;
      document.getElementById('est-concluir-terminei').checked = alvo >= totalPags;
    }
    const parte = item.partes > 1 ? `Parte ${item.parte} de ${item.partes}. ` : '';
    document.getElementById('est-concluir-dica').textContent = totalPags
      ? `${parte}Leia até a página ${alvo} (${lidas ? `você parou na ${lidas}` : 'começando do início'}). Ao terminar o assunto, marque "Terminei este PDF": só então a primeira revisão é agendada, conforme o seu acerto.`
      : tipo === 'meta'
      ? 'Teoria e caderno de questões do tópico. Ao concluir, a primeira revisão é agendada conforme o seu acerto.'
      : `Refaça o caderno do TEC deste tópico. Quanto maior o acerto, mais longe fica a próxima revisão; abaixo de ${ACERTO_REFORCO}% entra um reforço.`;

    const minutos = minutosCrono || (window.estSessao && window.estSessao.minutosDe(id)) ||
      (tipo === 'meta' ? item.minutos : item.minutos || MIN_REVISAO);
    document.getElementById('est-concluir-h').value = Math.floor(minutos / 60) || '';
    document.getElementById('est-concluir-m').value = minutos % 60 || '';
    document.getElementById('est-concluir-q').value = '';
    document.getElementById('est-concluir-c').value = '';
    document.getElementById('est-concluir-tec').value = ref.t.tecLink || '';
    document.getElementById('est-modal-concluir').classList.add('active');
  }

  function fecharConclusao() {
    document.getElementById('est-modal-concluir').classList.remove('active');
    contextoConclusao = null;
  }

  async function salvarConclusao() {
    const ctx = contextoConclusao;
    if (!ctx) return;
    const item = ctx.tipo === 'meta' ? metas.find(m => m.id === ctx.id) : revisoes.find(r => r.id === ctx.id);
    const ref = item && acharTopico(item.topico_id);
    if (!ref) { fecharConclusao(); return; }
    const { e, d, t } = ref;

    const val = id => parseInt(document.getElementById(id).value, 10) || 0;
    const minutos = val('est-concluir-h') * 60 + val('est-concluir-m');
    const questoes = val('est-concluir-q');
    const acertos = Math.min(val('est-concluir-c'), questoes);
    const tecLink = document.getElementById('est-concluir-tec').value.trim();
    const pct = questoes > 0 ? Math.round((acertos / questoes) * 100) : null;

    // Atualiza o tópico do edital
    t.tempoGasto = (t.tempoGasto || 0) + minutos;
    t.questoesFeitas = (t.questoesFeitas || 0) + questoes;
    t.questoesCertas = (t.questoesCertas || 0) + acertos;
    if (tecLink) t.tecLink = tecLink;
    const atualizacao = {
      tempo_gasto: t.tempoGasto, questoes_feitas: t.questoesFeitas,
      questoes_certas: t.questoesCertas, tec_link: t.tecLink || ''
    };
    // Tópico com PDF: guarda até onde leu; sem "Terminei este PDF", ele continua no plano
    const comPdf = ctx.tipo === 'meta' && ctx.totalPags > 0;
    const terminou = !comPdf || document.getElementById('est-concluir-terminei').checked;
    const parcial = !terminou;
    if (comPdf) item.paginas_lidas = terminou ? ctx.totalPags : Math.min(ctx.totalPags, val('est-concluir-pag'));
    if (ctx.tipo === 'meta' && !parcial) { t.estudado = true; atualizacao.estudado = true; }
    saveEditais();
    fecharConclusao();
    if (window.estSessao) window.estSessao.zerarCrono(ctx.id);

    // Registra a sessão no histórico
    const sessao = {
      id: novoId('s'), date: hoje(), timestamp: new Date().toISOString(),
      editalId: e.id, discId: d.id, topicId: t.id, discipline: d.nome, topic: t.nome,
      timeMinutes: minutos, questionsTotal: questoes, questionsCorrect: acertos,
      tipo: ctx.tipo === 'meta' ? 'estudo' : item.tipo, metaDone: ctx.tipo === 'meta' && !parcial
    };
    studyData.push(sessao);
    saveData();
    sessaoCriada(sessao);

    if (ctx.tipo === 'meta') {
      item.concluida = true;
      gravar('metas', item);
      if (parcial) {
        // O número de partes muda com o ritmo real: atualiza o "de N" das partes já na semana
        const abertas = metas.filter(m => m.topico_id === t.id && !m.concluida && m.partes);
        const proj = projetar(e);
        const ultima = proj && proj.semanas.flatMap(w => w.metas).filter(m => m.topico_id === t.id).pop();
        const total = ultima ? ultima.partes : Math.max(item.parte || 1, ...abertas.map(m => m.parte || 1));
        abertas.forEach(m => { m.partes = total; });
        if (abertas.length) gravar('metas', abertas);
        aviso(`Progresso salvo: ${item.paginas_lidas} de ${ctx.totalPags} páginas. O restante continua no plano.`);
      } else {
        // Terminou antes do previsto: as partes que sobraram saem do plano
        const sobras = metas.filter(m => m.topico_id === t.id && !m.concluida && m.id !== item.id).map(m => m.id);
        if (sobras.length) { metas = metas.filter(m => !sobras.includes(m.id)); apagar('metas', sobras); }
        topicoConcluido(t.id, pct);
      }
    } else {
      item.concluida_em = hoje();
      item.acerto = pct;
      gravar('revisoes', item);
      const prox = agendarRevisao(ref, item, pct);
      aviso(prox
        ? `${prox.tipo === 'reforco' ? 'Reforço' : 'Próxima revisão'} em ${fmtData(prox.data_prevista)}.`
        : 'Tópico dominado: ele sai da fila de revisões! 🎉');
    }

    const { error } = await sb.from('topicos').update(atualizacao).eq('id', t.id);
    if (error) console.error('Erro ao atualizar tópico:', error);

    renderDashboard();
    renderEdital();
    renderTudo();
  }

  function initModal() {
    const overlay = document.getElementById('est-modal-concluir');
    if (!overlay) return;
    document.getElementById('est-modal-concluir-close').addEventListener('click', fecharConclusao);
    overlay.addEventListener('click', ev => { if (ev.target === overlay) fecharConclusao(); });
    // "Páginas lidas" e "Terminei este PDF" andam juntos
    const pag = document.getElementById('est-concluir-pag');
    const terminei = document.getElementById('est-concluir-terminei');
    pag.addEventListener('input', () => {
      const total = contextoConclusao && contextoConclusao.totalPags;
      if (total) terminei.checked = (parseInt(pag.value, 10) || 0) >= total;
    });
    terminei.addEventListener('change', () => {
      const total = contextoConclusao && contextoConclusao.totalPags;
      if (total && terminei.checked) pag.value = total;
      else if (total && (parseInt(pag.value, 10) || 0) >= total) pag.value = Math.max(0, total - 1);
    });
    document.getElementById('est-concluir-form').addEventListener('submit', ev => {
      ev.preventDefault();
      salvarConclusao();
    });
  }

  /* =============================================
     RENDERIZAÇÃO: COMPONENTES
  ============================================= */
  function aviso(msg) {
    let el = document.getElementById('est-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'est-toast';
      el.className = 'est-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 3500);
  }

  function bannerLocal() {
    if (remoto) return '';
    return `<div class="est-plano-banner">⚠️ As tabelas do plano ainda não existem no Supabase, então estes dados estão
      só neste navegador. Rode <code>supabase/estudos-plano.sql</code> e depois <code>supabase/rls.sql</code>.</div>`;
  }

  function rotuloRevisao(r) {
    return r.tipo === 'reforco' ? 'Reforço' : `Revisão ${r.etapa}`;
  }

  function classeAcerto(pct) {
    if (pct === null) return '';
    return pct < ACERTO_REFORCO ? 'ruim' : pct < ACERTO_BOM ? 'medio' : 'bom';
  }

  function botaoTec(t) {
    return t && t.tecLink
      ? `<a class="est-plano-btn" href="${escapeHtml(t.tecLink)}" target="_blank" rel="noopener" title="Abrir caderno do TEC">TEC ↗</a>`
      : '';
  }

  function seloIncidencia(topicId) {
    const pct = pctIncidencia(topicId);
    if (pct === null) return '';
    const txt = pct >= 1 ? Math.round(pct) + '%' : pct > 0 ? '<1%' : '0%';
    return ` · <span class="est-plano-inc ${pct >= 10 ? 'alta' : pct < 2 ? 'baixa' : ''}" title="${pct.toFixed(1).replace('.', ',')}% das questões da disciplina no TEC">📊 ${txt}</span>`;
  }

  function seloPaginas(topicId) {
    const p = Math.round(paginasDoTopico(topicId));
    if (!p) return '';
    const lidas = paginasLidas(topicId);
    return lidas
      ? ` · <span title="Páginas lidas de ${p}">📄 ${lidas}/${p} p.</span>`
      : ` · <span title="Páginas de material ligadas a este tópico">📄 ${p} p.</span>`;
  }

  // Torna a parte de texto do item clicável (abre a janela de estudo)
  function abreEstudo(tipo, id) {
    return ` role="button" tabindex="0" title="Abrir cronômetro e resumo"
      onclick="estPlano.abrirEstudo('${tipo}', '${id}')"
      onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); estPlano.abrirEstudo('${tipo}', '${id}'); }"`;
  }

  function seloCrono(item) {
    return !item.previsto && !item.concluida && window.estSessao ? window.estSessao.selo(item.id) : '';
  }

  function itemMeta(m, { compacto = false } = {}) {
    const ref = acharTopico(m.topico_id);
    const disc = ref ? ref.d.nome : 'Disciplina removida';
    const top = ref ? ref.t.nome : 'Tópico removido';
    const atrasada = !m.concluida && !m.previsto && m.dia < hoje();
    const tag = (m.previsto ? 'Previsto' : m.concluida ? '✓ Feito' : atrasada ? 'Atrasada' : 'Estudo') +
      (m.partes > 1 ? ` · parte ${m.parte}/${m.partes}` : '');
    return `
      <div class="est-plano-item tipo-estudo ${m.concluida ? 'feito' : ''} ${m.previsto ? 'previsto' : ''}">
        <div class="est-plano-item-info"${m.previsto ? '' : abreEstudo('meta', m.id)}>
          <span class="est-plano-tag">${tag} · ${fmtMin(m.minutos)}${seloIncidencia(m.topico_id)}${seloPaginas(m.topico_id)}${seloCrono(m)}</span>
          <span class="est-plano-item-disc">${escapeHtml(disc)}</span>
          <span class="est-plano-item-top" title="${escapeHtml(top)}">${escapeHtml(top)}</span>
        </div>
        ${m.concluida || m.previsto ? '' : `
        <div class="est-plano-item-acoes">
          ${compacto ? '' : `<button class="est-plano-btn sutil" onclick="estPlano.removerMeta('${m.id}')" title="Remover meta" aria-label="Remover meta">✕</button>`}
          ${botaoTec(ref && ref.t)}
          <button class="est-plano-btn primario" onclick="estPlano.abrirConclusao('meta', '${m.id}')">Concluir</button>
        </div>`}
      </div>`;
  }

  function itemRevisao(r) {
    const ref = acharTopico(r.topico_id);
    const disc = ref ? ref.d.nome : 'Disciplina removida';
    const top = ref ? ref.t.nome : 'Tópico removido';
    const atraso = diasEntre(r.data_prevista, hoje());
    const pct = ref ? pctTopico(ref.t) : null;
    const quando = r.previsto ? 'previsto' : atraso > 0 ? `${atraso} dia${atraso > 1 ? 's' : ''} de atraso` : fmtData(r.data_prevista);
    return `
      <div class="est-plano-item tipo-${r.tipo} ${r.previsto ? 'previsto' : ''}">
        <div class="est-plano-item-info"${r.previsto ? '' : abreEstudo('revisao', r.id)}>
          <span class="est-plano-tag">${rotuloRevisao(r)} · ${fmtMin(r.minutos || MIN_REVISAO)} · ${quando}${r.previsto ? '' : seloCrono(r)}</span>
          <span class="est-plano-item-disc">${escapeHtml(disc)}</span>
          <span class="est-plano-item-top" title="${escapeHtml(top)}">${escapeHtml(top)}
            ${pct !== null && !r.previsto ? `<span class="est-plano-acerto ${classeAcerto(pct)}">${pct}%</span>` : ''}</span>
        </div>
        ${r.previsto ? '' : `<div class="est-plano-item-acoes">
          <button class="est-plano-btn sutil" onclick="estPlano.adiarRevisao('${r.id}')" title="Adiar para amanhã">Adiar</button>
          ${botaoTec(ref && ref.t)}
          <button class="est-plano-btn primario" onclick="estPlano.abrirConclusao('revisao', '${r.id}')">Concluir</button>
        </div>`}
      </div>`;
  }

  function barra(pct, cor = 'green') {
    return `<div class="est-progress-mini"><div class="est-progress-mini-fill ${cor}" style="width:${Math.min(100, Math.max(0, pct))}%"></div></div>`;
  }

  /* =============================================
     VISÃO GERAL: PLANO DE HOJE
  ============================================= */
  function renderHoje() {
    const el = document.getElementById('est-plano-hoje');
    if (!el) return;
    const e = editalAtivo();
    if (!e) { el.innerHTML = ''; return; }
    const plano = planoDe(e.id);
    if (!plano) {
      el.innerHTML = `
        <div class="est-plano-cta">
          <div>
            <strong>Monte seu plano semanal</strong>
            <p>Informe suas horas por semana e o peso de cada disciplina: o painel gera as metas de cada dia e agenda as revisões sozinho.</p>
          </div>
          <button class="est-btn-register" onclick="navigateTo('metas')">Configurar plano</button>
        </div>`;
      return;
    }

    const h = hoje();
    const semana = segundaDe(h);
    const daSemana = metasDaSemana(e.id, semana);
    const metasHoje = daSemana.filter(m => m.dia === h || (m.dia < h && !m.concluida));
    const revHoje = revisoes
      .filter(r => r.edital_id === e.id && !r.concluida_em && r.data_prevista <= h)
      .sort((a, b) => a.data_prevista.localeCompare(b.data_prevista));
    const estudado = minutosEstudados(semana, somarDias(semana, 6));
    const metaMin = Number(plano.horas_semana) * 60;
    const feitas = daSemana.filter(m => m.concluida).length;
    const pendentes = metasHoje.filter(m => !m.concluida).length + revHoje.length;

    el.innerHTML = `
      <div class="est-plano-hoje">
        <div class="est-plano-hoje-head">
          <div>
            <h2 class="est-activity-title">Plano de hoje</h2>
            <span class="est-plano-sub">${pendentes ? `${pendentes} atividade${pendentes > 1 ? 's' : ''} pendente${pendentes > 1 ? 's' : ''}` : 'Tudo feito por hoje 🎉'}</span>
          </div>
          <div class="est-plano-semana-resumo">
            <span>Semana: <strong>${fmtMin(estudado)}</strong> de ${fmtMin(metaMin)} · <strong>${feitas}</strong>/${daSemana.length} metas</span>
            ${barra(metaMin ? (estudado / metaMin) * 100 : 0, estudado >= metaMin ? 'green' : 'blue')}
          </div>
        </div>
        <div class="est-plano-lista">
          ${revHoje.map(itemRevisao).join('')}
          ${metasHoje.map(m => itemMeta(m, { compacto: true })).join('')}
          ${!revHoje.length && !metasHoje.length ? '<p class="est-plano-vazio">Nenhuma meta para hoje. Veja a semana em “Planejamento Semanal”.</p>' : ''}
        </div>
      </div>`;
  }

  /* =============================================
     SEÇÃO: METAS DA SEMANA
  ============================================= */
  function htmlConfig(e, plano) {
    const p = plano || { horas_semana: 20, dias_semana: [1, 2, 3, 4, 5, 6], disciplinas: {} };
    const opcoes = (nomes, atual) => Object.entries(nomes)
      .map(([v, n]) => `<option value="${v}" ${Number(v) === Number(atual) ? 'selected' : ''}>${n}</option>`).join('');
    return `
      <form class="est-plano-card est-plano-config" id="est-plano-config-form">
        <h3 class="est-plano-card-title">⚙️ Configuração do plano — ${escapeHtml(e.titulo)}</h3>
        <div class="est-plano-config-linha">
          <div class="est-form-group">
            <label class="est-form-label" for="est-plano-horas">Horas de estudo por semana</label>
            <input type="number" id="est-plano-horas" class="est-form-input" min="1" max="100" step="0.5" value="${p.horas_semana}" required />
          </div>
          <div class="est-form-group">
            <span class="est-form-label">Dias de estudo</span>
            <div class="est-plano-dias">
              ${[1, 2, 3, 4, 5, 6, 0].map(d => `
                <label><input type="checkbox" name="dia" value="${d}" ${p.dias_semana.includes(d) ? 'checked' : ''}/><span>${DIAS_CURTOS[d]}</span></label>`).join('')}
            </div>
          </div>
        </div>
        <p class="est-plano-sub">Disciplinas com <strong>peso alto</strong> e <strong>nível iniciante</strong> recebem mais metas. O nível também define o tempo de cada tópico (iniciante ${fmtMin(BLOCO_MIN[1])}, intermediário ${fmtMin(BLOCO_MIN[2])}, avançado ${fmtMin(BLOCO_MIN[3])}).</p>
        <div class="est-plano-tabela-wrap">
          <table class="est-plano-tabela">
            <thead><tr><th>Disciplina</th><th>Peso na prova</th><th>Seu nível</th><th>Incidência (TEC)</th><th>Material (PDF)</th><th>Incluir</th></tr></thead>
            <tbody>
              ${e.disciplinas.map(d => {
                const c = configDisc(plano, d.id);
                return `<tr data-disc="${d.id}">
                  <td>${escapeHtml(d.nome)}</td>
                  <td><select class="est-form-select" name="peso">${opcoes(NOMES_PESO, c.peso)}</select></td>
                  <td><select class="est-form-select" name="nivel">${opcoes(NOMES_NIVEL, c.nivel)}</select></td>
                  <td>${(() => {
                    const inc = incidenciaDaDisciplina(d);
                    return `<button type="button" class="est-plano-btn ${inc ? '' : 'primario'}" onclick="estIncidencia.abrir('${e.id}', '${d.id}')">
                      ${inc ? `✓ ${inc.soma} questões · trocar` : '📊 Importar'}</button>`;
                  })()}</td>
                  <td>${(() => {
                    const lista = materiaisDaDisciplina(d.id);
                    const pags = lista.reduce((a, m) => a + (m.paginas || 0), 0);
                    return `<button type="button" class="est-plano-btn ${lista.length ? '' : 'primario'}" onclick="estMateriais.abrir('${e.id}', '${d.id}')">
                      ${lista.length ? `✓ ${lista.length} PDF${lista.length > 1 ? 's' : ''} · ${pags} p.` : '📚 PDFs'}</button>`;
                  })()}</td>
                  <td><input type="checkbox" name="ativa" ${c.ativa ? 'checked' : ''} aria-label="Incluir ${escapeHtml(d.nome)}"/></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div class="est-plano-config-acoes">
          ${plano ? '<button type="button" class="est-btn-cancelar" onclick="estPlano.alternarConfig()">Cancelar</button>' : ''}
          <button type="submit" class="est-btn-register">Salvar e gerar a semana</button>
        </div>
      </form>`;
  }

  async function salvarConfig(form, e) {
    const dias = [...form.querySelectorAll('input[name="dia"]:checked')].map(x => Number(x.value));
    if (!dias.length) { aviso('Escolha pelo menos um dia de estudo.'); return; }
    const disciplinas = {};
    form.querySelectorAll('tr[data-disc]').forEach(tr => {
      disciplinas[tr.dataset.disc] = {
        peso: Number(tr.querySelector('[name="peso"]').value),
        nivel: Number(tr.querySelector('[name="nivel"]').value),
        ativa: tr.querySelector('[name="ativa"]').checked
      };
    });
    const linha = {
      edital_id: e.id,
      horas_semana: Number(form.querySelector('#est-plano-horas').value) || 20,
      dias_semana: dias,
      disciplinas,
      atualizado_em: new Date().toISOString()
    };
    planos = planos.filter(p => p.edital_id !== e.id);
    planos.push(linha);
    await gravar('plano_estudos', linha);
    configAberta = false;
    await regerarSemana();
  }

  function fmtDataLonga(str) {
    const [a, m, d] = str.split('-');
    return `${d}/${m}/${a}`;
  }

  /* Frase com a data em que o plano termina o edital, comparada com a prova */
  function resumoProjecao(projecao) {
    if (!projecao) return '';
    const fora = projecao.foraDoPlano
      ? ` ${projecao.foraDoPlano} tópico${projecao.foraDoPlano > 1 ? 's' : ''} de disciplinas fora do plano não entram na conta.` : '';
    if (projecao.restantes > 0) {
      return `Com as horas atuais, o plano não cobre o edital em 3 anos: aumente as horas por semana.${fora}`;
    }
    if (!projecao.fim) return `Todos os tópicos das disciplinas do plano já foram estudados. Agora o foco é revisar e fazer questões.${fora}`;
    const semanas = Math.max(1, Math.ceil((diasEntre(segundaDe(hoje()), projecao.fim) + 1) / 7));
    const folga = diasEntre(projecao.fim, getTargetDate());
    return `Pelo planejamento, o último tópico novo é estudado em <strong>${fmtDataLonga(projecao.fim)}</strong>
      (${semanas} semana${semanas > 1 ? 's' : ''}, já reservando tempo para as revisões),
      ${folga >= 0
        ? `<span class="est-plano-acerto bom">${folga} dias antes da prova</span>.`
        : `<span class="est-plano-acerto ruim">${-folga} dias depois da prova</span>. Aumente as horas semanais ou desmarque disciplinas de peso baixo.`}${fora}`;
  }

  function htmlCronograma(e, plano, projecao, atual) {
    if (!projecao) return '';
    const prova = getTargetDate();
    const nomeDisc = id => (e.disciplinas.find(d => d.id === id) || { nome: '?' }).nome;
    const linha = (semana, lista, revs, minRev, rotulo) => {
      const porDisc = {};
      lista.forEach(m => { porDisc[m.disciplina_id] = (porDisc[m.disciplina_id] || 0) + 1; });
      const discs = Object.entries(porDisc).sort((a, b) => b[1] - a[1]);
      const min = lista.reduce((a, m) => a + m.minutos, 0) + minRev;
      return `
        <tr class="${semana === semanaVista ? 'atual' : ''} ${somarDias(semana, 6) > prova ? 'apos-prova' : ''}" onclick="estPlano.irParaSemana('${semana}')" tabindex="0"
          onkeydown="if(event.key==='Enter')estPlano.irParaSemana('${semana}')">
          <td><strong>${fmtData(semana)} – ${fmtData(somarDias(semana, 6))}</strong>${rotulo ? ` <span class="est-plano-sub">${rotulo}</span>` : ''}</td>
          <td>${lista.length || '—'}</td>
          <td>${revs || '—'}</td>
          <td>${min ? fmtMin(min) : '—'}</td>
          <td class="est-plano-chips">${discs.slice(0, 4).map(([id, n]) => `<span>${escapeHtml(nomeDisc(id))}${n > 1 ? ` ×${n}` : ''}</span>`).join('')}${discs.length > 4 ? `<span>+${discs.length - 4}</span>` : ''}</td>
        </tr>`;
    };
    let ultima = projecao.semanas.length;
    while (ultima > 0 && !projecao.semanas[ultima - 1].metas.length) ultima--;
    return `
      <div class="est-plano-card">
        <h3 class="est-plano-card-title">📆 Planejamento até o fim do edital</h3>
        <p class="est-plano-texto" style="margin-bottom: 14px;">${resumoProjecao(projecao)}</p>
        <div class="est-plano-tabela-wrap">
          <table class="est-plano-tabela est-plano-cronograma">
            <thead><tr><th>Semana</th><th>Tópicos novos</th><th>Revisões</th><th>Tempo total</th><th>Disciplinas dos tópicos novos</th></tr></thead>
            <tbody>
              ${linha(atual, metasDaSemana(e.id, atual), projecao.revisoesNa(atual), projecao.minutosRevisaoNa(atual), 'atual')}
              ${projecao.semanas.slice(0, ultima).map(w => linha(w.semana, w.metas, w.revisoes, w.minRevisao, '')).join('')}
            </tbody>
          </table>
        </div>
        <p class="est-plano-sub" style="margin-top: 10px;">Clique numa semana para ver os dias. Semanas em vermelho terminam depois da data da prova (${fmtDataLonga(prova)}).</p>
      </div>`;
  }

  function renderMetas() {
    const el = document.getElementById('est-plano-metas');
    if (!el) return;
    const e = editalAtivo();
    if (!e) {
      el.innerHTML = '<p class="est-plano-vazio">Cadastre um edital em “Edital Verticalizado” para montar o plano.</p>';
      return;
    }
    const plano = planoDe(e.id);
    const h = hoje();
    const atual = segundaDe(h);
    if (!semanaVista) semanaVista = atual;
    const projecao = plano ? projetar(e) : null;
    const prevista = semanaVista > atual;
    const semanaPrevista = prevista && projecao ? projecao.semanas.find(w => w.semana === semanaVista) : null;
    const lista = prevista ? (semanaPrevista ? semanaPrevista.metas : []) : metasDaSemana(e.id, semanaVista);
    const fim = somarDias(semanaVista, 6);
    const metaMin = plano ? Number(plano.horas_semana) * 60 : 0;

    // Revisões fazem parte do mesmo planejamento: as já agendadas e as previstas pela projeção
    const revisoesDoDia = dia => {
      if (dia < h) return [];
      const reais = revisoes.filter(r => r.edital_id === e.id && !r.concluida_em &&
        (r.data_prevista === dia || (dia === h && r.data_prevista < h)));
      const previstas = projecao ? (projecao.itens[dia] || []) : [];
      return [...reais, ...previstas];
    };
    const dias = [];
    for (let i = 0; i < 7; i++) dias.push(somarDias(semanaVista, i));
    const revSemana = dias.flatMap(revisoesDoDia);
    const revFeitas = revisoes.filter(r => r.edital_id === e.id && r.concluida_em && r.concluida_em >= semanaVista && r.concluida_em <= fim).length;
    const minPrevistos = lista.filter(m => !m.concluida).reduce((a, m) => a + m.minutos, 0) +
      revSemana.reduce((a, r) => a + (r.minutos || MIN_REVISAO), 0);
    const estudado = prevista ? minPrevistos : minutosEstudados(semanaVista, fim);
    const semRevisao = plano ? topicosSemRevisao(e) : [];

    el.innerHTML = `
      ${bannerLocal()}
      <div class="est-plano-topo">
        <div>
          <h2 class="est-plano-titulo">🗓️ Planejamento Semanal</h2>
          <span class="est-plano-sub">${escapeHtml(e.titulo)} · troque o edital em “Edital Verticalizado”</span>
        </div>
        <div class="est-plano-topo-acoes">
          <div class="est-plano-nav">
            <button class="est-plano-btn" onclick="estPlano.mudarSemana(-1)" aria-label="Semana anterior">◀</button>
            <span>${fmtData(semanaVista)} – ${fmtData(fim)}</span>
            <button class="est-plano-btn" onclick="estPlano.mudarSemana(1)" aria-label="Próxima semana">▶</button>
          </div>
          ${plano ? `<button class="est-plano-btn" onclick="estPlano.alternarConfig()">⚙️ Plano</button>` : ''}
          ${plano && semanaVista === atual ? `<button class="est-plano-btn" onclick="estPlano.regerarSemana()" title="Refaz as metas não concluídas desta semana">↻ Regerar</button>` : ''}
        </div>
      </div>

      ${!plano || configAberta ? htmlConfig(e, plano) : ''}

      ${plano ? `
      <div class="est-plano-kpis">
        ${prevista ? `
        <div class="est-plano-kpi"><span>Tempo previsto</span><strong>${fmtMin(estudado)} <small>/ ${fmtMin(metaMin)}</small></strong>${barra(metaMin ? estudado / metaMin * 100 : 0, 'blue')}</div>
        <div class="est-plano-kpi"><span>Tópicos novos</span><strong>${lista.length}</strong></div>
        <div class="est-plano-kpi"><span>Revisões</span><strong>${revSemana.length}</strong></div>` : `
        <div class="est-plano-kpi"><span>Horas na semana</span><strong>${fmtMin(estudado)} <small>/ ${fmtMin(metaMin)}</small></strong>${barra(metaMin ? estudado / metaMin * 100 : 0, 'blue')}</div>
        <div class="est-plano-kpi"><span>Tópicos novos</span><strong>${lista.filter(m => m.concluida).length} <small>/ ${lista.length}</small></strong>${barra(lista.length ? lista.filter(m => m.concluida).length / lista.length * 100 : 0)}</div>
        <div class="est-plano-kpi"><span>Revisões</span><strong>${revFeitas} <small>/ ${revFeitas + revSemana.length}</small></strong>${barra(revFeitas + revSemana.length ? revFeitas / (revFeitas + revSemana.length) * 100 : 0, 'amber')}</div>`}
      </div>

      ${semRevisao.length ? `
      <div class="est-plano-cta">
        <div>
          <strong>${semRevisao.length} tópico${semRevisao.length > 1 ? 's' : ''} estudado${semRevisao.length > 1 ? 's' : ''} sem revisão no plano</strong>
          <p>Foram marcados antes do plano existir. Coloco a primeira revisão deles no planejamento a partir de amanhã, sem passar do limite diário.</p>
        </div>
        <button class="est-btn-register" onclick="estPlano.agendarEstudados()">Incluir no plano</button>
      </div>` : ''}

      ${prevista ? `<p class="est-plano-vazio">${lista.length || revSemana.length
        ? 'Previsão: os tópicos novos são confirmados quando a semana começar, e as revisões mudam conforme o seu acerto até lá.'
        : 'Nada previsto para esta semana: nessa altura o edital já foi estudado e as revisões dos tópicos acabaram.'}</p>` : ''}
      ${semanaVista === atual && !lista.length ? '<p class="est-plano-vazio">Nenhum tópico novo nesta semana: todos os tópicos das disciplinas incluídas já estão estudados, ou não sobraram dias de estudo.</p>' : ''}

      <div class="est-plano-semana">
        ${dias.map(dia => {
          const doDia = lista.filter(m => m.dia === dia).sort((a, b) => a.ordem - b.ordem);
          const revDia = revisoesDoDia(dia);
          const previsto = doDia.filter(m => !m.concluida).reduce((a, m) => a + m.minutos, 0) +
            revDia.reduce((a, r) => a + (r.minutos || MIN_REVISAO), 0);
          const feito = prevista ? 0 : minutosEstudados(dia, dia);
          const folga = !plano.dias_semana.includes(diaDaSemana(dia));
          const resumo = [feito ? fmtMin(feito) + ' feitos' : '', previsto ? fmtMin(previsto) + ' previstos' : '']
            .filter(Boolean).join(' · ') || (folga ? 'folga' : '');
          return `
            <div class="est-plano-dia ${dia === h ? 'hoje' : ''} ${dia < h ? 'passado' : ''}">
              <div class="est-plano-dia-head">
                <strong>${DIAS_CURTOS[diaDaSemana(dia)]} ${fmtData(dia)}</strong>
                <span>${resumo}</span>
              </div>
              ${doDia.map(m => itemMeta(m)).join('')}
              ${revDia.map(itemRevisao).join('')}
              ${!revDia.length && !doDia.length ? '<span class="est-plano-dia-vazio">—</span>' : ''}
            </div>`;
        }).join('')}
      </div>

      ${htmlCronograma(e, plano, projecao, atual)}

      <p class="est-plano-sub est-plano-regra">Como as revisões entram no plano: cada tópico estudado volta para revisão; o intervalo
        dobra com acerto de ${ACERTO_REFORCO}% a ${ACERTO_BOM - 1}%, triplica de ${ACERTO_BOM}% a ${ACERTO_OTIMO - 1}% e quadruplica
        a partir de ${ACERTO_OTIMO}%. Abaixo de ${ACERTO_REFORCO}% entra um reforço. Quando o intervalo passaria de ${INTERVALO_MAX} dias,
        o tópico está dominado e sai do plano. Revisões ocupam no máximo ${LIMITE_REVISAO_DIA * 100}% do tempo de cada dia.
        Nas disciplinas com incidência do TEC, entra primeiro o tópico com mais questões por página de material.
        Tópico com PDF ligado leva o tempo de leitura (${PAGINAS_POR_HORA} páginas por hora), em partes de até ${fmtMin(PARTE_MAX)}.</p>` : ''}
    `;

    const form = document.getElementById('est-plano-config-form');
    if (form) form.addEventListener('submit', ev => { ev.preventDefault(); salvarConfig(form, e); });
  }

  /* =============================================
     SEÇÃO: DESEMPENHO
  ============================================= */
  function graficoSemanas(semanas, metaMin) {
    const W = 560, H = 200, base = 170, topo = 20;
    const max = Math.max(metaMin, ...semanas.map(s => s.min), 60);
    const larg = W / semanas.length;
    const y = v => base - (v / max) * (base - topo);
    const barras = semanas.map((s, i) => {
      const x = i * larg + larg * 0.2;
      const w = larg * 0.6;
      const cor = metaMin && s.min >= metaMin ? '#4ade80' : '#60a5fa';
      return `
        <rect x="${x}" y="${y(s.min)}" width="${w}" height="${base - y(s.min)}" rx="4" fill="${cor}" opacity="0.85"><title>${fmtMin(s.min)}</title></rect>
        <text x="${x + w / 2}" y="${y(s.min) - 5}" text-anchor="middle" fill="#c8ccd4" font-size="11">${s.min ? String(Math.round(s.min / 6) / 10).replace('.', ',') + 'h' : ''}</text>
        <text x="${x + w / 2}" y="${base + 18}" text-anchor="middle" fill="#8892a4" font-size="11">${fmtData(s.inicio)}</text>`;
    }).join('');
    const linha = metaMin ? `
      <line x1="0" x2="${W}" y1="${y(metaMin)}" y2="${y(metaMin)}" stroke="#fbbf24" stroke-dasharray="5 4" stroke-width="1.5"/>
      <text x="${W - 4}" y="${y(metaMin) - 6}" text-anchor="end" fill="#fbbf24" font-size="11">meta ${fmtMin(metaMin)}</text>` : '';
    return `<svg class="est-plano-grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Horas estudadas por semana">
      <line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="rgba(200,204,212,0.15)"/>${barras}${linha}</svg>`;
  }

  function previsao(e, plano) {
    let pendentes = 0;
    e.disciplinas.forEach(d => d.topicos.forEach(t => { if (!t.estudado) pendentes++; }));
    if (!pendentes) return 'Todos os tópicos do edital já foram estudados. Agora o foco é revisar e fazer questões.';

    // Pelo plano: a mesma projeção semana a semana do quadro de Metas
    const partes = [];
    if (plano) partes.push(resumoProjecao(projetar(e)));

    // Pelo ritmo real das últimas 4 semanas, para comparar com o plano
    const desde = somarDias(hoje(), -28);
    const concluidos = new Set([
      ...studyData.filter(s => s.metaDone && s.topicId && s.date >= desde).map(s => s.topicId),
      ...metas.filter(m => m.edital_id === e.id && m.concluida && m.dia >= desde).map(m => m.topico_id)
    ]);
    const ritmo = concluidos.size / 4;
    if (ritmo) {
      const fim = somarDias(hoje(), Math.ceil((pendentes / ritmo) * 7));
      const folga = diasEntre(fim, getTargetDate());
      partes.push(`No seu ritmo real das últimas 4 semanas (${ritmo.toFixed(1).replace('.', ',')} tópicos por semana),
        os ${pendentes} tópicos restantes terminam em <strong>${fmtDataLonga(fim)}</strong>,
        ${folga >= 0
          ? `<span class="est-plano-acerto bom">${folga} dias antes da prova</span>.`
          : `<span class="est-plano-acerto ruim">${-folga} dias depois da prova</span>.`}`);
    }
    if (!partes.length) return `Faltam ${pendentes} tópicos. Monte o plano em “Planejamento Semanal” para ver quando o edital termina.`;
    return partes.join('<br><br>');
  }

  function renderDesempenho() {
    const el = document.getElementById('est-plano-desempenho');
    if (!el) return;
    const e = editalAtivo();
    const plano = e ? planoDe(e.id) : null;
    const metaMin = plano ? Number(plano.horas_semana) * 60 : 0;
    const h = hoje();
    const atual = segundaDe(h);

    const semanas = [];
    for (let i = 7; i >= 0; i--) {
      const inicio = somarDias(atual, -7 * i);
      semanas.push({ inicio, min: minutosEstudados(inicio, somarDias(inicio, 6)) });
    }
    const ult7 = minutosEstudados(somarDias(h, -6), h);
    const diasComEstudo = new Set(studyData.filter(s => s.date >= somarDias(h, -6) && s.timeMinutes > 0).map(s => s.date)).size;
    const atrasadas = revisoes.filter(r => !r.concluida_em && r.data_prevista < h).length;
    const feitas = revisoes.filter(r => r.concluida_em);
    const revAcerto = feitas.filter(r => r.acerto !== null && r.acerto !== undefined);
    const mediaRev = revAcerto.length ? Math.round(revAcerto.reduce((a, r) => a + r.acerto, 0) / revAcerto.length) : null;

    let linhasDisc = '';
    let fracos = [];
    if (e) {
      linhasDisc = e.disciplinas.map(d => {
        const total = d.topicos.length;
        const done = d.topicos.filter(t => t.estudado).length;
        const min = d.topicos.reduce((a, t) => a + (t.tempoGasto || 0), 0);
        const q = d.topicos.reduce((a, t) => a + (t.questoesFeitas || 0), 0);
        const c = d.topicos.reduce((a, t) => a + (t.questoesCertas || 0), 0);
        const pct = q ? Math.round((c / q) * 100) : null;
        return `<tr>
          <td>${escapeHtml(d.nome)}</td>
          <td><div class="est-plano-celula-barra"><span>${done}/${total}</span>${barra(total ? done / total * 100 : 0)}</div></td>
          <td>${min ? fmtMin(min) : '—'}</td>
          <td>${q || '—'}</td>
          <td>${pct !== null ? `<span class="est-plano-acerto ${classeAcerto(pct)}">${pct}%</span>` : '—'}</td>
        </tr>`;
      }).join('');
      e.disciplinas.forEach(d => d.topicos.forEach(t => {
        const pct = pctTopico(t);
        if (t.questoesFeitas >= 10 && pct < ACERTO_BOM) fracos.push({ d, t, pct });
      }));
      fracos = fracos.sort((a, b) => a.pct - b.pct).slice(0, 10);
    }

    el.innerHTML = `
      ${bannerLocal()}
      <div class="est-plano-topo">
        <div>
          <h2 class="est-plano-titulo">📈 Desempenho</h2>
          <span class="est-plano-sub">${e ? escapeHtml(e.titulo) : 'Sem edital'}</span>
        </div>
      </div>

      <div class="est-plano-kpis">
        <div class="est-plano-kpi"><span>Esta semana</span><strong>${fmtMin(semanas[7].min)}${metaMin ? ` <small>/ ${fmtMin(metaMin)}</small>` : ''}</strong>${metaMin ? barra(semanas[7].min / metaMin * 100, 'blue') : ''}</div>
        <div class="est-plano-kpi"><span>Média diária (7 dias)</span><strong>${fmtMin(ult7 / 7)}</strong><small>${diasComEstudo} de 7 dias com estudo</small></div>
        <div class="est-plano-kpi"><span>Acerto nas revisões</span><strong>${mediaRev !== null ? mediaRev + '%' : '—'}</strong><small>${feitas.length} revisões feitas</small></div>
        <div class="est-plano-kpi ${atrasadas ? 'alerta' : ''}"><span>Revisões atrasadas</span><strong>${atrasadas}</strong></div>
      </div>

      ${e ? `<div class="est-plano-card"><h3 class="est-plano-card-title">🔮 Previsão</h3><p class="est-plano-texto">${previsao(e, plano)}</p></div>` : ''}

      <div class="est-plano-card">
        <h3 class="est-plano-card-title">Horas por semana</h3>
        ${graficoSemanas(semanas, metaMin)}
      </div>

      ${e ? `
      <div class="est-plano-card">
        <h3 class="est-plano-card-title">Por disciplina</h3>
        <div class="est-plano-tabela-wrap">
          <table class="est-plano-tabela">
            <thead><tr><th>Disciplina</th><th>Tópicos</th><th>Tempo</th><th>Questões</th><th>Acerto</th></tr></thead>
            <tbody>${linhasDisc}</tbody>
          </table>
        </div>
      </div>

      <div class="est-plano-card">
        <h3 class="est-plano-card-title">🎯 Pontos fracos <span class="est-plano-sub">(tópicos com 10+ questões e acerto abaixo de ${ACERTO_BOM}%)</span></h3>
        <div class="est-plano-lista">
          ${fracos.length ? fracos.map(({ d, t, pct }) => `
            <div class="est-plano-item">
              <div class="est-plano-item-info">
                <span class="est-plano-item-disc">${escapeHtml(d.nome)}</span>
                <span class="est-plano-item-top">${escapeHtml(t.nome)} <span class="est-plano-acerto ${classeAcerto(pct)}">${pct}% de ${t.questoesFeitas}</span></span>
              </div>
              <div class="est-plano-item-acoes">
                ${botaoTec(t)}
                ${revisaoPendente(t.id)
                  ? `<span class="est-plano-sub">revisão em ${fmtData(revisaoPendente(t.id).data_prevista)}</span>`
                  : `<button class="est-plano-btn primario" onclick="estPlano.agendarReforco('${t.id}')">Agendar reforço</button>`}
              </div>
            </div>`).join('') : '<p class="est-plano-vazio">Nenhum ponto fraco por enquanto.</p>'}
        </div>
      </div>` : ''}
    `;
  }

  /* =============================================
     NAVEGAÇÃO
  ============================================= */
  function renderSecao(secao) {
    if (secao === 'inicio') renderHoje();
    if (secao === 'metas') renderMetas();
    if (secao === 'desempenho') renderDesempenho();
  }

  function renderTudo() {
    renderCards();
    renderHoje();
    renderSecao(currentSection);
  }

  function mudarSemana(delta) {
    semanaVista = somarDias(semanaVista || segundaDe(hoje()), delta * 7);
    renderMetas();
  }

  function irParaSemana(semana) {
    semanaVista = semana;
    renderMetas();
    const sec = document.getElementById('est-section-metas');
    if (sec) sec.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function alternarConfig() {
    configAberta = !configAberta;
    renderMetas();
  }

  /* O plano acompanha o edital escolhido em "Edital Verticalizado" */
  function editalTrocado() {
    semanaVista = null;
    configAberta = false;
    garantirSemanaAtual();
    renderTudo();
  }

  document.addEventListener('DOMContentLoaded', initModal);

  window.estPlano = {
    init, renderHoje, renderSecao, topicoConcluido, sessaoCriada, sessaoRemovida,
    abrirConclusao, abrirEstudo, adiarRevisao, removerMeta, regerarSemana, agendarEstudados,
    agendarReforco, mudarSemana, irParaSemana, alternarConfig, editalTrocado, projetar,
    incidenciaDaDisciplina, pctIncidencia, salvarIncidencias,
    materiaisDaDisciplina, paginasDoTopico, prioridadeDosTopicos, salvarMateriais,
    renderTudo, fmtMin, aviso, revisoesDoTopico, paginasLidas
  };
})();
