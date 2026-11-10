/* Motor de estudos — migração (etapa 1). Só contas: recebe os dados atuais e devolve o que gravar
   e o que ficou pendente; quem lê e grava é o estudos.plano.js. Testes em ferramentas/testes/motor.html.

   Leva o edital por PDF para a hierarquia Disciplina > PDF > Subtópico:
   - cada PDF ganha a linha do motor (ordem, caderno do TEC, conclusão);
   - cada subtópico ganha o PDF dono e as páginas (colunas novas), a partir da ligação que já existe;
   - os vínculos PDF → item do edital de origem viram vínculos opcionais dos subtópicos;
   - cada erro ganha o PDF.
   Pode rodar de novo: só devolve o que ainda está diferente (e re-sincroniza as páginas, que o site
   publicado continua gravando no campo antigo). */
(function () {
  const faixaValida = l => l && l.de > 0 && l.ate >= l.de;
  const iguais = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const uniao = (a, b) => [...new Set([...(a || []), ...b])];

  /* dados = {
       edital:  { id, titulo, disciplinas: [{ id, nome, topicos: [{ id, nome, estudado, tecLink }] }] },
       origem:  o edital de onde o "por PDF" foi criado (mesmo formato), ou null,
       materiais:  linhas de "materiais" (todas),
       subtopicos: linhas de "subtopicos" (todas),
       erros:      linhas de "erros" (id, edital_id, topico_id, subtopico_id, material_id),
       motorPdfs:  linhas já existentes de "motor_pdfs",
       paginasLidas: { idDoItem: páginas lidas }, ultimaSessao: { idDoItem: 'AAAA-MM-DD' }, hoje
     }
     Devolve { pdfs, subs, erros, pendencias }. */
  function planejar(dados) {
    const { edital, origem, materiais, subtopicos, erros = [], motorPdfs = [], paginasLidas = {}, ultimaSessao = {}, hoje } = dados;
    const pend = { origem: origem ? origem.titulo : null, variosPdfs: [], semPaginas: [], pdfsSemItem: [], vinculos: [], semOrigem: [] };
    const itens = new Map();   // item → { d, t }
    edital.disciplinas.forEach(d => d.topicos.forEach(t => itens.set(t.id, { d, t })));
    const doEdital = materiais.filter(m => m.edital_id === edital.id);
    const pdfPorId = new Map(doEdital.map(m => [m.id, m]));
    const itemDoPdf = m => { const l = (m.topicos || []).filter(x => itens.has(x.topico_id)); return l.length === 1 ? l[0].topico_id : null; };
    const pdfsDoItem = {};
    doEdital.forEach(m => { const t = itemDoPdf(m); if (t) (pdfsDoItem[t] = pdfsDoItem[t] || []).push(m); else pend.pdfsSemItem.push({ pdf: m.nome }); });
    const dataDe = tId => ultimaSessao[tId] || hoje;

    // ---- Subtópicos: PDF dono e páginas
    const subsDoEdital = subtopicos.filter(s => itens.has(s.topico_id));
    const novoSub = new Map();   // id → campos calculados
    subsDoEdital.forEach(s => {
      const item = itens.get(s.topico_id);
      const links = (s.pdfs || []).filter(p => pdfPorId.has(p.material_id));
      let material = null, link = null;
      if (links.length > 1) {
        // Páginas em mais de um PDF: quem decide o dono é o usuário (se já decidiu, vale a ligação com esse PDF)
        link = links.find(p => p.material_id === s.material_id) || null;
        if (!link) {
          pend.variosPdfs.push({ subtopico: s.nome, disciplina: item.d.nome,
            pdfs: links.map(p => ({ pdf: pdfPorId.get(p.material_id).nome, de: p.de || null, ate: p.ate || null })) });
          return;
        }
        material = link.material_id;
      } else if (links.length === 1) { link = links[0]; material = link.material_id; }
      else { const l = pdfsDoItem[s.topico_id] || []; material = l.length === 1 ? l[0].id : s.material_id || null; }
      const comPaginas = faixaValida(link);
      if (!comPaginas) pend.semPaginas.push({ subtopico: s.nome, disciplina: item.d.nome, pdf: material ? pdfPorId.get(material).nome : null });
      const ini = comPaginas ? link.de : s.pag_ini || null, fim = comPaginas ? link.ate : s.pag_fim || null;
      const lido = item.t.estudado || (fim && fim <= (paginasLidas[s.topico_id] || 0));
      novoSub.set(s.id, { material_id: material, pag_ini: ini, pag_fim: fim, estudado_em: s.estudado_em || (lido ? dataDe(s.topico_id) : null),
        itens_edital: s.itens_edital || [] });
    });

    // ---- Vínculos com o edital de origem: do PDF antigo (mesmo nome, mesma disciplina) para os subtópicos
    const itensPdf = {};   // PDF sem subtópicos: o vínculo fica no PDF
    if (origem) {
      const itensOrigem = new Set(origem.disciplinas.flatMap(d => d.topicos.map(t => t.id)));
      const nomeOrigem = id => { for (const d of origem.disciplinas) { const t = d.topicos.find(x => x.id === id); if (t) return t.nome; } return id; };
      const discOrigem = new Map(origem.disciplinas.map(d => [d.nome, d.id]));
      doEdital.forEach(m => {
        const disc = edital.disciplinas.find(d => d.id === m.disciplina_id);
        const antigo = disc && materiais.find(o => o.edital_id === origem.id && o.disciplina_id === discOrigem.get(disc.nome) && o.nome === m.nome);
        if (!antigo) { pend.semOrigem.push({ pdf: m.nome }); return; }
        const links = (antigo.topicos || []).filter(l => itensOrigem.has(l.topico_id));
        if (!links.length) return;
        const subs = subsDoEdital.filter(s => novoSub.has(s.id) && novoSub.get(s.id).material_id === m.id);
        if (!subs.length) { itensPdf[m.id] = links.map(l => l.topico_id); return; }
        links.forEach(l => {
          const unico = links.length === 1;
          if (!faixaValida(l) && !unico) {
            pend.vinculos.push({ pdf: m.nome, item: nomeOrigem(l.topico_id), motivo: 'o PDF era ligado a vários itens sem faixa de páginas' });
            return;
          }
          let alvo = subs;
          if (faixaValida(l)) {
            alvo = subs.filter(s => { const n = novoSub.get(s.id); return n.pag_ini && n.pag_fim && n.pag_ini <= l.ate && n.pag_fim >= l.de; });
            const semPag = subs.filter(s => !novoSub.get(s.id).pag_ini);
            if (unico) alvo = alvo.concat(semPag);
            else if (semPag.length) pend.vinculos.push({ pdf: m.nome, item: nomeOrigem(l.topico_id), motivo: `${semPag.length} subtópico(s) sem páginas: ${semPag.map(s => s.nome).join(', ')}` });
            if (!alvo.length) { pend.vinculos.push({ pdf: m.nome, item: nomeOrigem(l.topico_id), motivo: `nenhum subtópico nas páginas ${l.de}–${l.ate}` }); return; }
          }
          alvo.forEach(s => { const n = novoSub.get(s.id); n.itens_edital = uniao(n.itens_edital, [l.topico_id]); });
        });
      });
    }

    // ---- Saídas: só o que mudou
    const subs = [];
    subsDoEdital.forEach(s => {
      const n = novoSub.get(s.id);
      if (!n) return;
      const atual = { material_id: s.material_id || null, pag_ini: s.pag_ini || null, pag_fim: s.pag_fim || null, estudado_em: s.estudado_em || null, itens_edital: s.itens_edital || [] };
      if (!iguais(atual, n)) subs.push({ id: s.id, nome: s.nome, ...n });
    });
    const jaTem = new Map(motorPdfs.map(p => [p.id, p]));
    const ordemNaDisc = {};
    const pdfs = [];
    doEdital.forEach(m => {
      const tId = itemDoPdf(m), item = tId && itens.get(tId).t;
      if (!tId) return;   // sem item próprio: fora do motor (listado nas pendências)
      const ordem = ordemNaDisc[m.disciplina_id] = (ordemNaDisc[m.disciplina_id] ?? -1) + 1;
      const atual = jaTem.get(m.id);
      if (!atual) {
        pdfs.push({ id: m.id, nome: m.nome, edital_id: edital.id, disciplina_id: m.disciplina_id, ordem, tec_link: (item && item.tecLink) || null,
          itens_edital: itensPdf[m.id] || [], concluido_em: item && item.estudado ? dataDe(tId) : null });
      } else if (itensPdf[m.id] && !iguais(uniao(atual.itens_edital, itensPdf[m.id]), atual.itens_edital || [])) {
        pdfs.push({ id: m.id, nome: m.nome, itens_edital: uniao(atual.itens_edital, itensPdf[m.id]) });
      }
    });
    const errosNovos = erros.filter(e => !e.material_id && itens.has(e.topico_id)).map(e => {
      const n = e.subtopico_id && novoSub.get(e.subtopico_id);
      const l = pdfsDoItem[e.topico_id] || [];
      return { id: e.id, material_id: (n && n.material_id) || (l.length === 1 ? l[0].id : null) };
    }).filter(e => e.material_id);
    return { pdfs, subs, erros: errosNovos, pendencias: pend };
  }

  const temMudanca = p => p.pdfs.length + p.subs.length + p.erros.length > 0;

  // Relatório em texto, para o usuário conferir antes de aplicar
  function relatorio(p) {
    const n = (q, um, varios) => `${q} ${q === 1 ? um : varios}`;
    const L = [];
    const novos = p.pdfs.filter(x => 'ordem' in x);
    L.push('O QUE SERÁ GRAVADO (só campos novos; nada é apagado)');
    L.push(`- ${n(novos.length, 'PDF entra', 'PDFs entram')} no motor (ordem de leitura, caderno do TEC e conclusão).`);
    const comDono = p.subs.filter(s => s.material_id), comVinc = p.subs.filter(s => s.itens_edital.length);
    L.push(`- ${n(comDono.length, 'subtópico ganha', 'subtópicos ganham')} PDF dono e páginas.`);
    L.push(`- ${n(comVinc.length, 'subtópico recebe', 'subtópicos recebem')} vínculo com itens do edital${p.pendencias.origem ? ` “${p.pendencias.origem}”` : ''}.`);
    L.push(`- ${n(p.erros.length, 'erro do Caderno ganha', 'erros do Caderno ganham')} o PDF.`);
    L.push('- As metas e as revisões de hoje não mudam nesta etapa.');
    const pd = p.pendencias;
    L.push('', 'PARA VOCÊ DECIDIR');
    L.push(`Subtópicos com páginas em mais de um PDF (${pd.variosPdfs.length}): ficam sem PDF dono até você dizer como dividir.`);
    pd.variosPdfs.forEach(x => L.push(`  • ${x.disciplina} › ${x.subtopico}: ${x.pdfs.map(q => `${q.pdf}${q.de ? ` (p. ${q.de}–${q.ate})` : ' (sem páginas)'}`).join(' | ')}`));
    L.push('', 'O QUE NÃO FOI POSSÍVEL CONVERTER');
    if (!pd.origem) L.push('Não achei o edital de origem (o desativado com o mesmo nome, sem “— por PDF”): nenhum vínculo com o edital foi convertido.');
    L.push(`Vínculos com o edital não convertidos (${pd.vinculos.length}):`);
    pd.vinculos.forEach(x => L.push(`  • ${x.pdf} → ${x.item}: ${x.motivo}`));
    L.push(`Subtópicos sem páginas (${pd.semPaginas.length}): entram sem faixa; preencha as páginas na ficha.`);
    pd.semPaginas.forEach(x => L.push(`  • ${x.disciplina} › ${x.subtopico}${x.pdf ? ` (${x.pdf})` : ' (sem PDF)'}`));
    if (pd.origem) {
      L.push(`PDFs que não existiam no edital de origem (${pd.semOrigem.length}): sem vínculo para converter.`);
      pd.semOrigem.forEach(x => L.push(`  • ${x.pdf}`));
    }
    if (pd.pdfsSemItem.length) {
      L.push(`PDFs sem item próprio ou ligados a vários itens (${pd.pdfsSemItem.length}): ficam fora do motor.`);
      pd.pdfsSemItem.forEach(x => L.push(`  • ${x.pdf}`));
    }
    return L.join('\n');
  }

  window.estMotorMigracao = { planejar, temMudanca, relatorio };
})();
