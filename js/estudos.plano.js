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
  const MIN_REVISAO = 30;                        // tempo reservado para cada revisão do dia
  const INTERVALOS = [1, 7, 30, 60];             // dias até a revisão 1, 2, 3 e 4
  const ACERTO_REFORCO = 70;                     // abaixo disso, entra reforço
  const ACERTO_BOM = 85;                         // acima disso, o intervalo aumenta 50%
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
    const { error } = await sb.from(tabela).upsert(lista, { onConflict });
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
    garantirSemanaAtual();
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

  /* Usado pelo card "Metas da Semana" da visão geral */
  window.resumoSemanaPlano = function () {
    const e = editalAtivo();
    if (!e) return null;
    const lista = metasDaSemana(e.id, segundaDe(hoje()));
    return { feitas: lista.filter(m => m.concluida).length, total: lista.length };
  };

  /* =============================================
     GERAÇÃO DAS METAS DA SEMANA
  ============================================= */
  function gerarSemana(edital, semana) {
    const plano = planoDe(edital.id);
    if (!plano || !plano.dias_semana || !plano.dias_semana.length) return [];

    const h = hoje();
    const dias = [];
    for (let i = 0; i < 7; i++) {
      const dia = somarDias(semana, i);
      if (dia >= h && plano.dias_semana.includes(diaDaSemana(dia))) dias.push(dia);
    }
    if (!dias.length) return [];

    // Orçamento de minutos por dia, já descontando as revisões previstas
    const porDia = (Number(plano.horas_semana) * 60) / plano.dias_semana.length;
    const orcamento = {};
    dias.forEach(d => { orcamento[d] = porDia; });
    revisoes
      .filter(r => !r.concluida_em && r.edital_id === edital.id)
      .forEach(r => {
        const d = r.data_prevista < dias[0] ? dias[0] : r.data_prevista;
        if (orcamento[d] !== undefined) orcamento[d] = Math.max(0, orcamento[d] - MIN_REVISAO);
      });
    const total = Object.values(orcamento).reduce((a, b) => a + b, 0);

    // Tópicos pendentes por disciplina, com prioridade = peso × (4 − nível)
    const jaNaSemana = new Set(metasDaSemana(edital.id, semana).map(m => m.topico_id));
    const fila = edital.disciplinas
      .map(d => {
        const cfg = configDisc(plano, d.id);
        const pendentes = d.topicos.filter(t => !t.estudado && !jaNaSemana.has(t.id));
        return { d, cfg, pendentes, prioridade: cfg.peso * (4 - cfg.nivel) };
      })
      .filter(x => x.cfg.ativa && x.pendentes.length);
    if (!fila.length) return [];

    const somaPrioridade = fila.reduce((a, x) => a + x.prioridade, 0);
    fila.forEach(x => {
      const bloco = BLOCO_MIN[x.cfg.nivel] || 90;
      const n = Math.max(1, Math.round((total * x.prioridade) / somaPrioridade / bloco));
      x.itens = x.pendentes.slice(0, n).map(t => ({ d: x.d, t, minutos: bloco }));
    });
    fila.sort((a, b) => b.prioridade - a.prioridade);

    // Intercala as disciplinas, como num ciclo de estudos
    const ordem = [];
    for (let i = 0, resta = true; resta; i++) {
      resta = false;
      fila.forEach(x => { if (x.itens[i]) { ordem.push(x.itens[i]); resta = true; } });
    }

    // Distribui pelos dias respeitando o orçamento (com 15% de folga)
    const usado = {};
    const cabe = (dia, min) => {
      const u = usado[dia] || 0;
      return u + min <= orcamento[dia] * 1.15 || (u === 0 && orcamento[dia] >= min / 2);
    };
    const novas = [];
    let idx = 0;
    for (const item of ordem) {
      while (idx < dias.length && !cabe(dias[idx], item.minutos)) idx++;
      if (idx >= dias.length) break;
      const dia = dias[idx];
      usado[dia] = (usado[dia] || 0) + item.minutos;
      novas.push({
        id: novoId('m'), edital_id: edital.id, semana, dia,
        disciplina_id: item.d.id, topico_id: item.t.id,
        tipo: 'estudo', minutos: item.minutos, concluida: false, ordem: novas.length
      });
    }
    return novas;
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
     REVISÕES CONDICIONAIS
  ============================================= */
  function proximaRevisao(etapaAtual, pct) {
    if (pct !== null && pct < ACERTO_REFORCO) {
      return { tipo: 'reforco', etapa: etapaAtual, dias: etapaAtual === 0 ? 1 : 2 };
    }
    if (etapaAtual >= INTERVALOS.length) return null;
    let dias = INTERVALOS[etapaAtual];
    if (pct !== null && pct >= ACERTO_BOM) dias = Math.round(dias * 1.5);
    return { tipo: 'revisao', etapa: etapaAtual + 1, dias };
  }

  /* Empurra a data para o próximo dia de estudo do plano (folgas não recebem revisão) */
  function proximoDiaDeEstudo(editalId, dia) {
    const plano = planoDe(editalId);
    if (!plano || !plano.dias_semana || !plano.dias_semana.length) return dia;
    while (!plano.dias_semana.includes(diaDaSemana(dia))) dia = somarDias(dia, 1);
    return dia;
  }

  function agendarRevisao(ref, etapaAtual, pct, base) {
    const prox = proximaRevisao(etapaAtual, pct);
    if (!prox) return null;
    const r = {
      id: novoId('r'), edital_id: ref.e.id, disciplina_id: ref.d.id, topico_id: ref.t.id,
      etapa: prox.etapa, tipo: prox.tipo,
      data_prevista: proximoDiaDeEstudo(ref.e.id, somarDias(base || hoje(), prox.dias)),
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
      agendarRevisao(ref, 0, pct === undefined || pct === null ? pctTopico(ref.t) : pct);
    }
    renderTudo();
  }

  function agendarReforco(topicId) {
    const ref = acharTopico(topicId);
    if (!ref || revisaoPendente(topicId)) return;
    const etapa = Math.max(0, ...revisoes.filter(r => r.topico_id === topicId && r.concluida_em).map(r => r.etapa));
    const r = {
      id: novoId('r'), edital_id: ref.e.id, disciplina_id: ref.d.id, topico_id: topicId,
      etapa, tipo: 'reforco', data_prevista: proximoDiaDeEstudo(ref.e.id, somarDias(hoje(), 1)),
      concluida_em: null, acerto: null
    };
    revisoes.push(r);
    gravar('revisoes', r);
    renderTudo();
    aviso('Reforço agendado para amanhã.');
  }

  /* Tópicos marcados como estudados antes do plano existir: até 5 revisões por dia */
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
    const lista = topicosSemRevisao(e);
    const novas = lista.map((ref, i) => {
      const pct = pctTopico(ref.t);
      return {
        id: novoId('r'), edital_id: e.id, disciplina_id: ref.d.id, topico_id: ref.t.id,
        etapa: 1, tipo: pct !== null && pct < ACERTO_REFORCO ? 'reforco' : 'revisao',
        data_prevista: proximoDiaDeEstudo(e.id, somarDias(hoje(), 1 + Math.floor(i / 5))),
        concluida_em: null, acerto: null
      };
    });
    revisoes.push(...novas);
    gravar('revisoes', novas);
    renderTudo();
    aviso(`${novas.length} revisões agendadas.`);
  }

  function adiarRevisao(id) {
    const r = revisoes.find(x => x.id === id);
    if (!r) return;
    r.data_prevista = proximoDiaDeEstudo(r.edital_id, somarDias(hoje(), 1));
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
  function abrirConclusao(tipo, id) {
    const item = tipo === 'meta' ? metas.find(m => m.id === id) : revisoes.find(r => r.id === id);
    if (!item) return;
    const ref = acharTopico(item.topico_id);
    if (!ref) { aviso('Este tópico não existe mais no edital.'); return; }
    contextoConclusao = { tipo, id };

    const titulo = tipo === 'meta' ? 'Concluir meta'
      : item.tipo === 'reforco' ? 'Concluir reforço' : `Concluir revisão ${item.etapa}/${INTERVALOS.length}`;
    document.getElementById('est-concluir-titulo').textContent = titulo;
    document.getElementById('est-concluir-topico').textContent = `${ref.d.nome} — ${ref.t.nome}`;
    document.getElementById('est-concluir-dica').textContent = tipo === 'meta'
      ? 'Teoria e caderno de questões do tópico. Ao concluir, a primeira revisão é agendada conforme o seu acerto.'
      : `Refaça o caderno do TEC deste tópico. Abaixo de ${ACERTO_REFORCO}% entra um reforço; a partir de ${ACERTO_BOM}% a próxima revisão fica mais espaçada.`;

    const minutos = tipo === 'meta' ? item.minutos : MIN_REVISAO;
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
    if (ctx.tipo === 'meta') { t.estudado = true; atualizacao.estudado = true; }
    saveEditais();
    fecharConclusao();

    // Registra a sessão no histórico
    const sessao = {
      id: novoId('s'), date: hoje(), timestamp: new Date().toISOString(),
      editalId: e.id, discId: d.id, topicId: t.id, discipline: d.nome, topic: t.nome,
      timeMinutes: minutos, questionsTotal: questoes, questionsCorrect: acertos,
      tipo: ctx.tipo === 'meta' ? 'estudo' : item.tipo, metaDone: ctx.tipo === 'meta'
    };
    studyData.push(sessao);
    saveData();
    sessaoCriada(sessao);

    if (ctx.tipo === 'meta') {
      item.concluida = true;
      gravar('metas', item);
      topicoConcluido(t.id, pct);
    } else {
      item.concluida_em = hoje();
      item.acerto = pct;
      gravar('revisoes', item);
      const prox = agendarRevisao(ref, item.etapa, pct);
      aviso(prox
        ? `${prox.tipo === 'reforco' ? 'Reforço' : 'Próxima revisão'} em ${fmtData(prox.data_prevista)}.`
        : 'Ciclo de revisões do tópico concluído!');
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
    return r.tipo === 'reforco' ? 'Reforço' : `Revisão ${r.etapa}/${INTERVALOS.length}`;
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

  function itemMeta(m, { compacto = false } = {}) {
    const ref = acharTopico(m.topico_id);
    const disc = ref ? ref.d.nome : 'Disciplina removida';
    const top = ref ? ref.t.nome : 'Tópico removido';
    const atrasada = !m.concluida && m.dia < hoje();
    return `
      <div class="est-plano-item tipo-estudo ${m.concluida ? 'feito' : ''}">
        <div class="est-plano-item-info">
          <span class="est-plano-tag">${m.concluida ? '✓ Feito' : atrasada ? 'Atrasada' : 'Estudo'} · ${fmtMin(m.minutos)}</span>
          <span class="est-plano-item-disc">${escapeHtml(disc)}</span>
          <span class="est-plano-item-top">${escapeHtml(top)}</span>
        </div>
        ${m.concluida ? '' : `
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
    return `
      <div class="est-plano-item tipo-${r.tipo}">
        <div class="est-plano-item-info">
          <span class="est-plano-tag">${rotuloRevisao(r)} · ${atraso > 0 ? `${atraso} dia${atraso > 1 ? 's' : ''} de atraso` : fmtData(r.data_prevista)}</span>
          <span class="est-plano-item-disc">${escapeHtml(disc)}</span>
          <span class="est-plano-item-top">${escapeHtml(top)}
            ${pct !== null ? `<span class="est-plano-acerto ${classeAcerto(pct)}">${pct}%</span>` : ''}</span>
        </div>
        <div class="est-plano-item-acoes">
          <button class="est-plano-btn sutil" onclick="estPlano.adiarRevisao('${r.id}')" title="Adiar para amanhã">Adiar</button>
          ${botaoTec(ref && ref.t)}
          <button class="est-plano-btn primario" onclick="estPlano.abrirConclusao('revisao', '${r.id}')">Concluir</button>
        </div>
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
          ${!revHoje.length && !metasHoje.length ? '<p class="est-plano-vazio">Nenhuma meta para hoje. Veja a semana em “Metas da Semana”.</p>' : ''}
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
            <thead><tr><th>Disciplina</th><th>Peso na prova</th><th>Seu nível</th><th>Incluir</th></tr></thead>
            <tbody>
              ${e.disciplinas.map(d => {
                const c = configDisc(plano, d.id);
                return `<tr data-disc="${d.id}">
                  <td>${escapeHtml(d.nome)}</td>
                  <td><select class="est-form-select" name="peso">${opcoes(NOMES_PESO, c.peso)}</select></td>
                  <td><select class="est-form-select" name="nivel">${opcoes(NOMES_NIVEL, c.nivel)}</select></td>
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
    const lista = metasDaSemana(e.id, semanaVista);
    const fim = somarDias(semanaVista, 6);
    const estudado = minutosEstudados(semanaVista, fim);
    const metaMin = plano ? Number(plano.horas_semana) * 60 : 0;

    const dias = [];
    for (let i = 0; i < 7; i++) dias.push(somarDias(semanaVista, i));

    el.innerHTML = `
      ${bannerLocal()}
      <div class="est-plano-topo">
        <div>
          <h2 class="est-plano-titulo">🎯 Metas da Semana</h2>
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
        <div class="est-plano-kpi"><span>Horas na semana</span><strong>${fmtMin(estudado)} <small>/ ${fmtMin(metaMin)}</small></strong>${barra(metaMin ? estudado / metaMin * 100 : 0, 'blue')}</div>
        <div class="est-plano-kpi"><span>Metas concluídas</span><strong>${lista.filter(m => m.concluida).length} <small>/ ${lista.length}</small></strong>${barra(lista.length ? lista.filter(m => m.concluida).length / lista.length * 100 : 0)}</div>
        <div class="est-plano-kpi"><span>Revisões na semana</span><strong>${revisoes.filter(r => r.edital_id === e.id && r.data_prevista >= semanaVista && r.data_prevista <= fim).length}</strong></div>
      </div>

      ${semanaVista > atual ? '<p class="est-plano-vazio">As metas desta semana são geradas automaticamente quando ela começar.</p>' : ''}
      ${semanaVista === atual && !lista.length ? '<p class="est-plano-vazio">Nenhuma meta gerada: todos os tópicos das disciplinas incluídas já estão estudados, ou não sobraram dias de estudo nesta semana.</p>' : ''}

      <div class="est-plano-semana">
        ${dias.map(dia => {
          const doDia = lista.filter(m => m.dia === dia).sort((a, b) => a.ordem - b.ordem);
          const revDia = revisoes.filter(r => r.edital_id === e.id && !r.concluida_em &&
            (r.data_prevista === dia || (dia === h && r.data_prevista < h)));
          const previsto = doDia.reduce((a, m) => a + m.minutos, 0);
          const feito = minutosEstudados(dia, dia);
          const folga = !plano.dias_semana.includes(diaDaSemana(dia));
          return `
            <div class="est-plano-dia ${dia === h ? 'hoje' : ''} ${dia < h ? 'passado' : ''}">
              <div class="est-plano-dia-head">
                <strong>${DIAS_CURTOS[diaDaSemana(dia)]} ${fmtData(dia)}</strong>
                <span>${feito ? fmtMin(feito) + ' feitos' : previsto ? fmtMin(previsto) + ' previstos' : folga ? 'folga' : ''}</span>
              </div>
              ${revDia.map(itemRevisao).join('')}
              ${doDia.map(m => itemMeta(m)).join('')}
              ${!revDia.length && !doDia.length ? '<span class="est-plano-dia-vazio">—</span>' : ''}
            </div>`;
        }).join('')}
      </div>` : ''}
    `;

    const form = document.getElementById('est-plano-config-form');
    if (form) form.addEventListener('submit', ev => { ev.preventDefault(); salvarConfig(form, e); });
  }

  /* =============================================
     SEÇÃO: REVISÕES
  ============================================= */
  function renderRevisoes() {
    const el = document.getElementById('est-plano-revisoes');
    if (!el) return;
    const e = editalAtivo();
    if (!e) {
      el.innerHTML = '<p class="est-plano-vazio">Cadastre um edital para usar as revisões.</p>';
      return;
    }
    const h = hoje();
    const em7 = somarDias(h, 7);
    const pend = revisoes
      .filter(r => r.edital_id === e.id && !r.concluida_em)
      .sort((a, b) => a.data_prevista.localeCompare(b.data_prevista));
    const grupos = [
      ['Atrasadas', pend.filter(r => r.data_prevista < h)],
      ['Hoje', pend.filter(r => r.data_prevista === h)],
      ['Próximos 7 dias', pend.filter(r => r.data_prevista > h && r.data_prevista <= em7)],
      ['Mais adiante', pend.filter(r => r.data_prevista > em7)]
    ];
    const semRevisao = topicosSemRevisao(e);
    const feitas = revisoes
      .filter(r => r.edital_id === e.id && r.concluida_em)
      .sort((a, b) => b.concluida_em.localeCompare(a.concluida_em))
      .slice(0, 10);

    el.innerHTML = `
      ${bannerLocal()}
      <div class="est-plano-topo">
        <div>
          <h2 class="est-plano-titulo">📅 Revisões e Reforços</h2>
          <span class="est-plano-sub">Revisões em ${INTERVALOS.join(', ')} dias. Abaixo de ${ACERTO_REFORCO}% de acerto entra um reforço; a partir de ${ACERTO_BOM}% o intervalo aumenta 50%.</span>
        </div>
      </div>

      <div class="est-plano-kpis">
        ${grupos.slice(0, 3).map(([nome, l]) => `<div class="est-plano-kpi ${nome === 'Atrasadas' && l.length ? 'alerta' : ''}"><span>${nome}</span><strong>${l.length}</strong></div>`).join('')}
      </div>

      ${semRevisao.length ? `
      <div class="est-plano-cta">
        <div>
          <strong>${semRevisao.length} tópico${semRevisao.length > 1 ? 's' : ''} estudado${semRevisao.length > 1 ? 's' : ''} sem revisão</strong>
          <p>Foram marcados antes do plano existir. Posso agendar a primeira revisão deles, até 5 por dia a partir de amanhã.</p>
        </div>
        <button class="est-btn-register" onclick="estPlano.agendarEstudados()">Agendar revisões</button>
      </div>` : ''}

      ${grupos.map(([nome, l]) => l.length ? `
        <div class="est-plano-card">
          <h3 class="est-plano-card-title">${nome} <span class="est-plano-sub">(${l.length})</span></h3>
          <div class="est-plano-lista">${(nome === 'Mais adiante' ? l.slice(0, 20) : l).map(itemRevisao).join('')}</div>
        </div>` : '').join('')}

      ${!pend.length && !semRevisao.length ? '<p class="est-plano-vazio">Nenhuma revisão pendente. Elas aparecem aqui quando você conclui um tópico.</p>' : ''}

      ${feitas.length ? `
      <div class="est-plano-card">
        <h3 class="est-plano-card-title">Últimas concluídas</h3>
        <div class="est-plano-lista">
          ${feitas.map(r => {
            const ref = acharTopico(r.topico_id);
            return `<div class="est-plano-item feito">
              <div class="est-plano-item-info">
                <span class="est-plano-tag">${rotuloRevisao(r)} · ${fmtData(r.concluida_em)}</span>
                <span class="est-plano-item-top">${escapeHtml(ref ? ref.t.nome : 'Tópico removido')}</span>
              </div>
              ${r.acerto !== null && r.acerto !== undefined ? `<span class="est-plano-acerto ${classeAcerto(r.acerto)}">${r.acerto}%</span>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}
    `;
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

    const desde = somarDias(hoje(), -28);
    const concluidos = new Set([
      ...studyData.filter(s => s.metaDone && s.topicId && s.date >= desde).map(s => s.topicId),
      ...metas.filter(m => m.edital_id === e.id && m.concluida && m.dia >= desde).map(m => m.topico_id)
    ]);
    let ritmo = concluidos.size / 4;
    let fonte = 'no seu ritmo das últimas 4 semanas';
    if (!ritmo && plano) {
      ritmo = metasDaSemana(e.id, segundaDe(hoje())).length;
      fonte = 'se você cumprir as metas planejadas';
    }
    if (!ritmo) return `Faltam ${pendentes} tópicos. Conclua algumas metas para o painel estimar quando o edital termina.`;

    const fim = somarDias(hoje(), Math.ceil((pendentes / ritmo) * 7));
    const folga = diasEntre(fim, getTargetDate());
    const [a, m, d] = fim.split('-');
    return `Faltam <strong>${pendentes} tópicos</strong> (${ritmo.toFixed(1).replace('.', ',')} por semana ${fonte}).
      Previsão de término: <strong>${d}/${m}/${a}</strong>,
      ${folga >= 0
        ? `<span class="est-plano-acerto bom">${folga} dias antes da prova</span>`
        : `<span class="est-plano-acerto ruim">${-folga} dias depois da prova</span>. Aumente as horas semanais ou o peso das disciplinas prioritárias.`}`;
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
    if (secao === 'revisoes') renderRevisoes();
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
    abrirConclusao, adiarRevisao, removerMeta, regerarSemana, agendarEstudados,
    agendarReforco, mudarSemana, alternarConfig, editalTrocado
  };
})();
