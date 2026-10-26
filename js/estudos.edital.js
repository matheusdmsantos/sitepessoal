/* =============================================
   EDITAL VERTICALIZADO (estudos.edital.js)
   Desenha a aba "Edital Verticalizado": números do edital, busca e filtros, disciplinas
   com progresso e acerto, tópicos com selos (incidência, páginas, resumo, revisão) e a
   ficha lateral do tópico. Exporta o edital em PDF ou Excel.

   Os dados e as ações continuam no estudos.v5.js (editaisData, toggleTopic, promptRefazer,
   promptRevisao, promptTempo, deleteTopic, addTopic, addDisc, reorderDisc, updateTopicName,
   updateDiscName); revisões, incidência e páginas vêm do estudos.plano.js; o resumo, do
   estudos.sessao.js / estudos.resumos.js. renderEdital() do v5 chama estEdital.render().
============================================= */
(function () {
  const ACERTO_FRACO = 70;          // abaixo disso o tópico é ponto fraco
  const MIN_QUESTOES_FRACO = 5;     // com menos questões, o acerto ainda não diz nada
  const INCIDENCIA_ALTA = 1.5;      // vezes a média da disciplina (100% / nº de tópicos)
  const NIVEL_MAX = 3;
  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  const FILTROS = [
    { id: 'todos', nome: 'Todos' },
    { id: 'pendentes', nome: 'Não estudados' },
    { id: 'fracos', nome: `Acerto < ${ACERTO_FRACO}%` },
    { id: 'atrasadas', nome: 'Revisão atrasada' },
    { id: 'semresumo', nome: 'Sem resumo' },
    { id: 'incidencia', nome: 'Alta incidência' }
  ];

  let busca = '';
  let filtro = 'todos';
  let ficha = null;          // { eId, dId, tId }
  let iniciado = false;

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normalizar = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const plano = () => window.estPlano || {};
  const hojeStr = () => dataLocal();

  function diasAte(data) {
    const [a, m, d] = data.split('-').map(Number);
    const [ha, hm, hd] = hojeStr().split('-').map(Number);
    return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(ha, hm - 1, hd)) / 86400000);
  }
  function fmtData(data) {
    if (!data) return '';
    const [a, m, d] = data.split('-');
    return `${d}/${m}/${a}`;
  }
  function fmtTempo(min) {
    min = Math.round(min || 0);
    const h = Math.floor(min / 60), m = min % 60;
    return h ? `${h}h${m ? String(m).padStart(2, '0') : ''}` : `${m}min`;
  }
  const fmtPct = n => Math.round(n).toLocaleString('pt-BR') + '%';

  function lerLocal(chave, padrao) {
    try { const v = localStorage.getItem(chave); return v === null ? padrao : JSON.parse(v); } catch (e) { return padrao; }
  }
  function gravarLocal(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* sem armazenamento */ }
  }

  function editalAtual() {
    return editaisData.find(e => e.id === currentEditalId) || null;
  }

  function acharTopico(eId, dId, tId) {
    const e = editaisData.find(x => x.id === eId);
    const d = e && e.disciplinas.find(x => x.id === dId);
    const t = d && d.topicos.find(x => x.id === tId);
    return t ? { e, d, t } : null;
  }

  /* =============================================
     INFORMAÇÕES DE CADA TÓPICO
  ============================================= */
  function acerto(t) {
    return t.questoesFeitas > 0 ? (t.questoesCertas / t.questoesFeitas) * 100 : null;
  }
  function classeAcerto(pct) {
    return pct === null ? '' : pct < ACERTO_FRACO ? 'ruim' : pct < 85 ? 'medio' : 'bom';
  }
  function fraco(t) {
    const p = acerto(t);
    return p !== null && t.questoesFeitas >= MIN_QUESTOES_FRACO && p < ACERTO_FRACO;
  }
  function temResumo(d, t) {
    const r = typeof resumosMap !== 'undefined' && resumosMap[makeResumoKey(d.nome, t.nome)];
    return !!(r && r.conteudo && r.conteudo.trim() && r.conteudo !== '<p><br></p>');
  }

  /* Revisão: { tipo: 'atrasada' | 'hoje' | 'agendada' | 'dominado' | 'sem' | null, r, dias } */
  function situacaoRevisao(t) {
    if (!t.estudado) return { tipo: null };
    const revs = plano().revisoesDoTopico ? plano().revisoesDoTopico(t.id) : [];
    const pendente = revs.find(r => !r.concluida_em);
    if (pendente) {
      const dias = diasAte(pendente.data_prevista);
      return { tipo: dias < 0 ? 'atrasada' : dias === 0 ? 'hoje' : 'agendada', r: pendente, dias };
    }
    return { tipo: revs.some(r => r.concluida_em) ? 'dominado' : 'sem' };
  }

  function numeracao(nome) {
    const m = /^\s*(\d+(?:\.\d+)*)[.)]?\s/.exec(nome || '');
    return m ? m[1] : null;
  }

  // Nível de cada tópico pela numeração ("1" = 1, "1.1" = 2...), com base no menor nível da disciplina
  function niveis(d) {
    const brutos = d.topicos.map(t => { const n = numeracao(t.nome); return n ? n.split('.').length : 1; });
    const base = Math.min(...brutos, 99) - 1;
    return brutos.map(n => Math.min(NIVEL_MAX, Math.max(1, n - base)));
  }

  function incidenciaAlta(d, t) {
    const p = plano().pctIncidencia ? plano().pctIncidencia(t.id) : null;
    return p !== null && d.topicos.length > 0 && p >= INCIDENCIA_ALTA * (100 / d.topicos.length);
  }

  function passaNoFiltro(d, t) {
    if (busca && !normalizar(t.nome).includes(normalizar(busca))) return false;
    switch (filtro) {
      case 'pendentes': return !t.estudado;
      case 'fracos': return fraco(t);
      case 'atrasadas': return situacaoRevisao(t).tipo === 'atrasada';
      case 'semresumo': return !temResumo(d, t);
      case 'incidencia': return incidenciaAlta(d, t);
      default: return true;
    }
  }

  /* =============================================
     ESTADO DAS DISCIPLINAS ABERTAS (por edital)
  ============================================= */
  const chaveAbertas = eId => 'est_edital_abertas_' + eId;
  function abertas(eId) { return new Set(lerLocal(chaveAbertas(eId), [])); }
  function alternarDisc(dId) {
    const e = editalAtual();
    if (!e) return;
    const s = abertas(e.id);
    if (s.has(dId)) s.delete(dId); else s.add(dId);
    gravarLocal(chaveAbertas(e.id), [...s]);
    const card = document.querySelector(`.est-ed-disc[data-disc-id="${CSS.escape(dId)}"]`);
    if (card && !busca && filtro === 'todos') {
      card.classList.toggle('aberta', s.has(dId));
      card.querySelector('.est-ed-disc-topo').setAttribute('aria-expanded', s.has(dId));
    } else render();
  }
  function abrirTodas(sim) {
    const e = editalAtual();
    if (!e) return;
    gravarLocal(chaveAbertas(e.id), sim ? e.disciplinas.map(d => d.id) : []);
    render();
  }

  /* =============================================
     DESENHO
  ============================================= */
  function render() {
    const lista = $('est-edital-accordion');
    if (!lista) return;
    iniciar();
    const e = editalAtual();
    const vazio = $('est-edital-empty');
    const btnExcluir = $('est-btn-delete-edital');
    if (!e) {
      lista.innerHTML = '';
      $('est-ed-painel').innerHTML = '';
      $('est-ed-barra').hidden = true;
      if (vazio) vazio.style.display = 'flex';
      if (btnExcluir) btnExcluir.style.display = 'none';
      fecharFicha();
      return;
    }
    if (vazio) vazio.style.display = 'none';
    if (btnExcluir) btnExcluir.style.display = 'flex';
    $('est-ed-barra').hidden = false;

    renderPainel(e);
    renderBarra(e);
    renderLista(e);
    if (ficha) renderFicha();
  }

  function renderPainel(e) {
    const topicos = e.disciplinas.flatMap(d => d.topicos);
    const total = topicos.length;
    const feitos = topicos.filter(t => t.estudado).length;
    const q = topicos.reduce((a, t) => a + (t.questoesFeitas || 0), 0);
    const c = topicos.reduce((a, t) => a + (t.questoesCertas || 0), 0);
    const pctQ = q ? (c / q) * 100 : null;
    const minutos = topicos.reduce((a, t) => a + (t.tempoGasto || 0), 0);
    const fracos = topicos.filter(fraco).length;
    const sit = topicos.map(situacaoRevisao);
    const atrasadas = sit.filter(s => s.tipo === 'atrasada').length;
    const hoje = sit.filter(s => s.tipo === 'hoje').length;
    const semana = sit.filter(s => s.tipo === 'agendada' && s.dias <= 7).length;
    const dominados = sit.filter(s => s.tipo === 'dominado').length;
    let fim = null;
    try { const p = plano().projetar && plano().projetar(e); fim = p && p.fim; } catch (err) { fim = null; }
    const pct = total ? (feitos / total) * 100 : 0;

    $('est-ed-painel').innerHTML = `
      <div class="est-ed-card largo">
        <span class="est-ed-card-rotulo">Progresso do edital</span>
        <div class="est-ed-card-linha"><strong>${fmtPct(pct)}</strong><span>${feitos} de ${total} tópicos estudados</span></div>
        <div class="est-ed-barra-prog"><div style="width:${pct}%"></div></div>
      </div>
      <div class="est-ed-card">
        <span class="est-ed-card-rotulo">Questões</span>
        <strong class="${classeAcerto(pctQ)}">${pctQ === null ? '—' : fmtPct(pctQ)}</strong>
        <span>${c.toLocaleString('pt-BR')} de ${q.toLocaleString('pt-BR')} certas${fracos ? ` · <button type="button" class="est-ed-link ruim" onclick="estEdital.filtrar('fracos')">${fracos} ponto${fracos > 1 ? 's' : ''} fraco${fracos > 1 ? 's' : ''}</button>` : ''}</span>
      </div>
      <div class="est-ed-card">
        <span class="est-ed-card-rotulo">Tempo de estudo</span>
        <strong>${fmtTempo(minutos)}</strong>
        <span>${feitos ? `média de ${fmtTempo(minutos / feitos)} por tópico` : 'nos tópicos do edital'}</span>
      </div>
      <div class="est-ed-card">
        <span class="est-ed-card-rotulo">Revisões</span>
        <strong class="${atrasadas ? 'ruim' : 'bom'}">${atrasadas ? `${atrasadas} atrasada${atrasadas > 1 ? 's' : ''}` : 'Em dia'}</strong>
        <span>${hoje} hoje · ${semana} nos próximos 7 dias${dominados ? ` · ${dominados} dominado${dominados > 1 ? 's' : ''}` : ''}</span>
      </div>
      <div class="est-ed-card">
        <span class="est-ed-card-rotulo">Previsão de término</span>
        <strong>${fim ? fmtData(fim) : feitos === total && total ? 'Concluído' : '—'}</strong>
        <span>${fim ? 'pelo ritmo do plano semanal' : `<button type="button" class="est-ed-link" onclick="navigateTo('metas')">Configure o plano semanal</button>`}</span>
      </div>`;
  }

  function renderBarra(e) {
    const chips = $('est-ed-filtros');
    chips.innerHTML = FILTROS.map(f => `
      <button type="button" class="est-ed-chip ${filtro === f.id ? 'ativo' : ''}" aria-pressed="${filtro === f.id}" onclick="estEdital.filtrar('${f.id}')">${f.nome}</button>`).join('');
    const busc = $('est-ed-busca');
    if (busc.value !== busca) busc.value = busca;
  }

  function seloRevisao(s) {
    switch (s.tipo) {
      case 'atrasada': return `<span class="est-ed-selo ruim" title="Revisão prevista para ${fmtData(s.r.data_prevista)}">⚠ revisão ${-s.dias}d atrasada</span>`;
      case 'hoje': return `<span class="est-ed-selo medio" title="Revisão de hoje">🔁 revisar hoje</span>`;
      case 'agendada': return `<span class="est-ed-selo" title="Próxima revisão em ${fmtData(s.r.data_prevista)}">🔁 em ${s.dias}d</span>`;
      case 'dominado': return `<span class="est-ed-selo bom" title="O intervalo de revisão passou de 120 dias">🏆 dominado</span>`;
      default: return '';
    }
  }

  function linhaTopico(e, d, t, nivel) {
    const p = acerto(t);
    const inc = plano().pctIncidencia ? plano().pctIncidencia(t.id) : null;
    const pags = plano().paginasDoTopico ? Math.round(plano().paginasDoTopico(t.id)) : 0;
    const lidas = pags && plano().paginasLidas ? plano().paginasLidas(t.id) : 0;
    const sit = situacaoRevisao(t);
    const ativo = ficha && ficha.tId === t.id;
    const selos = [
      inc !== null ? `<span class="est-ed-selo ${incidenciaAlta(d, t) ? 'alta' : ''}" title="${inc.toFixed(1).replace('.', ',')}% das questões da disciplina no TEC">📊 ${inc >= 1 ? Math.round(inc) + '%' : inc > 0 ? '<1%' : '0%'}</span>` : '',
      pags ? `<span class="est-ed-selo" title="Páginas lidas do material">📄 ${lidas ? `${lidas}/` : ''}${pags}p</span>` : '',
      temResumo(d, t) ? `<span class="est-ed-selo" title="Tem resumo">✍️</span>` : '',
      seloRevisao(sit),
      t.tempoGasto ? `<span class="est-ed-selo sutil" title="Tempo de estudo">⏱ ${fmtTempo(t.tempoGasto)}</span>` : ''
    ].join('');
    return `
      <div class="est-ed-topico nivel-${nivel} ${t.estudado ? 'feito' : ''} ${ativo ? 'ativo' : ''}" data-topic-id="${esc(t.id)}"
           role="button" tabindex="0" onclick="estEdital.abrirFicha('${e.id}', '${d.id}', '${t.id}')"
           onkeydown="if (event.target === this && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); this.click(); }">
        <input type="checkbox" class="est-ed-check" ${t.estudado ? 'checked' : ''} aria-label="Estudado: ${esc(t.nome)}"
               onclick="event.stopPropagation()" onchange="toggleTopic('${e.id}', '${d.id}', '${t.id}', this.checked)">
        <span class="est-ed-topico-nome">${esc(t.nome)}</span>
        <span class="est-ed-selos">${selos}</span>
        <span class="est-ed-acerto ${classeAcerto(p)}" title="${t.questoesCertas || 0} certas de ${t.questoesFeitas || 0}">${p === null ? '—' : `${fmtPct(p)} <small>${t.questoesCertas}/${t.questoesFeitas}</small>`}</span>
        ${t.tecLink ? `<a class="est-ed-tec" href="${esc(t.tecLink)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Abrir caderno do TEC">TEC ↗</a>` : '<span class="est-ed-tec vazio"></span>'}
        <span class="est-ed-seta" aria-hidden="true">›</span>
      </div>`;
  }

  function renderLista(e) {
    const lista = $('est-edital-accordion');
    const abertasSet = abertas(e.id);
    const filtrando = !!busca || filtro !== 'todos';
    let achados = 0;

    const html = e.disciplinas.map((d, i) => {
      const nv = niveis(d);
      const visiveis = d.topicos.map((t, j) => ({ t, nivel: nv[j] })).filter(x => passaNoFiltro(d, x.t));
      if (filtrando && !visiveis.length) return '';
      achados += visiveis.length;
      const total = d.topicos.length;
      const feitos = d.topicos.filter(t => t.estudado).length;
      const q = d.topicos.reduce((a, t) => a + (t.questoesFeitas || 0), 0);
      const c = d.topicos.reduce((a, t) => a + (t.questoesCertas || 0), 0);
      const pctQ = q ? (c / q) * 100 : null;
      const nFracos = d.topicos.filter(fraco).length;
      const min = d.topicos.reduce((a, t) => a + (t.tempoGasto || 0), 0);
      const aberta = filtrando || abertasSet.has(d.id);
      const pct = total ? (feitos / total) * 100 : 0;
      return `
        <section class="est-ed-disc ${aberta ? 'aberta' : ''}" data-disc-id="${esc(d.id)}">
          <div class="est-ed-disc-topo" role="button" tabindex="0" aria-expanded="${aberta}"
               onclick="estEdital.alternarDisc('${d.id}')"
               onkeydown="if (event.target === this && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); this.click(); }">
            <span class="est-ed-chevron" aria-hidden="true">▸</span>
            <h3 class="est-ed-disc-nome">${esc(d.nome)}</h3>
            <span class="est-ed-disc-acoes" onclick="event.stopPropagation()">
              <button type="button" onclick="estEdital.renomearDisc('${d.id}')" title="Renomear disciplina" aria-label="Renomear ${esc(d.nome)}">✎</button>
              <button type="button" onclick="reorderDisc('${e.id}', '${d.id}', -1)" ${i === 0 ? 'disabled' : ''} title="Mover para cima" aria-label="Mover ${esc(d.nome)} para cima">▲</button>
              <button type="button" onclick="reorderDisc('${e.id}', '${d.id}', 1)" ${i === e.disciplinas.length - 1 ? 'disabled' : ''} title="Mover para baixo" aria-label="Mover ${esc(d.nome)} para baixo">▼</button>
            </span>
            <span class="est-ed-disc-numeros">
              <span class="est-ed-disc-prog" title="${feitos} de ${total} tópicos estudados">
                <span class="est-ed-barra-prog"><span style="width:${pct}%"></span></span>
                ${feitos}/${total}
              </span>
              <span class="est-ed-acerto ${classeAcerto(pctQ)}" title="Acerto médio da disciplina">${pctQ === null ? '—' : fmtPct(pctQ)}</span>
              ${nFracos ? `<span class="est-ed-selo ruim" title="Tópicos com acerto abaixo de ${ACERTO_FRACO}% (mín. ${MIN_QUESTOES_FRACO} questões)">⚠ ${nFracos} fraco${nFracos > 1 ? 's' : ''}</span>` : ''}
              ${min ? `<span class="est-ed-selo sutil">⏱ ${fmtTempo(min)}</span>` : ''}
            </span>
          </div>
          <div class="est-ed-disc-corpo">
            ${visiveis.map(x => linhaTopico(e, d, x.t, x.nivel)).join('')}
            ${filtrando ? '' : `<button type="button" class="est-ed-add" onclick="addTopic('${e.id}', '${d.id}')">+ Adicionar tópico</button>`}
          </div>
        </section>`;
    }).join('');

    lista.innerHTML = (filtrando
      ? `<p class="est-ed-contagem">${achados} tópico${achados === 1 ? '' : 's'} encontrado${achados === 1 ? '' : 's'}${achados ? '' : '. <button type="button" class="est-ed-link" onclick="estEdital.limparFiltros()">Limpar filtros</button>'}</p>`
      : '') + html +
      (filtrando ? '' : `<button type="button" class="est-ed-add disc" onclick="addDisc('${e.id}')">+ Adicionar disciplina</button>`);
  }

  /* =============================================
     FICHA DO TÓPICO (painel lateral)
  ============================================= */
  function abrirFicha(eId, dId, tId) {
    ficha = { eId, dId, tId };
    const painel = $('est-ed-ficha');
    painel.hidden = false;
    $('est-ed-ficha-fundo').hidden = false;
    requestAnimationFrame(() => { painel.classList.add('aberta'); $('est-ed-ficha-fundo').classList.add('aberta'); });
    renderFicha();
    document.querySelectorAll('.est-ed-topico.ativo').forEach(el => el.classList.remove('ativo'));
    const linha = document.querySelector(`.est-ed-topico[data-topic-id="${CSS.escape(tId)}"]`);
    if (linha) linha.classList.add('ativo');
    painel.querySelector('.est-ed-ficha-fechar').focus();
  }

  function fecharFicha() {
    const painel = $('est-ed-ficha');
    if (!painel || !ficha) return;
    const tId = ficha.tId;
    ficha = null;
    painel.classList.remove('aberta');
    $('est-ed-ficha-fundo').classList.remove('aberta');
    setTimeout(() => { if (!ficha) { painel.hidden = true; $('est-ed-ficha-fundo').hidden = true; } }, 250);
    const linha = document.querySelector(`.est-ed-topico[data-topic-id="${CSS.escape(tId)}"]`);
    if (linha) { linha.classList.remove('ativo'); linha.focus(); }
  }

  function renderFicha() {
    const ref = ficha && acharTopico(ficha.eId, ficha.dId, ficha.tId);
    if (!ref) { fecharFicha(); return; }
    const { e, d, t } = ref;
    const p = acerto(t);
    const inc = plano().pctIncidencia ? plano().pctIncidencia(t.id) : null;
    const pags = plano().paginasDoTopico ? Math.round(plano().paginasDoTopico(t.id)) : 0;
    const lidas = pags && plano().paginasLidas ? plano().paginasLidas(t.id) : 0;
    const revs = plano().revisoesDoTopico ? plano().revisoesDoTopico(t.id) : [];
    const sit = situacaoRevisao(t);
    const sessoes = (typeof studyData !== 'undefined' ? studyData : []).filter(s => s.topicId === t.id)
      .sort((a, b) => (b.timestamp || b.date || '').localeCompare(a.timestamp || a.date || ''));
    const pdfs = plano().materiaisDaDisciplina ? plano().materiaisDaDisciplina(d.id)
      .map(m => ({ m, faixa: (m.topicos || []).find(x => x.topico_id === t.id) })).filter(x => x.faixa) : [];
    const r = typeof resumosMap !== 'undefined' && resumosMap[makeResumoKey(d.nome, t.nome)];
    const resumoTxt = temResumo(d, t) ? (() => {
      const tpl = document.createElement('template');
      tpl.innerHTML = r.conteudo;
      const txt = tpl.content.textContent.replace(/\s+/g, ' ').trim();
      return txt.length > 260 ? txt.slice(0, 260) + '…' : txt;
    })() : '';
    const rotuloRev = x => x.tipo === 'reforco' ? 'Reforço' : `Revisão ${x.etapa}`;

    $('est-ed-ficha-conteudo').innerHTML = `
      <header class="est-ed-ficha-topo">
        <div>
          <span class="est-plano-tag">${esc(d.nome)}</span>
          <h2 id="est-ed-ficha-titulo">${esc(t.nome)}</h2>
        </div>
        <button type="button" class="est-modal-close est-ed-ficha-fechar" onclick="estEdital.fecharFicha()" aria-label="Fechar ficha">✕</button>
      </header>

      <label class="est-ed-ficha-estudado">
        <input type="checkbox" ${t.estudado ? 'checked' : ''} onchange="toggleTopic('${e.id}', '${d.id}', '${t.id}', this.checked)">
        <span>${t.estudado ? 'Estudado' : 'Marcar como estudado'}</span>
        ${seloRevisao(sit)}
      </label>

      <div class="est-ed-ficha-numeros">
        <div><span>Acerto</span><strong class="${classeAcerto(p)}">${p === null ? '—' : fmtPct(p)}</strong><small>${t.questoesCertas || 0} de ${t.questoesFeitas || 0}</small></div>
        <div><span>Tempo</span><strong>${t.tempoGasto ? fmtTempo(t.tempoGasto) : '—'}</strong><small>${sessoes.length} sess${sessoes.length === 1 ? 'ão' : 'ões'}</small></div>
        <div><span>Incidência</span><strong>${inc === null ? '—' : inc.toFixed(1).replace('.', ',') + '%'}</strong><small>${inc === null ? 'sem planilha do TEC' : 'das questões da disciplina'}</small></div>
        <div><span>Material</span><strong>${pags ? `${lidas}/${pags}` : '—'}</strong><small>${pags ? 'páginas lidas' : 'sem PDF ligado'}</small></div>
      </div>

      <div class="est-ed-ficha-acoes">
        <button type="button" class="est-plano-btn primario" onclick="promptRefazer('${e.id}', '${d.id}', '${t.id}')">＋ Registrar questões</button>
        <button type="button" class="est-plano-btn" onclick="promptTempo('${e.id}', '${d.id}', '${t.id}')">⏱ Adicionar tempo</button>
        <button type="button" class="est-plano-btn" onclick="promptRevisao('${e.id}', '${d.id}', '${t.id}')">Corrigir totais</button>
      </div>

      <section class="est-ed-ficha-bloco">
        <h3>Caderno do TEC</h3>
        ${t.tecLink
          ? `<div class="est-ed-ficha-linha"><a href="${esc(t.tecLink)}" target="_blank" rel="noopener" class="est-ed-tec-link">Abrir caderno ↗</a><button type="button" class="est-ed-link" onclick="estEdital.editarTec()">Alterar link</button></div>`
          : `<button type="button" class="est-ed-link" onclick="estEdital.editarTec()">+ Adicionar link do caderno</button>`}
      </section>

      <section class="est-ed-ficha-bloco">
        <h3>Resumo</h3>
        ${resumoTxt ? `<p class="est-ed-ficha-resumo">${esc(resumoTxt)}</p>` : '<p class="est-ed-ficha-vazio">Ainda sem resumo.</p>'}
        <div class="est-ed-ficha-linha">
          <button type="button" class="est-plano-btn" onclick="estSessao.abrirResumo(${esc(JSON.stringify(d.nome))}, ${esc(JSON.stringify(t.nome))})">${resumoTxt ? '✍️ Abrir resumo' : '✍️ Escrever resumo'}</button>
          ${resumoTxt ? `<button type="button" class="est-ed-link" onclick="estEdital.fecharFicha(); estResumos.irPara(${esc(JSON.stringify(d.nome))}, ${esc(JSON.stringify(t.nome))})">Ver no resumo da matéria</button>` : ''}
        </div>
      </section>

      ${window.estErros ? window.estErros.blocoFicha(e.id, d.id, t.id) : ''}

      <section class="est-ed-ficha-bloco">
        <h3>Revisões</h3>
        ${revs.length ? `<ul class="est-ed-ficha-lista">${revs.map(x => x.concluida_em
          ? `<li><span>✓ ${rotuloRev(x)}</span><span>${fmtData(x.concluida_em)}</span><span class="${classeAcerto(x.acerto === null ? null : x.acerto)}">${x.acerto === null || x.acerto === undefined ? '' : x.acerto + '%'}</span></li>`
          : `<li class="pendente"><span>${rotuloRev(x)}</span><span>${fmtData(x.data_prevista)}</span><span>${diasAte(x.data_prevista) < 0 ? '<span class="ruim">atrasada</span>' : 'prevista'}</span></li>`).join('')}</ul>`
          : `<p class="est-ed-ficha-vazio">${t.estudado ? 'Nenhuma revisão registrada.' : 'A primeira revisão é agendada quando o tópico é estudado.'}</p>`}
      </section>

      ${pdfs.length ? `
      <section class="est-ed-ficha-bloco">
        <h3>Material em PDF</h3>
        <ul class="est-ed-ficha-lista">${pdfs.map(({ m, faixa }) => `<li><span>📄 ${esc(m.nome)}</span><span>${faixa.de && faixa.ate ? `p. ${faixa.de}–${faixa.ate}` : ''}</span></li>`).join('')}</ul>
      </section>` : ''}

      <section class="est-ed-ficha-bloco">
        <h3>Histórico de estudo</h3>
        ${sessoes.length ? `<ul class="est-ed-ficha-lista">${sessoes.slice(0, 12).map(s => `
          <li><span>${fmtData(s.date)}</span><span>${s.tipo === 'revisao' ? 'Revisão' : s.tipo === 'reforco' ? 'Reforço' : 'Estudo'} · ${fmtTempo(s.timeMinutes)}</span><span>${s.questionsTotal ? `${s.questionsCorrect}/${s.questionsTotal}` : ''}</span></li>`).join('')}</ul>
          ${sessoes.length > 12 ? `<p class="est-ed-ficha-vazio">e mais ${sessoes.length - 12} sessões no Histórico.</p>` : ''}`
          : '<p class="est-ed-ficha-vazio">Nenhuma sessão registrada.</p>'}
      </section>

      <footer class="est-ed-ficha-rodape">
        <button type="button" class="est-ed-link" onclick="estEdital.renomearTopico()">Renomear tópico</button>
        <button type="button" class="est-ed-link ruim" onclick="estEdital.excluirTopico()">Excluir tópico</button>
      </footer>`;
  }

  /* =============================================
     AÇÕES DA FICHA E DAS DISCIPLINAS
  ============================================= */
  async function editarTec() {
    const ref = ficha && acharTopico(ficha.eId, ficha.dId, ficha.tId);
    if (!ref) return;
    const url = await window.customPrompt('Cole a URL do caderno do TEC para este tópico:', ref.t.tecLink || '');
    if (url === null) return;
    ref.t.tecLink = url.trim();
    saveEditais();
    render();
    const { error } = await window.supabaseClient.from('topicos').update({ tec_link: ref.t.tecLink }).eq('id', ref.t.id);
    if (error) console.error('Erro ao salvar link do TEC:', error);
  }

  /* O resumo é ligado pelo nome (disciplina + tópico): ao renomear, o resumo acompanha */
  async function moverResumo(discAntes, topAntes, discDepois, topDepois) {
    const antes = makeResumoKey(discAntes, topAntes);
    const depois = makeResumoKey(discDepois, topDepois);
    const r = resumosMap[antes];
    if (!r || antes === depois) return;
    resumosMap[depois] = { ...r, disciplina_nome: discDepois, topico_nome: topDepois };
    delete resumosMap[antes];
    try {
      const backups = JSON.parse(localStorage.getItem('est_resumos_backup') || '{}');
      if (backups[antes] !== undefined) { backups[depois] = backups[antes]; delete backups[antes]; }
      localStorage.setItem('est_resumos_backup', JSON.stringify(backups));
    } catch (e) { /* backup local indisponível */ }
    if (r.id) {
      const { error } = await window.supabaseClient.from('resumos')
        .update({ disciplina_nome: discDepois, topico_nome: topDepois }).eq('id', r.id);
      if (error) console.error('Erro ao mover o resumo:', error);
    }
  }

  async function renomearTopico() {
    const ref = ficha && acharTopico(ficha.eId, ficha.dId, ficha.tId);
    if (!ref) return;
    const novo = await window.customPrompt('Novo nome do tópico:', ref.t.nome);
    if (!novo || !novo.trim() || novo.trim() === ref.t.nome) return;
    const antes = ref.t.nome;
    await updateTopicName(ref.e.id, ref.d.id, ref.t.id, novo);
    await moverResumo(ref.d.nome, antes, ref.d.nome, ref.t.nome);
    render();
  }

  async function renomearDisc(dId) {
    const e = editalAtual();
    const d = e && e.disciplinas.find(x => x.id === dId);
    if (!d) return;
    const novo = await window.customPrompt('Novo nome da disciplina:', d.nome);
    if (!novo || !novo.trim() || novo.trim() === d.nome) return;
    const antes = d.nome;
    await updateDiscName(e.id, d.id, novo);
    for (const t of d.topicos) await moverResumo(antes, t.nome, d.nome, t.nome);
    render();
  }

  async function excluirTopico() {
    const ref = ficha && acharTopico(ficha.eId, ficha.dId, ficha.tId);
    if (!ref) return;
    await deleteTopic(ref.e.id, ref.d.id, ref.t.id);
    if (!acharTopico(ref.e.id, ref.d.id, ref.t.id)) fecharFicha();
  }

  function filtrar(id) {
    filtro = FILTROS.some(f => f.id === id) ? id : 'todos';
    render();
  }

  function limparFiltros() {
    filtro = 'todos';
    busca = '';
    render();
  }

  /* =============================================
     EXPORTAÇÃO (PDF e Excel)
  ============================================= */
  function carregarScript(url, global) {
    if (window[global]) return Promise.resolve();
    return new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = ok;
      s.onerror = () => { s.remove(); falha(new Error('Falha ao carregar ' + url)); };
      document.head.appendChild(s);
    });
  }

  function proximaRevisaoTexto(t) {
    const s = situacaoRevisao(t);
    if (s.tipo === 'dominado') return 'Dominado';
    return s.r ? fmtData(s.r.data_prevista) + (s.tipo === 'atrasada' ? ' (atrasada)' : '') : '';
  }

  function nomeArquivo(e, ext) {
    return ('Edital verticalizado - ' + (e.titulo || 'edital')).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() + '.' + ext;
  }

  async function gravar(blob, nome, pasta) {
    if (window.estResumos && window.estResumos.gravarArquivo) return window.estResumos.gravarArquivo(blob, nome, pasta);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function pasta() {
    if (!window.estResumos || !window.estResumos.pastaDestino) return null;
    try { return await window.estResumos.pastaDestino(); }
    catch (e) { if (e.name === 'AbortError') throw e; return null; }
  }

  function aviso(msg) {
    if (plano().aviso) plano().aviso(msg);
  }

  async function exportarExcel() {
    const e = editalAtual();
    if (!e) return;
    let destino;
    try { destino = await pasta(); } catch (err) { return; }
    aviso('Gerando a planilha…');
    try { await carregarScript(XLSX_URL, 'XLSX'); } catch (err) { aviso('Não foi possível carregar o gerador de planilhas.'); return; }
    const linhas = [['Disciplina', 'Tópico', 'Estudado', 'Questões', 'Acertos', '% Acerto', 'Tempo (min)', 'Incidência (%)', 'Próxima revisão', 'Resumo', 'Caderno TEC']];
    e.disciplinas.forEach(d => d.topicos.forEach(t => {
      const p = acerto(t);
      const inc = plano().pctIncidencia ? plano().pctIncidencia(t.id) : null;
      linhas.push([d.nome, t.nome, t.estudado ? 'Sim' : 'Não', t.questoesFeitas || 0, t.questoesCertas || 0,
        p === null ? '' : Math.round(p), t.tempoGasto || 0, inc === null ? '' : Math.round(inc * 10) / 10,
        proximaRevisaoTexto(t), temResumo(d, t) ? 'Sim' : '', t.tecLink || '']);
    }));
    const X = window.XLSX;
    const aba = X.utils.aoa_to_sheet(linhas);
    aba['!cols'] = [{ wch: 28 }, { wch: 60 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 11 }, { wch: 13 }, { wch: 18 }, { wch: 8 }, { wch: 30 }];
    aba['!autofilter'] = { ref: aba['!ref'] };
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, aba, 'Edital');
    const blob = new Blob([X.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await gravar(blob, nomeArquivo(e, 'xlsx'), destino);
  }

  function htmlParaImprimir(e) {
    const topicos = e.disciplinas.flatMap(d => d.topicos);
    const feitos = topicos.filter(t => t.estudado).length;
    const q = topicos.reduce((a, t) => a + (t.questoesFeitas || 0), 0);
    const c = topicos.reduce((a, t) => a + (t.questoesCertas || 0), 0);
    return `
      <style>
        .ev { font-family: Arial, sans-serif; color: #111; font-size: 10pt; }
        .ev h1 { font-size: 17pt; margin: 0 0 2px; }
        .ev .sub { color: #555; margin: 0 0 14px; }
        .ev h2 { font-size: 12pt; margin: 16px 0 4px; padding: 4px 6px; background: #eef2ff; border-left: 4px solid #4f46e5; }
        .ev table { width: 100%; border-collapse: collapse; }
        .ev th { text-align: left; font-size: 8pt; color: #555; border-bottom: 1px solid #999; padding: 3px 4px; }
        .ev td { border-bottom: 1px solid #ddd; padding: 3px 4px; vertical-align: top; }
        .ev tr { page-break-inside: avoid; }
        .ev .c { width: 18px; font-size: 11pt; }
        .ev .n { text-align: right; white-space: nowrap; width: 54px; }
        .ev .d { white-space: nowrap; width: 88px; }
        .ev .ruim { color: #b91c1c; font-weight: bold; } .ev .medio { color: #a16207; } .ev .bom { color: #15803d; }
      </style>
      <div class="ev">
        <h1>${esc(e.titulo || 'Edital')}</h1>
        <p class="sub">Edital verticalizado · ${feitos} de ${topicos.length} tópicos estudados${q ? ` · acerto ${fmtPct((c / q) * 100)}` : ''} · ${fmtData(hojeStr())}</p>
        ${e.disciplinas.map(d => {
          const nv = niveis(d);
          return `
          <h2>${esc(d.nome)} (${d.topicos.filter(t => t.estudado).length}/${d.topicos.length})</h2>
          <table>
            <thead><tr><th class="c"></th><th>Tópico</th><th class="n">Questões</th><th class="n">Acerto</th><th class="n">Incid.</th><th class="d">Revisão</th></tr></thead>
            <tbody>${d.topicos.map((t, j) => {
              const p = acerto(t);
              const inc = plano().pctIncidencia ? plano().pctIncidencia(t.id) : null;
              return `<tr>
                <td class="c">${t.estudado ? '☑' : '☐'}</td>
                <td style="padding-left:${4 + (nv[j] - 1) * 14}px">${esc(t.nome)}${temResumo(d, t) ? ' ✍' : ''}</td>
                <td class="n">${t.questoesFeitas ? `${t.questoesCertas}/${t.questoesFeitas}` : ''}</td>
                <td class="n ${classeAcerto(p)}">${p === null ? '' : fmtPct(p)}</td>
                <td class="n">${inc === null ? '' : inc.toFixed(1).replace('.', ',') + '%'}</td>
                <td class="d">${proximaRevisaoTexto(t)}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>`;
        }).join('')}
      </div>`;
  }

  async function exportarPdf() {
    const e = editalAtual();
    if (!e) return;
    let destino;
    try { destino = await pasta(); } catch (err) { return; }
    aviso('Gerando o PDF…');
    try { await window.carregarHtml2pdf(); } catch (err) { aviso('Não foi possível carregar o gerador de PDF.'); return; }
    const el = document.createElement('div');
    el.innerHTML = htmlParaImprimir(e);
    const blob = await html2pdf().set({
      margin: [10, 10, 12, 10],
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', 'h2'] }
    }).from(el).outputPdf('blob');
    await gravar(blob, nomeArquivo(e, 'pdf'), destino);
  }

  /* =============================================
     INICIALIZAÇÃO
  ============================================= */
  function iniciar() {
    if (iniciado) return;
    iniciado = true;

    let t = null;
    $('est-ed-busca').addEventListener('input', ev => {
      clearTimeout(t);
      t = setTimeout(() => { busca = ev.target.value.trim(); render(); }, 180);
    });

    // Ficha lateral: criada uma vez, fora da seção (sobrepõe a página)
    const fundo = document.createElement('div');
    fundo.id = 'est-ed-ficha-fundo';
    fundo.className = 'est-ed-ficha-fundo';
    fundo.hidden = true;
    fundo.addEventListener('click', fecharFicha);
    const painel = document.createElement('aside');
    painel.id = 'est-ed-ficha';
    painel.className = 'est-ed-ficha';
    painel.hidden = true;
    painel.setAttribute('role', 'dialog');
    painel.setAttribute('aria-modal', 'true');
    painel.setAttribute('aria-labelledby', 'est-ed-ficha-titulo');
    painel.innerHTML = '<div id="est-ed-ficha-conteudo"></div>';
    document.body.append(fundo, painel);

    // Captura: roda antes do Esc do v5, que fecha os modais; com um modal aberto, o Esc é dele
    document.addEventListener('keydown', ev => {
      if (ev.key !== 'Escape' || !ficha) return;
      if (document.querySelector('.est-modal-overlay.active')) return;
      fecharFicha();
    }, true);
  }

  window.estEdital = {
    render, alternarDisc, abrirTodas, filtrar, limparFiltros,
    abrirFicha, fecharFicha, editarTec, renomearTopico, renomearDisc, excluirTopico,
    exportarExcel, exportarPdf
  };
})();
