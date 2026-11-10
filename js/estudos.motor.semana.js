/* Motor de estudos — E. Orçamento semanal, rampa e geração da semana (funções puras; parâmetros em
   estConfig.semana). Usa os módulos de leitura (B), erros (C) e questões (D). Nada aqui grava:
   devolve as metas que a interface deve criar. */
(function () {
  const S = () => window.estConfig.semana;
  const L = () => window.estMotorLeitura, Q = () => window.estMotorQuestoes, E = () => window.estMotorErros;

  /* E1, E3: fração dos minutos da semana para questões (revisão de erros, blocos e manutenção).
     atraso = semanas seguidas que terminaram com revisões acumuladas (true vale 1): +0,10 cada, até 0,85. */
  function fracao(lidas, total, atraso) {
    const s = S();
    if (!(total > 0) || lidas >= total) return 1;
    const f = s.fracaoBase + s.fracaoRampa * Math.max(0, lidas) / total + Number(atraso || 0) * s.fracaoAtraso;
    return Math.min(f, s.fracaoMaxLeitura);
  }

  /* E2: páginas por semana para acabar a leitura antes da reta final (4 semanas antes da prova).
     Sem data da prova, 0. Já na reta final, tudo o que falta. */
  function pisoLeitura(faltam, hoje, dataProva) {
    if (!dataProva || !(faltam > 0)) return 0;
    const semanas = Math.floor(Q().diasEntre(hoje, Q().somar(dataProva, -7 * S().retaFinalSemanas)) / 7);
    return semanas >= 1 ? Math.ceil(faltam / semanas) : faltam;
  }

  /* E3: revisões vencidas que não couberam valem mais que uma semana de orçamento de questões? */
  const atrasado = (minutosVencidos, orcamentoQuestoes) => minutosVencidos > orcamentoQuestoes;

  /* E6: questões primeiro (na ordem em que entraram), depois o conteúdo novo; sem estudo e questões
     da mesma disciplina em sequência, sempre que der */
  function ordenarDia(metas) {
    const q = metas.filter(m => m.tipo !== 'leitura'), l = metas.filter(m => m.tipo === 'leitura');
    const r = [...q];
    while (l.length) {
      const ant = r.length ? r[r.length - 1].disciplina_id : null;
      const i = l.findIndex(m => m.disciplina_id !== ant);
      r.push(l.splice(i >= 0 ? i : 0, 1)[0]);
    }
    return r;
  }

  // A3: sem subtópicos, o PDF inteiro é o alvo (subtopico_id null)
  const alvosDe = (ids, total) => (ids.length ? window.estMotorQuestoes.dividir(total, ids).map(x => ({ subtopico_id: x.id, questoes: x.questoes }))
    : [{ subtopico_id: null, questoes: total }]);

  /* Gera a semana. entrada = {
       dias: [{ dia, minutos }]   dias de estudo, a partir de hoje
       dataProva                  opcional
       disciplinas: [{ id, peso, pdfs: [PDF de leitura, com lidas] }]
       modelos: [linhas de motor_pdfs]   (com disciplina_id e peso)
       subtopicos: { idDoPdf: [{ id, estudado_em, nao_cai }] }
       stats: { idDoSubtopico: { total, acertos, ultimo } }
       erros: [itens da agenda de erros]
       primeiros: [{ material_id, disciplina_id, subtopicos: [ids], depoisDe }]   1º contato pendente
       atraso: semanas seguidas que terminaram com revisões acumuladas (E3; true = 1)
     }
     Devolve { metas, adiados, avisos, fracao, orcamento: { total, questoes, leitura }, minutosVencidos, atrasoProxima }. */
  function gerarSemana(entrada) {
    const cfgQ = window.estConfig.questoes, cfgL = window.estConfig.leitura;
    const dias = entrada.dias.filter(d => d.minutos > 0);
    const avisos = [], metas = [];
    if (!dias.length) return { metas, adiados: [], avisos: ['Nenhum dia de estudo nesta semana.'], fracao: 0, orcamento: { total: 0, questoes: 0, leitura: 0 }, minutosVencidos: 0, atrasoProxima: false };
    // Cópias: a simulação avança a leitura e os modelos sem mexer na entrada
    const discs = entrada.disciplinas.map(d => ({ ...d, pdfs: d.pdfs.map(p => ({ ...p })) }));
    const modelos = new Map((entrada.modelos || []).map(m => [m.id, { ...m }]));
    const subs = {};
    Object.entries(entrada.subtopicos || {}).forEach(([k, l]) => { subs[k] = l.map(s => ({ ...s })); });
    const stats = entrada.stats || {};
    const primeiros = (entrada.primeiros || []).map(p => ({ ...p }));
    const todosPdfs = discs.flatMap(d => d.pdfs);
    const totalPag = todosPdfs.reduce((a, p) => a + L().totalALer(p), 0);
    const faltamPag = todosPdfs.reduce((a, p) => a + L().faltam(p), 0);

    // ---- Orçamento (E1, E2, E3)
    const total = dias.reduce((a, d) => a + d.minutos, 0);
    const f = fracao(totalPag - faltamPag, totalPag, entrada.atraso);
    const piso = pisoLeitura(faltamPag, dias[0].dia, entrada.dataProva);
    const minPiso = L().minutosDe(piso);
    let orcL = faltamPag > 0 ? Math.max(Math.round((1 - f) * total), Math.min(minPiso, total)) : 0;
    orcL = Math.min(orcL, L().minutosDe(faltamPag));
    if (minPiso > total) avisos.push(`A leitura mínima para acabar antes da reta final (${piso} páginas, ${minPiso} min) não cabe nas ${total} min da semana.`);
    const orcQ = total - orcL;
    let usadoQ = 0, usadoL = 0;
    const blocoMin = Q().minutosDoBloco();
    const postosRev = new Set(), postosMan = new Set();
    const errosFeitos = new Set();
    const alocado = {};

    dias.forEach(({ dia, minutos }) => {
      const doDia = [];
      const capQ = Math.round(minutos * orcQ / total);
      let qDia = 0;
      // Cabe mais um bloco? No dia (pela fração) ou, se o dia ainda não tem questões, no orçamento da semana
      const cabe = m => usadoQ + m <= orcQ + 1e-9 && (qDia + m <= capQ || (qDia === 0 && m <= minutos));
      const por = (meta) => { doDia.push({ dia, ...meta }); qDia += meta.minutos; usadoQ += meta.minutos; };

      // (1) revisão de erros vencidos: uma meta só (C3); se não couber toda, os que couberem
      const errosDia = E().vencidos(entrada.erros || [], dia).filter(e => !errosFeitos.has(e.id));
      if (errosDia.length) {
        let k = errosDia.length;
        while (k > 0 && !cabe(E().minutos(k))) k--;
        if (k > 0) { const m = E().meta(errosDia.slice(0, k), dia); errosDia.slice(0, k).forEach(e => errosFeitos.add(e.id)); por({ ...m, disciplina_id: null }); }
      }
      // (2) blocos de 1º contato: no dia de estudo seguinte ao estudo, nunca no mesmo dia (D1, D2)
      primeiros.filter(p => !p.posto && p.depoisDe < dia).sort((a, b) => a.depoisDe.localeCompare(b.depoisDe)).forEach(p => {
        if (!cabe(blocoMin)) return;
        p.posto = dia;
        por({ tipo: 'questoes', tipo_bloco: 'primeiro', disciplina_id: p.disciplina_id, material_id: p.material_id, minutos: blocoMin,
          alvos: alvosDe(p.subtopicos, cfgQ.porBloco) });
        // PDF já concluído: a revisão conta a partir deste bloco (o bloco real ajusta a meia-vida)
        const e = modelos.get(p.material_id);
        if (e && e.concluido_em) modelos.set(e.id, { ...e, ultimo_contato: dia, proxima_data: Q().somar(dia, Math.max(1, Math.round(Q().intervaloDe(e.meia_vida || Q().meiaVidaInicial())))) });
      });
      // PDF com 1º contato ainda por fazer não entra na revisão (ela vem depois do 1º contato)
      const esperando = id => primeiros.some(p => p.material_id === id && (!p.posto || p.posto === dia));
      // (3) blocos de PDF vencidos: menor retenção prevista × maior peso (D3, E4)
      [...modelos.values()].filter(e => Q().emRevisao(e, dia) && !postosRev.has(e.id) && !esperando(e.id))
        .sort((a, b) => Q().prioridade(a, dia) - Q().prioridade(b, dia)).forEach(e => {
          const alvos = Q().escolherSubtopicos(subs[e.id] || [], stats, dia, cfgQ.maxSubtopicos);
          if (!cabe(blocoMin)) return;
          postosRev.add(e.id);
          por({ tipo: 'questoes', tipo_bloco: 'revisao', disciplina_id: e.disciplina_id, material_id: e.id, minutos: blocoMin, alvos: alvosDe(alvos, cfgQ.porBloco) });
        });
      // (4) manutenção: até 3 PDFs graduados vencidos da mesma disciplina num bloco (D8)
      const grad = [...modelos.values()].filter(e => Q().emManutencao(e, dia) && !postosMan.has(e.id));
      [...new Set(grad.map(e => e.disciplina_id))].forEach(disc => {
        const pdfs = grad.filter(e => e.disciplina_id === disc).sort((a, b) => Q().prioridade(a, dia) - Q().prioridade(b, dia)).slice(0, cfgQ.maxPdfsManutencao);
        if (!cabe(blocoMin)) return;
        pdfs.forEach(e => postosMan.add(e.id));
        por({ tipo: 'questoes', tipo_bloco: 'manutencao', disciplina_id: disc, material_id: pdfs[0].id, minutos: blocoMin,
          alvos: Q().dividir(cfgQ.porBloco, pdfs.map(e => e.id)).map(x => ({ material_id: x.id, questoes: x.questoes })) });
      });

      // (5) leitura: o resto do dia, dentro do orçamento de leitura, alternando as disciplinas (B1)
      let resto = minutos - qDia;
      for (let guarda = 0; guarda < 50; guarda++) {
        const livre = Math.min(resto, orcL - usadoL);
        if (livre < cfgL.minMin) break;
        const cand = discs.filter(d => d.pdfs.some(p => L().faltam(p) > 0));
        if (!cand.length) break;
        const peso = d => (Number(d.peso) > 0 ? Number(d.peso) : 1);
        const d = cand.sort((a, b) => (alocado[a.id] || 0) / peso(a) - (alocado[b.id] || 0) / peso(b))[0];
        const m = L().proximaMeta(d.pdfs, Math.min(cfgL.alvoMin, livre));
        if (!m || m.minutos > livre + 1e-9) break;
        const pdf = d.pdfs.find(p => p.id === m.material_id);
        pdf.lidas = m.pag_fim;
        alocado[d.id] = (alocado[d.id] || 0) + m.minutos;
        resto -= m.minutos;
        usadoL += m.minutos;
        doDia.push({ dia, tipo: 'leitura', disciplina_id: d.id, material_id: m.material_id, pag_ini: m.pag_ini, pag_fim: m.pag_fim,
          paginas: m.paginas, minutos: m.minutos, concluidos: m.concluidos, fimDoPdf: m.fimDoPdf });
        // Subtópicos que acabam nesta meta: estudados hoje, com bloco de 1º contato a partir de amanhã
        if (m.concluidos.length) {
          (subs[m.material_id] || []).forEach(s => { if (m.concluidos.includes(s.id)) s.estudado_em = dia; });
          const p = primeiros.find(x => x.material_id === m.material_id && x.depoisDe === dia && !x.posto);
          if (p) p.subtopicos = [...new Set([...p.subtopicos, ...m.concluidos])];
          else primeiros.push({ material_id: m.material_id, disciplina_id: d.id, subtopicos: m.concluidos, depoisDe: dia });
        }
        if (m.fimDoPdf && !(subs[m.material_id] || []).some(s => !s.nao_cai) && !(pdf.subtopicos || []).some(s => !s.nao_cai)) {
          primeiros.push({ material_id: m.material_id, disciplina_id: d.id, subtopicos: [], depoisDe: dia });
        }
        if (m.fimDoPdf) {
          const est = modelos.get(m.material_id) || { id: m.material_id, disciplina_id: d.id, peso: pdf.peso, blocos: 0 };
          modelos.set(m.material_id, Q().concluirPdf(est, dia, entrada.dataProva));
        }
      }
      metas.push(...ordenarDia(doDia));
    });

    // ---- O que ficou de fora (adiado, nunca antecipado)
    const ultimo = dias[dias.length - 1].dia;
    const adiados = [];
    const errosFora = E().vencidos(entrada.erros || [], ultimo).filter(e => !errosFeitos.has(e.id));
    if (errosFora.length) adiados.push({ tipo: 'erros', itens: errosFora.map(e => e.id), minutos: E().minutos(errosFora.length) });
    primeiros.filter(p => !p.posto && p.depoisDe < ultimo).forEach(p => adiados.push({ tipo: 'questoes', tipo_bloco: 'primeiro', material_id: p.material_id, minutos: blocoMin }));
    [...modelos.values()].filter(e => Q().emRevisao(e, ultimo) && !postosRev.has(e.id) && !primeiros.some(p => p.material_id === e.id && !p.posto))
      .forEach(e => adiados.push({ tipo: 'questoes', tipo_bloco: 'revisao', material_id: e.id, minutos: blocoMin }));
    [...modelos.values()].filter(e => Q().emManutencao(e, ultimo) && !postosMan.has(e.id))
      .forEach(e => adiados.push({ tipo: 'questoes', tipo_bloco: 'manutencao', material_id: e.id, minutos: blocoMin }));
    const minutosVencidos = adiados.filter(a => a.tipo_bloco !== 'primeiro').reduce((a, x) => a + x.minutos, 0);
    if (adiados.length) avisos.push(`${adiados.length} revisão(ões) não couberam nesta semana e foram adiadas.`);
    if (piso && usadoL < minPiso && faltamPag > 0) avisos.push(`A leitura da semana (${usadoL} min) ficou abaixo do mínimo para acabar antes da reta final (${minPiso} min).`);
    return { metas, adiados, avisos, fracao: total ? orcQ / total : 0, orcamento: { total, questoes: orcQ, leitura: orcL },
      usado: { questoes: usadoQ, leitura: usadoL }, minutosVencidos, atrasoProxima: atrasado(minutosVencidos, orcQ),
      primeirosPendentes: primeiros.filter(p => !p.posto).map(({ posto, ...p }) => p) };
  }

  /* E5: dia para uma meta nova numa semana já gerada: o próprio dia (ou o primeiro dia de estudo
     depois de "desde") se houver folga; senão, o próximo com folga; null = fica para a semana seguinte. */
  function encaixar(metasDaSemana, dias, desde, minutos) {
    for (const d of dias) {
      if (d.dia < desde) continue;
      const usado = metasDaSemana.filter(m => m.dia === d.dia && !m.concluida).reduce((a, m) => a + m.minutos, 0);
      if (usado + minutos <= d.minutos) return d.dia;
    }
    return null;
  }

  /* E7: projeção (só o cálculo). Data prevista de término da leitura e carga semanal de questões das
     próximas N semanas. { faltam, total, minutosSemana, dataProva, hoje, semanas } */
  function projetar({ faltam, total, minutosSemana, dataProva, hoje, semanas }) {
    const n = semanas || S().semanasProjecao;
    const r = [];
    let resta = faltam, termino = resta > 0 ? null : hoje, inicio = hoje;
    for (let i = 0; i < 156 && (i < n || (resta > 0 && !termino)); i++) {
      const f = fracao(total - resta, total, false);
      const piso = pisoLeitura(resta, inicio, dataProva);
      const minL = resta > 0 ? Math.min(minutosSemana, Math.max(Math.round((1 - f) * minutosSemana), L().minutosDe(piso))) : 0;
      const pags = Math.min(resta, Math.floor(minL * window.estConfig.leitura.paginasPorHora / 60));
      resta -= pags;
      if (resta <= 0 && !termino) termino = Q().somar(inicio, 6);
      if (i < n) r.push({ inicio, fracao: minutosSemana ? (minutosSemana - minL) / minutosSemana : 0, minutosQuestoes: minutosSemana - minL, minutosLeitura: minL, paginas: pags });
      inicio = Q().somar(inicio, 7);
      if (pags === 0 && resta > 0 && minL === 0) break;
    }
    return { semanas: r, terminoLeitura: termino };
  }

  window.estMotorSemana = { fracao, pisoLeitura, atrasado, ordenarDia, gerarSemana, encaixar, projetar };
})();
