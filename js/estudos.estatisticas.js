/* Estatísticas do motor de estudos (interface, etapa 5). Contas puras em estStats (testes em
   ferramentas/testes/motor.html) e a tela (estStats.render), chamada pela seção Desempenho.
   Regras (F1): questões inéditas (blocos) medem retenção; itens de erro refeitos medem correção; as duas
   taxas nunca são somadas. Blocos de fixação e erros "Gabarito discutível" ficam fora de tudo. */
(function () {
  const C = () => (window.estConfig && window.estConfig.estatisticas) || { amostraMin: 30, z: 1.96, pontosAcerto: 1, pontosErro: -1 };
  const FORA = 'gabarito';

  /* ---------- Contas ---------- */

  // F3: intervalo de confiança de Wilson (95%) para acertos/n
  function wilson(acertos, n, z) {
    z = z || C().z;
    if (!(n > 0)) return { p: null, lo: null, hi: null };
    const p = acertos / n, z2 = z * z;
    const centro = (p + z2 / (2 * n)) / (1 + z2 / n);
    const margem = (z / (1 + z2 / n)) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
    return { p, lo: Math.max(0, centro - margem), hi: Math.min(1, centro + margem) };
  }
  const suficiente = n => n >= C().amostraMin;

  /* F1: blocos que contam (sem fixação). estudadoEm = { idDoSubtopico: data } (opcional): como no modelo,
     o item de um subtópico estudado no dia do bloco (ou ainda não lido) fica fora; o bloco é refeito só com
     os itens que contam. */
  let estudadoEm = null;
  function contaItem(b, i) {
    if (!estudadoEm || !i.subtopico_id || !(i.subtopico_id in estudadoEm)) return true;
    const d = estudadoEm[i.subtopico_id];
    return !!d && d < b.data;
  }
  function blocosValidos(blocos) {
    return (blocos || []).filter(b => b.tipo_bloco !== 'fixacao').map(b => {
      if (!estudadoEm || !(b.itens || []).length) return b;
      const itens = b.itens.filter(i => contaItem(b, i));
      if (itens.length === b.itens.length) return b;
      return { ...b, itens, total: itens.reduce((a, i) => a + (i.total || 0), 0), acertos: itens.reduce((a, i) => a + (i.acertos || 0), 0) };
    }).filter(b => b.total > 0);
  }
  const comEstudo = mapa => { estudadoEm = mapa || null; };
  const errosValidos = erros => (erros || []).filter(e => e.motivo !== FORA);
  function separar(blocos, erros) {
    const bs = blocosValidos(blocos);
    const resp = errosValidos(erros).flatMap(e => (e.revisoes_log || []).map(r => ({ ...r, erro: e })));
    const t = bs.reduce((a, b) => a + b.total, 0), c = bs.reduce((a, b) => a + b.acertos, 0);
    return {
      ineditas: { blocos: bs.length, total: t, acertos: c, taxa: t ? c / t : null },
      refeitos: { respostas: resp.length, acertos: resp.filter(r => r.acertou).length, taxa: resp.length ? resp.filter(r => r.acertou).length / resp.length : null }
    };
  }

  // F2: por PDF, pontos (dias × acerto), histórico de intervalos e previsto × real
  function porPdf(blocos) {
    const r = {};
    blocosValidos(blocos).slice().sort((a, b) => (a.data < b.data ? -1 : 1)).forEach(b => {
      const x = r[b.material_id] = r[b.material_id] || { pontos: [], intervalos: [], calibracao: [], total: 0, acertos: 0 };
      const real = b.acertos / b.total;
      x.pontos.push({ dias: b.dias, acerto: real, data: b.data, n: b.total });
      if (b.intervalo) x.intervalos.push({ data: b.data, intervalo: b.intervalo });
      if (b.previsto != null) x.calibracao.push({ previsto: b.previsto, real, n: b.total, data: b.data });
      x.total += b.total; x.acertos += b.acertos;
    });
    return r;
  }

  // F3: por subtópico, acerto acumulado em inéditas com Wilson; menos de amostraMin = insuficiente
  function porSubtopico(blocos) {
    const r = {};
    blocosValidos(blocos).forEach(b => (b.itens || []).forEach(i => {
      if (!i.subtopico_id || !(i.total > 0)) return;
      const x = r[i.subtopico_id] = r[i.subtopico_id] || { total: 0, acertos: 0 };
      x.total += i.total; x.acertos += i.acertos;
    }));
    Object.values(r).forEach(x => { x.wilson = wilson(x.acertos, x.total); x.suficiente = suficiente(x.total); });
    return r;
  }

  // F4: causas por chave (disciplina ou subtópico), recorrência por causa, dominados × em aberto
  function errosResumo(erros, chave) {
    const es = errosValidos(erros);
    const porChave = {}, porCausa = {};
    es.forEach(e => {
      const k = chave(e) || '—', m = e.motivo || 'sem';
      (porChave[k] = porChave[k] || {})[m] = (porChave[k][m] || 0) + 1;
      const c = porCausa[m] = porCausa[m] || { erros: 0, recorrentes: 0, recorrencias: 0 };
      c.erros++; c.recorrencias += e.recorrencias || 0; if (e.recorrencias > 0) c.recorrentes++;
    });
    Object.values(porCausa).forEach(c => { c.taxa = c.erros ? c.recorrentes / c.erros : 0; });
    return { porChave, porCausa, dominados: es.filter(e => e.dominado_em).length, abertos: es.filter(e => !e.dominado_em).length };
  }

  /* F5: calibração por confiança. Só entram blocos com certeza/chute preenchidos e com todos os erros do
     resultado registrados (erros com bloco_id). Acerto do nível = (questões do nível − erros do nível) / questões. */
  function calibracao(blocos, erros) {
    const es = errosValidos(erros);
    const niveis = { certeza: { q: 0, e: 0 }, duvida: { q: 0, e: 0 }, chute: { q: 0, e: 0 } };
    let entraram = 0, fora = 0;
    blocosValidos(blocos).forEach(b => {
      if (b.certeza == null && b.chute == null) { fora++; return; }
      const doBloco = es.filter(e => e.bloco_id === b.id);
      if (doBloco.length < b.total - b.acertos) { fora++; return; }
      const q = { certeza: b.certeza || 0, chute: b.chute || 0 };
      q.duvida = Math.max(0, b.total - q.certeza - q.chute);
      const e = { certeza: 0, duvida: 0, chute: 0 };
      doBloco.forEach(x => { const k = x.confianca in e ? x.confianca : 'duvida'; e[k]++; });
      Object.keys(niveis).forEach(k => { niveis[k].q += q[k]; niveis[k].e += Math.min(e[k], q[k]); });
      entraram++;
    });
    Object.values(niveis).forEach(n => { n.acerto = n.q ? (n.q - n.e) / n.q : null; });
    // Indicador separado (opção b): correção dos erros refeitos pela confiança original
    const correcao = {};
    es.forEach(x => (x.revisoes_log || []).forEach(r => {
      const k = x.confianca || 'sem';
      const c = correcao[k] = correcao[k] || { respostas: 0, acertos: 0 };
      c.respostas++; if (r.acertou) c.acertos++;
    }));
    Object.values(correcao).forEach(c => { c.taxa = c.respostas ? c.acertos / c.respostas : null; });
    return { niveis, entraram, fora, correcao };
  }

  /* F6: nota líquida prevista = soma de peso × (pontosAcerto × p + pontosErro × (1 − p)), com p = acerto
     previsto do subtópico (Certo/Errado: com +1 e −1, peso × (2p − 1)). itens = [{ peso, previsto }]. */
  function notaLiquida(itens, regra) {
    const r = regra || { acerto: C().pontosAcerto, erro: C().pontosErro };
    return itens.reduce((a, x) => a + (Number(x.peso) > 0 ? Number(x.peso) : 1) * (r.acerto * x.previsto + r.erro * (1 - x.previsto)), 0);
  }

  /* F7: edital. itens = [{ id, nome }]; subs = [{ id, itens_edital, estudado_em }]; stats = porSubtopico */
  function edital(itens, subs, stats) {
    const r = itens.map(it => {
      const ligados = subs.filter(s => (s.itens_edital || []).includes(it.id));
      const t = ligados.reduce((a, s) => a + ((stats[s.id] || {}).total || 0), 0), c = ligados.reduce((a, s) => a + ((stats[s.id] || {}).acertos || 0), 0);
      return { ...it, subtopicos: ligados.length, estudado: ligados.some(s => s.estudado_em), total: t, acertos: c, taxa: t ? c / t : null };
    });
    return { itens: r, cobertura: r.length ? r.filter(x => x.estudado).length / r.length : null, semSubtopico: r.filter(x => !x.subtopicos) };
  }

  /* ---------- Tela ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = x => (x == null ? '—' : `${Math.round(x * 100)}%`);
  const MOTIVOS = { conteudo: 'Não sabia o conteúdo', esqueci: 'Sabia, mas esqueci', leitura: 'Li errado', pegadinha: 'Pegadinha da banca', pressa: 'Pressa ou chute', sem: 'Sem causa' };
  const COR = ['#256abf', '#6da7ec', '#9ec5f4'];

  // Dispersão pequena em SVG (x e y de 0 a xMax/1), com a diagonal opcional
  function dispersao(pontos, { xMax, diagonal, rotX, rotY }) {
    const W = 260, H = 150, m = 28;
    const X = v => m + (v / xMax) * (W - m - 8), Y = v => H - m + 6 - v * (H - m - 6);
    return `<svg class="est-stat-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(rotY)} por ${esc(rotX)}">
      <line x1="${m}" y1="${Y(0)}" x2="${W - 8}" y2="${Y(0)}" class="eixo" /><line x1="${m}" y1="${Y(0)}" x2="${m}" y2="${Y(1)}" class="eixo" />
      <line x1="${m}" y1="${Y(0.8)}" x2="${W - 8}" y2="${Y(0.8)}" class="meta" />
      ${diagonal ? `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" class="meta" />` : ''}
      <text x="${m - 4}" y="${Y(1) + 4}" text-anchor="end">100%</text><text x="${m - 4}" y="${Y(0)}" text-anchor="end">0</text>
      <text x="${W - 8}" y="${H - 4}" text-anchor="end">${esc(rotX)}</text>
      ${pontos.map(p => `<circle cx="${X(Math.min(p.x, xMax))}" cy="${Y(p.y)}" r="5" fill="${COR[0]}" stroke="var(--est-bg, #222640)" stroke-width="2" data-v="${esc(p.v)}" data-l="${esc(p.l)}" />`).join('')}
    </svg>`;
  }

  /* dados = { edital, plano, motorPdfs, materiais, blocos, erros, subtopicos: [{ id, nome, material_id, peso, itens_edital, estudado_em }],
       itensEdital: { idDaDisciplina: [{ id, nome }] }, metas, sessoes, hoje, dataProva, minutosSemana } */
  function render(el, d) {
    const Q = window.estMotorQuestoes;
    const mapa = {};
    d.subtopicos.forEach(s => { mapa[s.id] = s.estudado_em || null; });
    comEstudo(mapa);
    const sep = separar(d.blocos, d.erros);
    const pdfs = porPdf(d.blocos), subs = porSubtopico(d.blocos);
    const nomePdf = id => (d.materiais.find(m => m.id === id) || {}).nome || 'PDF';
    const nomeDisc = id => (d.edital.disciplinas.find(x => x.id === id) || {}).nome || '—';
    const subPor = id => d.subtopicos.find(s => s.id === id);
    const ref = d.dataProva && d.dataProva > d.hoje ? d.dataProva : d.hoje;
    // F6: acerto previsto de cada subtópico estudado na data da prova (ou hoje), pelo modelo do PDF
    const previstoSub = s => {
      const e = d.motorPdfs.find(p => p.id === s.material_id);
      if (!e || !e.meia_vida || !e.ultimo_contato) return null;
      return Q.acertoPrevisto(Q.retencao(Q.diasEntre(e.ultimo_contato, ref), e.meia_vida), 'ce');
    };
    const notaItens = d.subtopicos.filter(s => s.estudado_em && !s.nao_cai).map(s => ({ s, peso: s.peso, previsto: previstoSub(s) })).filter(x => x.previsto != null);
    const nota = notaLiquida(notaItens);
    const notaMax = notaItens.reduce((a, x) => a + (Number(x.peso) > 0 ? Number(x.peso) : 1) * C().pontosAcerto, 0);
    const cal = calibracao(d.blocos, d.erros);
    const er = errosResumo(d.erros, e => nomeDisc(e.disciplina_id));
    const erSub = errosResumo(d.erros, e => (subPor(e.subtopico_id) || {}).nome);
    // F8: carga das últimas 8 semanas
    const semanas = [];
    for (let i = 7; i >= 0; i--) {
      const ini = Q.somar(d.semanaAtual, -7 * i), fim = Q.somar(ini, 6);
      const prev = d.metas.filter(m => m.semana === ini).reduce((a, m) => a + m.minutos, 0);
      const real = d.sessoes.filter(s => s.date >= ini && s.date <= fim).reduce((a, s) => a + (s.timeMinutes || 0), 0);
      semanas.push({ ini, prev, real });
    }
    const filaMetas = d.metas.filter(m => m.tipo_bloco && m.tipo !== 'estudo' && !m.concluida && m.dia < d.hoje);
    const filaErros = errosValidos(d.erros).filter(e => !e.dominado_em && e.proxima && e.proxima < d.hoje);
    const maxCarga = Math.max(1, d.minutosSemana, ...semanas.map(w => Math.max(w.prev, w.real)));
    const fmtH = m => `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, '0')}`;
    // F7 por disciplina
    const editalHtml = d.edital.disciplinas.map(disc => {
      const itens = (d.itensEdital[disc.id] || []);
      if (!itens.length) return '';
      const ed = edital(itens, d.subtopicos, subs);
      return `<details class="est-stat-det"><summary><strong>${esc(disc.nome)}</strong> · cobertura ${pct(ed.cobertura)} · ${ed.semSubtopico.length} item(ns) sem subtópico</summary>
        <table class="est-stat-tab"><thead><tr><th>Item do edital</th><th>Subtópicos</th><th>Estudado</th><th>Acerto (inéditas)</th></tr></thead><tbody>
        ${ed.itens.map(x => `<tr class="${x.subtopicos ? '' : 'falta'}"><td>${esc(x.nome)}</td><td>${x.subtopicos || '—'}</td><td>${x.estudado ? '✓' : ''}</td><td>${x.total ? `${pct(x.taxa)} <small>de ${x.total}</small>` : '—'}</td></tr>`).join('')}
        </tbody></table></details>`;
    }).join('');

    el.innerHTML = `
      <div class="est-plano-card est-stat">
        <h3 class="est-stat-titulo">📐 Motor de estudos — estatísticas</h3>
        <p class="est-plano-sub">Questões inéditas medem retenção; erros refeitos medem correção. As duas taxas não se somam. Blocos de fixação e “Gabarito discutível” ficam fora.</p>
        <div class="est-plano-kpis">
          <div class="est-plano-kpi"><span>Inéditas (retenção)</span><strong>${pct(sep.ineditas.taxa)}</strong><small class="est-motor-kpi-sub">${sep.ineditas.acertos} de ${sep.ineditas.total} em ${sep.ineditas.blocos} bloco(s)</small></div>
          <div class="est-plano-kpi"><span>Erros refeitos (correção)</span><strong>${pct(sep.refeitos.taxa)}</strong><small class="est-motor-kpi-sub">${sep.refeitos.acertos} de ${sep.refeitos.respostas} resposta(s)</small></div>
          <div class="est-plano-kpi"><span>Nota líquida prevista</span><strong>${notaItens.length ? nota.toFixed(1) : '—'}</strong><small class="est-motor-kpi-sub">${notaItens.length ? `de ${notaMax.toFixed(1)} possíveis · ${notaItens.length} subtópico(s) · ${d.dataProva ? 'na data da prova' : 'hoje'} · regra ${C().pontosAcerto > 0 ? '+' : ''}${C().pontosAcerto}/${C().pontosErro}` : 'sem subtópicos estudados com blocos'}</small></div>
        </div>

        <h4>Por PDF</h4>
        ${Object.keys(pdfs).length ? `<div class="est-stat-pdfs">${Object.entries(pdfs).map(([id, x]) => {
          const e = d.motorPdfs.find(p => p.id === id) || {};
          const xMax = Math.max(7, ...x.pontos.map(p => p.dias));
          return `<details class="est-stat-det"><summary><strong>${esc(nomePdf(id))}</strong> · meia-vida ${e.meia_vida ? `${e.meia_vida.toFixed(1)} d` : '—'} · próxima ${e.proxima_data || '—'}${e.graduado ? ' · manutenção' : ''} · ${pct(x.acertos / x.total)} de ${x.total}</summary>
            <div class="est-stat-graficos">
              <figure><figcaption>Acerto × dias desde o último contato</figcaption>${dispersao(x.pontos.map(p => ({ x: p.dias, y: p.acerto, v: `${pct(p.acerto)} com ${p.dias} dia(s)`, l: `${p.data} · ${p.n} questões` })), { xMax, rotX: 'dias', rotY: 'acerto' })}</figure>
              <figure><figcaption>Previsto × real (diagonal = acerto perfeito do modelo)</figcaption>${dispersao(x.calibracao.map(p => ({ x: p.previsto, y: p.real, v: `real ${pct(p.real)} · previsto ${pct(p.previsto)}`, l: `${p.data} · ${p.n} questões` })), { xMax: 1, diagonal: true, rotX: 'previsto', rotY: 'real' })}</figure>
            </div>
            <p class="est-plano-sub">Intervalos: ${x.intervalos.length ? x.intervalos.map(i => `${i.intervalo} d`).join(' → ') : '—'}</p></details>`;
        }).join('')}</div>` : '<p class="est-plano-vazio">Nenhum bloco de questões registrado ainda.</p>'}

        <h4>Por subtópico (inéditas, IC de Wilson 95%)</h4>
        ${Object.keys(subs).length ? `<table class="est-stat-tab"><thead><tr><th>Subtópico</th><th>PDF</th><th>Acerto</th><th>Intervalo de confiança</th></tr></thead><tbody>
          ${Object.entries(subs).sort((a, b) => a[1].wilson.p - b[1].wilson.p).map(([id, x]) => { const s = subPor(id) || {}; return `<tr>
            <td>${esc(s.nome || '—')}</td><td>${esc(s.material_id ? nomePdf(s.material_id) : '')}</td>
            <td>${pct(x.wilson.p)} <small>de ${x.total}</small></td>
            <td>${x.suficiente ? `<span class="est-stat-ic"><i style="left:${x.wilson.lo * 100}%;width:${(x.wilson.hi - x.wilson.lo) * 100}%"></i><b style="left:${x.wilson.p * 100}%"></b></span> ${pct(x.wilson.lo)}–${pct(x.wilson.hi)}`
              : `<span class="est-stat-insuf">amostra insuficiente (${x.total} de ${C().amostraMin})</span>`}</td></tr>`; }).join('')}
        </tbody></table>` : '<p class="est-plano-vazio">Sem questões inéditas por subtópico ainda.</p>'}

        <h4>Erros</h4>
        <p class="est-plano-sub">${er.abertos} em aberto · ${er.dominados} dominado(s)</p>
        <table class="est-stat-tab"><thead><tr><th>Causa</th><th>Erros</th><th>Recorrência</th></tr></thead><tbody>
          ${Object.entries(er.porCausa).map(([m, c]) => `<tr><td>${esc(MOTIVOS[m] || m)}</td><td>${c.erros}</td><td>${pct(c.taxa)} <small>(${c.recorrentes} voltaram a ser errados)</small></td></tr>`).join('') || '<tr><td colspan="3">—</td></tr>'}
        </tbody></table>
        <details class="est-stat-det"><summary>Causas por disciplina e por subtópico</summary>
          ${[['Disciplina', er.porChave], ['Subtópico', erSub.porChave]].map(([rot, pc]) => `<table class="est-stat-tab"><thead><tr><th>${rot}</th>${Object.keys(MOTIVOS).filter(m => m !== 'sem').map(m => `<th>${esc(MOTIVOS[m])}</th>`).join('')}</tr></thead><tbody>
            ${Object.entries(pc).map(([k, v]) => `<tr><td>${esc(k)}</td>${Object.keys(MOTIVOS).filter(m => m !== 'sem').map(m => `<td>${v[m] || ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`).join('')}
        </details>

        <h4>Calibração por confiança</h4>
        <p class="est-plano-sub">${cal.entraram} bloco(s) entraram na conta${cal.fora ? `; ${cal.fora} ficaram fora (sem certeza/chute ou com erros não registrados)` : ''}.</p>
        <table class="est-stat-tab"><thead><tr><th>Confiança</th><th>Questões</th><th>Acerto</th><th>Correção dos erros refeitos</th></tr></thead><tbody>
          ${[['certeza', 'Certeza'], ['duvida', 'Dúvida'], ['chute', 'Chute']].map(([k, r]) => `<tr><td>${r}</td><td>${cal.niveis[k].q}</td><td>${pct(cal.niveis[k].acerto)}</td>
            <td>${cal.correcao[k] ? `${pct(cal.correcao[k].taxa)} <small>de ${cal.correcao[k].respostas}</small>` : '—'}</td></tr>`).join('')}
        </tbody></table>

        <h4>Edital</h4>
        ${editalHtml || '<p class="est-plano-vazio">Sem itens do edital de origem para comparar.</p>'}

        <h4>Carga</h4>
        <p class="est-plano-sub">Fila vencida: ${filaMetas.length} meta(s) de questões/revisão atrasada(s) · ${filaErros.length} erro(s) com revisão vencida.</p>
        <div class="est-stat-carga">${semanas.map(w => `<div class="est-motor-barra"><span class="est-motor-barra-rot">${w.ini.slice(8)}/${w.ini.slice(5, 7)}</span>
          <div class="est-stat-carga-barras"><i style="width:${w.prev / maxCarga * 100}%;background:${COR[2]}" data-v="${fmtH(w.prev)} previstas" data-l="semana de ${w.ini}"></i>
          <i style="width:${w.real / maxCarga * 100}%;background:${COR[0]}" data-v="${fmtH(w.real)} realizadas" data-l="semana de ${w.ini}"></i></div>
          <span class="est-motor-barra-val">${fmtH(w.real)}</span></div>`).join('')}
          <span class="est-motor-legenda"><i style="background:${COR[2]}"></i>previsto <i style="background:${COR[0]}"></i>realizado</span></div>
      </div>`;
  }

  window.estStats = { comEstudo, wilson, suficiente, separar, porPdf, porSubtopico, errosResumo, calibracao, notaLiquida, edital, render };
})();
