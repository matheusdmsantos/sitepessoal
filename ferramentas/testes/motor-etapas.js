/* Testes das etapas 2 a 5 do motor (seção I). Usa grupo/teste do motor.html. */
(function () {
  const { grupo, teste } = window.__teste;
  const perto = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

  /* ---------- Etapa 2: metas de leitura (I1) ---------- */
  grupo('Etapa 2 — leitura (I1)');
  const Lt = window.estMotorLeitura;
  {
    const pdfA = { id: 'A', ordem: 0, paginas: 60, lidas: 0, subtopicos: [
      { id: 'a1', pag_ini: 1, pag_fim: 18 }, { id: 'a2', pag_ini: 19, pag_fim: 30 }, { id: 'a3', pag_ini: 31, pag_fim: 45, nao_cai: true }, { id: 'a4', pag_ini: 46, pag_fim: 60 }] };
    const pdfB = { id: 'B', ordem: 1, paginas: 10, lidas: 0, subtopicos: [] };
    const pdfs = [pdfB, pdfA];
    const vistas = [];
    for (let i = 0, m; i < 20 && (m = Lt.proximaMeta(pdfs, 60)); i++) {
      vistas.push(m);
      pdfs.find(p => p.id === m.material_id).lidas = m.pag_fim;
    }
    const seq = vistas.map(m => `${m.material_id}:${m.pag_ini}-${m.pag_fim}`).join(' ');
    const doA = vistas.filter(m => m.material_id === 'A');
    teste('leitura linear: PDFs na ordem e páginas em sequência, sem saltos',
      vistas[0].material_id === 'A' && vistas[vistas.length - 1].material_id === 'B' && doA.every((m, i) => (i === 0 ? m.pag_ini === 1 : m.pag_ini > doA[i - 1].pag_fim)), seq);
    teste('páginas de subtópico "não cai" são puladas', !doA.some(m => m.pag_ini >= 31 && m.pag_ini <= 45) && doA.reduce((a, m) => a + m.paginas, 0) === 45, seq);
    teste('corte no fim do subtópico quando fica a até 20% do alvo', vistas[0].pag_fim === 18 && vistas[0].concluidos.join() === 'a1', `1ª meta: p. 1–${vistas[0].pag_fim} (alvo 20 páginas)`);
    teste('nenhuma meta passa de 70 min', vistas.every(m => m.minutos <= 70));
    teste('subtópico estudado quando a meta tem a última página dele (B4)', vistas.some(m => m.concluidos.includes('a2')) && !vistas.some(m => m.concluidos.includes('a3')));
    const longo = Lt.proximaMeta([{ id: 'C', ordem: 0, paginas: 80, lidas: 0, subtopicos: [{ id: 'c1', pag_ini: 1, pag_fim: 80 }] }], 60);
    teste('subtópico longo: corta no alvo e não o marca como estudado', longo.pag_fim === 20 && !longo.concluidos.length && !longo.fimDoPdf);
    const pouco = Lt.proximaMeta([{ id: 'D', ordem: 0, paginas: 30, lidas: 25, subtopicos: [] }], 60);
    teste('fim do PDF: a meta termina na última página', pouco.pag_ini === 26 && pouco.pag_fim === 30 && pouco.fimDoPdf);
    teste('PDF todo lido: sem meta', Lt.proximaMeta([{ id: 'E', ordem: 0, paginas: 10, lidas: 10, subtopicos: [] }], 60) === null);
  }

  /* ---------- Etapa 3: agenda de erros (I3) ---------- */
  grupo('Etapa 3 — agenda de erros (I3)');
  const Er = window.estMotorErros;
  {
    const ag = Er.agendar({ motivo: 'conteudo' }, '2026-11-10');
    teste('erro registrado: 1ª revisão em 2 dias', ag.etapa === 0 && ag.proxima === '2026-11-12');
    let it = { ...ag, motivo: 'conteudo' };
    it = { ...it, ...Er.responder(it, true, '2026-11-12') };
    teste('acerto avança: próxima em 7 dias', it.etapa === 1 && it.proxima === '2026-11-19');
    it = { ...it, ...Er.responder(it, true, '2026-11-19') };
    teste('2º acerto: próxima em 21 dias', it.etapa === 2 && it.proxima === '2026-12-10');
    const errou = Er.responder(it, false, '2026-12-10');
    teste('erro volta ao 1º passo, conta recorrência e pede releitura (não sabia o conteúdo)',
      errou.etapa === 0 && errou.proxima === '2026-12-12' && errou.recorrencias === 1 && errou.releitura);
    teste('erro de outro motivo não pede releitura', !Er.responder({ etapa: 1, motivo: 'pressa' }, false, '2026-12-10').releitura);
    const dom = Er.responder(it, true, '2026-12-10');
    teste('3º acerto seguido: dominado e sai da fila', dom.dominado_em === '2026-12-10' && dom.proxima === null && !Er.naAgenda({ ...it, ...dom }));
    teste('"Gabarito discutível": fora da agenda e das estatísticas', Er.agendar({ motivo: 'gabarito' }, '2026-11-10') === null &&
      !Er.naAgenda({ motivo: 'gabarito', proxima: '2026-11-01' }) && !Er.nasEstatisticas({ motivo: 'gabarito' }) &&
      Er.vencidos([{ id: 'g', motivo: 'gabarito', proxima: '2026-11-01' }], '2026-11-10').length === 0);
    const meta = Er.meta(Er.vencidos([{ id: '1', proxima: '2026-11-09' }, { id: '2', proxima: '2026-11-10' }, { id: '3', proxima: '2026-11-11' },
      { id: '4', proxima: '2026-11-01', dominado_em: '2026-11-02' }], '2026-11-10'), '2026-11-10');
    teste('vencidos do dia numa meta só, 75 s por item', meta.itens.join() === '1,2' && meta.minutos === 3);
    const conv = Er.converter([
      { id: 'c0', etapa: 0, proxima: '2026-11-11', ultima_revisao: null, criado_em: '2026-11-10T10:00:00Z' },
      { id: 'c1', etapa: 1, proxima: '2026-11-17', ultima_revisao: '2026-11-10' },
      { id: 'c2', etapa: 2, proxima: '2026-12-10', ultima_revisao: '2026-11-10' },
      { id: 'c3', etapa: 3, proxima: '2027-01-01', ultima_revisao: '2026-11-10' },
      { id: 'g', motivo: 'gabarito', etapa: 0, proxima: '2026-11-11' }]);
    const de = id => conv.find(x => x.id === id);
    teste('conversão para 2/7/21: mostra só o que muda', conv.length === 3 && de('c0').para.proxima === '2026-11-12' && !de('c1') &&
      de('c2').para.proxima === '2026-12-01' && de('c3').para.dominado_em === '2026-11-10' && !de('g'), conv.map(x => x.id).join());
  }

  /* ---------- Etapa 4: questões por PDF (I2, I4) ---------- */
  grupo('Etapa 4 — questões por PDF (I2, I4)');
  const Qs = window.estMotorQuestoes, CQ = window.estConfig.questoes;
  {
    const base = { meiaVida: 4, n: 15, tipo: 'ce', dias: 4 };
    teste('chute: 80% em certo/errado e 68% em múltipla = retenção 0,60', perto(Qs.corrigir(0.8, 'ce'), 0.6) && perto(Qs.corrigir(0.68, 'me'), 0.6));
    teste('chute: limites 0,05 e 0,95', Qs.corrigir(1, 'ce') === 0.95 && Qs.corrigir(0.3, 'ce') === 0.05);
    teste('meia-vida inicial ≈ 1,36 e 1º intervalo de 1 dia', perto(Qs.meiaVidaInicial(), 1.3569, 1e-3) && Math.round(Qs.intervaloDe(Qs.meiaVidaInicial())) === 1);
    const acima = Qs.calcular({ ...base, acertos: 14 }), abaixo = Qs.calcular({ ...base, acertos: 10 }), lapso = Qs.calcular({ ...base, acertos: 8 });
    teste('intervalo cresce com acerto acima da meta', acima.intervalo > 4, `4 → ${acima.intervalo}`);
    teste('abaixo da meta cresce menos; no lapso encolhe', abaixo.intervalo < acima.intervalo && lapso.intervalo < 4, `${abaixo.intervalo} < ${acima.intervalo}; lapso ${lapso.intervalo}`);
    teste('lapso: sem o ganho', lapso.lapso && perto(lapso.meiaVida, lapso.estimada) && perto(acima.meiaVida, acima.estimada * CQ.ganho));
    teste('limites: 3× e 0,5× os dias; teto da prova; nunca menos de 1',
      Qs.calcular({ meiaVida: 30, n: 30, acertos: 30, tipo: 'ce', dias: 2 }).intervalo === 6 &&
      Qs.calcular({ meiaVida: 1, n: 30, acertos: 15, tipo: 'ce', dias: 20 }).intervalo === 10 &&
      Qs.calcular({ meiaVida: 30, n: 30, acertos: 30, tipo: 'ce', dias: 20, diasAteProva: 25 }).intervalo === 5 &&
      Qs.calcular({ meiaVida: 1, n: 15, acertos: 0, tipo: 'ce', dias: 1, diasAteProva: 2 }).intervalo === 1);
    const extremos = [0, 15].flatMap(a => ['ce', 'me'].map(t => Qs.calcular({ ...base, tipo: t, acertos: a })));
    teste('acerto de 0% e 100%: sem erro de cálculo', extremos.every(u => [u.meiaVida, u.intervalo, u.observada].every(Number.isFinite) && u.intervalo >= 1));

    const est0 = { id: 'P', disciplina_id: 'd', meia_vida: null, ultimo_contato: null, proxima_data: null, blocos: 0, graduado: false, concluido_em: null };
    const fix = Qs.registrarBloco(est0, { tipo_bloco: 'primeiro', tipo_questao: 'ce', itens: [{ subtopico_id: 's1', total: 15, acertos: 15 }], estudadosHoje: ['s1'] }, '2026-11-10');
    teste('questões no dia do estudo: fixação, fora do modelo', fix.registro.tipo_bloco === 'fixacao' && fix.estado === est0);
    const p1 = Qs.registrarBloco(est0, { tipo_bloco: 'primeiro', tipo_questao: 'ce', itens: [{ subtopico_id: 's1', total: 15, acertos: 13 }], diasDesdeEstudo: 1 }, '2026-11-11');
    teste('1º contato com o PDF em leitura: ajusta a meia-vida, sem próxima data', p1.estado.meia_vida > Qs.meiaVidaInicial() && !p1.estado.proxima_data && p1.registro.dias === 1);
    const conc = Qs.concluirPdf(p1.estado, '2026-11-20');
    teste('PDF concluído: a fila de revisão começa', conc.concluido_em === '2026-11-20' && conc.proxima_data > '2026-11-20', conc.proxima_data);
    const rev = Qs.registrarBloco(conc, { tipo_bloco: 'revisao', tipo_questao: 'ce', itens: [{ subtopico_id: 's1', total: 8, acertos: 8 }, { subtopico_id: 's2', total: 7, acertos: 6 }] }, '2026-11-25');
    teste('bloco com vários subtópicos: registro de cada um e um modelo só do PDF',
      rev.registro.itens.length === 2 && rev.registro.total === 15 && rev.estado.blocos === 2 && rev.estado.proxima_data > '2026-11-25');
    const grad = Qs.registrarBloco({ ...conc, meia_vida: 40, ultimo_contato: '2026-10-01' }, { tipo_bloco: 'revisao', tipo_questao: 'ce', itens: [{ subtopico_id: 's1', total: 15, acertos: 15 }] }, '2026-11-20');
    teste('graduação: intervalo acima de 45 dias vai para a manutenção', grad.registro.intervalo > CQ.limiteGraduacao && grad.estado.graduado, `intervalo ${grad.registro.intervalo}`);
    const volta = Qs.registrarBloco(grad.estado, { tipo_bloco: 'manutencao', tipo_questao: 'ce', itens: [{ subtopico_id: null, total: 5, acertos: 2 }] }, '2027-02-01');
    teste('manutenção abaixo do lapso: volta para a fila própria', volta.registro.lapso && !volta.estado.graduado);
    const ficou = Qs.registrarBloco(grad.estado, { tipo_bloco: 'manutencao', tipo_questao: 'ce', itens: [{ subtopico_id: null, total: 5, acertos: 5 }] }, '2027-02-01');
    teste('manutenção acima do lapso: continua graduado', ficou.estado.graduado);
    const stats = { s1: { total: 20, acertos: 18, ultimo: '2026-11-01' }, s2: { total: 20, acertos: 10, ultimo: '2026-11-05' }, s3: { total: 10, acertos: 5, ultimo: '2026-10-01' } };
    const subs = ['s1', 's2', 's3', 's4', 's5'].map(id => ({ id, estudado_em: id === 's5' ? '2026-11-10' : '2026-10-01', nao_cai: id === 's4' }));
    const esc = Qs.escolherSubtopicos(subs, stats, '2026-11-10');
    teste('escolha do bloco: até 3, menor acerto e mais tempo sem ver; nunca o estudado no dia; "não cai" fora', esc.join() === 's3,s2,s1', esc.join());
    teste('questões divididas entre os cadernos', JSON.stringify(Qs.dividir(15, ['a', 'b'])) === '[{"id":"a","questoes":8},{"id":"b","questoes":7}]');
  }

  /* ---------- Etapa 5: semana (I2, I5) ---------- */
  grupo('Etapa 5 — orçamento e semana (I2, I5)');
  const Sm = window.estMotorSemana;
  {
    teste('rampa: 30% no início, 50% na metade, 100% sem leitura; atraso soma 10% (teto 85%)',
      perto(Sm.fracao(0, 100), 0.30) && perto(Sm.fracao(50, 100), 0.50) && Sm.fracao(100, 100) === 1 && perto(Sm.fracao(50, 100, true), 0.60) && perto(Sm.fracao(99, 100, 2), 0.85));
    teste('piso de leitura: páginas restantes / semanas até a reta final',
      Sm.pisoLeitura(100, '2026-11-09', '2027-01-04') === 25 && Sm.pisoLeitura(100, '2026-11-09', null) === 0 && Sm.pisoLeitura(100, '2026-12-14', '2027-01-04') === 100,
      `${Sm.pisoLeitura(100, '2026-11-09', '2027-01-04')} p./semana`);
    teste('correção por atraso: revisões vencidas acima de uma semana de orçamento', Sm.atrasado(300, 240) && !Sm.atrasado(200, 240));

    const semana = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'];
    const dias = min => semana.map(dia => ({ dia, minutos: min }));
    const disciplina = (id, pdfs) => ({ id, peso: 1, pdfs });
    const pdf = (id, paginas, subs) => ({ id, ordem: 0, paginas, lidas: 0, subtopicos: subs });
    const g = Sm.gerarSemana({ dias: dias(200), disciplinas: [
      disciplina('dp', [pdf('P1', 60, [{ id: 'x1', pag_ini: 1, pag_fim: 20 }, { id: 'x2', pag_ini: 21, pag_fim: 60 }])]),
      disciplina('dd', [pdf('P2', 500, [])])], modelos: [], subtopicos: { P1: [{ id: 'x1' }, { id: 'x2' }] }, erros: [] });
    const blocos = g.metas.filter(m => m.tipo_bloco === 'primeiro');
    const estudo = s => g.metas.find(m => m.tipo === 'leitura' && (m.concluidos || []).includes(s));
    teste('1º contato no dia de estudo seguinte, nunca no mesmo dia',
      blocos.length >= 1 && blocos.every(b => b.alvos.every(a => estudo(a.subtopico_id) && estudo(a.subtopico_id).dia < b.dia)) &&
      blocos[0].dia === semana[semana.indexOf(estudo('x1').dia) + 1], blocos.map(b => b.dia + ' ' + b.alvos.map(a => a.subtopico_id)).join('; '));
    const doP2 = g.metas.filter(m => m.material_id === 'P2' && m.tipo === 'questoes');
    const fimP2 = (g.metas.find(m => m.material_id === 'P2' && m.fimDoPdf) || {}).dia;
    teste('PDF sem subtópicos: 1º contato do PDF inteiro no dia seguinte ao fim, sem revisão junto',
      !fimP2 || (doP2.length === 1 && doP2[0].tipo_bloco === 'primeiro' && doP2[0].dia > fimP2 && doP2[0].alvos[0].subtopico_id === null),
      fimP2 ? doP2.map(m => m.dia + ' ' + m.tipo_bloco).join('; ') : 'P2 não termina nesta semana');
    const curto = Sm.gerarSemana({ dias: dias(200), disciplinas: [disciplina('dd', [pdf('P3', 30, [])])], modelos: [], subtopicos: {}, erros: [] });
    const qP3 = curto.metas.filter(m => m.tipo === 'questoes'), fimP3 = curto.metas.find(m => m.fimDoPdf).dia;
    teste('PDF curto sem subtópicos: 1º contato em D+1 e a revisão só depois dele',
      qP3[0].tipo_bloco === 'primeiro' && qP3[0].dia === semana[semana.indexOf(fimP3) + 1] && qP3.slice(1).every(m => m.tipo_bloco !== 'revisao' || m.dia > qP3[0].dia),
      qP3.map(m => m.dia + ' ' + m.tipo_bloco).join('; '));
    teste('rampa no início: ~30% dos minutos para questões', perto(g.fracao, 0.30, 0.01), `${Math.round(g.fracao * 100)}%`);
    const porDia = semana.map(d => g.metas.filter(m => m.dia === d));
    teste('ordem do dia: questões antes da leitura', porDia.every(l => { const i = l.findIndex(m => m.tipo === 'leitura'); return i < 0 || l.slice(i).every(m => m.tipo === 'leitura'); }));
    teste('nenhum dia passa da carga', porDia.every(l => l.reduce((a, m) => a + m.minutos, 0) <= 200));
    teste('estudo logo depois de questões da mesma disciplina só quando não há outra',
      porDia.every(l => l.every((m, i) => i === 0 || m.tipo !== 'leitura' || l[i - 1].tipo === 'leitura' || m.disciplina_id !== l[i - 1].disciplina_id ||
        !l.slice(i).some(x => x.tipo === 'leitura' && x.disciplina_id !== l[i - 1].disciplina_id))));

    const mod = (id, retDias, peso) => ({ id, disciplina_id: 'dp', peso, meia_vida: 4, ultimo_contato: '2026-11-0' + (9 - retDias), proxima_data: '2026-11-01', concluido_em: '2026-10-01', graduado: false, blocos: 3 });
    const lido = [disciplina('dp', [{ id: 'Z', ordem: 0, paginas: 10, lidas: 10, subtopicos: [] }])];
    const g2 = Sm.gerarSemana({ dias: [{ dia: '2026-11-09', minutos: 50 }], disciplinas: lido, modelos: [mod('R1', 2, 1), mod('R2', 6, 1), mod('R3', 4, 3)], subtopicos: {}, erros: [] });
    teste('leitura acabada: 100% do tempo para questões', g2.fracao === 1);
    teste('dia lotado: entra o de menor retenção × maior peso; os outros são adiados',
      g2.metas.length === 1 && g2.metas[0].material_id === 'R3' && g2.adiados.length === 2, `entrou ${g2.metas.map(m => m.material_id)}; adiados ${g2.adiados.map(a => a.material_id)}`);
    teste('revisões acumuladas acima do orçamento: atraso para a semana seguinte', g2.atrasoProxima, `${g2.minutosVencidos} min vencidos, orçamento ${g2.orcamento.questoes}`);
    const g3 = Sm.gerarSemana({ dias: [{ dia: '2026-11-09', minutos: 120 }], disciplinas: lido, modelos: [mod('R1', 2, 1)], subtopicos: {},
      erros: [{ id: 'e1', proxima: '2026-11-08' }, { id: 'e2', proxima: '2026-11-09' }] });
    teste('prioridade: revisão de erros vencidos antes dos blocos', g3.metas[0].tipo === 'erros' && g3.metas[0].itens.length === 2 && g3.metas[1].material_id === 'R1');
    const g4 = Sm.gerarSemana({ dias: [{ dia: '2026-12-01', minutos: 30 }], dataProva: '2027-01-10', disciplinas: [disciplina('dd', [pdf('P9', 400, [])])], modelos: [], subtopicos: {}, erros: [] });
    teste('semana lotada: o piso de leitura não cabe e há aviso', g4.avisos.some(a => /não cabe/.test(a)) && g4.metas.every(m => m.tipo === 'leitura'));
    const g5 = Sm.gerarSemana({ dias: dias(100), dataProva: '2026-12-21', disciplinas: [disciplina('dd', [pdf('P8', 300, [])])], modelos: [], subtopicos: {}, erros: [] });
    const pisoMin = window.estMotorLeitura.minutosDe(Sm.pisoLeitura(300, '2026-11-09', '2026-12-21'));
    teste('piso de leitura acima da rampa: a leitura sobe até o mínimo', g5.orcamento.leitura >= pisoMin && pisoMin > 0.7 * 600, `${g5.orcamento.leitura} min (mínimo ${pisoMin})`);
    const ms = [{ dia: '2026-11-10', minutos: 180 }, { dia: '2026-11-11', minutos: 100 }];
    const ds = [{ dia: '2026-11-10', minutos: 200 }, { dia: '2026-11-11', minutos: 200 }, { dia: '2026-11-12', minutos: 200 }];
    teste('encaixe na semana gerada: no dia, ou no próximo com folga; sem folga, semana seguinte',
      Sm.encaixar(ms, ds, '2026-11-11', 45) === '2026-11-11' && Sm.encaixar(ms, ds, '2026-11-10', 45) === '2026-11-11' && Sm.encaixar(ms, ds.slice(0, 1), '2026-11-10', 45) === null);
    const pj = Sm.projetar({ faltam: 400, total: 400, minutosSemana: 1200, dataProva: null, hoje: '2026-11-09', semanas: 8 });
    teste('projeção: 8 semanas, questões crescendo e data de término da leitura',
      pj.semanas.length === 8 && pj.semanas[3].minutosQuestoes > pj.semanas[0].minutosQuestoes && !!pj.terminoLeitura,
      `término ${pj.terminoLeitura}; questões ${pj.semanas.map(s => s.minutosQuestoes).join(', ')}`);
  }

  /* ---------- Interface, etapa 1: cadastro do PDF (T1) ---------- */
  grupo('Interface 1 — cadastro de subtópicos (T1)');
  const Cd = window.estCadastroPdf;
  {
    const r = Cd.lerLinhas(['Acentuação; 1-12', 'Hífen; pág. 13–15; https://www.tecconcursos.com.br/caderno/AbC', '', 'Crase; 16', ' ; 20-22',
      'Regência; 22-20', 'Pontuação; 30-90', 'Colocação; 10 a 12', 'Concordância; abc', 'Vírgula; 40-41; tec.com/x', 'A; 1-2; https://x; extra'].join('\n'), 60);
    const e = n => (r.find(x => x.linha === n) || {}).erros || [];
    teste('linhas válidas: nome, páginas e caderno', r[0].pag_ini === 1 && r[0].pag_fim === 12 && !e(1).length &&
      r[1].pag_ini === 13 && r[1].pag_fim === 15 && r[1].tec_link === 'https://www.tecconcursos.com.br/caderno/AbC' && !e(2).length);
    teste('página única e "10 a 12" são aceitas', r.find(x => x.linha === 4).pag_fim === 16 && !e(4).length && r.find(x => x.linha === 8).pag_fim === 12 && !e(8).length);
    teste('linha em branco é ignorada', !r.some(x => x.linha === 3));
    teste('linhas inválidas: sem nome, final antes da inicial, fora do PDF, formato, link e campos a mais',
      /sem nome/.test(e(5)) && /antes da inicial/.test(e(6)) && /última página/.test(e(7)) && /formato/.test(e(9)) && /https/.test(e(10)) && /3 campos/.test(e(11)),
      r.filter(x => x.erros.length).map(x => x.linha + ': ' + x.erros.join('/')).join(' | '));
    const v = Cd.validar([{ nome: 'A', pag_ini: 1, pag_fim: 12 }, { nome: 'B', pag_ini: 10, pag_fim: 20 }, { nome: 'C', pag_ini: 30, pag_fim: 40 },
      { nome: 'a', pag_ini: 50, pag_fim: 52 }, { nome: 'D', pag_ini: 55, pag_fim: 70 }, { nome: 'E' }], 60);
    teste('sobreposição de páginas: erro na linha que repete', v.erros.some(x => x.i === 1 && /10–12/.test(x.msg)), v.erros.map(x => x.i + ': ' + x.msg).join(' | '));
    teste('nome repetido (sem diferenciar maiúsculas) e faixa fora do PDF: erro', v.erros.some(x => x.i === 3 && /repetido/.test(x.msg)) && v.erros.some(x => x.i === 4 && /fora do PDF/.test(x.msg)));
    teste('páginas não cobertas e subtópico sem páginas: aviso', v.avisos.some(x => /21–29, 41–49, 53–54/.test(x)) && v.avisos.some(x => /sem páginas: E/.test(x)), v.avisos.join(' | '));
    teste('lista correta: sem erros', !Cd.validar([{ nome: 'A', pag_ini: 1, pag_fim: 30 }, { nome: 'B', pag_ini: 31, pag_fim: 60 }], 60).erros.length);
    const sum = Cd.lerSumario(['Curso de Português', 'Sumário', '1 - Acentuação gráfica ........ 3', '2. Hífen .... 15', 'Regras gerais 15',
      '3 Crase ............. 22', 'Lista de questões ....... 40', 'Página 2 de 60'], 60);
    teste('sumário: faixas de cada item até a véspera do seguinte; o último até o fim do PDF',
      sum.length === 4 && sum[0].nome === 'Acentuação gráfica' && sum[0].pag_ini === 3 && sum[0].pag_fim === 14 && sum[1].nome === 'Regras gerais' && sum[3].pag_fim === 60,
      sum.map(x => `${x.nome} ${x.pag_ini}-${x.pag_fim}`).join(' | '));
    teste('texto sem sumário: nenhuma sugestão', !Cd.lerSumario(['Aula 01', 'Nesta aula veremos 3 temas', 'Bons estudos 2'], 60).length);
  }

  const falhas = window.__teste.falhas();
  const fim = document.createElement('p');
  fim.id = 'resultado';
  fim.className = falhas ? 'falha' : 'ok';
  fim.textContent = falhas ? `${falhas} teste(s) falharam.` : 'Todos os testes passaram.';
  document.body.appendChild(fim);
})();
