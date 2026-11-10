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
  const PARTE_MAX = 70;                          // nenhuma meta de estudo passa de 1h10: o tópico maior vira partes
  // Depois do estudo de cada tópico entra uma meta de questões, pela relevância do tópico:
  // incidência do TEC (≥ 10% da disciplina = alta, < 2% = baixa) ou, sem ela, o peso da disciplina
  const QUESTOES_POR_RELEVANCIA = { 3: 20, 2: 15, 1: 10 };
  const MIN_POR_QUESTAO = 3;
  // Assunto com páginas no PDF: uma meta de questões dele, na metade ou no fim do PDF (assuntosParaQuestoes)
  const QUESTOES_POR_ASSUNTO = 15;
  // Só os estudos a partir desta semana geram meta de questões (os antigos não ganham de uma vez)
  const INICIO_QUESTOES = '2026-11-02';
  const PADRAO_DISC = { peso: 2, nivel: 2, ativa: true };
  const NOMES_PESO = { 1: 'Baixo', 2: 'Médio', 3: 'Alto' };
  const NOMES_NIVEL = { 1: 'Iniciante', 2: 'Intermediário', 3: 'Avançado' };
  const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  /* =============================================
     ESTADO
  ============================================= */
  let remoto = false;
  let temSubMeta = true;      // coluna metas.subtopico_id (meta de questões de um assunto); sem ela, uma meta por item
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
  // Motor de estudos (PDF como espinha; supabase/motor.sql). Sem as tabelas, nada do motor aparece.
  let motorPdfs = [];         // linhas de motor_pdfs (uma por PDF)
  let motorBlocos = [];       // histórico dos blocos de questões
  let temMotor = false;

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
      tipo: s.tipo || 'estudo', meta_concluida: !!s.metaDone,
      ...(window.estSub && window.estSub.temSessoes() ? { assuntos: s.assuntos || null } : {})
    };
  }

  function linhaParaSessao(r) {
    return {
      id: r.id, date: r.data, timestamp: r.criado_em,
      editalId: r.edital_id, discId: r.disciplina_id, topicId: r.topico_id,
      discipline: r.disciplina, topic: r.topico,
      timeMinutes: r.minutos, questionsTotal: r.questoes, questionsCorrect: r.acertos,
      tipo: r.tipo, metaDone: r.meta_concluida, assuntos: r.assuntos || null
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
    temSubMeta = !(await sb.from('metas').select('subtopico_id').limit(1)).error;
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
    // Ordem da lista de PDFs = ordem de criação (o id começa pelo horário); o banco não garante ordem
    materiais = mat.linhas.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    remotoMat = mat.remoto;
    indexarIncidencias();
    pagPorTopico = contarPaginas(materiais);
    if (window.estSub) await window.estSub.carregar();
    await carregarMotor();
  }

  async function carregarMotor() {
    temMotor = false;
    if (!remoto || !window.estMotorMigracao) return;
    const [a, b, c] = await Promise.all([sb.from('motor_pdfs').select('*'), sb.from('motor_blocos').select('*'),
      sb.from('subtopicos').select('material_id').limit(1)]);
    if (a.error || b.error || c.error) return;
    motorPdfs = a.data || [];
    motorBlocos = b.data || [];
    temMotor = true;
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
     "lista" permite simular materiais ainda não salvos (tela de materiais).
     "ordemPdf": segue a ordem dos PDFs cadastrados (e das páginas dentro de cada um);
     tópicos sem PDF vão para o fim, na ordem do edital. */
  function prioridadeDosTopicos(d, lista, ordemPdf) {
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
    if (ordemPdf) {
      const pos = {};
      (lista || materiaisDaDisciplina(d.id)).forEach((m, mi) => (m.topicos || []).forEach((l, j) => {
        const k = mi * 1e6 + (Number(l.de) || j);
        if (l.topico_id && !(pos[l.topico_id] <= k)) pos[l.topico_id] = k;
      }));
      const chave = x => (x.t.id in pos ? pos[x.t.id] : Infinity);
      itens.sort((a, b) => chave(a) - chave(b) || a.i - b.i);
    } else if (inc) itens.sort((a, b) => b.porPagina - a.porPagina || a.efetivas - b.efetivas || a.i - b.i);
    return { itens, comIncidencia: !!inc, comPaginas: conhecidas.length > 0, mediana };
  }

  /* "Seguir a ordem dos PDFs" (tela de materiais): fica na configuração da disciplina no plano;
     sem plano ainda, espera em "ordemPdfPendente" até a configuração ser salva. */
  const ordemPdfPendente = {};
  function ordemPdfDe(editalId, discId) {
    return discId in ordemPdfPendente ? ordemPdfPendente[discId] : !!configDisc(planoDe(editalId), discId).ordemPdf;
  }

  /* Subtópicos agrupados no Edital Verticalizado: a incidência e os PDFs deles passam para o
     tópico principal (faixas de páginas unidas) e a semana é refeita sem as metas abertas
     que apontavam para eles. */
  async function juntarTopicos(edital, disc, deIds, paraId) {
    const de = new Set(deIds);
    const novoId = id => (de.has(id) ? paraId : id);
    const incs = incidencias.filter(r => r.disciplina_id === disc.id);
    if (incs.some(r => de.has(r.topico_id))) {
      const porTopico = {};
      incs.forEach(r => { porTopico[novoId(r.topico_id)] = (porTopico[novoId(r.topico_id)] || 0) + r.questoes; });
      await salvarIncidencias(edital, disc, porTopico);
    }
    const lista = materiaisDaDisciplina(disc.id);
    if (lista.some(m => (m.topicos || []).some(l => de.has(l.topico_id)))) {
      const nova = lista.map(m => {
        const links = [];
        (m.topicos || []).forEach(l => {
          const igual = links.find(x => x.topico_id === novoId(l.topico_id));
          if (!igual) links.push({ ...l, topico_id: novoId(l.topico_id) });
          else if (igual.de > 0 && l.de > 0) { igual.de = Math.min(igual.de, l.de); igual.ate = Math.max(igual.ate || 0, l.ate || 0) || null; }
          else { igual.de = null; igual.ate = null; }
        });
        return { ...m, topicos: links };
      });
      await salvarMateriais(edital, disc, nova);
    }
    const ativo = editalAtivo();
    if (planoDe(edital.id) && ativo && ativo.id === edital.id) await regerarSemana();
  }

  /* Edital por PDF: cada PDF da disciplina é um item de estudo. Fica na configuração da
     disciplina no plano, como o ordemPdf. */
  const porPdfDe = (editalId, discId) => !!configDisc(planoDe(editalId), discId).porPdf;
  const linhaDoTopico = (t, discId) => ({ id: t.id, disciplina_id: discId, nome: t.nome, estudado: false,
    questoes_feitas: 0, questoes_certas: 0, tec_link: '', tempo_gasto: 0 });
  const itemDoPdf = (id, m) => ({ id, nome: m.nome, estudado: false, questoesFeitas: 0, questoesCertas: 0, tecLink: '', tempoGasto: 0 });

  // PDF que entrou na lista de uma disciplina por PDF ganha o próprio item, no fim (o id ordena depois dos outros)
  async function itensDosPdfsSoltos(disc, lista) {
    const soltos = lista.filter(m => !(m.topicos || []).some(l => l.topico_id));
    if (!soltos.length) return;
    const base = Date.now();
    const novos = soltos.map((m, i) => itemDoPdf(`t_${base}_${String(i).padStart(5, '0')}`, m));
    const { error } = await sb.from('topicos').insert(novos.map(t => linhaDoTopico(t, disc.id)));
    if (error) {
      console.error('Erro ao criar os itens dos PDFs:', error);
      aviso('Não foi possível criar os itens dos PDFs novos. Abra a lista de PDFs e salve de novo.');
      return;
    }
    soltos.forEach((m, i) => { m.topicos = [{ topico_id: novos[i].id, de: null, ate: null }]; });
    disc.topicos.push(...novos);
    saveEditais();
    renderEdital();
  }

  async function salvarMateriais(edital, disc, lista, ordemPdf) {
    if (porPdfDe(edital.id, disc.id)) await itensDosPdfsSoltos(disc, lista);
    const plano = planoDe(edital.id);
    if (ordemPdf !== undefined && ordemPdf !== ordemPdfDe(edital.id, disc.id)) {
      if (plano) {
        plano.disciplinas = { ...plano.disciplinas, [disc.id]: { ...configDisc(plano, disc.id), ordemPdf } };
        await gravar('plano_estudos', plano);
      } else ordemPdfPendente[disc.id] = ordemPdf;
    }
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
    const feitas = metas.filter(m => m.topico_id === topicId && m.concluida && !ehQuestoes(m));
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
    const ctx = { planejado: {}, partesFeitas: {}, reservas: {}, contagem: {}, itens: {}, alocado: {}, questoes: [] };
    const h = hoje();
    revisoes.filter(r => r.edital_id === edital.id && !r.concluida_em).forEach(r => {
      reservar(ctx, r.data_prevista < h ? h : r.data_prevista, r.minutos || MIN_REVISAO);
    });
    const contarParte = m => { ctx.partesFeitas[m.topico_id] = (ctx.partesFeitas[m.topico_id] || 0) + 1; };
    metas.filter(m => m.edital_id === edital.id && m.semana < semanaBase && m.concluida && !ehQuestoes(m)).forEach(contarParte);
    metasDaSemana(edital.id, semanaBase).forEach(m => {
      ctx.alocado[m.disciplina_id] = (ctx.alocado[m.disciplina_id] || 0) + m.minutos;
      if (ehQuestoes(m)) return;
      contarParte(m);
      if (!m.concluida) ctx.planejado[m.topico_id] = (ctx.planejado[m.topico_id] || 0) + m.minutos;
      // As revisões só começam depois da última parte do tópico
      if (!m.concluida && (!m.partes || m.parte >= m.partes)) {
        reservarRevisoes(ctx, plano, m.dia, acertoEsperado(edital.disciplinas.find(d => d.id === m.disciplina_id)), m.topico_id, m.disciplina_id);
      }
    });
    // Questões que ainda faltam: tópico sem meta de questões cujo estudo já passou da metade
    // das páginas (com PDF) ou terminou (sem PDF), contando o que está planejado até semanaBase
    ctx.comQuestoes = new Set(metas.filter(m => ehQuestoes(m) && !m.subtopico_id).map(m => m.topico_id));
    ctx.comQuestoesSub = new Set(metas.filter(m => ehQuestoes(m) && m.subtopico_id).map(m => m.subtopico_id));
    const porTopico = {};
    metas.filter(m => m.edital_id === edital.id && !ehQuestoes(m) && m.semana >= INICIO_QUESTOES &&
      m.semana <= semanaBase && !ctx.comQuestoes.has(m.topico_id) && !questoesPorAssunto(ctx, m.topico_id).length)
      .forEach(m => (porTopico[m.topico_id] = porTopico[m.topico_id] || []).push(m));
    Object.values(porTopico).forEach(lista => {
      lista.sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : (a.ordem || 0) - (b.ordem || 0)));
      const tId = lista[0].topico_id;
      let lidas = paginasLidas(tId);
      const gatilho = lista.find(m => {
        if (!m.concluida) lidas += m.minutos * PAGINAS_POR_HORA / 60;
        return passouDaMetade(tId, lidas, m);
      });
      if (gatilho) {
        ctx.comQuestoes.add(tId);
        ctx.questoes.push({ topico_id: tId, disciplina_id: gatilho.disciplina_id, depoisDe: gatilho.dia });
      }
    });
    // Por assunto: o que já foi lido (ou planejado até aqui) e ainda não tem meta de questões
    const vistos = new Set();
    metas.filter(m => m.edital_id === edital.id && !ehQuestoes(m) && m.semana >= INICIO_QUESTOES && m.semana <= semanaBase).forEach(m => {
      if (vistos.has(m.topico_id)) return;
      vistos.add(m.topico_id);
      const ass = questoesPorAssunto(ctx, m.topico_id);
      if (!ass.length) return;
      const ref = acharTopico(m.topico_id);
      const pos = paginasLidas(m.topico_id) + metas.filter(x => x.topico_id === m.topico_id && !x.concluida && !ehQuestoes(x) && x.semana <= semanaBase)
        .reduce((a, x) => a + x.minutos * PAGINAS_POR_HORA / 60, 0);
      assuntosParaQuestoes(ass, ctx, pos, paginasDoTopico(m.topico_id), !!(ref && ref.t.estudado))
        .forEach(a => ctx.questoes.push({ topico_id: m.topico_id, disciplina_id: m.disciplina_id, subtopico_id: a.s.id, depoisDe: hoje() }));
    });
    return ctx;
  }

  /* Questões por assunto: na metade do PDF, uma meta para cada assunto já lido; no fim, para os que
     faltam (QUESTOES_POR_ASSUNTO cada, então cada meta fica abaixo de PARTE_MAX). Marca os escolhidos. */
  function assuntosParaQuestoes(ass, ctx, pos, total, fim) {
    const primeira = !ass.some(a => ctx.comQuestoesSub.has(a.s.id));
    const r = ass.filter(a => !ctx.comQuestoesSub.has(a.s.id) &&
      (fim || pos >= total - 0.5 || (primeira && pos >= total / 2 && a.fim <= pos + 0.5)));
    r.forEach(a => ctx.comQuestoesSub.add(a.s.id));
    return r;
  }

  const ehQuestoes = m => m.tipo === 'questoes';
  /* Hora da meta de questões: com PDF, quando as páginas lidas/planejadas chegam à metade
     (ou na última parte, se o ritmo real ficou diferente); sem PDF, depois do estudo. */
  function passouDaMetade(topicId, paginas, meta) {
    const total = paginasDoTopico(topicId);
    return (!meta.partes || meta.parte >= meta.partes) || (total > 0 && paginas >= total / 2);
  }
  const questoesDaMeta = m => Math.round(m.minutos / MIN_POR_QUESTAO);

  /* Número de questões do tópico pela relevância (ver QUESTOES_POR_RELEVANCIA) */
  function questoesDoTopico(plano, topicId, discId) {
    const pct = pctIncidencia(topicId);
    const nivel = pct === null ? configDisc(plano, discId).peso : pct >= 10 ? 3 : pct < 2 ? 1 : 2;
    return QUESTOES_POR_RELEVANCIA[nivel] || QUESTOES_POR_RELEVANCIA[2];
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
     Sem PDF: o bloco do nível em partes iguais de até PARTE_MAX, menos as partes já feitas ou
     planejadas; o tópico fica estudado na última. */
  function faltaDoTopico(ctx, x, t) {
    if (t.estudado) return 0;
    const pags = Math.round(paginasDoTopico(t.id));
    if (!pags) {
      const bloco = blocoDoTopico(x, t), partes = Math.ceil(bloco / PARTE_MAX);
      return Math.round(bloco / partes) * Math.max(0, partes - (ctx.partesFeitas[t.id] || 0));
    }
    if (cortesDoTopico(t.id)) {
      const resto = pags - posicaoNoTopico(ctx, t.id);
      return resto >= 0.5 ? Math.round(resto * 60 / PAGINAS_POR_HORA) : ctx.planejado[t.id] ? 0 : 15;
    }
    const restantes = Math.max(0, pags - paginasLidas(t.id));
    const leitura = Math.max(15, Math.ceil((restantes / PAGINAS_POR_HORA) * 60 / 15) * 15);
    const falta = leitura - (ctx.planejado[t.id] || 0);
    return falta >= 15 ? falta : 0;
  }

  /* Próxima meta do tópico: { minutos, parte, partes }. O que falta é dividido por igual em
     partes de até PARTE_MAX. */
  function proximaParte(ctx, x, t) {
    const falta = faltaDoTopico(ctx, x, t);
    const fins = paginasDoTopico(t.id) ? cortesDoTopico(t.id) : null;
    if (fins) {   // com assuntos: a parte acaba no fim do próximo corte
      const n = (ctx.partesFeitas[t.id] || 0) + 1;
      const pos = posicaoNoTopico(ctx, t.id);
      const restam = fins.filter(f => f > pos + 0.5);
      return restam.length ? { minutos: Math.round((restam[0] - pos) * 60 / PAGINAS_POR_HORA), parte: n, partes: n - 1 + restam.length }
        : { minutos: falta, parte: n, partes: n };
    }
    const parte = (ctx.partesFeitas[t.id] || 0) + 1;
    const resto = Math.ceil(falta / PARTE_MAX);
    return { minutos: resto <= 1 ? falta : Math.round(falta / resto), parte, partes: parte - 1 + resto };
  }
  function filaDoTopico(plano, d) {
    const cfg = configDisc(plano, d.id);
    const inc = incidenciaDaDisciplina(d);
    // Com incidência do TEC, primeiro o que mais cai por página de material
    // ou, se a disciplina pede, a ordem dos PDFs
    const ordem = inc || cfg.ordemPdf ? prioridadeDosTopicos(d, null, cfg.ordemPdf).itens.map(x => x.t) : d.topicos;
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
    // Meta de questões no mesmo dia do fim do estudo, se couber; senão, no próximo dia com espaço.
    // A que não cabe nesta semana fica em ctx.questoes para a seguinte.
    const colocarQuestoes = q => {
      const minutos = (q.subtopico_id ? QUESTOES_POR_ASSUNTO : questoesDoTopico(plano, q.topico_id, q.disciplina_id)) * MIN_POR_QUESTAO;
      const dia = dias.find(d => d >= q.depoisDe && cabe(d, minutos));
      if (!dia) return false;
      usado[dia] = (usado[dia] || 0) + minutos;
      ctx.alocado[q.disciplina_id] = (ctx.alocado[q.disciplina_id] || 0) + minutos;
      novas.push({
        id: novoId('m'), edital_id: edital.id, semana, dia,
        disciplina_id: q.disciplina_id, topico_id: q.topico_id,
        tipo: 'questoes', minutos, concluida: false, ordem: novas.length,
        ...(q.subtopico_id ? { subtopico_id: q.subtopico_id } : {})
      });
      return true;
    };
    ctx.questoes = ctx.questoes.filter(q => !colocarQuestoes(q));
    while (fila.length) {
      fila.sort((a, b) => vez(a) - vez(b));
      const x = fila[0];
      const t = x.pendentes[0];
      const p = proximaParte(ctx, x, t);
      // Partes do mesmo tópico ficam em ordem: nunca antes do dia da parte anterior.
      // Seguindo a ordem dos PDFs, o tópico seguinte também não passa na frente do anterior (o mesmo dia pode)
      const depoisDe = p.parte > 1 ? (novas.filter(m => m.topico_id === t.id).pop() || {}).dia : null;
      const desde = x.cfg.ordemPdf ? (novas.filter(m => m.disciplina_id === x.d.id && m.tipo === 'estudo').pop() || {}).dia : null;
      const dia = dias.find(d => (!depoisDe || d > depoisDe) && (!desde || d >= desde) && cabe(d, p.minutos));
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
      const total = paginasDoTopico(t.id);
      const pos = posicaoNoTopico(ctx, t.id);
      const metade = total > 0 && pos >= total / 2;
      const ass = questoesPorAssunto(ctx, t.id);
      if (ass.length) {
        assuntosParaQuestoes(ass, ctx, pos, total, ultima).forEach(a => {
          const q = { topico_id: t.id, disciplina_id: x.d.id, subtopico_id: a.s.id, depoisDe: dia };
          if (!colocarQuestoes(q)) ctx.questoes.push(q);
        });
      } else if (!ctx.comQuestoes.has(t.id) && (ultima || metade)) {
        ctx.comQuestoes.add(t.id);
        const q = { topico_id: t.id, disciplina_id: x.d.id, depoisDe: dia };
        if (!colocarQuestoes(q)) ctx.questoes.push(q);
      }
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

  /* Terminou antes: traz para hoje as metas do próximo dia previsto (estudo e questões; as
     revisões dependem da data e continuam onde estão). A projeção se refaz sem elas. */
  async function adiantar() {
    const e = editalAtivo();
    const projecao = e && planoDe(e.id) ? projetar(e) : null;
    const previstas = projecao ? projecao.semanas.flatMap(w => w.metas) : [];
    if (!previstas.length) { aviso('Não há metas previstas para adiantar: o edital já está todo no plano.'); return; }
    const dia = previstas.reduce((a, m) => (m.dia < a ? m.dia : a), previstas[0].dia);
    const h = hoje(), semana = segundaDe(h);
    const ordem0 = metasDaSemana(e.id, semana).filter(m => m.dia === h).length;
    const novas = previstas.filter(m => m.dia === dia).map(({ previsto, ...m }, i) => ({ ...m, id: novoId('m'), semana, dia: h, ordem: ordem0 + i }));
    metas.push(...novas);
    await gravar('metas', novas);
    semanaVista = semana;
    renderTudo();
    aviso(`${novas.length} meta${novas.length > 1 ? 's' : ''} de ${fmtData(dia)} adiantada${novas.length > 1 ? 's' : ''} para hoje.`);
  }

  /* Apaga todas as metas e revisões do edital ativo e gera a semana de novo. A configuração
     (horas, dias, peso/nível, PDFs, incidência) e o progresso dos tópicos ficam. */
  async function reiniciarPlanejamento() {
    const e = editalAtivo();
    if (!e) return;
    const ok = await customConfirm('Reiniciar o planejamento do zero? Todas as metas e revisões deste edital, inclusive as já concluídas, serão apagadas e a semana será gerada de novo. A configuração do plano, os PDFs e o progresso dos assuntos continuam. Não dá para desfazer.');
    if (!ok) return;
    if (remoto) {
      const [r1, r2] = await Promise.all(['metas', 'revisoes'].map(t => sb.from(t).delete().eq('edital_id', e.id)));
      if (r1.error || r2.error) {
        console.error('Erro ao reiniciar o planejamento:', r1.error || r2.error);
        aviso('Não foi possível apagar o planejamento no servidor. Nada foi mudado.');
        return;
      }
    }
    metas = metas.filter(m => m.edital_id !== e.id);
    revisoes = revisoes.filter(r => r.edital_id !== e.id);
    if (!remoto) { salvarLocal('metas'); salvarLocal('revisoes'); }
    await regerarSemana();
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
    // A meta de questões continua: ela vem depois do estudo
    const abertas = metas.filter(m => m.topico_id === topicId && !m.concluida && !ehQuestoes(m));
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
  /* O que ler na janela de estudo: [{ nome, de, ate, aprox }] com páginas reais do PDF.
     Meta de estudo em aberto: o trecho desta parte (continua de onde parou, PAGINAS_POR_HORA;
     a última parte vai até o fim). Revisão ou meta concluída: o material inteiro do tópico.
     PDF ligado sem faixa: a posição do trecho no PDF é desconhecida (aprox = páginas contadas). */
  let previstasDoTopico = [];   // metas previstas da última ficha aberta (não são gravadas)

  /* Trechos do assunto nos PDFs, na ordem cadastrada: { m, l, nome, inicio, pags, aprox } */
  /* Assuntos do item com faixa de páginas no PDF, em posições contadas como em paginasLidas
     (as páginas do item em sequência pelos trechos): [{ s, ini, fim }] na ordem das páginas */
  function assuntosNasPaginas(tId) {
    if (!window.estSub) return [];
    const trechos = trechosDoTopico(tId);
    const r = [];
    window.estSub.doTopico(tId).forEach(s => (s.pdfs || []).forEach(p => {
      if (!(p.de > 0 && p.ate >= p.de)) return;
      let pos = 0;
      trechos.forEach(x => {
        if (x.m.id === p.material_id) {
          const a = Math.max(0, p.de - x.inicio), b = Math.min(x.pags, p.ate - x.inicio + 1);
          if (b > a) r.push({ s, ini: pos + a, fim: pos + b });
        }
        pos += x.pags;
      });
    }));
    return r.sort((a, b) => a.ini - b.ini || a.fim - b.fim);
  }
  // Um registro por assunto (o que aparece em mais de um trecho fica com a faixa toda)
  function assuntosUnicos(tId) {
    const por = new Map();
    assuntosNasPaginas(tId).forEach(x => {
      const y = por.get(x.s.id);
      if (!y) por.set(x.s.id, { ...x });
      else { y.ini = Math.min(y.ini, x.ini); y.fim = Math.max(y.fim, x.fim); }
    });
    return [...por.values()];
  }
  const posicaoNoTopico = (ctx, tId) => paginasLidas(tId) + (ctx.planejado[tId] || 0) * PAGINAS_POR_HORA / 60;
  const questoesPorAssunto = (ctx, tId) => (temSubMeta && !ctx.comQuestoes.has(tId) ? assuntosUnicos(tId) : []);

  const PAG_PARTE = PARTE_MAX * PAGINAS_POR_HORA / 60;   // páginas de uma meta de até PARTE_MAX
  /* Item com assuntos com páginas: a leitura é cortada nos limites dos assuntos. O assunto grande
     vira partes iguais de até PARTE_MAX; os curtos seguidos ficam juntos até PARTE_MAX. Páginas sem
     assunto entram do mesmo jeito. Devolve onde cada parte acaba (posições do item), ou null. */
  function cortesDoTopico(tId) {
    const total = Math.round(paginasDoTopico(tId));
    const ass = assuntosNasPaginas(tId);
    if (!ass.length || !total) return null;
    const pecas = [];
    const add = (a, b) => {
      const n = Math.ceil((b - a) / PAG_PARTE);
      for (let i = 0; i < n; i++) pecas.push([a + Math.round((b - a) * i / n), a + Math.round((b - a) * (i + 1) / n)]);
    };
    let pos = 0;
    ass.forEach(x => {
      const b = Math.min(total, x.fim);
      if (b <= pos) return;
      if (x.ini > pos) add(pos, Math.min(x.ini, total));
      add(Math.max(pos, x.ini), b);
      pos = b;
    });
    if (pos < total) add(pos, total);
    const fins = [];
    let ini = 0;
    pecas.forEach(([a, b]) => { if (b - ini > PAG_PARTE + 0.01 && a > ini) { fins.push(a); ini = a; } });
    fins.push(total);
    return fins;
  }

  function trechosDoTopico(tId) {
    return materiais.map(m => {
      const l = (m.topicos || []).find(x => x.topico_id === tId);
      if (!l) return null;
      const faixa = l.de > 0 && l.ate >= l.de;
      const pags = Math.round(faixa ? Math.min(l.ate, m.paginas || l.ate) - l.de + 1 : contarPaginas([m])[tId] || 0);
      return pags > 0 ? { m, l, nome: m.nome, inicio: faixa ? l.de : 1, pags, aprox: !faixa && (m.topicos || []).length > 1 } : null;
    }).filter(Boolean);
  }

  /* Página do PDF ↔ páginas lidas do assunto (contadas em sequência pelos trechos) */
  function lidasAtePagina(trechos, idx, pag) {
    const antes = trechos.slice(0, idx).reduce((a, x) => a + x.pags, 0);
    return antes + Math.max(0, Math.min(trechos[idx].pags, pag - trechos[idx].inicio + 1));
  }
  function paginaDasLidas(trechos, lidas) {
    let pos = 0;
    for (let i = 0; i < trechos.length; i++) {
      if (lidas <= pos + trechos[i].pags || i === trechos.length - 1) {
        return { idx: i, pag: trechos[i].inicio + Math.max(0, Math.min(trechos[i].pags, lidas - pos) - 1) };
      }
      pos += trechos[i].pags;
    }
    return { idx: 0, pag: 0 };
  }

  /* "Terminei" na página P de um PDF dividido em faixas: o assunto passa a acabar em P e o
     seguinte do mesmo PDF começa em P + 1 (a divisão sugerida raramente bate com o fim real). */
  async function ajustarFaixas(trecho, pag) {
    const { m, l } = trecho;
    pag = Math.min(pag, m.paginas || pag);
    if (!(l.de > 0 && l.ate >= l.de) || pag < l.de || pag === l.ate) return;
    const fimAntigo = l.ate;
    l.ate = pag;
    m.topicos.forEach(o => {
      if (o === l || !(o.de > 0) || o.de <= l.de) return;
      if (o.de <= pag || o.de === fimAntigo + 1) { o.de = pag + 1; if (!(o.ate >= o.de)) o.ate = o.de; }
    });
    pagPorTopico = contarPaginas(materiais);
    if (!remotoMat) {
      try { localStorage.setItem('est_plano_materiais', JSON.stringify(materiais)); } catch (e) { console.warn(e); }
      return;
    }
    const { error } = await sb.from('materiais').update({ topicos: m.topicos }).eq('id', m.id);
    if (error) { console.error('Erro ao ajustar as páginas do PDF:', error); aviso('Não foi possível salvar a nova divisão de páginas do PDF.'); }
  }

  function roteiroDeLeitura(tipo, item) {
    const tId = item.topico_id;
    const trechos = trechosDoTopico(tId);
    if (!trechos.length) return [];
    const { ini, fim } = faixaDaMeta(tipo, item, trechos.reduce((a, x) => a + x.pags, 0));
    return recortar(trechos, ini, fim);
  }

  // Páginas [ini, fim) da meta, contadas em sequência pelos trechos do item (como as páginas lidas)
  function faixaDaMeta(tipo, item, total) {
    const tId = item.topico_id;
    let ini = 0, fim = total;
    if (tipo === 'meta' && !item.concluida && !ehQuestoes(item)) {
      const ritmo = min => min * PAGINAS_POR_HORA / 60;
      ini = paginasLidas(tId) + [...metas, ...previstasDoTopico]
        .filter(m => m.topico_id === tId && !m.concluida && m.id !== item.id && !ehQuestoes(m) &&
          (m.dia < item.dia || (m.dia === item.dia && (m.ordem || 0) < (item.ordem || 0))))
        .reduce((a, m) => a + ritmo(m.minutos), 0);
      ini = Math.min(Math.round(ini), total - 1);
      fim = item.partes > 1 && item.parte < item.partes ? Math.min(total, ini + Math.round(ritmo(item.minutos))) : total;
    }
    return { ini, fim };
  }

  // Recorta [ini, fim) nos PDFs do item, na ordem em que estão cadastrados
  function recortar(trechos, ini, fim) {
    const r = [];
    let pos = 0;
    trechos.forEach(x => {
      const a = Math.max(ini, pos), b = Math.min(fim, pos + x.pags);
      if (b > a) r.push({ id: x.m.id, nome: x.nome, de: x.inicio + a - pos, ate: x.inicio + b - pos - 1, aprox: x.aprox });
      pos += x.pags;
    });
    return r;
  }

  // Assuntos (com páginas no PDF) que a meta de estudo cobre, com as páginas de cada um dentro dela
  function assuntosDaMeta(item) {
    if (ehQuestoes(item)) return [];
    const trechos = trechosDoTopico(item.topico_id), ass = assuntosUnicos(item.topico_id);
    if (!trechos.length || !ass.length) return [];
    const { ini, fim } = faixaDaMeta('meta', item, trechos.reduce((a, x) => a + x.pags, 0));
    return ass.filter(a => a.fim > ini && a.ini < fim).map(a => {
      const de = Math.max(a.ini, ini), ate = Math.min(a.fim, fim);
      return { s: a.s, paginas: ate - de, trecho: recortar(trechos, de, ate) };
    });
  }

  /* Janela de estudo (estudos.sessao.js): cronômetro e resumo do tópico */
  function abrirEstudo(tipo, id) {
    // Meta prevista (ficha do Edital): abre sem cronômetro nem "Concluir", só resumo e leitura
    const item = tipo === 'meta' ? metas.find(m => m.id === id) || previstasDoTopico.find(m => m.id === id) : revisoes.find(r => r.id === id);
    if (!item || !window.estSessao) return;
    const ref = acharTopico(item.topico_id);
    if (!ref) { aviso('Este tópico não existe mais no edital.'); return; }
    const rotulo = (item.previsto ? 'Previsto · ' : '') + (tipo !== 'meta' ? rotuloRevisao(item)
      : ehQuestoes(item) ? `Questões · ${questoesDaMeta(item)}${nomeDoAssunto(item)}`
      : 'Estudo' + (item.partes > 1 ? ` · parte ${item.parte}/${item.partes}` : ''));
    const assMeta = tipo === 'meta' && !item.concluida ? assuntosDaMeta(item) : [];
    window.estSessao.abrir({
      tipo, id: item.previsto ? undefined : id, topicoId: ref.t.id, disc: ref.d.nome, topico: ref.t.nome, rotulo,
      minutos: tipo === 'meta' ? item.minutos : item.minutos || MIN_REVISAO,
      concluida: tipo === 'meta' ? !!item.concluida : !!item.concluida_em,
      leitura: roteiroDeLeitura(tipo, item),
      leituraParcial: tipo === 'meta' && !item.concluida && item.partes > 1 && !ehQuestoes(item),
      questoes: tipo === 'meta' && ehQuestoes(item) ? questoesDaMeta(item) : 0,
      subtopicoId: item.subtopico_id || (assMeta[0] && assMeta[0].s.id) || undefined   // abre já no assunto da meta
    });
  }

  /* minutosCrono: tempo do cronômetro da janela de estudo, quando houver */
  function abrirConclusao(tipo, id, minutosCrono = 0) {
    const item = tipo === 'meta' ? metas.find(m => m.id === id) : revisoes.find(r => r.id === id);
    if (!item) return;
    const ref = acharTopico(item.topico_id);
    if (!ref) { aviso('Este tópico não existe mais no edital.'); return; }
    contextoConclusao = { tipo, id };

    const questoesMeta = tipo === 'meta' && ehQuestoes(item);
    const titulo = questoesMeta ? 'Concluir questões' : tipo === 'meta' ? 'Concluir meta'
      : item.tipo === 'reforco' ? 'Concluir reforço' : `Concluir revisão ${item.etapa}`;
    document.getElementById('est-concluir-titulo').textContent = titulo;
    document.getElementById('est-concluir-topico').textContent = `${ref.d.nome} — ${ref.t.nome}`;
    // Tópico com PDF: pergunta até onde leu; só "Terminei este PDF" fecha o tópico
    const totalPags = tipo === 'meta' && !questoesMeta ? Math.round(paginasDoTopico(item.topico_id)) : 0;
    const lidas = totalPags ? paginasLidas(item.topico_id) : 0;
    const alvo = Math.min(totalPags, lidas + Math.round(item.minutos / 60 * PAGINAS_POR_HORA));
    contextoConclusao.totalPags = totalPags;
    const trechos = totalPags ? trechosDoTopico(item.topico_id) : [];
    contextoConclusao.trechos = trechos;
    document.getElementById('est-concluir-pdf').style.display = trechos.length ? '' : 'none';
    const alvoPdf = paginaDasLidas(trechos, alvo);
    const parou = lidas ? paginaDasLidas(trechos, lidas) : null;
    if (trechos.length) {
      const sel = document.getElementById('est-concluir-pdf-sel');
      sel.innerHTML = trechos.map((x, i) => `<option value="${i}">${escapeHtml(x.nome)} (págs. ${x.inicio}–${x.inicio + x.pags - 1})</option>`).join('');
      sel.value = String(alvoPdf.idx);
      sel.style.display = trechos.length > 1 ? '' : 'none';
      document.getElementById('est-concluir-pag').value = alvoPdf.pag;
      mostrarFaixaConclusao();
      document.getElementById('est-concluir-terminei').checked = alvo >= totalPags;
    }
    const parte = item.partes > 1 ? `Parte ${item.parte} de ${item.partes}. ` : '';
    document.getElementById('est-concluir-dica').textContent = questoesMeta
      ? `Resolva ${questoesDaMeta(item)} questões do assunto (do PDF ou do TEC) e informe quantas acertou.`
      : trechos.length
      ? `${parte}Leia até a página ${alvoPdf.pag} (${parou ? `você parou na ${parou.pag}` : 'começando do início'}). Se o assunto acabou em outra página, informe a página real: o próximo trecho começa na seguinte. Ao terminar o assunto, marque "Terminei este PDF": só então a primeira revisão é agendada, conforme o seu acerto.`
      : tipo === 'meta'
      ? 'Teoria e caderno de questões do tópico. Ao concluir, a primeira revisão é agendada conforme o seu acerto.'
      : `Refaça o caderno do TEC deste tópico. Quanto maior o acerto, mais longe fica a próxima revisão; abaixo de ${ACERTO_REFORCO}% entra um reforço.`;

    const minutos = minutosCrono || (window.estSessao && window.estSessao.minutosDe(id)) ||
      (tipo === 'meta' ? item.minutos : item.minutos || MIN_REVISAO);
    document.getElementById('est-concluir-h').value = Math.floor(minutos / 60) || '';
    document.getElementById('est-concluir-m').value = minutos % 60 || '';
    document.getElementById('est-concluir-q').value = questoesMeta ? questoesDaMeta(item) : '';
    document.getElementById('est-concluir-c').value = '';
    document.getElementById('est-concluir-tec').value = ref.t.tecLink || '';
    montarAssuntosConclusao(tipo, item, ref, questoesMeta);
    document.getElementById('est-modal-concluir').classList.add('active');
  }

  /* Divisão por assunto (opcional). Meta de estudo: os assuntos com tempo no cronômetro ou ligados aos
     PDFs da meta (sem nenhum desses, todos os do item). Revisão e meta de questões: todos os do item;
     na de questões, a sugestão de cada um vai no campo vazio. */
  function montarAssuntosConclusao(tipo, item, ref, questoesMeta) {
    const caixa = document.getElementById('est-concluir-assuntos');
    const sub = window.estSub;
    if (!caixa) return;
    if (item.subtopico_id) { caixa.hidden = true; return; }   // meta de um assunto: o registro vai direto para ele
    const todos = sub && sub.temSessoes() ? sub.doTopico(ref.t.id) : [];
    const tempos = window.estSessao ? window.estSessao.tempoPorAssunto(contextoConclusao.id) : {};
    const mats = new Set(roteiroDeLeitura(tipo, item).map(x => x.id));
    let lista = tipo === 'meta' && !questoesMeta ? todos.filter(s => tempos[s.id] > 0 || s.pdfs.some(x => mats.has(x.material_id))) : todos;
    if (!lista.length) lista = todos;
    const cotas = questoesMeta && lista.length ? sub.distribuir(ref.t.id, questoesDaMeta(item)) : {};
    caixa.hidden = !lista.length;
    caixa.open = lista.some(s => tempos[s.id] > 0) || questoesMeta;
    document.getElementById('est-concluir-assuntos-lista').innerHTML = lista.map(s => `
      <div class="est-concluir-ass" data-sub="${s.id}">
        <span title="${attr(s.nome)}">${escapeHtml(s.nome)}</span>
        <input type="number" class="est-form-input" min="0" data-k="minutos" value="${tempos[s.id] || ''}" placeholder="0" aria-label="Minutos em ${attr(s.nome)}" />
        <input type="number" class="est-form-input" min="0" data-k="questoes" placeholder="${cotas[s.id] ? '≈' + cotas[s.id] : '0'}" aria-label="Questões feitas de ${attr(s.nome)}" />
        <input type="number" class="est-form-input" min="0" data-k="acertos" placeholder="0" aria-label="Questões certas de ${attr(s.nome)}" />
      </div>`).join('');
  }

  function lerAssuntosConclusao() {
    const caixa = document.getElementById('est-concluir-assuntos');
    if (!caixa || caixa.hidden) return [];
    return [...caixa.querySelectorAll('.est-concluir-ass[data-sub]')].map(l => {
      const v = k => Math.max(0, parseInt(l.querySelector(`[data-k="${k}"]`).value, 10) || 0);
      const questoes = v('questoes');
      return { subtopico_id: l.dataset.sub, minutos: v('minutos'), questoes, acertos: Math.min(v('acertos'), questoes) };
    }).filter(x => x.minutos || x.questoes);
  }

  function mostrarFaixaConclusao() {
    const x = contextoConclusao.trechos[parseInt(document.getElementById('est-concluir-pdf-sel').value, 10) || 0];
    if (!x) return;
    document.getElementById('est-concluir-pag').max = x.m.paginas || '';
    document.getElementById('est-concluir-pag-total').textContent =
      `do PDF (o assunto: págs. ${x.inicio}–${x.inicio + x.pags - 1}${x.aprox ? ', aprox.' : ''})`;
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
    // Divisão por assunto: os totais sobem se a soma dos assuntos passar deles; o resto fica sem subtópico
    const assuntos = lerAssuntosConclusao();
    const somaAss = k => assuntos.reduce((a, x) => a + x[k], 0);
    const minutos = Math.max(val('est-concluir-h') * 60 + val('est-concluir-m'), somaAss('minutos'));
    const questoes = Math.max(val('est-concluir-q'), somaAss('questoes'));
    const acertos = Math.min(Math.max(val('est-concluir-c'), somaAss('acertos')), questoes);
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
    const questoesMeta = ctx.tipo === 'meta' && ehQuestoes(item);
    const comPdf = ctx.tipo === 'meta' && ctx.totalPags > 0 && ctx.trechos.length > 0;
    const terminou = !comPdf || document.getElementById('est-concluir-terminei').checked;
    const parcial = !terminou;
    // Sem PDF, o tópico dividido em partes só fica estudado na última
    const parteDoMeio = ctx.tipo === 'meta' && !comPdf && item.partes > 1 && item.parte < item.partes;
    if (comPdf) {
      const idx = parseInt(document.getElementById('est-concluir-pdf-sel').value, 10) || 0;
      const pag = val('est-concluir-pag');
      item.paginas_lidas = terminou ? ctx.totalPags : Math.min(ctx.totalPags, lidasAtePagina(ctx.trechos, idx, pag));
      if (terminou && pag) await ajustarFaixas(ctx.trechos[idx], pag);
    }
    if (ctx.tipo === 'meta' && !parcial && !parteDoMeio && !questoesMeta) { t.estudado = true; atualizacao.estudado = true; }
    saveEditais();
    fecharConclusao();
    if (window.estSessao) window.estSessao.zerarCrono(ctx.id);

    // Meta de um assunto (questões) ou de assuntos com páginas (estudo), sem divisão à mão: o registro vai para eles
    if (!assuntos.length && ctx.tipo === 'meta' && window.estSub && window.estSub.temSessoes()) {
      if (item.subtopico_id) assuntos.push({ subtopico_id: item.subtopico_id, minutos, questoes, acertos });
      else if (!questoesMeta) {
        const ass = assuntosDaMeta(item), pags = ass.reduce((a, x) => a + x.paginas, 0);
        if (pags > 0) ass.forEach(a => assuntos.push({ subtopico_id: a.s.id, minutos: Math.round(minutos * a.paginas / pags),
          questoes: ass.length === 1 ? questoes : 0, acertos: ass.length === 1 ? acertos : 0 }));
      }
    }
    // Registra a sessão no histórico
    const sessao = {
      id: novoId('s'), date: hoje(), timestamp: new Date().toISOString(),
      editalId: e.id, discId: d.id, topicId: t.id, discipline: d.nome, topic: t.nome,
      timeMinutes: minutos, questionsTotal: questoes, questionsCorrect: acertos,
      tipo: ctx.tipo === 'meta' ? 'estudo' : item.tipo, metaDone: ctx.tipo === 'meta' && !parcial && !parteDoMeio && !questoesMeta,
      ...(assuntos.length ? { assuntos } : {})
    };
    studyData.push(sessao);
    saveData();
    sessaoCriada(sessao);

    if (ctx.tipo === 'meta') {
      item.concluida = true;
      gravar('metas', item);
      if (questoesMeta) {
        aviso(questoes ? `Questões registradas: ${acertos} de ${questoes} (${pct}%).` : 'Meta de questões concluída.');
      } else if (parcial) {
        // O número de partes muda com o ritmo real: atualiza o "de N" das partes já na semana
        const abertas = metas.filter(m => m.topico_id === t.id && !m.concluida && m.partes && !ehQuestoes(m));
        const proj = projetar(e);
        const ultima = proj && proj.semanas.flatMap(w => w.metas).filter(m => m.topico_id === t.id).pop();
        const total = ultima ? ultima.partes : Math.max(item.parte || 1, ...abertas.map(m => m.parte || 1));
        abertas.forEach(m => { m.partes = total; });
        if (abertas.length) gravar('metas', abertas);
        aviso(`Progresso salvo: ${item.paginas_lidas} de ${ctx.totalPags} páginas. O restante continua no plano.`);
      } else if (parteDoMeio) {
        aviso(`Parte ${item.parte} de ${item.partes} concluída. As outras continuam no plano.`);
      } else {
        // Terminou antes do previsto: as partes que sobraram saem do plano
        const sobras = metas.filter(m => m.topico_id === t.id && !m.concluida && m.id !== item.id && !ehQuestoes(m)).map(m => m.id);
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
    const porPdf = document.getElementById('est-btn-por-pdf');
    if (porPdf) porPdf.addEventListener('click', perguntarEditalPorPdf);
    const overlay = document.getElementById('est-modal-concluir');
    if (!overlay) return;
    document.getElementById('est-modal-concluir-close').addEventListener('click', fecharConclusao);
    overlay.addEventListener('click', ev => { if (ev.target === overlay) fecharConclusao(); });
    // Chegar à última página do assunto marca "Terminei este PDF" (dá para desmarcar)
    const pag = document.getElementById('est-concluir-pag');
    const terminei = document.getElementById('est-concluir-terminei');
    const fimDoAssunto = () => {
      const tr = contextoConclusao && contextoConclusao.trechos;
      const x = tr && tr[tr.length - 1];
      return x ? x.inicio + x.pags - 1 : 0;
    };
    pag.addEventListener('input', () => {
      const fim = fimDoAssunto();
      const ultimo = document.getElementById('est-concluir-pdf-sel').value === String(contextoConclusao.trechos.length - 1);
      if (fim && ultimo) terminei.checked = (parseInt(pag.value, 10) || 0) >= fim;
    });
    terminei.addEventListener('change', () => {
      if (terminei.checked && !pag.value) pag.value = fimDoAssunto();
    });
    document.getElementById('est-concluir-pdf-sel').addEventListener('change', mostrarFaixaConclusao);
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

  /* Metas do tópico para a ficha do Edital: as gravadas e, no edital ativo, as previstas
     das próximas semanas. Cada uma com { dia, rotulo, situacao, id?, previsto? }. */
  function metasDoTopico(topicId) {
    const ref = acharTopico(topicId);
    if (!ref) return [];
    const proj = ref.e.id === currentEditalId ? projetar(ref.e) : null;
    const futuras = proj ? proj.semanas.flatMap(w => w.metas).filter(m => m.topico_id === topicId) : [];
    previstasDoTopico = futuras;
    return [...metas.filter(m => m.topico_id === topicId), ...futuras]
      .sort((a, b) => a.dia.localeCompare(b.dia) || (a.ordem || 0) - (b.ordem || 0))
      .map(m => ({
        id: m.id, dia: m.dia, previsto: !!m.previsto,
        rotulo: (ehQuestoes(m) ? `Questões · ${questoesDaMeta(m)}${nomeDoAssunto(m)}` : 'Estudo' + (m.partes > 1 ? ` · parte ${m.parte}/${m.partes}` : '')) + ` · ${fmtMin(m.minutos)}`,
        situacao: m.concluida ? 'feita' : m.previsto ? 'prevista' : m.dia < hoje() ? 'atrasada' : 'planejada'
      }));
  }

  // Linha do card no plano: o PDF e as páginas a ler (as mesmas do "Ler agora"); sem PDF, o tópico
  const txtPags = x => `p. ${x.de === x.ate ? x.de : `${x.de}–${x.ate}`}`;
  const listaE = l => (l.length > 1 ? l.slice(0, -1).join(', ') + ' e ' + l[l.length - 1] : l[0] || '');
  const nomeDoAssunto = m => {
    const s = m.subtopico_id && window.estSub && window.estSub.porId(m.subtopico_id);
    return s ? ` · ${s.nome}` : '';
  };
  // Com assuntos com páginas: "Estude Hífen (p. 13–15) e Acentuação (p. 16–25) · 📄 PDF, p. 13–25"
  function linhaDoItem(tipo, item, top) {
    const l = roteiroDeLeitura(tipo, item);
    const pdf = l.length ? '📄 ' + l.map(x => `${x.nome}, ${txtPags(x)}`).join(' · ') : top;
    const ass = tipo === 'meta' && !item.concluida ? assuntosDaMeta(item) : [];
    return ass.length ? `Estude ${listaE(ass.map(a => `${a.s.nome} (${a.trecho.map(txtPags).join(', ')})`))} · ${pdf}` : pdf;
  }

  function textoQuestoesAssunto(m, sub) {
    return `Faça ${questoesDaMeta(m)} questões de ${sub.nome} e registre os erros e as dificuldades no Caderno de Erros` +
      (sub.tec_link ? '' : ' (crie o caderno no TEC, se ainda não tiver)');
  }
  function botaoTecAssunto(sub) {
    return sub.tec_link
      ? `<a class="est-plano-btn" href="${escapeHtml(sub.tec_link)}" target="_blank" rel="noopener" title="Abrir o caderno do TEC de ${escapeHtml(sub.nome)}">TEC ↗</a>`
      : `<button class="est-plano-btn" onclick="estSub.editarTec('${sub.id}').then(() => estPlano.renderTudo())" title="Colar o link do caderno deste assunto no TEC">+ Caderno TEC</button>`;
  }

  function itemMeta(m, { compacto = false } = {}) {
    const ref = acharTopico(m.topico_id);
    const disc = ref ? ref.d.nome : 'Disciplina removida';
    const top = ref ? ref.t.nome : 'Tópico removido';
    const atrasada = !m.concluida && !m.previsto && m.dia < hoje();
    const q = ehQuestoes(m);
    const sub = q && m.subtopico_id && window.estSub ? window.estSub.porId(m.subtopico_id) : null;
    const linha = q ? (sub ? textoQuestoesAssunto(m, sub) : top) : linhaDoItem('meta', m, top);
    const tag = (m.previsto ? 'Previsto' : m.concluida ? '✓ Feito' : atrasada ? 'Atrasada' : q ? 'Questões' : 'Estudo') +
      (q ? ` · ${questoesDaMeta(m)} questões` : m.partes > 1 ? ` · parte ${m.parte}/${m.partes}` : '');
    return `
      <div class="est-plano-item tipo-${q ? 'questoes' : 'estudo'} ${m.concluida ? 'feito' : ''} ${m.previsto ? 'previsto' : ''}">
        <div class="est-plano-item-info"${m.previsto ? '' : abreEstudo('meta', m.id)}>
          <span class="est-plano-tag">${tag} · ${fmtMin(m.minutos)}${seloIncidencia(m.topico_id)}${q ? '' : seloPaginas(m.topico_id)}${seloCrono(m)}</span>
          <span class="est-plano-item-disc">${escapeHtml(disc)}</span>
          <span class="est-plano-item-top" title="${escapeHtml(linha)}">${escapeHtml(linha)}</span>
        </div>
        ${m.concluida || m.previsto ? '' : `
        <div class="est-plano-item-acoes">
          ${compacto ? '' : `<button class="est-plano-btn sutil" onclick="estPlano.removerMeta('${m.id}')" title="Remover meta" aria-label="Remover meta">✕</button>`}
          ${sub ? botaoTecAssunto(sub) : q && ref && !ref.t.tecLink && window.estTec ? `<button class="est-plano-btn" onclick="estTec.criar('${ref.t.id}')" title="Gera no TEC o caderno deste assunto (userscript no Tampermonkey)">📝 Gerar caderno</button>` : botaoTec(ref && ref.t)}
          <button class="est-plano-btn primario" onclick="estPlano.abrirConclusao('meta', '${m.id}')">Concluir</button>
        </div>`}
      </div>`;
  }

  /* Na revisão: assuntos abaixo de 70% (com ao menos 5 questões) pedem mais questões e o registro dos erros */
  function assuntosFracos(tId) {
    const fracos = window.estSub ? window.estSub.numerosDe(tId).assuntos.filter(n => n.q >= 5 && n.c / n.q < 0.7) : [];
    return fracos.length ? `<span class="est-plano-item-fracos">⚠ ${fracos.map(n => `${escapeHtml(n.s.nome)} (${Math.round(n.c / n.q * 100)}%)`).join(', ')}: ` +
      `faça mais ${QUESTOES_POR_ASSUNTO} questões${fracos.length > 1 ? ' de cada' : ''} e registre os erros no Caderno de Erros.</span>` : '';
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
          <span class="est-plano-item-top" title="${escapeHtml(top)}">${escapeHtml(linhaDoItem('revisao', r, top))}
            ${pct !== null && !r.previsto ? `<span class="est-plano-acerto ${classeAcerto(pct)}">${pct}%</span>` : ''}</span>
          ${r.previsto || !ref ? '' : assuntosFracos(ref.t.id)}
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
        ordemPdf: ordemPdfDe(e.id, tr.dataset.disc) || undefined,
        porPdf: porPdfDe(e.id, tr.dataset.disc) || undefined,
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
          ${plano && semanaVista >= atual && projecao && projecao.semanas.some(w => w.metas.length) ? `<button class="est-plano-btn" onclick="estPlano.adiantar()" title="Traz para hoje as metas do próximo dia previsto">⏩ Adiantar</button>` : ''}
          ${plano ? `<button class="est-plano-btn perigo" onclick="estPlano.reiniciarPlanejamento()" title="Apaga todas as metas e revisões deste edital e começa o plano de novo">⟲ Reiniciar do zero</button>` : ''}
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

      ${temMotor && editalPorPdf(e) && !migracaoPendente(e) ? `
      <div class="est-plano-cta">
        <div>
          <strong>Motor de estudos (prévia)</strong>
          <p>Veja a semana que o novo motor geraria com os seus dados de hoje: leitura linear dos PDFs, questões por PDF e revisão de erros. Nada é gravado.</p>
        </div>
        <button class="est-btn-register" onclick="estPlano.verSemanaDoMotor()">Ver a semana do motor</button>
      </div>` : ''}

      ${migracaoPendente(e) ? `
      <div class="est-plano-cta">
        <div>
          <strong>Motor de estudos: falta trazer os dados deste edital</strong>
          <p>Cada PDF e cada subtópico ganha os campos novos (PDF dono, páginas, vínculo com o edital). Você vê o relatório antes de aplicar; as metas de hoje não mudam.</p>
        </div>
        <button class="est-btn-register" onclick="estPlano.migrarMotor()">Ver o que muda</button>
      </div>` : ''}

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
        Tópico com PDF ligado leva o tempo de leitura (${PAGINAS_POR_HORA} páginas por hora). Nenhuma meta de estudo passa de ${fmtMin(PARTE_MAX)}: o tópico maior vira partes.</p>` : ''}
    `;

    const form = document.getElementById('est-plano-config-form');
    if (form) form.addEventListener('submit', ev => { ev.preventDefault(); salvarConfig(form, e); });
  }

  /* =============================================
     SEÇÃO: DESEMPENHO
  ============================================= */
  /* Gráficos em SVG/HTML próprios. Uma série: o azul do painel (--est-blue). Grandeza ordenada
     (mapa de calor, cobertura, maturidade): rampa azul de um tom só, do escuro (menos) ao claro
     (mais), validada no fundo dos cartões (#222640) pela skill de dataviz; SEM_DADO é o trilho.
     Linha de meta/limite em âmbar. O valor de cada marca aparece no balão (data-v/data-l), que só
     complementa: os números também estão nos rótulos, nas legendas e na tabela por disciplina. */
  const RAMPA = ['#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'];
  const SEM_DADO = '#3a4055';
  const TEXTO_SOBRE = { '#256abf': '#fff', '#3987e5': '#fff', '#3a4055': '#fff' };   // nos claros, texto escuro
  const NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const fmtPct1 = v => String(Math.round(v * 10) / 10).replace('.', ',');
  const fmtHoras = min => String(Math.round(min / 6) / 10).replace('.', ',') + 'h';
  // escapeHtml (v5) não troca aspas: dentro de atributo, o nome de um tópico com " quebraria o HTML
  const attr = s => escapeHtml(String(s)).replace(/"/g, '&quot;');
  const balao = (v, l) => `data-v="${attr(v)}" data-l="${attr(l)}"`;

  /* Balão único da seção: segue o ponteiro sobre qualquer marca com data-v e aparece também
     no foco do teclado (barras e colunas do gráfico de acerto têm tabindex) */
  function ligarBalao(el) {
    if (el.dataset.balao) return;
    el.dataset.balao = '1';
    const b = document.createElement('div');
    b.className = 'est-viz-balao';
    b.setAttribute('role', 'tooltip');
    b.hidden = true;
    b.append(document.createElement('strong'), document.createElement('span'));
    document.body.appendChild(b);
    const mostrar = (alvo, x, y) => {
      b.firstChild.textContent = alvo.dataset.v;
      b.lastChild.textContent = alvo.dataset.l || '';
      b.hidden = false;
      const r = b.getBoundingClientRect();
      b.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x - r.width / 2)) + 'px';
      b.style.top = (y - r.height - 12 < 8 ? y + 18 : y - r.height - 12) + 'px';
    };
    const esconder = () => { b.hidden = true; };
    el.addEventListener('pointermove', ev => {
      const alvo = ev.target.closest('[data-v]');
      if (alvo && el.contains(alvo)) mostrar(alvo, ev.clientX, ev.clientY); else esconder();
    });
    el.addEventListener('pointerleave', esconder);
    el.addEventListener('focusin', ev => {
      const alvo = ev.target.closest('[data-v]');
      if (!alvo) return;
      const r = alvo.getBoundingClientRect();
      mostrar(alvo, r.left + r.width / 2, r.top);
    });
    el.addEventListener('focusout', esconder);
    window.addEventListener('scroll', esconder, true);
  }

  /* Barra segmentada alta: um todo dividido em partes { nome, valor, cor, rotulo?, texto? }.
     O rótulo vai dentro do bloco só se couber (ajustarRotulos mede depois de desenhar). */
  function barraSegmentada(partes, rotuloAria) {
    const total = partes.reduce((a, p) => a + p.valor, 0) || 1;
    const blocos = partes.filter(p => p.valor > 0).map(p => {
      const pct = p.valor / total * 100;
      return `<div class="est-viz-seg" style="flex:${p.valor} 1 0;background:${p.cor};color:${TEXTO_SOBRE[p.cor] || '#141624'}"
        ${balao(p.texto || fmtPct1(pct) + '%', p.nome)}><span>${p.rotulo || Math.round(pct) + '%'}</span></div>`;
    }).join('');
    const legenda = partes.map(p => `<span><i style="background:${p.cor}"></i>${escapeHtml(p.nome)}</span>`).join('');
    return `<div class="est-viz-segbar" role="img" aria-label="${attr(rotuloAria)}">${blocos}</div>
      <div class="est-viz-legenda">${legenda}</div>`;
  }

  function ajustarRotulos(el) {
    el.querySelectorAll('.est-viz-seg span').forEach(s => {
      s.hidden = false;
      s.hidden = s.offsetWidth + 12 > s.parentElement.clientWidth;
    });
  }

  /* Escala do eixo em horas: passo "redondo" e topo múltiplo do passo */
  function escalaHoras(maxMin) {
    const h = maxMin / 60;
    const passo = h <= 4 ? 1 : h <= 10 ? 2 : h <= 25 ? 5 : h <= 50 ? 10 : 20;
    return { passo: passo * 60, topo: Math.ceil(h / passo) * passo * 60 };
  }

  /* Coluna com canto de cima arredondado (4px) e base reta */
  function colunaArredondada(x, y, w, base) {
    const r = Math.min(4, w / 2, base - y);
    return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
  }

  function graficoSemanas(semanas, metaMin) {
    const W = 420, H = 200, base = 172, topo = 18, esq = 34;
    const { passo, topo: maxMin } = escalaHoras(Math.max(metaMin, ...semanas.map(s => s.min), 60));
    const y = v => base - (v / maxMin) * (base - topo);
    const banda = (W - esq) / semanas.length;
    const larg = Math.min(24, banda * 0.6);
    let grade = '';
    for (let v = 0; v <= maxMin; v += passo) {
      grade += `<line class="est-viz-grade-linha" x1="${esq}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>
        <text class="est-viz-eixo" x="${esq - 6}" y="${y(v) + 4}" text-anchor="end">${v / 60}h</text>`;
    }
    const barras = semanas.map((s, i) => {
      const x = esq + banda * i + (banda - larg) / 2;
      const atual = i === semanas.length - 1;
      const bateu = metaMin && s.min >= metaMin ? ' · meta batida' : '';
      return `${s.min ? `<path class="est-viz-barra" d="${colunaArredondada(x, y(s.min), larg, base)}" tabindex="0"
          ${balao(fmtMin(s.min) + bateu, (atual ? 'esta semana' : 'semana de ' + fmtData(s.inicio)))}/>` : ''}
        ${atual && s.min ? `<text class="est-viz-rotulo" x="${x + larg / 2}" y="${y(s.min) - 6}" text-anchor="middle">${fmtHoras(s.min)}</text>` : ''}
        <text class="est-viz-eixo" x="${x + larg / 2}" y="${base + 18}" text-anchor="middle">${fmtData(s.inicio)}</text>`;
    }).join('');
    // A meta é explicada no subtítulo do cartão: um rótulo na ponta da linha colide com a barra da semana
    const meta = metaMin ? `<line class="est-viz-meta" x1="${esq}" x2="${W}" y1="${y(metaMin)}" y2="${y(metaMin)}"/>` : '';
    return `<svg class="est-plano-grafico" viewBox="0 0 ${W} ${H}" role="img"
      aria-label="Horas estudadas por semana, nas últimas ${semanas.length} semanas; esta semana: ${fmtMin(semanas[semanas.length - 1].min)}">
      ${grade}${meta}${barras}</svg>`;
  }

  /* Acerto por semana (linha). Semana sem questões interrompe a linha. Cada semana tem uma
     coluna invisível (alvo do ponteiro e do teclado) com a linha-guia vertical. */
  function graficoAcerto(semanas) {
    const W = 420, H = 200, base = 172, topo = 14, esq = 34;
    const y = v => base - (v / 100) * (base - topo);
    const banda = (W - esq) / semanas.length;
    const cx = i => esq + banda * (i + 0.5);
    const pct = s => (s.q ? Math.round((s.c / s.q) * 100) : null);
    let grade = '';
    [0, 50, 100].forEach(v => {
      grade += `<line class="est-viz-grade-linha" x1="${esq}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>
        <text class="est-viz-eixo" x="${esq - 6}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`;
    });
    // Limite do reforço: valor no eixo; a explicação fica no subtítulo do cartão
    const limite = `<line class="est-viz-meta" x1="${esq}" x2="${W}" y1="${y(ACERTO_REFORCO)}" y2="${y(ACERTO_REFORCO)}"/>
      <text class="est-viz-eixo" x="${esq - 6}" y="${y(ACERTO_REFORCO) + 4}" text-anchor="end">${ACERTO_REFORCO}%</text>`;
    let d = '', solto = true;
    semanas.forEach((s, i) => {
      const p = pct(s);
      if (p === null) { solto = true; return; }
      d += `${solto ? 'M' : 'L'}${cx(i)},${y(p)}`;
      solto = false;
    });
    const ultimo = semanas.map((s, i) => ({ p: pct(s), i })).filter(x => x.p !== null).pop();
    const colunas = semanas.map((s, i) => {
      const p = pct(s);
      const quando = i === semanas.length - 1 ? 'esta semana' : 'semana de ' + fmtData(s.inicio);
      return `<g class="est-viz-col" tabindex="0" ${balao(p === null ? 'sem questões' : `${p}% de acerto`,
        p === null ? quando : `${quando} · ${s.c} de ${s.q} questões`)}>
        <rect class="est-viz-hit" x="${esq + banda * i}" y="${topo}" width="${banda}" height="${base - topo}"/>
        <line class="est-viz-cruz" x1="${cx(i)}" x2="${cx(i)}" y1="${topo}" y2="${base}"/>
        ${p !== null ? `<circle class="est-viz-ponto" cx="${cx(i)}" cy="${y(p)}" r="4"/>` : ''}
      </g>`;
    }).join('');
    const eixoX = semanas.map((s, i) => (i % 2 === semanas.length % 2 ? '' :
      `<text class="est-viz-eixo" x="${cx(i)}" y="${base + 18}" text-anchor="middle">${fmtData(s.inicio)}</text>`)).join('');
    return `<svg class="est-plano-grafico" viewBox="0 0 ${W} ${H}" role="img"
      aria-label="Acerto nas questões por semana${ultimo ? `; última semana com questões: ${ultimo.p}%` : ''}">
      ${grade}${limite}<path class="est-viz-linha-serie" d="${d}"/>${colunas}
      ${ultimo ? `<text class="est-viz-rotulo" x="${cx(ultimo.i)}" y="${y(ultimo.p) - 10}" text-anchor="middle">${ultimo.p}%</text>` : ''}
      ${eixoX}</svg>`;
  }

  /* Mapa de calor dos últimos meses: uma coluna por semana (seg → dom), cor pelos minutos do dia */
  function mapaDeCalor(semanas) {
    const h = hoje();
    const inicio = somarDias(segundaDe(h), -7 * (semanas - 1));
    const porDia = {};
    studyData.forEach(s => { if (s.date >= inicio && s.timeMinutes > 0) porDia[s.date] = (porDia[s.date] || 0) + s.timeMinutes; });
    const FAIXAS = [{ ate: 30, nome: 'até 30min' }, { ate: 60, nome: '30min a 1h' }, { ate: 120, nome: '1h a 2h' }, { ate: Infinity, nome: '2h ou mais' }];
    const nivel = m => FAIXAS.findIndex(f => m < f.ate);
    const C = 14, G = 3, X0 = 30, Y0 = 20;
    let celulas = '', meses = '';
    for (let w = 0; w < semanas; w++) {
      const seg = somarDias(inicio, 7 * w);
      const dia1 = Number(seg.slice(8, 10));
      // Nome do mês na 1ª semana cuja segunda-feira já é dele (na 1ª coluna, só se o nome
      // do mês seguinte não for colar nele)
      if ((w > 0 && dia1 <= 7) || (w === 0 && dia1 <= 17)) {
        meses += `<text class="est-viz-eixo" x="${X0 + w * (C + G)}" y="12">${NOMES_MES[Number(seg.slice(5, 7)) - 1]}</text>`;
      }
      for (let i = 0; i < 7; i++) {
        const dia = somarDias(seg, i);
        if (dia > h) continue;
        const m = porDia[dia] || 0;
        celulas += `<rect x="${X0 + w * (C + G)}" y="${Y0 + i * (C + G)}" width="${C}" height="${C}" rx="3"
          fill="${m ? RAMPA[nivel(m)] : SEM_DADO}" ${balao(m ? fmtMin(m) : 'sem estudo', `${DIAS_CURTOS[diaDaSemana(dia)]} ${fmtData(dia)}`)}/>`;
      }
    }
    const dias = ['Seg', 'Qua', 'Sex'].map((nome, k) =>
      `<text class="est-viz-eixo" x="${X0 - 6}" y="${Y0 + k * 2 * (C + G) + C - 3}" text-anchor="end">${nome}</text>`).join('');
    const W = X0 + semanas * (C + G), H = Y0 + 7 * (C + G);
    const legenda = [{ cor: SEM_DADO, nome: 'sem estudo' }, ...FAIXAS.map((f, i) => ({ cor: RAMPA[i], nome: f.nome }))]
      .map(x => `<span><i style="background:${x.cor}"></i>${x.nome}</span>`).join('');
    return `<div class="est-viz-mapa-wrap">
      <svg class="est-viz-mapa" viewBox="0 0 ${W} ${H}" role="img"
        aria-label="Minutos estudados por dia nas últimas ${semanas} semanas (detalhes de cada dia no Histórico)">${meses}${dias}${celulas}</svg>
      <div class="est-viz-legenda">${legenda}</div></div>`;
  }

  /* Dias seguidos com estudo até hoje (hoje ainda sem estudo não quebra a sequência) e a maior */
  function sequencias() {
    const dias = new Set(studyData.filter(s => s.timeMinutes > 0).map(s => s.date));
    let atual = 0, d = hoje();
    if (!dias.has(d)) d = somarDias(d, -1);
    while (dias.has(d)) { atual++; d = somarDias(d, -1); }
    let maior = 0, run = 0, ant = null;
    [...dias].sort().forEach(x => { run = ant && diasEntre(ant, x) === 1 ? run + 1 : 1; maior = Math.max(maior, run); ant = x; });
    return { atual, maior };
  }

  /* Cobertura da prova: quanto do que costuma cair já foi estudado. Dentro da disciplina, cada
     tópico pesa pela incidência do TEC (sem planilha, todos pesam igual); entre disciplinas, pelo
     "Peso na prova" da configuração do plano. Tópico estudado conta inteiro; tópico com PDF em
     leitura conta a fração das páginas lidas. Ganhos: os tópicos que mais somariam se estudados. */
  function cobertura(e, plano) {
    const discs = e.disciplinas.filter(d => d.topicos.length).map(d => {
      const inc = incidenciaDaDisciplina(d);
      const topicos = d.topicos.map(t => {
        const pags = paginasDoTopico(t.id);
        return {
          t, w: inc ? (incPorTopico[t.id] || 0) / inc.soma : 1 / d.topicos.length,
          feito: t.estudado ? 1 : 0, parcial: !t.estudado && pags ? Math.min(1, paginasLidas(t.id) / pags) : 0
        };
      });
      const soma = k => topicos.reduce((a, x) => a + x.w * x[k], 0);
      return { d, inc: !!inc, peso: configDisc(plano, d.id).peso, topicos, estudado: soma('feito'), andamento: soma('parcial') };
    });
    const somaPeso = discs.reduce((a, x) => a + x.peso, 0) || 1;
    discs.forEach(x => { x.fatia = x.peso / somaPeso; });
    const total = k => discs.reduce((a, x) => a + x.fatia * x[k], 0);
    const ganhos = discs.flatMap(x => x.topicos.filter(y => !y.t.estudado && y.w > 0)
      .map(y => ({ d: x.d, t: y.t, ganho: x.fatia * y.w * (1 - y.parcial) })))
      .sort((a, b) => b.ganho - a.ganho).slice(0, 5);
    return { discs, estudado: total('estudado'), andamento: total('andamento'), comInc: discs.filter(x => x.inc).length, ganhos };
  }

  /* Etapa de cada tópico do edital, do estudo ao domínio (revisões do plano) */
  const ETAPAS_MATURIDADE = ['Não estudado', 'Estudado', '1 revisão', '2 revisões', '3+ revisões', 'Dominado'];
  function maturidade(e) {
    const n = ETAPAS_MATURIDADE.map(() => 0);
    const porTopico = {};
    revisoes.forEach(r => { (porTopico[r.topico_id] = porTopico[r.topico_id] || []).push(r); });
    e.disciplinas.forEach(d => d.topicos.forEach(t => {
      if (!t.estudado) { n[0]++; return; }
      const revs = porTopico[t.id] || [];
      const feitas = revs.filter(r => r.concluida_em && r.tipo !== 'reforco').length;
      if (feitas && !revs.some(r => !r.concluida_em)) n[5]++;
      else n[1 + Math.min(3, feitas)]++;
    }));
    return n;
  }

  function htmlCobertura(cob) {
    const estudado = cob.estudado * 100, andamento = cob.andamento * 100;
    const falta = Math.max(0, 100 - estudado - andamento);
    const linhas = [...cob.discs].sort((a, b) => b.fatia - a.fatia).map(x => {
      const pE = x.estudado * 100, pA = x.andamento * 100;
      return `<div class="est-viz-linha" ${balao(fmtPct1(pE + pA) + '% coberto',
        `${x.d.nome} · estudado ${fmtPct1(pE)}%${pA >= 0.05 ? ` · em leitura ${fmtPct1(pA)}%` : ''} · ${fmtPct1(x.fatia * 100)}% da prova`)}>
        <span class="est-viz-linha-nome">${escapeHtml(x.d.nome)}<small>peso ${NOMES_PESO[x.peso].toLowerCase()} · ${x.inc ? 'pela incidência' : 'por tópicos'}</small></span>
        <span class="est-viz-fina">${pE > 0 ? `<i style="width:${pE}%;background:${RAMPA[2]}"></i>` : ''}${pA > 0 ? `<i style="width:${pA}%;background:${RAMPA[0]}"></i>` : ''}</span>
        <strong>${Math.round(pE + pA)}%</strong>
      </div>`;
    }).join('');
    const ganhos = cob.ganhos.map(g => `<li>${escapeHtml(g.t.nome)}<small>${escapeHtml(g.d.nome)}</small>
      <strong>+${fmtPct1(g.ganho * 100)} ${Math.round(g.ganho * 1000) === 10 ? 'ponto' : 'pontos'}</strong></li>`).join('');
    return `
      <div class="est-plano-card">
        <h3 class="est-plano-card-title">🎯 Cobertura da prova</h3>
        <div class="est-viz-heroi">
          <strong>${fmtPct1(estudado + andamento)}%</strong>
          <span>do que costuma cair na prova já foi estudado${andamento >= 0.05
            ? ` (${fmtPct1(estudado)}% concluído e ${fmtPct1(andamento)}% em PDFs que você está lendo)` : ''}.</span>
        </div>
        ${barraSegmentada([
          { nome: 'Estudado', valor: estudado, cor: RAMPA[2] },
          { nome: 'Em leitura', valor: andamento, cor: RAMPA[0] },
          { nome: 'Falta estudar', valor: falta, cor: SEM_DADO }
        ], `Cobertura da prova: ${fmtPct1(estudado)}% estudado, ${fmtPct1(andamento)}% em leitura, ${fmtPct1(falta)}% falta estudar`)}
        <p class="est-plano-sub est-viz-nota">Como é calculado: dentro de cada disciplina, cada tópico pesa pelas questões dele na planilha
          de incidência do TEC (${cob.comInc} de ${cob.discs.length} disciplina${cob.discs.length === 1 ? '' : 's'} com planilha; nas outras,
          todos os tópicos pesam igual). Entre as disciplinas, vale o “Peso na prova” da configuração do plano. Tópico com PDF em leitura
          conta pela fração das páginas lidas.</p>
        <div class="est-viz-grade">
          <div>
            <h4 class="est-viz-sub">Por disciplina</h4>
            ${linhas}
          </div>
          <div>
            <h4 class="est-viz-sub">Maior ganho de cobertura</h4>
            ${ganhos ? `<p class="est-plano-sub">Os tópicos ainda não estudados que mais aumentam a cobertura:</p><ol class="est-viz-ganhos">${ganhos}</ol>`
              : '<p class="est-plano-vazio">Todos os tópicos que costumam cair já foram estudados.</p>'}
          </div>
        </div>
      </div>`;
  }

  function htmlMaturidade(e) {
    const n = maturidade(e);
    const total = n.reduce((a, x) => a + x, 0);
    const cores = [SEM_DADO, ...RAMPA];
    return `
      <div class="est-plano-card">
        <h3 class="est-plano-card-title">🌱 Maturidade do edital <span class="est-plano-sub">(${total} tópicos)</span></h3>
        ${barraSegmentada(ETAPAS_MATURIDADE.map((nome, i) => ({
          nome, valor: n[i], cor: cores[i], rotulo: String(n[i]), texto: `${n[i]} tópico${n[i] === 1 ? '' : 's'}`
        })), 'Tópicos por etapa: ' + ETAPAS_MATURIDADE.map((nome, i) => `${nome}: ${n[i]}`).join(', '))}
        <p class="est-plano-sub est-viz-nota">Cada revisão feita leva o tópico uma etapa adiante. Dominado é o tópico que saiu da fila de revisões
          (o próximo intervalo passaria de ${INTERVALO_MAX} dias).</p>
      </div>`;
  }

  function htmlConstancia() {
    const h = hoje();
    const seq = sequencias();
    const dias30 = new Set(studyData.filter(s => s.timeMinutes > 0 && s.date > somarDias(h, -30) && s.date <= h).map(s => s.date)).size;
    return `
      <div class="est-plano-card">
        <h3 class="est-plano-card-title">🔥 Constância <span class="est-plano-sub">(últimos 6 meses)</span></h3>
        <div class="est-viz-constancia">
          ${mapaDeCalor(26)}
          <div class="est-viz-numeros">
            <div><strong>${seq.atual}</strong><span>${seq.atual === 1 ? 'dia seguido' : 'dias seguidos'} com estudo</span></div>
            <div><strong>${seq.maior}</strong><span>maior sequência</span></div>
            <div><strong>${dias30}</strong><span>de 30 dias com estudo</span></div>
          </div>
        </div>
      </div>`;
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
      ...metas.filter(m => m.edital_id === e.id && m.concluida && !ehQuestoes(m) && m.dia >= desde).map(m => m.topico_id)
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
    ligarBalao(el);
    const e = editalAtivo();
    const plano = e ? planoDe(e.id) : null;
    const metaMin = plano ? Number(plano.horas_semana) * 60 : 0;
    const h = hoje();
    const atual = segundaDe(h);

    // Últimas 12 semanas: minutos e questões (o gráfico de horas mostra as 8 últimas)
    const semanas = [];
    for (let i = 11; i >= 0; i--) {
      const inicio = somarDias(atual, -7 * i), fim = somarDias(inicio, 6);
      const doPeriodo = studyData.filter(s => s.date >= inicio && s.date <= fim);
      semanas.push({
        inicio,
        min: doPeriodo.reduce((a, s) => a + (s.timeMinutes || 0), 0),
        q: doPeriodo.reduce((a, s) => a + (s.questionsTotal || 0), 0),
        c: doPeriodo.reduce((a, s) => a + (s.questionsCorrect || 0), 0)
      });
    }
    const estaSemana = semanas[semanas.length - 1];
    const ult7 = minutosEstudados(somarDias(h, -6), h);
    const diasComEstudo = new Set(studyData.filter(s => s.date >= somarDias(h, -6) && s.timeMinutes > 0).map(s => s.date)).size;
    const atrasadas = revisoes.filter(r => !r.concluida_em && r.data_prevista < h).length;
    const feitas = revisoes.filter(r => r.concluida_em);
    const revAcerto = feitas.filter(r => r.acerto !== null && r.acerto !== undefined);
    const mediaRev = revAcerto.length ? Math.round(revAcerto.reduce((a, r) => a + r.acerto, 0) / revAcerto.length) : null;
    const cob = e ? cobertura(e, plano) : null;
    const comQuestoes = semanas.some(s => s.q > 0);

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
        const cd = cob.discs.find(x => x.d.id === d.id);
        return `<tr>
          <td>${escapeHtml(d.nome)}</td>
          <td><div class="est-plano-celula-barra"><span>${done}/${total}</span>${barra(total ? done / total * 100 : 0)}</div></td>
          <td>${cd ? Math.round((cd.estudado + cd.andamento) * 100) + '%' : '—'}</td>
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

      ${cob && cob.discs.length ? htmlCobertura(cob) : ''}

      <div class="est-plano-kpis">
        <div class="est-plano-kpi"><span>Esta semana</span><strong>${fmtMin(estaSemana.min)}${metaMin ? ` <small>/ ${fmtMin(metaMin)}</small>` : ''}</strong>${metaMin ? barra(estaSemana.min / metaMin * 100, 'blue') : ''}</div>
        <div class="est-plano-kpi"><span>Média diária (7 dias)</span><strong>${fmtMin(ult7 / 7)}</strong><small>${diasComEstudo} de 7 dias com estudo</small></div>
        <div class="est-plano-kpi"><span>Acerto nas revisões</span><strong>${mediaRev !== null ? mediaRev + '%' : '—'}</strong><small>${feitas.length} revisões feitas</small></div>
        <div class="est-plano-kpi ${atrasadas ? 'alerta' : ''}"><span>Revisões atrasadas</span><strong>${atrasadas}</strong></div>
      </div>

      ${htmlConstancia()}

      <div class="est-viz-duas">
        <div class="est-plano-card">
          <h3 class="est-plano-card-title">⏱ Horas por semana ${metaMin ? `<span class="est-plano-sub">(tracejado: meta de ${fmtMin(metaMin)})</span>` : ''}</h3>
          ${graficoSemanas(semanas.slice(-8), metaMin)}
        </div>
        <div class="est-plano-card">
          <h3 class="est-plano-card-title">✅ Acerto nas questões por semana <span class="est-plano-sub">(tracejado: ${ACERTO_REFORCO}%; abaixo disso entra reforço)</span></h3>
          ${comQuestoes ? graficoAcerto(semanas)
            : '<p class="est-plano-vazio">Registre questões (ao concluir metas e revisões) para ver a evolução do acerto.</p>'}
        </div>
      </div>

      ${e ? htmlMaturidade(e) : ''}

      ${e ? `<div class="est-plano-card"><h3 class="est-plano-card-title">🔮 Previsão</h3><p class="est-plano-texto">${previsao(e, plano)}</p></div>` : ''}

      ${e ? `
      <div class="est-plano-card">
        <h3 class="est-plano-card-title">Por disciplina</h3>
        <div class="est-plano-tabela-wrap">
          <table class="est-plano-tabela">
            <thead><tr><th>Disciplina</th><th>Tópicos</th><th>Cobertura</th><th>Tempo</th><th>Questões</th><th>Acerto</th></tr></thead>
            <tbody>${linhasDisc}</tbody>
          </table>
        </div>
      </div>

      ${window.estSub ? window.estSub.htmlDesempenho() : ''}

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
    ajustarRotulos(el);
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

  /* =============================================
     APROVEITAR ESTUDOS DE OUTRO EDITAL (js/estudos.aproveitar.js)
     ligacoes: { idTópicoNovo: idTópicoAntigo }; discs: { idDiscNova: idDiscAntiga }.
     Copia para o edital novo as revisões, os PDFs e o peso/nível das disciplinas;
     o edital antigo fica como estava. O que o tópico novo já tiver não é duplicado.
  ============================================= */
  async function aproveitarDe(novo, antigo, ligacoes, discs) {
    const discDoNovo = {};
    novo.disciplinas.forEach(d => d.topicos.forEach(t => { discDoNovo[t.id] = d.id; }));
    const novosDe = {};   // tópico antigo → tópicos novos ligados a ele
    Object.entries(ligacoes).forEach(([n, a]) => { (novosDe[a] = novosDe[a] || []).push(n); });

    const revNovas = [];
    Object.entries(ligacoes).forEach(([n, a]) => {
      if (revisoes.some(r => r.topico_id === n)) return;
      revisoes.filter(r => r.topico_id === a).forEach(r => revNovas.push({
        ...r, id: novoId('rev'), edital_id: novo.id, disciplina_id: discDoNovo[n], topico_id: n
      }));
    });
    revisoes.push(...revNovas);
    await gravar('revisoes', revNovas.map(({ dono, ...r }) => r));

    // PDFs: um assunto dividido em vários tópicos novos divide as páginas igualmente (sem faixa)
    let pdfs = 0;
    for (const [nd, ad] of Object.entries(discs)) {
      const disc = novo.disciplinas.find(d => d.id === nd);
      const existentes = materiaisDaDisciplina(nd);
      const copias = materiaisDaDisciplina(ad).filter(m => !existentes.some(x => x.nome === m.nome)).map(m => ({
        ...m, id: novoId('mat'), criado_em: null,
        topicos: (m.topicos || []).flatMap(l => {
          const alvos = (novosDe[l.topico_id] || []).filter(n => discDoNovo[n] === nd);
          return alvos.map(n => (alvos.length === 1 ? { ...l, topico_id: n } : { topico_id: n, de: null, ate: null }));
        })
      }));
      if (!disc || !copias.length) continue;
      pdfs += copias.length;
      const lista = existentes.concat(copias);
      const linhas = lista.map(m => ({ ...m, edital_id: novo.id, disciplina_id: nd, criado_em: m.criado_em || new Date().toISOString() }));
      materiais = materiais.filter(m => m.disciplina_id !== nd).concat(linhas);
      await gravarDaDisciplina('materiais', 'id', remotoMat, nd, linhas.map(({ dono, ...m }) => m), materiais);
    }
    pagPorTopico = contarPaginas(materiais);

    // Plano: horas, dias e peso/nível das disciplinas que vieram do edital antigo
    const velho = planoDe(antigo.id);
    let planoMudou = false;
    if (velho) {
      const atual = planoDe(novo.id);
      const config = { ...((atual && atual.disciplinas) || {}) };
      Object.entries(discs).forEach(([nd, ad]) => {
        if (!config[nd] && velho.disciplinas && velho.disciplinas[ad]) { config[nd] = { ...velho.disciplinas[ad] }; planoMudou = true; }
      });
      if (!atual || planoMudou) {
        const linha = {
          edital_id: novo.id, horas_semana: atual ? atual.horas_semana : velho.horas_semana,
          dias_semana: atual ? atual.dias_semana : velho.dias_semana, disciplinas: config, atualizado_em: new Date().toISOString()
        };
        planos = planos.filter(p => p.edital_id !== novo.id).concat(linha);
        await gravar('plano_estudos', linha);
        planoMudou = true;
      }
    }
    if (planoMudou && currentEditalId === novo.id) await regerarSemana();
    else renderTudo();
    return { revisoes: revNovas.length, pdfs, plano: planoMudou };
  }

  /* =============================================
     EDITAL POR PDF (botão ao lado do seletor de editais)
     Um edital novo com as mesmas disciplinas e um item por PDF, na ordem da lista de PDFs;
     o plano segue essa ordem, um PDF de cada vez. O edital de origem é desativado sem mudar
     nada nele (os números, resumos, assuntos e revisões dele ficam lá).
  ============================================= */
  async function perguntarEditalPorPdf() {
    const e = editalAtivo();
    if (!e || !e.disciplinas.length) { aviso('Escolha um edital com disciplinas.'); return; }
    if (e.disciplinas.every(d => porPdfDe(e.id, d.id))) {
      aviso('Este edital já é por PDF: cada PDF novo vira item quando você salva a lista de PDFs da disciplina.');
      return;
    }
    const n = e.disciplinas.reduce((a, d) => a + materiaisDaDisciplina(d.id).length, 0);
    const ok = await window.customConfirm(`Criar um edital novo a partir de “${e.titulo}”, com as mesmas disciplinas e um item para cada PDF ` +
      `(${n} PDF${n === 1 ? '' : 's'} hoje)? Os itens ficam na ordem dos nomes dos PDFs (Aula 00, Aula 01…) e o plano segue essa ordem, um PDF de cada vez. ` +
      `“${e.titulo}” será desativado sem mudar nada nele, e dá para reativá-lo na lista de editais.`);
    if (ok) await criarEditalPorPdf(e);
  }

  async function criarEditalPorPdf(antigo) {
    const base = Date.now();
    let n = 0;
    const discs = antigo.disciplinas.map((d, i) => {
      // Na ordem dos nomes (Aula 00, Aula 01… Aula 10): a da lista depende de como os PDFs foram escolhidos
      const pdfs = materiaisDaDisciplina(d.id).slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }));
      const topicos = pdfs.map(m => itemDoPdf(`t_${base}_${String(n++).padStart(5, '0')}`, m));
      return { antiga: d, pdfs, nova: { id: `d_${base}_${String(i).padStart(4, '0')}`, nome: d.nome, ordem: null, topicos } };
    });
    const novo = { id: 'e_' + base.toString(36), titulo: `${antigo.titulo} — por PDF`, status: 'aberto', disciplinas: discs.map(x => x.nova) };
    try {
      const r1 = await sb.from('editais').insert({ id: novo.id, cargo: novo.titulo, orgao: 'Por PDF', status: 'aberto' });
      if (r1.error) throw r1.error;
      const r2 = await sb.from('disciplinas').insert(discs.map(x => ({ id: x.nova.id, edital_id: novo.id, nome: x.nova.nome })));
      if (r2.error) throw r2.error;
      const linhas = discs.flatMap(x => x.nova.topicos.map(t => linhaDoTopico(t, x.nova.id)));
      for (let i = 0; i < linhas.length; i += 500) {
        const r3 = await sb.from('topicos').insert(linhas.slice(i, i + 500));
        if (r3.error) throw r3.error;
      }
    } catch (err) {
      console.error('Erro ao criar o edital por PDF:', err);
      aviso('Não foi possível criar o edital no servidor. Detalhe: ' + (err.message || err));
      return;
    }
    editaisData.push(novo);

    // A mesma lista de PDFs, cada um ligado inteiro ao seu item (ids na ordem da lista)
    let k = 0;
    for (const x of discs) {
      if (!x.pdfs.length) continue;
      const linhasMat = x.pdfs.map((m, i) => ({
        id: `mat_${base.toString(36)}_${String(k++).padStart(4, '0')}`, edital_id: novo.id, disciplina_id: x.nova.id,
        nome: m.nome, paginas: m.paginas || 0, topicos: [{ topico_id: x.nova.topicos[i].id, de: null, ate: null }],
        criado_em: new Date().toISOString()
      }));
      materiais = materiais.concat(linhasMat);
      await gravarDaDisciplina('materiais', 'id', remotoMat, x.nova.id, linhasMat, materiais);
    }
    pagPorTopico = contarPaginas(materiais);

    // Plano: as mesmas horas, dias e peso/nível; cada disciplina segue a ordem dos PDFs
    const velho = planoDe(antigo.id);
    const linha = {
      edital_id: novo.id,
      horas_semana: velho ? velho.horas_semana : 20,
      dias_semana: velho ? velho.dias_semana : [1, 2, 3, 4, 5, 6],
      disciplinas: Object.fromEntries(discs.map(x => [x.nova.id, { ...configDisc(velho, x.antiga.id), ordemPdf: true, porPdf: true }])),
      atualizado_em: new Date().toISOString()
    };
    planos = planos.filter(p => p.edital_id !== novo.id).concat(linha);
    await gravar('plano_estudos', linha);

    currentEditalId = novo.id;
    saveEditais();
    if (window.estAproveitar) await window.estAproveitar.desativar(antigo, true);   // já redesenha e gera a semana
    if (antigo.status !== 'desativado') { renderEditalSelect(); renderEdital(); editalTrocado(); }
    const pdfs = discs.reduce((a, x) => a + x.pdfs.length, 0);
    aviso(`“${novo.titulo}” criado: ${pdfs} PDF${pdfs === 1 ? ' virou item' : 's viraram itens'}. ` +
      'Disciplina sem PDF fica vazia até você importar os PDFs dela; cada PDF novo vira item ao salvar a lista.');
  }

  /* =============================================
     MOTOR DE ESTUDOS — MIGRAÇÃO (etapa 1; contas em estudos.motor.migracao.js)
     Vale para o edital por PDF. Só grava campos novos: motor_pdfs, as colunas novas de subtopicos
     e erros.material_id. As metas e revisões não mudam aqui.
  ============================================= */
  const editalPorPdf = e => !!e && e.disciplinas.length > 0 && e.disciplinas.every(d => porPdfDe(e.id, d.id));

  function dadosDaMigracao(e, erros) {
    const titulo = e.titulo.replace(/\s*—\s*por PDF\s*$/i, '');
    const ultimaSessao = {}, lidas = {};
    studyData.forEach(x => { if (x.topicId && x.date && !(ultimaSessao[x.topicId] >= x.date)) ultimaSessao[x.topicId] = x.date; });
    e.disciplinas.forEach(d => d.topicos.forEach(t => { lidas[t.id] = paginasLidas(t.id); }));
    return {
      edital: e, origem: editaisData.find(x => x !== e && x.titulo === titulo) || null, materiais,
      subtopicos: window.estSub ? editaisData.flatMap(x => x.disciplinas.flatMap(d => d.topicos.flatMap(t => window.estSub.doTopico(t.id)))) : [],
      erros: erros || [], motorPdfs, paginasLidas: lidas, ultimaSessao, hoje: hoje()
    };
  }
  // Para o aviso do Planejamento (sem os erros, que são lidos só na hora de migrar)
  function migracaoPendente(e) {
    if (!temMotor || !editalPorPdf(e)) return false;
    const p = window.estMotorMigracao.planejar(dadosDaMigracao(e));
    return p.pdfs.length + p.subs.length > 0;
  }

  // Janela com o relatório; devolve true se o usuário mandar aplicar
  function mostrarRelatorio(titulo, texto, rotuloAplicar) {
    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.className = 'est-modal-overlay active';
      ov.style.zIndex = '1060';
      ov.innerHTML = `<div class="est-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(titulo)}" style="max-width: 760px;">
        <h2 class="est-modal-title" style="margin-bottom: 12px;">${escapeHtml(titulo)}</h2>
        <pre style="white-space: pre-wrap; font: inherit; font-size: 0.82rem; line-height: 1.5; max-height: 55vh; overflow-y: auto; margin: 0 0 16px; color: var(--est-silver-bright);">${escapeHtml(texto)}</pre>
        <div style="display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap;">
          <button type="button" class="est-plano-btn" data-a="copiar">Copiar relatório</button>
          <button type="button" class="est-btn-cancelar" data-a="nao">${rotuloAplicar ? 'Cancelar' : 'Fechar'}</button>
          ${rotuloAplicar ? `<button type="button" class="est-btn-register" data-a="sim">${escapeHtml(rotuloAplicar)}</button>` : ''}
        </div></div>`;
      ov.addEventListener('click', ev => {
        const a = ev.target.dataset && ev.target.dataset.a;
        if (a === 'copiar') { navigator.clipboard.writeText(texto).then(() => aviso('Relatório copiado.'), () => aviso('Não foi possível copiar.')); return; }
        if (a === 'sim' || a === 'nao' || ev.target === ov) { ov.remove(); resolve(a === 'sim'); }
      });
      document.body.appendChild(ov);
    });
  }

  // Tela do PDF: grava os campos do PDF em motor_pdfs (cria a linha se o PDF ainda não estiver no motor)
  async function salvarMotorPdf(id, campos) {
    let x = motorPdfs.find(p => p.id === id);
    if (!x) {
      const m = materiais.find(y => y.id === id);
      if (!m) return false;
      x = { id, edital_id: m.edital_id, disciplina_id: m.disciplina_id, ordem: materiaisDaDisciplina(m.disciplina_id).indexOf(m), itens_edital: [] };
      motorPdfs.push(x);
    }
    Object.assign(x, campos);
    const { dono, ...linha } = x;
    const { error } = await sb.from('motor_pdfs').upsert(linha, { onConflict: 'id' });
    if (error) { console.error('Erro ao salvar o PDF no motor:', error); aviso('Não foi possível salvar o PDF no servidor.'); return false; }
    return true;
  }

  // Itens do edital de origem (o desativado com o mesmo nome, sem "— por PDF") na disciplina de mesmo nome
  function itensDoEditalDeOrigem(e, discNome) {
    const titulo = e.titulo.replace(/\s*—\s*por PDF\s*$/i, '');
    const origem = editaisData.find(x => x !== e && x.titulo === titulo);
    const d = origem && origem.disciplinas.find(x => x.nome === discNome);
    return d ? d.topicos.map(t => ({ id: t.id, nome: t.nome })) : [];
  }

  async function migrarMotor() {
    const e = editalAtivo();
    if (!temMotor || !editalPorPdf(e)) { aviso('A migração vale para o edital por PDF, com o supabase/motor.sql já rodado.'); return; }
    const r = await sb.from('erros').select('id, edital_id, topico_id, subtopico_id, material_id');
    const plano = window.estMotorMigracao.planejar(dadosDaMigracao(e, r.error ? [] : r.data));
    const mudou = window.estMotorMigracao.temMudanca(plano);
    const ok = await mostrarRelatorio(`Motor de estudos: o que muda em “${e.titulo}”`, window.estMotorMigracao.relatorio(plano), mudou ? 'Aplicar' : '');
    if (!ok || !mudou) return;
    const falhas = [];
    const conferir = (res, oque) => { if (res.error) { console.error('Migração do motor:', oque, res.error); falhas.push(oque); } };
    const novos = plano.pdfs.filter(x => 'ordem' in x).map(({ nome, ...x }) => x);
    if (novos.length) conferir(await sb.from('motor_pdfs').upsert(novos, { onConflict: 'id' }), 'PDFs');
    for (const x of plano.pdfs.filter(x => !('ordem' in x))) conferir(await sb.from('motor_pdfs').update({ itens_edital: x.itens_edital }).eq('id', x.id), 'vínculos dos PDFs');
    for (const { id, nome, ...campos } of plano.subs) {
      conferir(await sb.from('subtopicos').update(campos).eq('id', id), 'subtópicos');
      const s = window.estSub.porId(id);
      if (s) Object.assign(s, campos);
    }
    const porPdf = {};
    plano.erros.forEach(x => (porPdf[x.material_id] = porPdf[x.material_id] || []).push(x.id));
    for (const [material_id, ids] of Object.entries(porPdf)) conferir(await sb.from('erros').update({ material_id }).in('id', ids), 'erros');
    await carregarMotor();
    renderTudo();
    aviso(falhas.length ? `A migração terminou com falha em: ${[...new Set(falhas)].join(', ')}. Rode de novo.` : 'Migração aplicada. As metas e revisões continuam como estavam.');
  }

  /* =============================================
     MOTOR DE ESTUDOS — SEMANA SIMULADA (etapas 2 a 5; motor em estudos.motor.*.js)
     Monta a entrada do motor com os dados reais e mostra a semana que ele geraria. Não grava nada:
     a troca do agendamento acontece só na publicação (docs/motor-estudos.md).
  ============================================= */
  async function entradaDoMotor(e) {
    const plano = planoDe(e.id);
    const semana = segundaDe(hoje());
    const dias = [];
    for (let i = 0; i < 7; i++) {
      const dia = somarDias(semana, i);
      if (dia >= hoje() && plano.dias_semana.includes(diaDaSemana(dia))) dias.push({ dia, minutos: Math.round(minutosPorDia(plano)) });
    }
    const todosSubs = window.estSub ? e.disciplinas.flatMap(d => d.topicos.flatMap(t => window.estSub.doTopico(t.id))) : [];
    const subtopicos = {}, stats = {};
    const disciplinas = e.disciplinas.map(d => ({
      id: d.id, nome: d.nome, peso: configDisc(plano, d.id).peso,
      pdfs: motorPdfs.filter(x => x.disciplina_id === d.id).sort((a, b) => a.ordem - b.ordem).map(x => {
        const m = materiais.find(y => y.id === x.id) || {};
        const item = ((m.topicos || [])[0] || {}).topico_id;
        const subs = todosSubs.filter(s => s.material_id === x.id).map(s => ({ id: s.id, nome: s.nome, pag_ini: s.pag_ini, pag_fim: s.pag_fim, nao_cai: !!s.nao_cai, estudado_em: s.estudado_em || null }));
        subtopicos[x.id] = subs;
        if (item && window.estSub) window.estSub.numerosDe(item).assuntos.forEach(n => { stats[n.s.id] = { total: n.q, acertos: n.c, ultimo: null }; });
        return { id: x.id, nome: m.nome || x.id, ordem: x.ordem, paginas: m.paginas || 0, lidas: item ? Math.round(paginasLidas(item)) : 0, peso: x.peso, subtopicos: subs };
      })
    })).filter(d => d.pdfs.length);
    // Subtópicos estudados sem bloco de 1º contato ainda
    const comBloco = new Set(motorBlocos.flatMap(b => (b.itens || []).map(i => i.subtopico_id)));
    const primeiros = [];
    Object.entries(subtopicos).forEach(([pdf, subs]) => {
      const pend = subs.filter(s => s.estudado_em && !s.nao_cai && !comBloco.has(s.id));
      [...new Set(pend.map(s => s.estudado_em))].forEach(dia => primeiros.push({ material_id: pdf,
        disciplina_id: (motorPdfs.find(x => x.id === pdf) || {}).disciplina_id, subtopicos: pend.filter(s => s.estudado_em === dia).map(s => s.id), depoisDe: dia }));
    });
    // Erros: como ficariam na agenda nova (a conversão é feita só na publicação)
    const r = await sb.from('erros').select('id, edital_id, motivo, etapa, proxima, dominado_em, ultima_revisao, criado_em, recorrencias');
    const erros = (r.error ? [] : r.data).filter(x => x.edital_id === e.id);
    const conv = window.estMotorErros.converter(erros);
    const errosNovos = erros.map(x => { const c = conv.find(y => y.id === x.id); return c ? { ...x, ...c.para } : x; });
    return { dias, dataProva: plano.data_prova || (typeof getTargetDate === 'function' ? getTargetDate() : null), disciplinas,
      modelos: motorPdfs.map(x => ({ ...x })), subtopicos, stats, erros: errosNovos, primeiros, atraso: 0, _conv: conv, _erros: erros };
  }

  async function verSemanaDoMotor() {
    const e = editalAtivo();
    if (!temMotor || !editalPorPdf(e) || !planoDe(e.id)) { aviso('Vale para o edital por PDF com o plano configurado e o supabase/motor.sql rodado.'); return; }
    const ent = await entradaDoMotor(e);
    const g = window.estMotorSemana.gerarSemana(ent);
    const L = window.estMotorLeitura;
    const pdfs = ent.disciplinas.flatMap(d => d.pdfs);
    const total = pdfs.reduce((a, p) => a + L.totalALer(p), 0), faltam = pdfs.reduce((a, p) => a + L.faltam(p), 0);
    const pj = window.estMotorSemana.projetar({ faltam, total, minutosSemana: g.orcamento.total || 1, dataProva: ent.dataProva, hoje: hoje() });
    const nomePdf = id => (pdfs.find(p => p.id === id) || {}).nome || id;
    const nomeSub = id => { for (const l of Object.values(ent.subtopicos)) { const s = l.find(x => x.id === id); if (s) return s.nome; } return id; };
    const nomeDisc = id => (e.disciplinas.find(d => d.id === id) || {}).nome || '';
    const TIPOS = { primeiro: '1º contato', revisao: 'revisão do PDF', manutencao: 'manutenção' };
    const linha = m => m.tipo === 'leitura'
      ? `Leitura · ${fmtMin(m.minutos)} · ${nomeDisc(m.disciplina_id)} · ${nomePdf(m.material_id)}, p. ${m.pag_ini}–${m.pag_fim}${m.concluidos.length ? ` (termina: ${m.concluidos.map(nomeSub).join(', ')})` : ''}`
      : m.tipo === 'erros' ? `Revisão de erros · ${m.itens.length} questão(ões) · ${fmtMin(m.minutos)}`
      : `Questões (${TIPOS[m.tipo_bloco]}) · ${fmtMin(m.minutos)} · ${nomeDisc(m.disciplina_id)} · ${m.tipo_bloco === 'manutencao'
        ? m.alvos.map(a => `${nomePdf(a.material_id)} (${a.questoes})`).join(', ')
        : `${nomePdf(m.material_id)}: ${m.alvos.map(a => (a.subtopico_id ? `${nomeSub(a.subtopico_id)} (${a.questoes})` : `PDF inteiro (${a.questoes})`)).join(', ')}`}`;
    const T = [];
    T.push(`ORÇAMENTO DA SEMANA: ${fmtMin(g.orcamento.total)} · questões ${Math.round(g.fracao * 100)}% (${fmtMin(g.orcamento.questoes)}) · leitura ${fmtMin(g.orcamento.leitura)}`);
    T.push(`Leitura: ${total - faltam} de ${total} páginas lidas (${total ? Math.round((total - faltam) / total * 100) : 0}%)${ent.dataProva ? ` · prova em ${fmtData(ent.dataProva)}` : ' · sem data da prova'}`);
    g.avisos.forEach(a => T.push('⚠ ' + a));
    T.push('');
    ent.dias.forEach(({ dia }) => {
      const doDia = g.metas.filter(m => m.dia === dia);
      T.push(`${DIAS_CURTOS[diaDaSemana(dia)]} ${fmtData(dia)} · ${fmtMin(doDia.reduce((a, m) => a + m.minutos, 0))}`);
      doDia.forEach(m => T.push('  • ' + linha(m)));
      if (!doDia.length) T.push('  —');
    });
    if (g.adiados.length) { T.push('', 'ADIADO PARA A SEMANA SEGUINTE'); g.adiados.forEach(a => T.push(`  • ${a.tipo === 'erros' ? `${a.itens.length} erro(s)` : `${TIPOS[a.tipo_bloco]} de ${nomePdf(a.material_id)}`}`)); }
    T.push('', 'PROJEÇÃO (8 semanas)', `Término previsto da leitura: ${pj.terminoLeitura ? fmtData(pj.terminoLeitura) : 'depois de 3 anos no ritmo atual'}`);
    pj.semanas.forEach(w => T.push(`  ${fmtData(w.inicio)}: questões ${fmtMin(w.minutosQuestoes)} (${Math.round(w.fracao * 100)}%), leitura ${w.paginas} p.`));
    const naAgenda = ent._erros.filter(window.estMotorErros.naAgenda);
    T.push('', 'ERROS DO CADERNO NA AGENDA NOVA (2/7/21; a conversão é feita só na publicação)',
      `${naAgenda.length} na agenda; ${ent._conv.length} mudariam de data ou de estado (${ent._conv.filter(c => c.para.dominado_em).length} virariam dominados).`);
    T.push('', 'Nada foi gravado: isto é só a simulação do motor com os seus dados de hoje.');
    await mostrarRelatorio('Semana que o motor geraria', T.join('\n'), '');
  }

  /* Conversão da agenda dos erros já registrados (1/7/30/90 → 2/7/21). Só na publicação do motor na main
     (docs/motor-estudos.md): no console do painel, rode estPlano.converterAgendaErros(). Mostra quantos mudam
     e só grava com confirmação. */
  async function converterAgendaErros() {
    const r = await sb.from('erros').select('id, motivo, etapa, proxima, dominado_em, ultima_revisao, criado_em');
    if (r.error) { aviso('Não foi possível ler os erros.'); return; }
    const conv = window.estMotorErros.converter(r.data || []);
    const dom = conv.filter(c => c.para.dominado_em).length;
    const T = [`${(r.data || []).filter(window.estMotorErros.naAgenda).length} erro(s) na agenda; ${conv.length} mudam (${dom} viram dominados).`, ''];
    conv.forEach(c => T.push(`${c.id}: etapa ${c.de.etapa}, próxima ${c.de.proxima || '—'} → ${c.para.dominado_em ? `dominado em ${c.para.dominado_em}` : `próxima ${c.para.proxima}`}`));
    if (!(await mostrarRelatorio('Conversão da agenda dos erros para 2/7/21', T.join('\n'), conv.length ? 'Converter' : ''))) return conv.length;
    let falhas = 0;
    for (const c of conv) {
      const { error } = await sb.from('erros').update({ etapa: c.para.etapa, proxima: c.para.proxima, dominado_em: c.para.dominado_em }).eq('id', c.id);
      if (error) { falhas++; console.error('Conversão do erro', c.id, error); }
    }
    aviso(falhas ? `${falhas} erro(s) não foram convertidos; rode de novo.` : `${conv.length} erro(s) convertidos para a agenda 2/7/21.`);
    return conv.length;
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
    abrirConclusao, abrirEstudo, adiarRevisao, removerMeta, regerarSemana, adiantar, reiniciarPlanejamento, metasDoTopico, agendarEstudados,
    agendarReforco, mudarSemana, irParaSemana, alternarConfig, editalTrocado, projetar,
    incidenciaDaDisciplina, pctIncidencia, salvarIncidencias,
    materiaisDaDisciplina, paginasDoTopico, prioridadeDosTopicos, salvarMateriais, ordemPdfDe, porPdfDe, criarEditalPorPdf, juntarTopicos,
    migrarMotor, verSemanaDoMotor, converterAgendaErros, salvarMotorPdf, itensDoEditalDeOrigem, temMotor: () => temMotor, motorPdfs: () => motorPdfs,
    renderTudo, fmtMin, aviso, revisoesDoTopico, paginasLidas, aproveitarDe
  };
})();
