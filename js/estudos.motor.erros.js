/* Motor de estudos — C. Agenda de erros (funções puras; parâmetros em estConfig.erros).
   Um item é a própria linha de "erros": etapa (= acertos seguidos), proxima, recorrencias, dominado_em, motivo.
   Passos: 2, 7 e 21 dias. Acerto avança; o 3º acerto seguido domina; erro volta ao começo e conta recorrência. */
(function () {
  const C = () => window.estConfig.erros;
  const dl = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const somar = (dia, n) => { const d = new Date(dia + 'T12:00:00'); d.setDate(d.getDate() + n); return dl(d); };

  // C2: gabarito discutível fica fora da agenda e das estatísticas; dominado sai da fila
  const naAgenda = e => e.motivo !== C().motivoFora && !e.dominado_em;
  const nasEstatisticas = e => e.motivo !== C().motivoFora;

  // Erro recém-registrado: 1ª revisão em 2 dias (null se ficar fora da agenda)
  function agendar(erro, hoje) {
    if (erro.motivo === C().motivoFora) return null;
    return { etapa: 0, proxima: somar(hoje, C().passos[0]), recorrencias: erro.recorrencias || 0, dominado_em: null };
  }

  /* Resposta numa revisão. Devolve os campos novos e { releitura } (C4: erro de conteúdo repetido). */
  function responder(item, acertou, hoje) {
    const passos = C().passos;
    if (acertou) {
      const etapa = (item.etapa || 0) + 1;
      return etapa >= passos.length
        ? { etapa, proxima: null, recorrencias: item.recorrencias || 0, dominado_em: hoje, releitura: false }
        : { etapa, proxima: somar(hoje, passos[etapa]), recorrencias: item.recorrencias || 0, dominado_em: null, releitura: false };
    }
    return { etapa: 0, proxima: somar(hoje, passos[0]), recorrencias: (item.recorrencias || 0) + 1, dominado_em: null,
      releitura: item.motivo === C().motivoConteudo };
  }

  const vencidos = (erros, dia) => erros.filter(e => naAgenda(e) && e.proxima && e.proxima <= dia);
  // C3: uma meta só com os vencidos do dia (75 s por item)
  const minutos = n => Math.ceil(n * C().segundosPorItem / 60);
  const meta = (itens, dia) => (itens.length ? { dia, tipo: 'erros', itens: itens.map(e => e.id), minutos: minutos(itens.length) } : null);

  /* Conversão da agenda antiga (1/7/30/90, até 4 acertos) para a nova, para rodar na publicação.
     Mantém os acertos seguidos; 3 ou mais = dominado; a próxima revisão conta a partir da última
     (ou do registro). Devolve só os que mudam: [{ id, de: {…}, para: {…} }]. */
  function converter(erros) {
    const passos = C().passos;
    return erros.filter(naAgenda).map(e => {
      const base = e.ultima_revisao || String(e.criado_em || '').slice(0, 10);
      const etapa = Math.max(0, e.etapa || 0);
      const para = etapa >= passos.length
        ? { etapa, proxima: null, dominado_em: e.ultima_revisao || base }
        : { etapa, proxima: base ? somar(base, passos[etapa]) : e.proxima, dominado_em: null };
      const de = { etapa: e.etapa || 0, proxima: e.proxima || null, dominado_em: e.dominado_em || null };
      return JSON.stringify(de) === JSON.stringify(para) ? null : { id: e.id, de, para };
    }).filter(Boolean);
  }

  window.estMotorErros = { naAgenda, nasEstatisticas, agendar, responder, vencidos, minutos, meta, converter };
})();
