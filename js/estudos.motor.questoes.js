/* Motor de estudos — D. Questões inéditas por PDF, com intervalo adaptativo (funções puras;
   parâmetros em estConfig.questoes). Cada PDF tem UM modelo de memória (linha de motor_pdfs):
   { id, disciplina_id, peso, meia_vida, ultimo_contato, proxima_data, blocos, graduado, concluido_em }.
   Retenção prevista = 2^(-dias / meia_vida). O subtópico é só a unidade de registro dentro do bloco. */
(function () {
  const C = () => window.estConfig.questoes;
  const dl = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const somar = (dia, n) => { const d = new Date(dia + 'T12:00:00'); d.setDate(d.getDate() + n); return dl(d); };
  const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);

  /* ---- Contas (D4–D7) ---- */
  const meiaVidaInicial = () => 1 / Math.log2(1 / C().retencaoAlvo);   // ≈ 1,36 dia
  const chuteDe = tipo => (tipo in C().chute ? C().chute[tipo] : C().chute.ce);
  const retencao = (dias, meiaVida) => Math.pow(2, -Math.max(0, dias) / meiaVida);
  const corrigir = (acerto, tipo) => { const c = chuteDe(tipo); return Math.min(0.95, Math.max(0.05, (acerto - c) / (1 - c))); };
  const acertoPrevisto = (ret, tipo) => chuteDe(tipo) + ret * (1 - chuteDe(tipo));
  const intervaloDe = meiaVida => meiaVida * Math.log2(1 / C().retencaoAlvo);

  /* Um bloco: { meiaVida (anterior), n, acertos, tipo, dias (D ≥ 1), diasAteProva (0 = sem data) } →
     { r, lapso, observada, estimada, meiaVida, intervalo, previsto } */
  function calcular({ meiaVida, n, acertos, tipo, dias, diasAteProva }) {
    const cfg = C(), D = Math.max(1, dias);
    const r = corrigir(n > 0 ? acertos / n : 0, tipo);
    const observada = -D / Math.log2(r);
    const peso = n / (n + cfg.pesoBloco);
    const estimada = Math.pow(meiaVida, 1 - peso) * Math.pow(observada, peso);
    const lapso = r < cfg.retencaoLapso;
    const nova = lapso ? estimada : estimada * cfg.ganho;
    let intervalo = Math.round(intervaloDe(nova));
    intervalo = Math.min(intervalo, Math.round(cfg.crescimentoMax * D));
    intervalo = Math.max(intervalo, Math.round(cfg.reducaoMax * D));
    if (diasAteProva > 0) intervalo = Math.min(intervalo, Math.floor(cfg.tetoProva * diasAteProva));
    intervalo = Math.max(1, intervalo);
    return { r, lapso, observada, estimada, meiaVida: nova, intervalo, previsto: acertoPrevisto(retencao(D, meiaVida), tipo) };
  }

  const diasAteProva = (dia, dataProva) => (dataProva ? Math.max(0, diasEntre(dia, dataProva)) : 0);

  /* ---- Eventos ---- */

  /* D7: PDF concluído (a meta com a última página foi concluída). A fila de revisão começa: a próxima
     data vem da meia-vida que os blocos de 1º contato já ajustaram. */
  function concluirPdf(estado, hoje, dataProva) {
    const mv = estado.meia_vida || meiaVidaInicial();
    let intervalo = Math.max(1, Math.round(intervaloDe(mv)));
    const ate = diasAteProva(hoje, dataProva);
    if (ate > 0) intervalo = Math.max(1, Math.min(intervalo, Math.floor(C().tetoProva * ate)));
    return { ...estado, meia_vida: mv, concluido_em: hoje, ultimo_contato: estado.ultimo_contato || hoje, proxima_data: somar(hoje, intervalo), graduado: false };
  }

  /* D1, D7, D8: registra um bloco concluído. bloco = { tipo_bloco (primeiro | revisao | manutencao),
     tipo_questao, itens: [{ subtopico_id, total, acertos }], estudadosHoje: [ids de subtópicos estudados hoje] }.
     Subtópico estudado hoje é fixação: sai do modelo e das estatísticas. Devolve { estado, registro }. */
  function registrarBloco(estado, bloco, hoje, dataProva) {
    const hojeEst = new Set(bloco.estudadosHoje || []);
    const validos = bloco.itens.filter(x => !hojeEst.has(x.subtopico_id) && x.total > 0);
    const n = validos.reduce((a, x) => a + x.total, 0), acertos = validos.reduce((a, x) => a + x.acertos, 0);
    const base = { tipo_bloco: bloco.tipo_bloco, tipo_questao: bloco.tipo_questao || 'ce', itens: bloco.itens,
      total: bloco.itens.reduce((a, x) => a + x.total, 0), acertos: bloco.itens.reduce((a, x) => a + x.acertos, 0), data: hoje };
    if (!n) return { estado, registro: { ...base, tipo_bloco: 'fixacao', dias: 0, previsto: null, mv_antes: null, mv_depois: null, intervalo: null } };
    const mv0 = estado.meia_vida || meiaVidaInicial();
    const dias = estado.ultimo_contato ? Math.max(1, diasEntre(estado.ultimo_contato, hoje)) : Math.max(1, bloco.diasDesdeEstudo || 1);
    const u = calcular({ meiaVida: mv0, n, acertos, tipo: bloco.tipo_questao, dias, diasAteProva: diasAteProva(hoje, dataProva) });
    const novo = { ...estado, meia_vida: u.meiaVida, ultimo_contato: hoje, blocos: (estado.blocos || 0) + 1 };
    if (estado.concluido_em) {
      novo.proxima_data = somar(hoje, u.intervalo);
      // D8: gradua quando o intervalo passa do limite; na manutenção, lapso volta para a fila própria
      novo.graduado = bloco.tipo_bloco === 'manutencao' ? !u.lapso : u.intervalo > C().limiteGraduacao;
    }
    return { estado: novo, registro: { ...base, dias, previsto: u.previsto, mv_antes: mv0, mv_depois: u.meiaVida, intervalo: u.intervalo, lapso: u.lapso } };
  }

  /* ---- Escolhas do bloco ---- */

  /* D3: até maxSubtopicos subtópicos já estudados (antes de "dia") do PDF: menor acerto acumulado
     primeiro, depois o mais tempo sem ver. stats = { idDoSubtopico: { total, acertos, ultimo } }. */
  function escolherSubtopicos(subtopicos, stats, dia, max) {
    const st = id => stats[id] || { total: 0, acertos: 0, ultimo: null };
    const acerto = id => (st(id).total ? st(id).acertos / st(id).total : -1);   // sem questões = primeiro
    return subtopicos.filter(s => !s.nao_cai && s.estudado_em && s.estudado_em < dia)
      .sort((a, b) => acerto(a.id) - acerto(b.id) || String(st(a.id).ultimo || '').localeCompare(String(st(b.id).ultimo || '')))
      .slice(0, max || C().maxSubtopicos).map(s => s.id);
  }
  // Divide o total entre os alvos (os primeiros recebem a sobra)
  const dividir = (total, ids) => ids.map((id, i) => ({ id, questoes: Math.floor(total / ids.length) + (i < total % ids.length ? 1 : 0) }));

  const emRevisao = (e, dia) => e.concluido_em && !e.graduado && e.proxima_data && e.proxima_data <= dia;
  const emManutencao = (e, dia) => e.concluido_em && e.graduado && e.proxima_data && e.proxima_data <= dia;
  const retencaoEm = (e, dia) => retencao(e.ultimo_contato ? diasEntre(e.ultimo_contato, dia) : 0, e.meia_vida || meiaVidaInicial());
  // E4: menor retenção prevista × maior peso
  const prioridade = (e, dia) => retencaoEm(e, dia) / (Number(e.peso) > 0 ? Number(e.peso) : 1);

  const minutosDoBloco = () => C().porBloco * C().minPorQuestao;

  window.estMotorQuestoes = {
    meiaVidaInicial, retencao, corrigir, acertoPrevisto, intervaloDe, calcular,
    concluirPdf, registrarBloco, escolherSubtopicos, dividir, emRevisao, emManutencao, retencaoEm, prioridade, minutosDoBloco,
    somar, diasEntre
  };
})();
