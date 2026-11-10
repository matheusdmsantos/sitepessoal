/* Motor de estudos — B. Metas de leitura (funções puras; parâmetros em estConfig.leitura).
   Um PDF de leitura: { id, nome, ordem, paginas, lidas, subtopicos: [{ id, nome, pag_ini, pag_fim, nao_cai }] }.
   "lidas" = última página lida (as páginas 1..lidas já foram); páginas de subtópicos "não cai" são puladas. */
(function () {
  const C = () => window.estConfig.leitura;

  // Páginas a ler do PDF, em faixas [de, ate], sem as de subtópicos "não cai"
  function paginasALer(pdf) {
    const fora = (pdf.subtopicos || []).filter(s => s.nao_cai && s.pag_ini > 0 && s.pag_fim >= s.pag_ini);
    const r = [];
    let ini = null;
    for (let p = 1; p <= pdf.paginas; p++) {
      const pula = fora.some(s => p >= s.pag_ini && p <= s.pag_fim);
      if (!pula && ini === null) ini = p;
      if ((pula || p === pdf.paginas) && ini !== null) { r.push([ini, pula ? p - 1 : p]); ini = null; }
    }
    return r;
  }
  // Páginas que ainda faltam, em ordem (lista de números)
  const restantes = pdf => paginasALer(pdf).flatMap(([a, b]) => { const l = []; for (let p = Math.max(a, (pdf.lidas || 0) + 1); p <= b; p++) l.push(p); return l; });
  const totalALer = pdf => paginasALer(pdf).reduce((a, [x, y]) => a + y - x + 1, 0);
  const faltam = pdf => restantes(pdf).length;
  const minutosDe = paginas => Math.round(paginas * 60 / C().paginasPorHora);

  /* B1, B3: a próxima meta de leitura de uma disciplina. pdfs em ordem; percorre o primeiro que ainda tem
     páginas, sem saltar. alvoMin = tempo disponível (até maxMin). Devolve
     { material_id, pag_ini, pag_fim, paginas, minutos, concluidos: [subtópicos que acabam nela], fimDoPdf } ou null. */
  function proximaMeta(pdfs, alvoMin) {
    const cfg = C();
    const pdf = pdfs.slice().sort((a, b) => a.ordem - b.ordem).find(p => faltam(p) > 0);
    if (!pdf) return null;
    const pags = restantes(pdf);
    const alvo = Math.min(alvoMin || cfg.alvoMin, cfg.maxMin) * cfg.paginasPorHora / 60;
    const max = cfg.maxMin * cfg.paginasPorHora / 60;
    let n = Math.max(1, Math.min(pags.length, Math.floor(alvo + 1e-9)));
    if (pags.length > n) {
      // Corte no fim de um subtópico a até folgaCorte do alvo (nunca acima do máximo): o mais perto do alvo
      const fins = (pdf.subtopicos || []).filter(s => !s.nao_cai && s.pag_fim > 0).map(s => pags.indexOf(s.pag_fim) + 1).filter(k => k > 0);
      const ok = fins.filter(k => Math.abs(k - alvo) <= cfg.folgaCorte * alvo && k <= Math.min(max, alvo * (1 + cfg.folgaCorte)));
      if (ok.length) n = ok.sort((a, b) => Math.abs(a - alvo) - Math.abs(b - alvo) || b - a)[0];
    }
    const lidos = pags.slice(0, n), fim = lidos[lidos.length - 1];
    return { material_id: pdf.id, pag_ini: lidos[0], pag_fim: fim, paginas: n, minutos: minutosDe(n),
      concluidos: concluidos(pdf, pdf.lidas || 0, fim), fimDoPdf: n === pags.length };
  }

  /* B4: subtópicos cuja última página está entre (de, ate]: ficam estudados quando a meta que contém
     a última página é concluída */
  function concluidos(pdf, de, ate) {
    return (pdf.subtopicos || []).filter(s => !s.nao_cai && s.pag_fim > de && s.pag_fim <= ate).map(s => s.id);
  }

  window.estMotorLeitura = { paginasALer, restantes, totalALer, faltam, minutosDe, proximaMeta, concluidos };
})();
