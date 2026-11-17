/* =============================================
   CADERNOS DO TEC (estudos.cadernos.js, window.estCadernos)
   Estudo por questões (ex.: metas do Sensei da Aprovação, ~5 cadernos por meta): um registro por
   caderno terminado, com o item do edital (e o assunto, se quiser), feitas, certas, tempo e data.
   Cada registro vira também uma sessão no histórico (estPlano.registrarSessao), então os números
   entram nos totais do item, no Edital e no Desempenho. Esta seção mostra só os cadernos:
   volume por semana e por dia, acerto por assunto (com a tendência das últimas 2 semanas) e
   1ª vez × última nos cadernos refeitos (mesmo número de caderno no link do TEC).
   Tabela public.cadernos (supabase/cadernos.sql); sem ela, fica em localStorage['est_cadernos']
   e sobe quando a tabela existir.
============================================= */
(function () {
  const LOCAL = 'est_cadernos';
  const ULTIMO = 'est_cad_ultimo';     // disciplina/item/assunto do último registro (o próximo vem igual)
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
    return { cadernos: lista.length, total: tot, acerto: pct(tot.c, tot.q), ult7, semanas, dias, assuntos, refeitos };
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

  function barras(serie, rotulo, destaque) {
    const max = Math.max(1, ...serie.map(x => x.q));
    return `<div class="est-cad-barras" role="img" aria-label="${esc(rotulo)}">${serie.map(x => {
      const a = pct(x.c, x.q);
      return `<div class="est-cad-col ${destaque(x) ? 'atual' : ''}" title="${esc(`${ddmm(x.dia)}: ${x.q} questões${x.q ? `, ${a}% de acerto, ${fmtMin(x.m)}` : ''}`)}">
        <span class="est-cad-num">${x.q || ''}</span>
        <span class="est-cad-barra" style="height:${Math.round(x.q / max * 100)}%"></span>
        <span class="est-cad-rot">${ddmm(x.dia)}</span></div>`;
    }).join('')}</div>`;
  }

  async function render() {
    const el = $('est-cadernos');
    if (!el) return;
    if (remoto === null) { el.innerHTML = '<p class="est-plano-vazio">Carregando…</p>'; await carregar(); }
    const e = editalAtivo();
    const lista = regs.filter(r => !e || r.edital_id === e.id).sort((a, b) => b.data.localeCompare(a.data) || String(b.criado_em || '').localeCompare(String(a.criado_em || '')));
    const st = estatisticas(lista);
    const h = hoje(), seg0 = segunda(h);
    el.innerHTML = `
      <div class="est-plano-topo">
        <div>
          <h2 class="est-plano-titulo">📒 Cadernos do TEC</h2>
          <span class="est-plano-sub">Registre cada caderno ao terminar: entra no item do edital, no histórico e no Desempenho.</span>
        </div>
        <div class="est-plano-topo-acoes"><button type="button" class="est-plano-btn primario" data-a="novo">+ Registrar caderno</button></div>
      </div>
      ${remoto === false ? '<div class="est-plano-card est-cad-aviso">Os cadernos estão ficando só neste navegador. Rode <code>supabase/cadernos.sql</code> no Supabase para guardar no servidor (o que já está aqui sobe sozinho).</div>' : ''}
      ${!lista.length ? '<div class="est-plano-card"><p class="est-plano-vazio">Nenhum caderno registrado neste edital ainda. Ao terminar um caderno do TEC, clique em “+ Registrar caderno”.</p></div>' : `
      <div class="est-plano-kpis">
        <div class="est-plano-kpi"><span>Questões</span><strong>${st.total.q}</strong><small>${st.cadernos} caderno${st.cadernos === 1 ? '' : 's'}</small></div>
        <div class="est-plano-kpi"><span>Acerto</span><strong>${st.acerto}%</strong><small>${st.total.c} certas</small></div>
        <div class="est-plano-kpi"><span>Tempo</span><strong>${fmtMin(st.total.m)}</strong><small>${st.total.q ? (st.total.m / st.total.q).toFixed(1).replace('.', ',') + ' min por questão' : ''}</small></div>
        <div class="est-plano-kpi"><span>Últimos 7 dias</span><strong>${st.ult7.q}</strong><small>${st.ult7.q ? pct(st.ult7.c, st.ult7.q) + '% de acerto' : 'sem questões'}</small></div>
      </div>
      <div class="est-plano-card">
        <h3 class="est-plano-card-title">Questões por semana</h3>
        <p class="est-plano-sub">Últimas ${SEMANAS} semanas (a data é a segunda-feira). Passe o mouse para ver o acerto e o tempo.</p>
        ${barras(st.semanas, 'Questões por semana', x => x.dia === seg0)}
      </div>
      <div class="est-plano-card">
        <h3 class="est-plano-card-title">Questões por dia</h3>
        <p class="est-plano-sub">Últimos ${DIAS} dias.</p>
        ${barras(st.dias, 'Questões por dia', x => x.dia === h)}
      </div>
      <div class="est-plano-card">
        <h3 class="est-plano-card-title">Acerto por assunto</h3>
        <p class="est-plano-sub">Do pior para o melhor. A tendência compara os últimos ${RECENTE_DIAS} dias com antes (em pontos). Com menos de ${POUCAS} questões, o acerto ainda diz pouco.</p>
        <div class="est-cad-tabela-rolagem"><table class="est-cad-tabela">
          <thead><tr><th>Assunto</th><th>Questões</th><th>Acerto</th><th>Tendência</th></tr></thead>
          <tbody>${st.assuntos.map(a => { const n = nomes(a.topico_id, a.subtopico_id); return `<tr class="${a.poucas ? 'poucas' : ''}">
            <td><span class="est-cad-item">${esc(n.disc)} › ${esc(n.item)}</span>${n.assunto ? `<strong>${esc(n.assunto)}</strong>` : '<strong>(item inteiro)</strong>'}</td>
            <td>${a.q}</td>
            <td><span class="est-cad-acerto"><span style="width:${a.acerto}%" class="${a.acerto < 70 ? 'fraco' : ''}"></span></span>${a.acerto}%</td>
            <td>${a.tendencia === null ? '<span class="est-cad-mudo">—</span>' : a.tendencia > 0 ? `<span class="est-cad-sobe">▲ ${a.tendencia}</span>` : a.tendencia < 0 ? `<span class="est-cad-desce">▼ ${-a.tendencia}</span>` : '='}</td></tr>`; }).join('')}</tbody>
        </table></div>
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
        <label class="est-form-group">Nome <input type="text" class="est-form-input" data-k="nome" maxlength="120" value="${esc(base.nome || '')}" placeholder="Ex.: Meta 12 – Licitações 2/5" /></label>
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
      const subs = c('item').value && window.estSub ? window.estSub.doTopico(c('item').value) : [];
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
      const s = await window.estPlano.registrarSessao({ topico_id: tId }, {
        minutos, questoes: feitas, acertos: certas, tipo: 'questoes', data,
        assuntos: sub ? [{ subtopico_id: sub, minutos, questoes: feitas, acertos: certas }] : []
      });
      r.sessao_id = s ? s.id : null;
      if (!(await salvarReg(r))) { ev.target.disabled = false; return; }
      gravarLocal(ULTIMO, { discId: r.disciplina_id, topicoId: tId, subtopicoId: sub });
      fechar();
      if (typeof renderDashboard === 'function') renderDashboard();
      render();
      aviso(`Caderno registrado: ${certas}/${feitas} (${pct(certas, feitas)}%).`);
      if (certas < feitas && window.estErros && await window.customConfirm(`Você errou ${feitas - certas} questão(ões). Registrar no Caderno de Erros agora?`)) {
        const mat = window.estPlano.materiaisDaDisciplina ? window.estPlano.materiaisDaDisciplina(r.disciplina_id).find(m => (m.topicos || []).some(l => l.topico_id === tId)) : null;
        window.estErros.novo({ discId: r.disciplina_id, topicoId: tId, subtopicoId: sub || '', materialId: mat ? mat.id : undefined });
      }
    });
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
      if (b.dataset.a === 'apagar') apagar(b.dataset.id);
      if (b.dataset.a === 'refazer') {
        const r = regs.find(x => x.id === b.dataset.id);
        if (r) abrirForm({ id: r.id, link: r.link, nome: r.nome, disciplina_id: r.disciplina_id, topico_id: r.topico_id, subtopico_id: r.subtopico_id });
      }
    });
  }
  document.addEventListener('DOMContentLoaded', init);

  window.estCadernos = { render, novo: abrirForm, estatisticas, _tecIdDe: tecIdDe };
})();
