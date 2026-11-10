/* Motor de estudos — todos os parâmetros numéricos (mude aqui; os módulos js/estudos.motor.*.js leem
   daqui). Documentação: docs/motor-estudos.md. */
window.estConfig = {
  // B. Metas de leitura
  leitura: {
    paginasPorHora: 20,      // ritmo de leitura
    alvoMin: 60,             // tempo-alvo de uma meta de leitura
    maxMin: 70,              // nenhuma meta de leitura passa disso
    minMin: 15,              // sobra de dia menor que isso não vira meta
    folgaCorte: 0.20         // B3: encerra no fim de um subtópico se ficar a até 20% do tempo-alvo
  },
  // C. Agenda de erros
  erros: {
    passos: [2, 7, 21],      // dias até a revisão, a partir do registro / do último acerto
    segundosPorItem: 75,     // C3: tempo estimado por erro na meta de revisão
    minReleitura: 20,        // C4: releitura curta do subtópico quando um erro de conteúdo se repete
    motivoFora: 'gabarito',  // C2: "Gabarito discutível" fica fora da agenda e das estatísticas
    motivoConteudo: 'conteudo'   // C4: "Não sabia o conteúdo"
  },
  // D. Questões inéditas por PDF
  questoes: {
    porBloco: 15,            // questões em cada bloco
    minPorQuestao: 3,
    maxSubtopicos: 3,        // D3: subtópicos por bloco de revisão
    maxPdfsManutencao: 3,    // D8: PDFs graduados por bloco de manutenção
    retencaoAlvo: 0.60,      // 80% de acerto em certo/errado
    retencaoLapso: 0.25,
    ganho: 2.2,
    crescimentoMax: 3.0,
    reducaoMax: 0.5,
    tetoProva: 0.20,
    limiteGraduacao: 45,     // D8: intervalo acima disso vai para a manutenção da disciplina
    pesoBloco: 10,           // peso do bloco = n / (n + pesoBloco)
    chute: { ce: 0.5, me: 0.2 }
  },
  // F. Estatísticas (só leitura; não mudam o agendamento)
  estatisticas: {
    amostraMin: 30,          // F3: menos questões que isso no subtópico = "amostra insuficiente"
    z: 1.96,                 // F3: intervalo de confiança de Wilson de 95%
    pontosAcerto: 1,         // F6: nota líquida = peso × (pontosAcerto × p + pontosErro × (1 − p)); Cebraspe: +1 e −1
    pontosErro: -1
  },
  // E. Orçamento semanal e rampa
  semana: {
    fracaoBase: 0.30,        // E1: fração de questões = base + rampa × (páginas lidas / total)
    fracaoRampa: 0.40,
    fracaoAtraso: 0.10,      // E3
    fracaoMaxLeitura: 0.85,  // E3: teto enquanto houver leitura
    retaFinalSemanas: 4,     // E2: a leitura deve acabar 4 semanas antes da prova
    semanasProjecao: 8       // E7
  }
};
