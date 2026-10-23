/* ─── js/estudos.incidencia.js — Incidência de assuntos (planilha do TEC Concursos) ───
 *
 * Lê a planilha "Índice do Caderno" exportada pelo TEC (colunas Índice/Assunto e
 * Quantidade), liga cada assunto a um tópico do edital por semelhança de texto e,
 * depois da revisão, grava quantas questões caíram em cada tópico. O planejamento
 * (estudos.plano.js) usa esses números para ordenar os tópicos e dosar o tempo.
 *
 * A planilha é lida no navegador com o SheetJS, carregado só quando usado.
 */
(function () {
  const XLSX_URL = window.EST_XLSX_URL || 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  const PARADAS = new Set(('a o e de da do das dos em no na nos nas ao aos à às por para com sem sob sobre ou um uma ' +
    'seu sua seus suas lei leis art arts n nº no decreto e/ou etc outros outras assuntos topicos mesclados ' +
    'jurisprudencia tribunais superiores dispoe disposicoes gerais legislacao pertinente suas alteracoes').split(' '));
  const APELIDOS = { lgpd: 'lei13709', lai: 'lei12527' };

  let carregando = null;
  let ctx = null;   // { edital, disc, assuntos: [{assunto, questoes, topicoId}] }

  const $ = id => document.getElementById(id);

  function carregarXlsx() {
    if (window.XLSX) return Promise.resolve();
    if (!carregando) {
      carregando = new Promise((ok, falha) => {
        const s = document.createElement('script');
        s.src = XLSX_URL;
        s.onload = ok;
        s.onerror = () => { carregando = null; falha(new Error('Não foi possível baixar o leitor de planilhas.')); };
        document.head.appendChild(s);
      });
    }
    return carregando;
  }

  /* =============================================
     PLANILHA → ASSUNTOS
  ============================================= */
  const semAcento = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  async function lerPlanilha(arquivo) {
    await carregarXlsx();
    const wb = window.XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
    const aba = wb.Sheets[wb.SheetNames[0]];
    // O TEC grava a dimensão da aba como "A1:D1" (só o cabeçalho); recalcula pelo que existe de fato
    const celulas = Object.keys(aba).filter(k => k[0] !== '!').map(k => window.XLSX.utils.decode_cell(k));
    if (celulas.length) {
      aba['!ref'] = window.XLSX.utils.encode_range({
        s: { r: Math.min(...celulas.map(c => c.r)), c: Math.min(...celulas.map(c => c.c)) },
        e: { r: Math.max(...celulas.map(c => c.r)), c: Math.max(...celulas.map(c => c.c)) }
      });
    }
    const linhas = window.XLSX.utils.sheet_to_json(aba, { header: 1, defval: '' });

    // Acha o cabeçalho pelos nomes das colunas, sem depender da posição
    let ini = linhas.findIndex(l => l.some(c => /quantidade|questoes/.test(semAcento(c))));
    let colQ, colA, colH;
    if (ini >= 0) {
      const cab = linhas[ini].map(semAcento);
      colQ = cab.findIndex(c => /quantidade|questoes/.test(c));
      colA = cab.findIndex(c => /indice|assunto/.test(c));
      colH = cab.findIndex(c => /hierarquia/.test(c));
    } else {
      ini = -1; colA = 0; colQ = 1; colH = -1;
    }

    const porNome = new Map();
    linhas.slice(ini + 1).forEach(l => {
      let assunto = colA >= 0 ? String(l[colA] || '').trim() : '';
      if (!assunto && colH >= 0) assunto = String(l[colH] || '').split(/[>»/]/).pop().trim();
      const q = parseFloat(String(l[colQ]).replace(',', '.'));
      if (!assunto || !(q > 0)) return;
      porNome.set(assunto, (porNome.get(assunto) || 0) + q);
    });
    return [...porNome].map(([assunto, questoes]) => ({ assunto, questoes })).sort((a, b) => b.questoes - a.questoes);
  }

  /* =============================================
     ASSUNTO → TÓPICO (semelhança de texto)
  ============================================= */
  function radical(p) {
    if (/^lei\d+$/.test(p) || /^\d+$/.test(p)) return p;
    for (const suf of ['coes', 'cao', 'oes', 'mente', 'idade', 'ais', 'eis', 'es', 's']) {
      if (p.length - suf.length >= 3 && p.endsWith(suf)) { p = p.slice(0, -suf.length); break; }   // "atos" → "ato"
    }
    return p.slice(0, 6);
  }

  function termos(texto) {
    const t = semAcento(texto)
      .replace(/(\d{1,2})\.(\d{3})(\/\d{2,4})?/g, ' lei$1$2 ')   // 14.133/2021 → lei14133
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map(p => APELIDOS[p] || p)
      .filter(p => !PARADAS.has(p) && (p.length > 2 || /^lei\d/.test(p)));
    return [...new Set(t.map(radical))];
  }

  function montarComparador(topicos) {
    const docs = topicos.map(t => {
      // Notas de retificação e endereços do edital ("...cebraspe.org.br/concursos...") só atrapalham
      const nome = t.nome.replace(/https?:\/\/\S+/g, ' ').replace(/\((retificad|alterad|incluíd|incluid)[^)]*\)/gi, ' ');
      const [titulo] = nome.split(':');
      return { id: t.id, todos: new Set(termos(nome)), titulo: new Set(termos(titulo)) };
    });
    const df = {};
    docs.forEach(d => d.todos.forEach(p => { df[p] = (df[p] || 0) + 1; }));
    const idf = p => Math.log((docs.length + 1) / ((df[p] || 0) + 0.5));
    return assunto => {
      const ts = termos(assunto);
      let melhor = null, nota = 0;
      docs.forEach(d => {
        let s = 0;
        ts.forEach(p => {
          if (!d.todos.has(p)) return;
          let peso = idf(p);
          if (/^lei\d/.test(p)) peso *= 2;          // número de lei identifica bem o tópico
          if (d.titulo.has(p)) peso *= 1.5;          // palavra do título do tópico vale mais
          s += peso;
        });
        if (s > nota) { nota = s; melhor = d.id; }
      });
      return nota >= 1 ? melhor : '';
    };
  }

  /* =============================================
     TELA DE REVISÃO
  ============================================= */
  const chaveMemoria = discId => 'est_inc_mapa_' + discId;

  function lerMemoria(discId) {
    try { return JSON.parse(localStorage.getItem(chaveMemoria(discId))) || {}; } catch { return {}; }
  }

  function salvarMemoria(discId) {
    try {
      const m = {};
      ctx.assuntos.forEach(a => { m[semAcento(a.assunto)] = a.topicoId; });
      localStorage.setItem(chaveMemoria(discId), JSON.stringify(m));
    } catch { /* só conveniência */ }
  }

  function nomeCurto(t, max = 70) {
    return t.nome.length > max ? t.nome.slice(0, max - 1) + '…' : t.nome;
  }

  function abrir(editalId, discId) {
    const edital = editaisData.find(e => e.id === editalId);
    const disc = edital && edital.disciplinas.find(d => d.id === discId);
    if (!disc) return;
    ctx = { edital, disc, assuntos: [] };
    $('est-inc-titulo').textContent = `Incidência do TEC — ${disc.nome}`;
    $('est-inc-arquivo').value = '';
    $('est-inc-revisao').style.display = 'none';
    $('est-inc-salvar').disabled = true;
    const atual = window.estPlano.incidenciaDaDisciplina(disc);
    status(atual
      ? `Esta disciplina já tem incidência de ${atual.soma} questões. Importe outra planilha para substituir.`
      : 'No TEC, gere um caderno com os filtros (disciplina, banca, anos) e baixe o Excel do índice do caderno.');
    $('est-modal-incidencia').classList.add('active');
  }

  function fechar() {
    $('est-modal-incidencia').classList.remove('active');
    ctx = null;
  }

  function status(msg, erro) {
    const el = $('est-inc-status');
    el.textContent = msg;
    el.classList.toggle('erro', !!erro);
  }

  async function lerArquivo(arquivo) {
    if (!arquivo || !ctx) return;
    status('Lendo a planilha…');
    try {
      const assuntos = await lerPlanilha(arquivo);
      if (!assuntos.length) { status('Não encontrei assuntos com quantidade de questões nesta planilha.', true); return; }
      const comparar = montarComparador(ctx.disc.topicos);
      const memoria = lerMemoria(ctx.disc.id);
      const ids = new Set(ctx.disc.topicos.map(t => t.id));
      ctx.assuntos = assuntos.map(a => {
        const lembrado = memoria[semAcento(a.assunto)];
        return { ...a, topicoId: lembrado !== undefined && (lembrado === '' || ids.has(lembrado)) ? lembrado : comparar(a.assunto) };
      });
      const total = assuntos.reduce((s, a) => s + a.questoes, 0);
      const ligados = ctx.assuntos.filter(a => a.topicoId).length;
      status(`${assuntos.length} assuntos e ${total} questões lidos. ${ligados} assuntos ligados automaticamente a tópicos do edital: confira abaixo.`);
      $('est-inc-revisao').style.display = '';
      $('est-inc-salvar').disabled = false;
      renderRevisao();
    } catch (e) {
      console.error('Erro ao ler planilha:', e);
      status('Não foi possível ler a planilha. Detalhe: ' + (e.message || e), true);
    }
  }

  function renderRanking() {
    const porTopico = {};
    ctx.assuntos.forEach(a => { if (a.topicoId) porTopico[a.topicoId] = (porTopico[a.topicoId] || 0) + a.questoes; });
    // % sobre as questões ligadas a tópicos, a mesma base usada no planejamento
    const fora = ctx.assuntos.filter(a => !a.topicoId).reduce((s, a) => s + a.questoes, 0);
    const total = ctx.assuntos.reduce((s, a) => s + a.questoes, 0) - fora;
    const lista = ctx.disc.topicos.map(t => ({ t, q: porTopico[t.id] || 0 })).sort((a, b) => b.q - a.q);
    const max = Math.max(1, ...lista.map(x => x.q));
    $('est-inc-ranking').innerHTML = lista.map((x, i) => `
      <div class="est-inc-rank ${x.q ? '' : 'zero'}">
        <span class="est-inc-pos">${i + 1}º</span>
        <span class="est-inc-nome" title="${escapeHtml(x.t.nome)}">${escapeHtml(nomeCurto(x.t, 90))}</span>
        <span class="est-inc-num">${x.q} <small>${total ? (x.q / total * 100).toFixed(1).replace('.', ',') : 0}%</small></span>
        <div class="est-inc-barra"><div style="width:${x.q / max * 100}%"></div></div>
      </div>`).join('') +
      (fora ? `<p class="est-plano-sub" style="margin-top:8px;">${fora} questões ficaram em assuntos fora do edital e não entram na conta.</p>` : '');
  }

  function renderRevisao() {
    const opcoes = ['<option value="">— Não está no edital —</option>']
      .concat(ctx.disc.topicos.map(t => `<option value="${t.id}">${escapeHtml(nomeCurto(t, 60))}</option>`)).join('');
    $('est-inc-assuntos').innerHTML = ctx.assuntos.map((a, i) => `
      <div class="est-inc-assunto ${a.topicoId ? '' : 'solto'}">
        <span class="est-inc-assunto-nome">${escapeHtml(a.assunto)}</span>
        <span class="est-inc-num">${a.questoes}</span>
        <select class="est-form-select" data-i="${i}" aria-label="Tópico do edital para ${escapeHtml(a.assunto)}">${opcoes}</select>
      </div>`).join('');
    $('est-inc-assuntos').querySelectorAll('select').forEach(sel => { sel.value = ctx.assuntos[sel.dataset.i].topicoId; });
    renderRanking();
  }

  async function salvar() {
    if (!ctx) return;
    const porTopico = {};
    ctx.assuntos.forEach(a => { if (a.topicoId) porTopico[a.topicoId] = (porTopico[a.topicoId] || 0) + a.questoes; });
    salvarMemoria(ctx.disc.id);
    $('est-inc-salvar').disabled = true;
    await window.estPlano.salvarIncidencias(ctx.edital, ctx.disc, porTopico);
    fechar();
  }

  function init() {
    if (!$('est-modal-incidencia')) return;
    $('est-inc-arquivo').addEventListener('change', e => lerArquivo(e.target.files[0]));
    $('est-inc-assuntos').addEventListener('change', e => {
      const sel = e.target.closest('select');
      if (!sel || !ctx) return;
      ctx.assuntos[sel.dataset.i].topicoId = sel.value;
      sel.closest('.est-inc-assunto').classList.toggle('solto', !sel.value);
      renderRanking();
    });
    $('est-inc-salvar').addEventListener('click', salvar);
    $('est-inc-cancelar').addEventListener('click', fechar);
    $('est-modal-incidencia-close').addEventListener('click', fechar);
    $('est-modal-incidencia').addEventListener('click', e => { if (e.target.id === 'est-modal-incidencia') fechar(); });
  }

  document.addEventListener('DOMContentLoaded', init);

  window.estIncidencia = { abrir, lerPlanilha, montarComparador, termos };
})();
