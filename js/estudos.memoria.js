/* Modelo de memória das metas de questões (repetição espaçada adaptativa).
   Só contas, sem tela nem banco: o estudos.plano.js agenda e grava; os testes ficam em
   ferramentas/testes/memoria.html.

   Cada tópico (assunto ou item) tem uma meia-vida em dias: retenção prevista = 2^(-dias / meia-vida).
   Cada bloco de questões mede a retenção real (acerto corrigido pelo chute) e ajusta a meia-vida. */
(function () {
  /* PARÂMETROS (mude aqui) */
  const CFG = {
    retencaoAlvo: 0.60,      // retenção em que o próximo bloco é marcado (80% de acerto em certo/errado, 68% em múltipla)
    retencaoLapso: 0.25,     // abaixo disso é lapso (62,5% em certo/errado, 40% em múltipla): sem ganho e com revisão teórica
    ganho: 2.2,              // quanto a meia-vida cresce a cada bloco sem lapso
    crescimentoMax: 3.0,     // o intervalo novo é no máximo 3× os dias desde o último contato
    reducaoMax: 0.5,         // e no mínimo metade deles
    tetoProva: 0.20,         // e no máximo 20% dos dias que faltam até a prova
    pesoBloco: 10,           // peso do bloco = n / (n + 10): bloco pequeno é mais ruidoso e pesa menos
    chute: { ce: 0.5, me: 0.2 }   // taxa de chute: certo/errado (padrão, Cebraspe) e múltipla escolha de 5
  };
  CFG.meiaVidaInicial = 1 / Math.log2(1 / CFG.retencaoAlvo);   // ≈ 1,36 dia: o 1º bloco cai em D+1

  const TIPOS = { ce: 'Certo/Errado', me: 'Múltipla escolha (5)' };
  const chuteDe = tipo => (tipo in CFG.chute ? CFG.chute[tipo] : CFG.chute.ce);

  const retencao = (dias, meiaVida) => Math.pow(2, -Math.max(0, dias) / meiaVida);
  // Acerto bruto (0 a 1) → retenção, tirando o que se acerta no chute; fica entre 5% e 95%
  function corrigir(acerto, tipo) {
    const c = chuteDe(tipo);
    return Math.min(0.95, Math.max(0.05, (acerto - c) / (1 - c)));
  }
  // Retenção → acerto que se espera ver no bloco
  const acertoPrevisto = (ret, tipo) => chuteDe(tipo) + ret * (1 - chuteDe(tipo));
  const intervaloDe = meiaVida => meiaVida * Math.log2(1 / CFG.retencaoAlvo);

  /* Um bloco concluído. meiaVida = a de antes; n e acertos do tópico; dias = desde o último contato
     (≥ 1; no mesmo dia do estudo é fixação e não passa por aqui); diasAteProva opcional.
     Devolve { r, lapso, observada, estimada, meiaVida, intervalo, previsto }. */
  function atualizar({ meiaVida, n, acertos, tipo, dias, diasAteProva }) {
    const D = Math.max(1, dias);
    const r = corrigir(n > 0 ? acertos / n : 0, tipo);
    const observada = -D / Math.log2(r);
    const peso = n / (n + CFG.pesoBloco);
    const estimada = Math.pow(meiaVida, 1 - peso) * Math.pow(observada, peso);
    const lapso = r < CFG.retencaoLapso;
    const nova = lapso ? estimada : estimada * CFG.ganho;
    let intervalo = Math.round(intervaloDe(nova));
    intervalo = Math.min(intervalo, Math.round(CFG.crescimentoMax * D));
    intervalo = Math.max(intervalo, Math.round(CFG.reducaoMax * D));
    if (diasAteProva > 0) intervalo = Math.min(intervalo, Math.floor(CFG.tetoProva * diasAteProva));
    intervalo = Math.max(1, intervalo);
    return { r, lapso, observada, estimada, meiaVida: nova, intervalo, previsto: acertoPrevisto(retencao(D, meiaVida), tipo) };
  }

  const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
  const somarDias = (dia, n) => {
    const d = new Date(dia + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  /* Reprocessa o histórico de um tópico em ordem de data. estudo = dia do primeiro contato;
     blocos = [{ data, n, acertos, tipo }]. Bloco no mesmo dia do último contato é fixação: fica no
     histórico, mas não mexe no modelo. Devolve { meiaVida, ultimoContato, proxima, blocos, historico }. */
  function reprocessar(estudo, blocos, dataProva) {
    const m = { meiaVida: CFG.meiaVidaInicial, ultimoContato: estudo, proxima: somarDias(estudo, 1), blocos: 0, historico: [] };
    blocos.slice().sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0)).forEach(b => {
      const dias = diasEntre(m.ultimoContato, b.data);
      if (dias <= 0 || !(b.n > 0)) { m.historico.push({ ...b, dias: Math.max(0, dias), fixacao: true }); return; }
      const u = atualizar({ meiaVida: m.meiaVida, n: b.n, acertos: b.acertos, tipo: b.tipo, dias,
        diasAteProva: dataProva ? diasEntre(b.data, dataProva) : 0 });
      m.historico.push({ ...b, dias, fixacao: false, previsto: u.previsto, mvAntes: m.meiaVida, mvDepois: u.meiaVida, intervalo: u.intervalo, lapso: u.lapso });
      m.meiaVida = u.meiaVida;
      m.ultimoContato = b.data;
      m.proxima = somarDias(b.data, u.intervalo);
      m.blocos++;
    });
    return m;
  }

  window.estMemoria = { CFG, TIPOS, retencao, corrigir, acertoPrevisto, intervaloDe, atualizar, reprocessar, diasEntre, somarDias };
})();
