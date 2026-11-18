/* =============================================
   CADERNOS DO TEC (estudos.cadernos.js, window.estCadernos)
   Estudo por questões (ex.: metas do Sensei da Aprovação, ~5 cadernos por meta): um registro por
   caderno terminado, com o item do edital (e o assunto, se quiser), feitas, certas, tempo e data.
   Cada registro vira também uma sessão no histórico (estPlano.registrarSessao), então os números
   entram nos totais do item, no Edital e no Desempenho. Esta seção mostra só os cadernos:
   volume por semana e por dia, acerto por assunto (com a tendência das últimas 2 semanas) e
   1ª vez × última nos cadernos refeitos (mesmo número de caderno no link do TEC).
   O Sensei entrega os cadernos em metas ("Meta 6": ~5 linhas "DISCIPLINA - Assunto"): "Registrar meta"
   recebe o texto colado da meta, monta uma linha por caderno com o item do edital sugerido pelo nome
   (estIncidencia.montarComparador; correções lembradas em est_cad_mapa) e grava só as linhas preenchidas.
   A disciplina do Sensei (antes do " - ") dá as estatísticas por disciplina. O nº da meta não é pedido
   (o usuário não quis: pouco importa na análise); a linha "Meta N" do texto colado é ignorada.
   Tabela public.cadernos (supabase/cadernos.sql); sem ela, fica em localStorage['est_cadernos']
   e sobe quando a tabela existir.
============================================= */
(function () {
  const LOCAL = 'est_cadernos';
  const ULTIMO = 'est_cad_ultimo';     // disciplina/item/assunto do último registro (o próximo vem igual)
  const MAPA = 'est_cad_mapa';         // nome do caderno (normalizado) → { discId, topicoId, subtopicoId } escolhidos
  const SEMANAS = 12, DIAS = 14;
  const RECENTE_DIAS = 14;             // "agora" na tendência do acerto por assunto
  const POUCAS = 10;                   // abaixo disso, o acerto do assunto ainda diz pouco

  let regs = [];
  let remoto = null;                   // null: não carregado; true: tabela; false: só neste navegador
  let carregando = null;

  const sb = () => window.supabaseClient;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const aviso = m => (window.estPlano ? window.estPlano.aviso(m) : alert(m));
  const ler = (k, p) => { try { return JSON.parse(localStorage.getItem(k)) || p; } catch (e) { return p; } };
  const gravarLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* cheio */ } };
  const novoId = () => 'cad_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const dl = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hoje = () => dl(new Date());
  const mais = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return dl(d); };
  const segunda = s => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dl(d); };
  const pct = (c, q) => (q ? Math.round(c / q * 100) : null);
  const ddmm = s => s.slice(8, 10) + '/' + s.slice(5, 7);
  const fmtMin = m => (window.estPlano ? window.estPlano.fmtMin(m) : m + ' min');
  const semTabela = e => e && (e.code === '42P01' || e.code === 'PGRST205' || /cadernos/.test(e.message || ''));

  // Número do caderno no link do TEC (…/questoes/cadernos/12345678); sem ele, o nome identifica as refações
  function tecIdDe(link) {
    const m = /cadernos\/(\d+)/.exec(link || '') || /(\d{5,})/.exec(link || '');
    return m ? m[1] : null;
  }
  const chaveRefeito = r => r.tec_id || String(r.nome || r.link || '').trim().toLowerCase();
  const norm = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  // "DIREITO CONSTITUCIONAL - Nacionalidade" → disciplina e assunto do Sensei
  function partesDoNome(nome) {
    const t = String(nome || '').trim(), i = t.indexOf(' - ');
    return i > 0 ? { disc: t.slice(0, i).trim(), assunto: t.slice(i + 3).trim() } : { disc: '', assunto: t };
  }

  /* ---------- dados ---------- */
  function carregar() {
    if (carregando) return carregando;
    carregando = (async () => {
      const { data, error } = await sb().from('cadernos').select('*');
      if (error) {
        if (!semTabela(error)) console.warn('Cadernos: erro ao carregar; usando a cópia deste navegador.', error);
        remoto = false;
        regs = ler(LOCAL, []);
        return;
      }
      remoto = true;
      regs = data || [];
      const locais = ler(LOCAL, []).filter(l => !regs.some(r => r.id === l.id));
      if (locais.length) {
        const up = await sb().from('cadernos').upsert(locais.map(({ dono, ...l }) => l));
        if (!up.error) { regs.push(...locais); localStorage.removeItem(LOCAL); }
      }
    })();
    return carregando;
  }

  async function salvarReg(r) {
    regs.push(r);
    if (!remoto) { gravarLocal(LOCAL, regs); return true; }
    const { error } = await sb().from('cadernos').insert(r);
    if (error) { console.error('Cadernos: não gravou.', error); aviso('Não foi possível salvar o caderno no servidor: ' + error.message); regs = regs.filter(x => x !== r); return false; }
    return true;
  }

  /* ---------- contas (puras) ---------- */
  function estatisticas(lista, h = hoje()) {
    const soma = l => l.reduce((a, r) => ({ q: a.q + r.feitas, c: a.c + r.certas, m: a.m + (r.minutos || 0) }), { q: 0, c: 0, m: 0 });
    const tot = soma(lista);
    const ult7 = soma(lista.filter(r => r.data > mais(h, -7)));
    const seg0 = segunda(h);
    const semanas = Array.from({ length: SEMANAS }, (_, i) => mais(seg0, -7 * (SEMANAS - 1 - i)))
      .map(s => ({ dia: s, ...soma(lista.filter(r => r.data >= s && r.data < mais(s, 7))) }));
    const dias = Array.from({ length: DIAS }, (_, i) => mais(h, -(DIAS - 1 - i)))
      .map(d => ({ dia: d, ...soma(lista.filter(r => r.data === d)) }));
    // Acerto por assunto (ou pelo item, quando o registro não tem assunto)
    const grupos = new Map();
    lista.forEach(r => {
      const k = r.subtopico_id ? 's:' + r.subtopico_id : 't:' + r.topico_id;
      if (!grupos.has(k)) grupos.set(k, { k, topico_id: r.topico_id, subtopico_id: r.subtopico_id || null, regs: [] });
      grupos.get(k).regs.push(r);
    });
    const corte = mais(h, -RECENTE_DIAS);
    const assuntos = [...grupos.values()].map(g => {
      const t = soma(g.regs), rec = soma(g.regs.filter(r => r.data > corte)), ant = soma(g.regs.filter(r => r.data <= corte));
      return { ...g, q: t.q, c: t.c, m: t.m, acerto: pct(t.c, t.q),
        tendencia: rec.q && ant.q ? pct(rec.c, rec.q) - pct(ant.c, ant.q) : null, poucas: t.q < POUCAS };
    }).sort((a, b) => a.acerto - b.acerto || b.q - a.q);
    // Cadernos refeitos: 1ª vez × última
    const porCad = new Map();
    lista.forEach(r => { const k = chaveRefeito(r); if (!k) return; if (!porCad.has(k)) porCad.set(k, []); porCad.get(k).push(r); });
    const refeitos = [...porCad.values()].filter(l => l.length > 1).map(l => {
      l.sort((a, b) => a.data.localeCompare(b.data) || String(a.criado_em || '').localeCompare(String(b.criado_em || '')));
      const p = l[0], u = l[l.length - 1];
      return { nome: u.nome || p.nome, link: u.link || p.link, vezes: l.length, primeira: pct(p.certas, p.feitas), ultima: pct(u.certas, u.feitas),
        dataPrimeira: p.data, dataUltima: u.data, topico_id: u.topico_id, subtopico_id: u.subtopico_id };
    }).map(x => ({ ...x, delta: x.ultima - x.primeira })).sort((a, b) => a.delta - b.delta);
    // Disciplina do Sensei (antes do " - " no nome); sem ela, a disciplina do edital
    const porDisc = new Map();
    lista.forEach(r => {
      const nome = partesDoNome(r.nome).disc || r.disciplinaEdital || '(sem disciplina)';
      const k = norm(nome);
      if (!porDisc.has(k)) porDisc.set(k, { nome, regs: [] });
      porDisc.get(k).regs.push(r);
    });
    const disciplinas = [...porDisc.values()].map(g => {
      const t = soma(g.regs), rec = soma(g.regs.filter(r => r.data > corte)), ant = soma(g.regs.filter(r => r.data <= corte));
      return { nome: g.nome, cadernos: g.regs.length, q: t.q, c: t.c, m: t.m, acerto: pct(t.c, t.q),
        tendencia: rec.q && ant.q ? pct(rec.c, rec.q) - pct(ant.c, ant.q) : null, poucas: t.q < POUCAS };
    }).sort((a, b) => a.acerto - b.acerto || b.q - a.q);
    return { cadernos: lista.length, total: tot, acerto: pct(tot.c, tot.q), ult7, semanas, dias, assuntos, refeitos, disciplinas };
  }

  /* ---------- tela ---------- */
  const editalAtivo = () => editaisData.find(e => e.id === currentEditalId) || null;
  function nomes(tId, sId) {
    for (const e of editaisData) for (const d of e.disciplinas) {
      const t = d.topicos.find(x => x.id === tId);
      if (t) {
        const s = sId && window.estSub ? window.estSub.porId(sId) : null;
        return { disc: d.nome, item: t.nome, assunto: s ? s.nome : '' };
      }
    }
    return { disc: '', item: '(item apagado)', assunto: '' };
  }

  // acerto: a altura é o % de acerto (semanas sem questões ficam vazias); senão, o nº de questões
  function barras(serie, rotulo, destaque, acerto) {
    const max = acerto ? 100 : Math.max(1, ...serie.map(x => x.q));
    return `<div class="est-cad-barras ${acerto ? 'acerto' : ''}" role="img" aria-label="${esc(rotulo)}">${serie.map(x => {
      const a = pct(x.c, x.q), v = acerto ? a || 0 : x.q;
      return `<div class="est-cad-col ${destaque(x) ? 'atual' : ''} ${acerto && a !== null && a < 70 ? 'fraco' : ''}" title="${esc(`${ddmm(x.dia)}: ${x.q} questões${x.q ? `, ${a}% de acerto, ${fmtMin(x.m)}` : ''}`)}">
        <span class="est-cad-num">${acerto ? (a === null ? '' : a + '%') : x.q || ''}</span>
        <span class="est-cad-barra" style="height:${Math.round(v / max * 100)}%"></span>
        <span class="est-cad-rot">${ddmm(x.dia)}</span></div>`;
    }).join('')}</div>`;
  }

  const barraAcerto = a => `<span class="est-cad-acerto"><span style="width:${a}%" class="${a < 70 ? 'fraco' : ''}"></span></span>${a}%`;
  const tendencia = t => (t === null ? '<span class="est-cad-mudo">—</span>' : t > 0 ? `<span class="est-cad-sobe">▲ ${t}</span>` : t < 0 ? `<span class="est-cad-desce">▼ ${-t}</span>` : '=');
  // linhas: [{ rotulo (html), q, acerto, tendencia, poucas }]
  const tabelaGrupos = linhas => `<div class="est-cad-tabela-rolagem"><table class="est-cad-tabela">
    <thead><tr><th>Nome</th><th>Questões</th><th>Acerto</th><th>Tendência</th></tr></thead>
    <tbody>${linhas.map(l => `<tr class="${l.poucas ? 'poucas' : ''}"><td>${l.rotulo}</td><td>${l.q}</td><td>${barraAcerto(l.acerto)}</td><td>${tendencia(l.tendencia)}</td></tr>`).join('')}</tbody>
  </table></div>`;

  // Os 3 assuntos de pior e de melhor acerto, só com amostra suficiente (POUCAS questões ou mais)
  function fortesFracos(assuntos) {
    const ok = assuntos.filter(a => !a.poucas);
    if (ok.length < 2) return '';
    const n = Math.min(3, Math.floor(ok.length / 2));
    const item = a => { const x = nomes(a.topico_id, a.subtopico_id); return `<li><span>${esc(x.assunto || x.item)}<small>${esc(x.disc)}</small></span><strong>${a.acerto}%</strong><small>${a.q} q.</small></li>`; };
    return `<div class="est-cad-ff">
      <div class="est-plano-card est-cad-fraco"><h3 class="est-plano-card-title">⚠ Pontos fracos</h3><ul>${ok.slice(0, n).map(item).join('')}</ul></div>
      <div class="est-plano-card est-cad-forte"><h3 class="est-plano-card-title">✓ Pontos fortes</h3><ul>${ok.slice(-n).reverse().map(item).join('')}</ul></div>
    </div>`;
  }

  async function render() {
    const el = $('est-cadernos');
    if (!el) return;
    if (remoto === null) { el.innerHTML = '<p class="est-plano-vazio">Carregando…</p>'; await carregar(); }
    const e = editalAtivo();
    const lista = regs.filter(r => !e || r.edital_id === e.id).map(r => ({ ...r, disciplinaEdital: nomes(r.topico_id).disc })).sort((a, b) => b.data.localeCompare(a.data) || String(b.criado_em || '').localeCompare(String(a.criado_em || '')));
    const st = estatisticas(lista);
    const h = hoje(), seg0 = segunda(h);
    el.innerHTML = `
      <div class="est-plano-topo">
        <div>
          <h2 class="est-plano-titulo">📒 Cadernos do TEC</h2>
          <span class="est-plano-sub">Registre cada caderno ao terminar: entra no item do edital, no histórico e no Desempenho.</span>
        </div>
        <div class="est-plano-topo-acoes"><button type="button" class="est-plano-btn" data-a="novo">+ Um caderno</button><button type="button" class="est-plano-btn primario" data-a="meta">📋 Registrar meta</button></div>
      </div>
      ${remoto === false ? '<div class="est-plano-card est-cad-aviso">Os cadernos estão ficando só neste navegador. Rode <code>supabase/cadernos.sql</code> no Supabase para guardar no servidor (o que já está aqui sobe sozinho).</div>' : ''}
      ${!lista.length ? '<div class="est-plano-card"><p class="est-plano-vazio">Nenhum caderno registrado neste edital ainda. Ao terminar os cadernos de uma meta do Sensei, clique em “📋 Registrar meta” e cole a lista da meta.</p></div>' : `
      <div class="est-plano-kpis">
        <div class="est-plano-kpi"><span>Questões</span><strong>${st.total.q}</strong><small>${st.cadernos} caderno${st.cadernos === 1 ? '' : 's'}</small></div>
        <div class="est-plano-kpi"><span>Acerto</span><strong>${st.acerto}%</strong><small>${st.total.c} certas</small></div>
        <div class="est-plano-kpi"><span>Tempo</span><strong>${fmtMin(st.total.m)}</strong><small>${st.total.q ? (st.total.m / st.total.q).toFixed(1).replace('.', ',') + ' min por questão' : ''}</small></div>
        <div class="est-plano-kpi"><span>Últimos 7 dias</span><strong>${st.ult7.q}</strong><small>${st.ult7.q ? pct(st.ult7.c, st.ult7.q) + '% de acerto' : 'sem questões'}</small></div>
      </div>
      ${fortesFracos(st.assuntos)}
      <div class="est-plano-card">
        <h3 class="est-plano-card-title">Questões por semana</h3>
        <p class="est-plano-sub">Últimas ${SEMANAS} semanas (a data é a segunda-feira). Passe o mouse para ver o acerto e o tempo.</p>
        ${barras(st.semanas, 'Questões por semana', x => x.dia === seg0)}
      </div>
      <div class="est-plano-card">
        <h3 class="est-plano-card-title">Acerto por semana</h3>
        <p class="est-plano-sub">% de acerto de cada semana (a linha marca 70%). Semana sem questões fica vazia.</p>
        ${barras(st.semanas, 'Acerto por semana', x => x.dia === seg0, true)}
      </div>
      <div class="est-plano-card">
        <h3 class="est-plano-card-title">Questões por dia</h3>
        <p class="est-plano-sub">Últimos ${DIAS} dias.</p>
        ${barras(st.dias, 'Questões por dia', x => x.dia === h)}
      </div>
      <div class="est-plano-card">
        <h3 class="est-plano-card-title">Acerto por disciplina</h3>
        <p class="est-plano-sub">Pela disciplina escrita no nome do caderno (como o Sensei manda), do pior para o melhor. Tendência: últimos ${RECENTE_DIAS} dias × antes.</p>
        ${tabelaGrupos(st.disciplinas.map(d => ({ ...d, rotulo: `<strong>${esc(d.nome)}</strong><span class="est-cad-item">${d.cadernos} caderno${d.cadernos === 1 ? '' : 's'}</span>` })))}
      </div>
      <div class="est-plano-card">
        <h3 class="est-plano-card-title">Acerto por assunto</h3>
        <p class="est-plano-sub">Do pior para o melhor. A tendência compara os últimos ${RECENTE_DIAS} dias com antes (em pontos). Com menos de ${POUCAS} questões, o acerto ainda diz pouco.</p>
        ${tabelaGrupos(st.assuntos.map(a => { const n = nomes(a.topico_id, a.subtopico_id); return { ...a,
          rotulo: `<span class="est-cad-item">${esc(n.disc)} › ${esc(n.item)}</span>${n.assunto ? `<strong>${esc(n.assunto)}</strong>` : '<strong>(item inteiro)</strong>'}` }; }))}
      </div>
      <div class="est-plano-card">
        <h3 class="est-plano-card-title">Cadernos refeitos</h3>
        <p class="est-plano-sub">Mesmo caderno resolvido mais de uma vez (pelo número no link do TEC ou pelo nome): acerto da 1ª vez × da última.</p>
        ${st.refeitos.length ? `<div class="est-cad-tabela-rolagem"><table class="est-cad-tabela">
          <thead><tr><th>Caderno</th><th>Vezes</th><th>1ª vez</th><th>Última</th><th>Diferença</th></tr></thead>
          <tbody>${st.refeitos.map(x => `<tr><td>${x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.nome || 'Caderno')}</a>` : esc(x.nome || 'Caderno')}<span class="est-cad-item">${esc(nomes(x.topico_id, x.subtopico_id).item)}</span></td>
            <td>${x.vezes}</td><td>${x.primeira}% <small>${ddmm(x.dataPrimeira)}</small></td><td>${x.ultima}% <small>${ddmm(x.dataUltima)}</small></td>
            <td>${x.delta > 0 ? `<span class="est-cad-sobe">▲ ${x.delta}</span>` : x.delta < 0 ? `<span class="est-cad-desce">▼ ${-x.delta}</span>` : '='}</td></tr>`).join('')}</tbody>
        </table></div>` : '<p class="est-plano-vazio">Nenhum caderno refeito ainda. Quando registrar de novo um caderno com o mesmo link, a comparação aparece aqui.</p>'}
      </div>
      <div class="est-plano-card">
        <h3 class="est-plano-card-title">Registros</h3>
        <ul class="est-cad-lista">${lista.map(r => { const n = nomes(r.topico_id, r.subtopico_id); return `<li>
          <span class="est-cad-data">${ddmm(r.data)}</span>
          <span class="est-cad-desc">${r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.nome || 'Caderno')}</a>` : esc(r.nome || 'Caderno')}
            <small>${esc(n.item)}${n.assunto ? ' › ' + esc(n.assunto) : ''}</small></span>
          <span class="est-cad-nums">${r.certas}/${r.feitas} · <strong>${pct(r.certas, r.feitas)}%</strong>${r.minutos ? ' · ' + fmtMin(r.minutos) : ''}</span>
          ${r.certas < r.feitas ? `<button type="button" class="est-cad-x" data-a="erros" data-id="${esc(r.id)}" title="Registrar as questões erradas deste caderno no Caderno de Erros (já no item e no assunto dele)">❌ ${r.feitas - r.certas}</button>` : ''}
          <button type="button" class="est-cad-x" data-a="refazer" data-id="${esc(r.id)}" title="Registrar de novo este caderno (refeito)">↻</button>
          <button type="button" class="est-cad-x" data-a="apagar" data-id="${esc(r.id)}" title="Apagar este registro (e a sessão dele)" aria-label="Apagar registro">✕</button></li>`; }).join('')}</ul>
      </div>`}`;
  }

  /* ---------- registrar ---------- */
  function opcoes(lista, sel, vazio) {
    return (vazio ? `<option value="">${esc(vazio)}</option>` : '') + lista.map(x => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.nome)}</option>`).join('');
  }

  function abrirForm(base = {}) {
    const e = editalAtivo();
    if (!e || !e.disciplinas.length) { aviso('Escolha um edital com disciplinas antes de registrar cadernos.'); return; }
    const ult = ler(ULTIMO, {});
    let dId = base.disciplina_id || ult.discId;
    if (!e.disciplinas.some(d => d.id === dId)) dId = e.disciplinas[0].id;
    const ov = document.createElement('div');
    ov.className = 'est-modal-overlay active';
    ov.style.zIndex = '1040';
    ov.innerHTML = `<div class="est-modal est-cad-form" role="dialog" aria-modal="true" aria-label="Registrar caderno">
      <div class="est-modal-header"><h2 class="est-modal-title">${base.id ? 'Caderno refeito' : 'Registrar caderno'}</h2>
        <button type="button" class="est-modal-close" data-a="fechar" aria-label="Fechar">✕</button></div>
      <div class="est-cad-campos">
        <label class="est-form-group">Link do caderno no TEC <input type="url" class="est-form-input" data-k="link" value="${esc(base.link || '')}" placeholder="https://www.tecconcursos.com.br/questoes/cadernos/…" /></label>
        <label class="est-form-group">Nome <input type="text" class="est-form-input" data-k="nome" maxlength="160" value="${esc(base.nome || '')}" placeholder="Ex.: DIREITO CONSTITUCIONAL - Nacionalidade" /></label>
        <label class="est-form-group">Disciplina <select class="est-form-select" data-k="disc">${opcoes(e.disciplinas, dId)}</select></label>
        <label class="est-form-group">Item do edital <select class="est-form-select" data-k="item"></select></label>
        <label class="est-form-group">Assunto <select class="est-form-select" data-k="sub"></select></label>
        <div class="est-cad-linha">
          <label class="est-form-group">Feitas <input type="number" class="est-form-input" data-k="feitas" min="1" inputmode="numeric" /></label>
          <label class="est-form-group">Certas <input type="number" class="est-form-input" data-k="certas" min="0" inputmode="numeric" /></label>
          <label class="est-form-group">Minutos <input type="number" class="est-form-input" data-k="min" min="0" inputmode="numeric" /></label>
          <label class="est-form-group">Data <input type="date" class="est-form-input" data-k="data" value="${hoje()}" max="${hoje()}" /></label>
        </div>
        <p class="est-cad-msg" role="alert"></p>
        <div class="est-motor-acoes">
          <button type="button" class="est-btn-cancelar" data-a="fechar">Cancelar</button>
          <button type="button" class="est-btn-register" data-a="salvar">Salvar</button>
        </div>
      </div></div>`;
    const fechar = () => ov.remove();
    ov.addEventListener('click', ev => { if (ev.target === ov || (ev.target.dataset && ev.target.dataset.a === 'fechar')) fechar(); });
    document.body.appendChild(ov);
    const c = k => ov.querySelector(`[data-k="${k}"]`);
    const preencherItens = tSel => {
      const d = e.disciplinas.find(x => x.id === c('disc').value);
      c('item').innerHTML = opcoes(d ? d.topicos : [], tSel, 'Escolha o item…');
      preencherSubs(base.subtopico_id || (tSel === ult.topicoId ? ult.subtopicoId : ''));
    };
    const preencherSubs = sSel => {
      const subs = c('item').value && window.estSub ? window.estSub.doNivel1(c('item').value) : [];   // subassuntos: só do resumo
      c('sub').innerHTML = opcoes(subs, sSel, subs.length ? '(item inteiro)' : 'Sem assuntos neste item');
      c('sub').disabled = !subs.length;
    };
    c('disc').addEventListener('change', () => preencherItens(''));
    c('item').addEventListener('change', () => preencherSubs(''));
    preencherItens(base.topico_id || ult.topicoId);
    c(base.id ? 'feitas' : 'link').focus();
    ov.querySelector('[data-a="salvar"]').addEventListener('click', async ev => {
      const msg = t => { ov.querySelector('.est-cad-msg').textContent = t; };
      const feitas = parseInt(c('feitas').value, 10), certas = parseInt(c('certas').value, 10), minutos = parseInt(c('min').value, 10) || 0;
      const link = c('link').value.trim(), tId = c('item').value, data = c('data').value || hoje();
      if (link && !/^https?:\/\//i.test(link)) return msg('O link precisa começar com http:// ou https://.');
      if (!tId) return msg('Escolha o item do edital.');
      if (!(feitas > 0)) return msg('Informe quantas questões você fez.');
      if (!(certas >= 0) || certas > feitas) return msg('As certas precisam estar entre 0 e as feitas.');
      ev.target.disabled = true;
      const sub = c('sub').disabled ? '' : c('sub').value;
      const r = {
        id: novoId(), edital_id: e.id, disciplina_id: c('disc').value, topico_id: tId, subtopico_id: sub || null,
        tec_id: tecIdDe(link), link: link || null, nome: c('nome').value.trim() || (tecIdDe(link) ? 'Caderno ' + tecIdDe(link) : 'Caderno'),
        data, feitas, certas, minutos, criado_em: new Date().toISOString()
      };
      if (!(await registrar(r))) { ev.target.disabled = false; return; }
      if (r.nome) { const mapa = ler(MAPA, {}); mapa[norm(r.nome)] = { discId: r.disciplina_id, topicoId: tId, subtopicoId: sub || '' }; gravarLocal(MAPA, mapa); }
      gravarLocal(ULTIMO, { discId: r.disciplina_id, topicoId: tId, subtopicoId: sub });
      fechar();
      if (typeof renderDashboard === 'function') renderDashboard();
      render();
      aviso(`Caderno registrado: ${certas}/${feitas} (${pct(certas, feitas)}%).`);
      if (certas < feitas && window.estErros && await window.customConfirm(`Você errou ${feitas - certas} questão(ões). Registrar no Caderno de Erros agora?`)) registrarErros(r);
    });
  }

  // Grava um caderno: sessão no histórico + registro. Devolve o registro ou null.
  async function registrar(r) {
    const s = await window.estPlano.registrarSessao({ topico_id: r.topico_id }, {
      minutos: r.minutos, questoes: r.feitas, acertos: r.certas, tipo: 'questoes', data: r.data,
      assuntos: r.subtopico_id ? [{ subtopico_id: r.subtopico_id, minutos: r.minutos, questoes: r.feitas, acertos: r.certas }] : []
    });
    r.sessao_id = s ? s.id : null;
    return (await salvarReg(r)) ? r : null;
  }

  /* Texto copiado da meta do Sensei: "Meta 6", "0%" e uma linha por caderno ("DISCIPLINA - Assunto").
     Devolve { meta, nomes }. */
  function lerMeta(texto) {
    let meta = null;
    const nomes = [];
    String(texto || '').split(/\r?\n/).map(l => l.replace(/^[\s•○●◯✓✔☐☑]+/, '').trim()).forEach(l => {
      if (!l) return;
      const m = /^meta\s*(\d+)\b/i.exec(l);
      if (m) { meta = parseInt(m[1], 10); return; }
      if (/^\d+\s*%$/.test(l)) return;
      nomes.push(l);
    });
    return { meta, nomes };
  }

  // Sugestão de disciplina, item e assunto do edital para "DISCIPLINA - Assunto" (o que já foi escolhido antes vale primeiro)
  function sugerir(e, nome) {
    const salvo = ler(MAPA, {})[norm(nome)];
    if (salvo && e.disciplinas.some(d => d.id === salvo.discId && d.topicos.some(t => t.id === salvo.topicoId))) return salvo;
    const { disc, assunto } = partesDoNome(nome);
    const C = window.estIncidencia && window.estIncidencia.montarComparador;
    let d = e.disciplinas.find(x => norm(x.nome) === norm(disc));
    if (!d && C && disc) { const id = C(e.disciplinas)(disc); d = e.disciplinas.find(x => x.id === id); }
    if (!d) return { discId: '', topicoId: '', subtopicoId: '' };
    // Itens e assuntos da disciplina numa lista só: o assunto (subtópico) achado leva o item junto
    const subs = window.estSub ? d.topicos.flatMap(t => window.estSub.doNivel1(t.id).map(s => ({ id: 's:' + s.id, nome: s.nome, t: t.id, s: s.id }))) : [];
    const alvos = [...d.topicos.map(t => ({ id: 't:' + t.id, nome: t.nome, t: t.id, s: '' })), ...subs];
    const id = C ? C(alvos)(assunto || nome) : '';
    const a = alvos.find(x => x.id === id);
    return { discId: d.id, topicoId: a ? a.t : '', subtopicoId: a ? a.s : '' };
  }

  function abrirMeta() {
    const e = editalAtivo();
    if (!e || !e.disciplinas.length) { aviso('Escolha um edital com disciplinas antes de registrar cadernos.'); return; }
    const ov = document.createElement('div');
    ov.className = 'est-modal-overlay active';
    ov.style.zIndex = '1040';
    ov.innerHTML = `<div class="est-modal est-cad-form est-cad-meta" role="dialog" aria-modal="true" aria-label="Registrar meta">
      <div class="est-modal-header"><h2 class="est-modal-title">Registrar meta do Sensei</h2>
        <button type="button" class="est-modal-close" data-a="fechar" aria-label="Fechar">✕</button></div>
      <div class="est-cad-campos">
        <label class="est-form-group">Cole a meta (no Sensei, selecione o quadro da meta, copie e cole aqui)
          <textarea class="est-form-input" data-k="texto" rows="5" placeholder="Meta 6&#10;DIREITO CONSTITUCIONAL - Nacionalidade&#10;HISTÓRIA DO MARANHÃO - A invasão holandesa&#10;…"></textarea></label>
        <label class="est-form-group">Data <input type="date" class="est-form-input" data-k="data" value="${hoje()}" max="${hoje()}" /></label>
        <div class="est-cad-linhas" data-k="linhas"></div>
        <p class="est-plano-sub">Preencha feitas e certas só dos cadernos que você terminou; os outros ficam para depois (cole a meta de novo quando terminar: os registrados nos últimos 7 dias avisam “já registrado”). Disciplina e item vêm sugeridos pelo nome: confira.</p>
        <p class="est-cad-msg" role="alert"></p>
        <div class="est-motor-acoes">
          <button type="button" class="est-btn-cancelar" data-a="fechar">Cancelar</button>
          <button type="button" class="est-btn-register" data-a="salvar">Salvar cadernos</button>
        </div>
      </div></div>`;
    const fechar = () => ov.remove();
    ov.addEventListener('click', ev => { if (ev.target === ov || (ev.target.dataset && ev.target.dataset.a === 'fechar')) fechar(); });
    document.body.appendChild(ov);
    const c = k => ov.querySelector(`[data-k="${k}"]`);
    const caixa = c('linhas');
    const itensDe = (dId, tSel) => { const d = e.disciplinas.find(x => x.id === dId); return opcoes(d ? d.topicos : [], tSel, 'Item do edital…'); };
    const subsDe = (tId, sSel) => { const l = tId && window.estSub ? window.estSub.doNivel1(tId) : []; return opcoes(l, sSel, l.length ? '(item inteiro)' : 'sem assuntos'); };
    let nomes = [];
    function montar() {
      nomes = lerMeta(c('texto').value).nomes;
      const semana = mais(hoje(), -7);
      caixa.innerHTML = nomes.map((nome, i) => {
        // Só um aviso: o mesmo nome pode voltar numa meta nova (então os campos continuam abertos)
        const feito = regs.filter(r => r.edital_id === e.id && r.data > semana && norm(r.nome) === norm(nome)).sort((a, b) => b.data.localeCompare(a.data))[0];
        const g = sugerir(e, nome);
        return `<div class="est-cad-lin ${feito ? 'feito' : ''}" data-i="${i}">
          <div class="est-cad-lin-nome">${feito ? '✓ ' : ''}${esc(nome)}${feito ? ` <small>já registrado em ${ddmm(feito.data)}: ${feito.certas}/${feito.feitas}</small>` : ''}</div>
          <div class="est-cad-lin-campos">
            <select class="est-form-select" data-c="disc" aria-label="Disciplina de ${esc(nome)}">${opcoes(e.disciplinas, g.discId, 'Disciplina…')}</select>
            <select class="est-form-select" data-c="item" aria-label="Item do edital de ${esc(nome)}">${itensDe(g.discId, g.topicoId)}</select>
            <select class="est-form-select" data-c="sub" aria-label="Assunto de ${esc(nome)}">${subsDe(g.topicoId, g.subtopicoId)}</select>
            <input type="url" class="est-form-input" data-c="link" placeholder="Link do caderno (opcional)" aria-label="Link do caderno ${esc(nome)}" />
            <input type="number" class="est-form-input" data-c="feitas" min="1" placeholder="Feitas" aria-label="Feitas em ${esc(nome)}" inputmode="numeric" />
            <input type="number" class="est-form-input" data-c="certas" min="0" placeholder="Certas" aria-label="Certas em ${esc(nome)}" inputmode="numeric" />
            <input type="number" class="est-form-input" data-c="min" min="0" placeholder="Min" aria-label="Minutos em ${esc(nome)}" inputmode="numeric" />
          </div></div>`;
      }).join('');
    }
    c('texto').addEventListener('input', montar);
    caixa.addEventListener('change', ev => {
      const lin = ev.target.closest('.est-cad-lin'), k = ev.target.dataset.c;
      if (!lin) return;
      if (k === 'disc') { lin.querySelector('[data-c="item"]').innerHTML = itensDe(ev.target.value, ''); lin.querySelector('[data-c="sub"]').innerHTML = subsDe('', ''); }
      if (k === 'item') lin.querySelector('[data-c="sub"]').innerHTML = subsDe(ev.target.value, '');
    });
    c('texto').focus();
    ov.querySelector('[data-a="salvar"]').addEventListener('click', async ev => {
      const msg = t => { ov.querySelector('.est-cad-msg').textContent = t; };
      const data = c('data').value || hoje();
      const novos = [];
      for (const lin of caixa.querySelectorAll('.est-cad-lin')) {
        const v = k => lin.querySelector(`[data-c="${k}"]`).value;
        const nome = nomes[Number(lin.dataset.i)];
        if (!v('feitas')) continue;
        const feitas = parseInt(v('feitas'), 10), certas = parseInt(v('certas'), 10), link = v('link').trim();
        if (!v('item')) return msg(`Escolha o item do edital de “${nome}”.`);
        if (!(feitas > 0) || !(certas >= 0) || certas > feitas) return msg(`Confira feitas e certas de “${nome}” (certas entre 0 e as feitas).`);
        if (link && !/^https?:\/\//i.test(link)) return msg(`O link de “${nome}” precisa começar com http:// ou https://.`);
        novos.push({ id: novoId(), edital_id: e.id, disciplina_id: v('disc'), topico_id: v('item'), subtopico_id: v('sub') || null,
          tec_id: tecIdDe(link), link: link || null, nome, data, feitas, certas, minutos: parseInt(v('min'), 10) || 0, criado_em: new Date().toISOString() });
      }
      if (!novos.length) return msg('Preencha feitas e certas de ao menos um caderno.');
      ev.target.disabled = true;
      const mapa = ler(MAPA, {});
      let ok = 0;
      for (const r of novos) {
        if (!(await registrar(r))) break;
        ok++;
        mapa[norm(r.nome)] = { discId: r.disciplina_id, topicoId: r.topico_id, subtopicoId: r.subtopico_id || '' };
      }
      gravarLocal(MAPA, mapa);
      fechar();
      if (typeof renderDashboard === 'function') renderDashboard();
      render();
      const q = novos.slice(0, ok).reduce((a, r) => ({ f: a.f + r.feitas, c: a.c + r.certas }), { f: 0, c: 0 });
      aviso(`${ok} caderno${ok === 1 ? '' : 's'} registrado${ok === 1 ? '' : 's'}: ${q.c}/${q.f} (${pct(q.c, q.f)}%).`);
      const comErro = novos.slice(0, ok).filter(r => r.certas < r.feitas);
      if (comErro.length && window.estErros && await window.customConfirm(`Há erros em ${comErro.length} caderno${comErro.length === 1 ? '' : 's'}. Registrar agora no Caderno de Erros, começando por “${comErro[0].nome}”? (Os outros têm o botão ❌ na lista de registros.)`)) registrarErros(comErro[0]);
    });
  }

  // Caderno de Erros já com disciplina, item (ou o PDF do item, no edital por PDF) e assunto do caderno.
  // O formulário tem "Salvar e registrar outra", que mantém tudo para o próximo erro do mesmo caderno.
  function registrarErros(r) {
    if (!window.estErros) return;
    const mat = window.estPlano.materiaisDaDisciplina ? window.estPlano.materiaisDaDisciplina(r.disciplina_id).find(m => (m.topicos || []).some(l => l.topico_id === r.topico_id)) : null;
    window.estErros.novo({ discId: r.disciplina_id, topicoId: r.topico_id, subtopicoId: r.subtopico_id || '', materialId: mat ? mat.id : undefined });
  }

  async function apagar(id) {
    const r = regs.find(x => x.id === id);
    if (!r || !(await window.customConfirm(`Apagar o registro “${r.nome}” (${r.certas}/${r.feitas})? As questões e o tempo saem também do item e do histórico.`))) return;
    if (remoto) {
      const { error } = await sb().from('cadernos').delete().eq('id', id);
      if (error) { aviso('Não foi possível apagar: ' + error.message); return; }
    }
    regs = regs.filter(x => x !== r);
    if (!remoto) gravarLocal(LOCAL, regs);
    // Tira dos totais do item e apaga a sessão criada junto
    for (const e of editaisData) for (const d of e.disciplinas) {
      const t = d.topicos.find(x => x.id === r.topico_id);
      if (!t) continue;
      t.questoesFeitas = Math.max(0, (t.questoesFeitas || 0) - r.feitas);
      t.questoesCertas = Math.max(0, (t.questoesCertas || 0) - r.certas);
      t.tempoGasto = Math.max(0, (t.tempoGasto || 0) - (r.minutos || 0));
      sb().from('topicos').update({ questoes_feitas: t.questoesFeitas, questoes_certas: t.questoesCertas, tempo_gasto: t.tempoGasto }).eq('id', t.id)
        .then(({ error }) => { if (error) console.error('Cadernos: totais do item não atualizados.', error); });
      if (typeof saveEditais === 'function') saveEditais();
    }
    if (r.sessao_id && typeof deleteSession === 'function') deleteSession(r.sessao_id);
    render();
  }

  function init() {
    const sec = $('est-cadernos');
    if (!sec) return;
    if (window.estPlano && window.estPlano.renderSecao) {
      const original = window.estPlano.renderSecao;
      window.estPlano.renderSecao = s => { original(s); if (s === 'cadernos') render(); };
    }
    sec.addEventListener('click', ev => {
      const b = ev.target.closest('[data-a]');
      if (!b) return;
      if (b.dataset.a === 'novo') abrirForm();
      if (b.dataset.a === 'meta') abrirMeta();
      if (b.dataset.a === 'apagar') apagar(b.dataset.id);
      if (b.dataset.a === 'erros') { const r = regs.find(x => x.id === b.dataset.id); if (r) registrarErros(r); }
      if (b.dataset.a === 'refazer') {
        const r = regs.find(x => x.id === b.dataset.id);
        if (r) abrirForm({ id: r.id, link: r.link, nome: r.nome, disciplina_id: r.disciplina_id, topico_id: r.topico_id, subtopico_id: r.subtopico_id });
      }
    });
  }
  document.addEventListener('DOMContentLoaded', init);

  window.estCadernos = { render, novo: abrirForm, meta: abrirMeta, estatisticas, lerMeta, sugerir, _tecIdDe: tecIdDe };
})();
