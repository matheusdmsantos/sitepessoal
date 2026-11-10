/* ─── js/estudos.subtopicos.js — Assuntos (subtópicos) dos itens do edital ───
 *
 * Disciplina → item do edital (tabela topicos) → assunto. Os assuntos são criados à mão, aos
 * poucos: na coluna "Assuntos" da janela de estudo (estudos.sessao.js), na ficha do item
 * (Edital Verticalizado) ou na tela de PDFs. Nada é sugerido nem criado sozinho; a única criação
 * automática é a das páginas que já existiam no resumo (migração: cada página vira um assunto).
 *
 * O resumo de um assunto é a página com o mesmo nome no resumo do item (tabela resumos; cada
 * página começa com <h1 class="est-pagina">): não há outra estrutura. Aqui (tabela subtopicos)
 * ficam o nome, a ordem, o caderno do TEC e os PDFs onde o assunto aparece ({ material_id, de, ate }).
 * Tempo e questões de cada assunto ficam na sessão (sessoes.assuntos); o erro guarda subtopico_id.
 * "Sem subtópico" de um item = totais do item − soma dos assuntos.
 *
 * Sem a tabela, os assuntos ficam neste navegador (est_plano_subtopicos) e sobem quando ela existir.
 * Sem as colunas sessoes.assuntos / erros.subtopico_id, a divisão por assunto fica desligada.
 * Carregado por estPlano.init (depois dos editais, resumos e PDFs).
 */
(function () {
  const sb = window.supabaseClient;
  const LOCAL = 'est_plano_subtopicos';
  // Palavras que não mudam o assunto: "Uso do hífen" é parecido com "Hífen"
  const VAZIAS = new Set(['uso', 'emprego', 'do', 'da', 'dos', 'das', 'de', 'o', 'a', 'os', 'as', 'e', 'em', 'no', 'na', 'nos', 'nas', 'um', 'uma']);
  const MIN_Q = 5;          // questões para o acerto de um assunto entrar na comparação
  const ACERTO_FRACO = 70;  // abaixo disso o assunto é destacado (o mesmo limite do reforço)

  let subs = [];            // { id, edital_id, disciplina_id, topico_id, nome, ordem, tec_link, pdfs }
  let remoto = false;
  let temSessoes = false;   // coluna sessoes.assuntos existe?
  let temErros = false;     // coluna erros.subtopico_id existe?
  let painel = null;        // ficha do item: { tId, tipo: 'mesclar' | 'reclassificar', de? }
  let visao = null;         // card de desempenho: null (disciplinas) | { dId, tId? }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const novoId = () => 'sub_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const chave = s => String(s || '').trim().toLowerCase();
  const semAcento = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '');
  // Forma de comparar nomes parecidos: sem acento, maiúsculas, "uso do" e plural
  const base = s => semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter(w => w && !VAZIAS.has(w)).map(w => (w.length > 3 ? w.replace(/s$/, '') : w)).join(' ');
  const vazio = html => !/<img|<table|<iframe/i.test(html || '') && !String(html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  const aviso = msg => (window.estPlano ? window.estPlano.aviso(msg) : alert(msg));
  const fmtMin = min => (window.estPlano ? window.estPlano.fmtMin(min) : `${min} min`);
  const curto = (s, max = 80) => (s.length > max ? s.slice(0, max - 1) + '…' : s);
  const pct = n => (n.q ? Math.round(n.c / n.q * 100) : null);
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

  /* =============================================
     DADOS
  ============================================= */
  function lerLocal() {
    try { return JSON.parse(localStorage.getItem(LOCAL)) || []; } catch { return []; }
  }

  function salvarLocal() {
    try { localStorage.setItem(LOCAL, JSON.stringify(subs)); } catch (e) { console.warn('Sem espaço para guardar os assuntos neste navegador.', e); }
  }

  async function carregar() {
    const [r, rs, re] = await Promise.all([
      sb.from('subtopicos').select('*'),
      sb.from('sessoes').select('assuntos').limit(1),
      sb.from('erros').select('subtopico_id').limit(1)
    ]);
    temSessoes = !rs.error;
    temErros = !re.error;
    if (r.error) {
      console.warn('Tabela subtopicos indisponível; os assuntos ficam só neste navegador. Rode supabase/subtopicos.sql.', r.error);
      remoto = false;
      subs = lerLocal();
    } else {
      remoto = true;
      subs = r.data || [];
      // Envia o que tinha sido guardado só aqui antes de a tabela existir
      const locais = lerLocal().filter(l => !subs.some(x => x.id === l.id));
      if (locais.length) {
        const up = await sb.from('subtopicos').upsert(locais.map(({ dono, ...l }) => l));
        if (!up.error) { subs.push(...locais); localStorage.removeItem(LOCAL); }
      } else {
        localStorage.removeItem(LOCAL);
      }
    }
    subs.forEach(s => { if (!Array.isArray(s.pdfs)) s.pdfs = []; });
    await migrar();
  }

  async function gravar(linhas) {
    const lista = [].concat(linhas);
    if (!lista.length) return true;
    if (!remoto) { salvarLocal(); return true; }
    const { error } = await sb.from('subtopicos').upsert(lista.map(({ dono, ...l }) => l));
    if (error) {
      console.error('Erro ao salvar assuntos:', error);
      aviso('Não foi possível salvar o assunto no servidor. Confira sua conexão.');
      return false;
    }
    return true;
  }

  async function apagarLinha(id) {
    subs = subs.filter(s => s.id !== id);
    if (!remoto) { salvarLocal(); return; }
    const { error } = await sb.from('subtopicos').delete().eq('id', id);
    if (error) console.error('Erro ao apagar assunto:', error);
  }

  function acharTopico(tId) {
    for (const e of editaisData) for (const d of e.disciplinas) {
      const t = d.topicos.find(x => x.id === tId);
      if (t) return { e, d, t };
    }
    return null;
  }

  // Janela aberta pelo nome (Meus Resumos, ficha): o item com esses nomes, de preferência no edital ativo
  function topicoPorNomes(disc, topico) {
    const ordem = editaisData.slice().sort((a, b) => (b.id === currentEditalId) - (a.id === currentEditalId));
    for (const e of ordem) {
      const d = e.disciplinas.find(x => chave(x.nome) === chave(disc));
      const t = d && d.topicos.find(x => chave(x.nome) === chave(topico));
      if (t) return t.id;
    }
    return null;
  }

  const doTopico = tId => subs.filter(s => s.topico_id === tId).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
  const porId = id => subs.find(s => s.id === id) || null;
  // O assunto de um registro só vale se for do mesmo item (o que veio de outro edital fica "sem subtópico")
  const doRegistro = (tId, subId) => { const s = subId ? porId(subId) : null; return s && s.topico_id === tId ? s : null; };
  const errosDo = tId => (window.estErros && window.estErros.todos ? window.estErros.todos() : []).filter(er => er.topico_id === tId);
  const pdfsDoTopico = ref => (window.estPlano ? window.estPlano.materiaisDaDisciplina(ref.d.id) : [])
    .filter(m => (m.topicos || []).some(l => l.topico_id === ref.t.id)).map(m => m.id);

  /* Nome já usado no item (exato, sem diferença de maiúsculas) ou parecido (acento, "uso do", plural) */
  function sugestao(tId, nome, exceto) {
    const n = chave(nome), b = base(nome);
    const lista = doTopico(tId).filter(s => s.id !== exceto);
    return {
      exato: n ? lista.find(s => chave(s.nome) === n) || null : null,
      parecido: b ? lista.find(s => chave(s.nome) !== n && base(s.nome) === b) || null : null
    };
  }

  /* =============================================
     RESUMO DO ITEM (as páginas são os assuntos)
  ============================================= */
  function docDo(ref) {
    const r = resumosMap[makeResumoKey(ref.d.nome, ref.t.nome)];
    return window.estSessao.separarPaginas((r && r.conteudo) || '');
  }

  async function gravarDoc(ref, paginas) {
    await salvarResumo(ref.d.nome, ref.t.nome, window.estSessao.juntarPaginas(paginas), true);
  }

  const paginaDe = (paginas, nome) => paginas.find(p => !p.semTitulo && chave(p.titulo) === chave(nome));

  // Assuntos que faltam para as páginas com título do resumo. Item com um PDF só: já ligados a ele.
  function novasDasPaginas(ref, paginas) {
    const existentes = doTopico(ref.t.id);
    let ordem = existentes.reduce((m, s) => Math.max(m, s.ordem), -1);
    const pdfs = pdfsDoTopico(ref);
    const novos = [];
    paginas.forEach(p => {
      if (p.semTitulo || [...existentes, ...novos].some(s => chave(s.nome) === chave(p.titulo))) return;
      novos.push({
        id: novoId(), edital_id: ref.e.id, disciplina_id: ref.d.id, topico_id: ref.t.id, nome: p.titulo.trim(),
        ordem: ++ordem, tec_link: '', pdfs: pdfs.length === 1 ? [{ material_id: pdfs[0], de: null, ate: null }] : []
      });
    });
    return novos;
  }

  /* Migração: as páginas que já existiam nos resumos do edital viram assuntos do item.
     Roda a cada carga e só cria o que falta, então também cobre resumos copiados de outro edital. */
  async function migrar() {
    const novos = [];
    editaisData.filter(e => e.status !== 'desativado').forEach(e => e.disciplinas.forEach(d => d.topicos.forEach(t => {
      const r = resumosMap[makeResumoKey(d.nome, t.nome)];
      if (!r || !r.conteudo || !r.conteudo.includes('est-pagina')) return;
      const lista = novasDasPaginas({ e, d, t }, window.estSessao.separarPaginas(r.conteudo));
      subs.push(...lista);
      novos.push(...lista);
    })));
    if (novos.length) await gravar(novos);
  }

  /* Janela de estudo: liga cada página ao assunto de mesmo nome (criando o que faltar), soma o
     conteúdo de páginas repetidas e põe as páginas na ordem dos assuntos. Devolve a lista nova
     (a primeira é sempre a das anotações gerais, sem assunto). */
  function ligarPaginas(tId, paginas) {
    const ref = acharTopico(tId);
    if (!ref) return paginas;
    const novos = novasDasPaginas(ref, paginas);
    if (novos.length) { subs.push(...novos); gravar(novos); }
    const lista = doTopico(tId);
    const geral = paginas.find(p => p.semTitulo) || { titulo: 'Anotações', html: '', semTitulo: true };
    const porSub = new Map();
    const soltas = [];
    paginas.filter(p => !p.semTitulo).forEach(p => {
      const s = lista.find(x => chave(x.nome) === chave(p.titulo));
      if (!s) { soltas.push(p); return; }   // não acontece; se acontecer, a página não se perde
      const ja = porSub.get(s.id);
      if (ja) ja.html = (vazio(ja.html) ? '' : ja.html) + p.html;
      else porSub.set(s.id, { ...p, titulo: s.nome, sub: s.id });
    });
    return [geral, ...lista.filter(s => porSub.has(s.id)).map(s => porSub.get(s.id)), ...soltas];
  }

  /* =============================================
     OPERAÇÕES
  ============================================= */
  async function criar(tId, nome, materialIds = []) {
    const ref = acharTopico(tId);
    nome = String(nome || '').trim();
    if (!ref || !nome) return null;
    const ja = sugestao(tId, nome).exato;
    if (ja) { await vincular(ja.id, materialIds); return ja; }
    const s = {
      id: novoId(), edital_id: ref.e.id, disciplina_id: ref.d.id, topico_id: tId, nome,
      ordem: doTopico(tId).reduce((m, x) => Math.max(m, x.ordem), -1) + 1, tec_link: '',
      pdfs: [...new Set(materialIds)].map(id => ({ material_id: id, de: null, ate: null }))
    };
    subs.push(s);
    await gravar(s);
    return s;
  }

  async function vincular(id, materialIds) {
    const s = porId(id);
    const novos = s ? [...new Set(materialIds)].filter(m => m && !s.pdfs.some(p => p.material_id === m)) : [];
    if (!novos.length) return;
    s.pdfs = [...s.pdfs, ...novos.map(m => ({ material_id: m, de: null, ate: null }))];
    await gravar(s);
  }

  async function desvincular(id, materialIds) {
    const s = porId(id);
    if (!s) return;
    s.pdfs = s.pdfs.filter(p => !materialIds.includes(p.material_id));
    await gravar(s);
  }

  // Faixa opcional de páginas do assunto num PDF
  async function faixa(id, materialId, de, ate) {
    const s = porId(id);
    const p = s && s.pdfs.find(x => x.material_id === materialId);
    if (!p) return;
    p.de = de > 0 ? de : null;
    p.ate = ate > 0 ? ate : null;
    await gravar(s);
  }

  async function definirTec(id, link) {
    const s = porId(id);
    if (!s || (s.tec_link || '') === link) return;
    s.tec_link = link;
    await gravar(s);
  }

  /* Link do caderno do TEC colado pelo usuário: o endereço ou o código de incorporação do TEC (fica só o src).
     Devolve '' (sem link), o endereço, ou null se não for http/https. */
  function linkDoCaderno(v) {
    v = String(v || '').trim();
    const src = v.match(/<iframe[^>]*\ssrc="(https?:\/\/[^"]+)"/i);
    if (src) v = src[1];
    return !v || /^https?:\/\//i.test(v) ? v : null;
  }

  // Ficha do item: colar ou trocar o caderno do TEC de um assunto
  async function editarTec(id) {
    const s = porId(id);
    if (!s) return;
    const v = await window.customPrompt(`Link do caderno do TEC de “${s.nome}” (o endereço ou o código de incorporação; vazio tira o link):`, s.tec_link || '');
    if (v === null) return;
    const link = linkDoCaderno(v);
    if (link === null) { aviso('Cole o endereço completo do caderno (começa com https://).'); return; }
    await definirTec(id, link);
    redesenhar();
  }

  /* Renomeia o assunto e a página dele no resumo do item. comDoc = false quando quem renomeia é a
     janela de estudo (ela grava a página com o nome novo). false se o nome já é de outro assunto. */
  async function renomear(id, nome, comDoc = true) {
    const s = porId(id);
    nome = String(nome || '').trim();
    if (!s || !nome) return false;
    if (nome === s.nome) return true;
    if (sugestao(s.topico_id, nome, s.id).exato) { aviso(`Já existe o assunto “${nome}” neste item.`); return false; }
    const antigo = s.nome;
    s.nome = nome;
    await gravar(s);
    const ref = comDoc && acharTopico(s.topico_id);
    if (ref) {
      const pags = docDo(ref);
      const p = paginaDe(pags, antigo);
      if (p) { p.titulo = nome; await gravarDoc(ref, pags); }
    }
    return true;
  }

  // Troca o assunto de lugar (↑↓) e reordena as páginas do resumo, que seguem a ordem dos assuntos
  async function mover(id, delta) {
    const s = porId(id);
    if (!s) return;
    const lista = doTopico(s.topico_id);
    const i = lista.indexOf(s), j = i + delta;
    if (j < 0 || j >= lista.length) return;
    [lista[i], lista[j]] = [lista[j], lista[i]];
    lista.forEach((x, k) => { x.ordem = k; });
    await gravar(lista);
    const ref = acharTopico(s.topico_id);
    const r = ref && resumosMap[makeResumoKey(ref.d.nome, ref.t.nome)];
    if (r && r.conteudo) await gravarDoc(ref, ligarPaginas(ref.t.id, docDo(ref)));
    redesenhar();
  }

  // Muda os assuntos das sessões escolhidas e grava (só o campo assuntos)
  async function trocarNasSessoes(filtro, novo) {
    const alvo = studyData.filter(filtro);
    for (const s of alvo) {
      s.assuntos = novo(s);
      if (temSessoes) {
        const { error } = await sb.from('sessoes').update({ assuntos: s.assuntos }).eq('id', s.id);
        if (error) console.error('Erro ao atualizar a sessão:', error);
      }
    }
    if (alvo.length) saveData();
  }

  /* Junta o assunto "de" no "para": resumo (um embaixo do outro), PDFs, link do TEC, erros,
     tempo e questões. O "de" deixa de existir. */
  async function mesclar(deId, paraId) {
    const de = porId(deId), para = porId(paraId);
    if (!de || !para || de === para || de.topico_id !== para.topico_id) return false;
    const ref = acharTopico(de.topico_id);
    if (ref) {
      const pags = docDo(ref);
      const pd = paginaDe(pags, de.nome);
      if (pd) {
        let pp = paginaDe(pags, para.nome);
        if (!pp) { pp = { titulo: para.nome, html: '', semTitulo: false }; pags.splice(pags.indexOf(pd), 0, pp); }
        if (!vazio(pd.html)) pp.html = (vazio(pp.html) ? '' : pp.html) + pd.html;
        pags.splice(pags.indexOf(pd), 1);
        await gravarDoc(ref, pags);
      }
    }
    de.pdfs.forEach(p => { if (!para.pdfs.some(x => x.material_id === p.material_id)) para.pdfs.push(p); });
    if (!para.tec_link && de.tec_link) para.tec_link = de.tec_link;
    await gravar(para);
    await trocarNasSessoes(s => (s.assuntos || []).some(a => a.subtopico_id === deId), s => {
      const lista = [];
      s.assuntos.forEach(a => {
        const id = a.subtopico_id === deId ? paraId : a.subtopico_id;
        const ja = lista.find(x => x.subtopico_id === id);
        if (ja) ['minutos', 'questoes', 'acertos'].forEach(k => { ja[k] = (ja[k] || 0) + (a[k] || 0); });
        else lista.push({ ...a, subtopico_id: id });
      });
      return lista;
    });
    const errosDe = errosDo(de.topico_id).filter(er => er.subtopico_id === deId).map(er => er.id);
    if (errosDe.length) await window.estErros.mudarAssunto(errosDe, paraId);
    await apagarLinha(deId);
    return true;
  }

  // Move para um assunto as sessões e os erros que estavam sem subtópico
  async function reclassificar(paraId, sessaoIds, erroIds) {
    const ids = new Set(sessaoIds);
    await trocarNasSessoes(s => ids.has(s.id), s => [{
      subtopico_id: paraId, minutos: s.timeMinutes || 0, questoes: s.questionsTotal || 0, acertos: s.questionsCorrect || 0
    }]);
    if (erroIds.length) await window.estErros.mudarAssunto(erroIds, paraId);
  }

  /* =============================================
     NÚMEROS
  ============================================= */
  /* Números de cada assunto do item e do que ficou sem subtópico. Questões, acertos e tempo vêm das
     sessões (sessoes.assuntos); erros, do caderno; "sem subtópico" = total do item − soma dos assuntos
     (inclui o que foi lançado só no total, como "Registrar questões" e "Corrigir totais"). */
  function numeros(t) {
    const por = new Map(doTopico(t.id).map(s => [s.id, { s, q: 0, c: 0, min: 0, erros: 0 }]));
    const sem = { sessoes: [], errosLista: [] };
    studyData.filter(x => x.topicId === t.id).forEach(x => {
      const partes = (x.assuntos || []).filter(a => por.has(a.subtopico_id));
      partes.forEach(a => {
        const n = por.get(a.subtopico_id);
        n.q += a.questoes || 0; n.c += a.acertos || 0; n.min += a.minutos || 0;
      });
      if (!partes.length) sem.sessoes.push(x);
    });
    errosDo(t.id).forEach(er => {
      const s = doRegistro(t.id, er.subtopico_id);
      if (s) por.get(s.id).erros++; else sem.errosLista.push(er);
    });
    const assuntos = [...por.values()];
    const soma = k => assuntos.reduce((a, n) => a + n[k], 0);
    sem.q = Math.max(0, (t.questoesFeitas || 0) - soma('q'));
    sem.c = Math.min(sem.q, Math.max(0, (t.questoesCertas || 0) - soma('c')));
    sem.min = Math.max(0, (t.tempoGasto || 0) - soma('min'));
    sem.erros = sem.errosLista.length;
    return { assuntos, sem };
  }

  function numerosDe(tId) {
    const ref = acharTopico(tId);
    return ref ? numeros(ref.t) : { assuntos: [], sem: { q: 0, c: 0, min: 0, erros: 0, sessoes: [], errosLista: [] } };
  }

  /* Meta de questões (opção A): quantas questões fazer em cada assunto do item. Mais para os de pior
     acerto e para os que ainda não têm questões; a soma é sempre o total. Devolve { [id]: n }. */
  function distribuir(tId, total) {
    const ns = numerosDe(tId).assuntos;
    if (!ns.length || !(total > 0)) return {};
    const peso = n => (n.q ? Math.max(0, 1 - n.c / n.q) + 0.25 : 1);
    const somaPesos = ns.reduce((a, n) => a + peso(n), 0);
    const cotas = ns.map(n => ({ id: n.s.id, v: total * peso(n) / somaPesos }));
    const r = Object.fromEntries(cotas.map(c => [c.id, Math.floor(c.v)]));
    let falta = total - Object.values(r).reduce((a, v) => a + v, 0);
    cotas.sort((a, b) => (b.v % 1) - (a.v % 1)).forEach(c => { if (falta > 0) { r[c.id]++; falta--; } });
    return r;
  }

  /* =============================================
     FICHA DO ITEM (Edital Verticalizado): cadastro, mesclar e reclassificar
  ============================================= */
  function selo(tId) {
    const n = doTopico(tId).length;
    return n ? `<span class="est-ed-selo" title="${plural(n, 'assunto', 'assuntos')} (subtópicos)">🧩 ${n}</span>` : '';
  }

  const redesenhar = () => { if (window.estEdital) window.estEdital.render(); };
  const opcoesAssuntos = (lista, sel) => lista.map(n => `<option value="${n.s.id}" ${n.s.id === sel ? 'selected' : ''}>${esc(n.s.nome)}</option>`).join('');

  // Páginas do assunto no PDF do item (só com um PDF; com vários, na tela de PDFs): cortam as metas do plano
  function campoPaginas(s, m) {
    if (!m) return '';
    const p = s.pdfs.find(x => x.material_id === m.id) || {};
    const campo = (k, v, rot) => `<input type="number" min="1" max="${m.paginas || ''}" data-k="${k}" value="${v || ''}" placeholder="pág."
      aria-label="${rot} de ${esc(s.nome)} no PDF" onchange="estSub.paginasNoPdf('${s.id}', '${m.id}', this.parentNode)" />`;
    return `<span class="est-sub-pags" title="Páginas do assunto no PDF: as metas de estudo e de questões seguem esses assuntos">📄 p. ${campo('de', p.de, 'Página inicial')} a ${campo('ate', p.ate, 'Página final')}</span>`;
  }

  async function paginasNoPdf(id, materialId, caixa) {
    const v = k => parseInt(caixa.querySelector(`[data-k="${k}"]`).value, 10) || 0;
    const de = v('de'), ate = v('ate');
    if (de && ate && ate < de) { aviso('A página final tem de vir depois da inicial.'); return; }
    await vincular(id, [materialId]);
    await faixa(id, materialId, de, ate);
    if (window.estPlano) window.estPlano.renderTudo();
  }

  function blocoFicha(e, d, t) {
    const { assuntos, sem } = numeros(t);
    const pdfsItem = window.estPlano ? window.estPlano.materiaisDaDisciplina(d.id).filter(m => (m.topicos || []).some(l => l.topico_id === t.id)) : [];
    const pdfUnico = pdfsItem.length === 1 ? pdfsItem[0] : null;
    const linhas = assuntos.map((n, i) => {
      const p = pct(n);
      return `<li>
        <span class="est-sub-nome">${esc(n.s.nome)}</span>
        <span class="est-sub-nums">
          <span title="PDFs onde o assunto aparece">📄 ${n.s.pdfs.length}</span>
          <span title="Erros registrados no caderno">❌ ${n.erros}</span>
          <span class="est-plano-acerto ${p === null ? '' : p < ACERTO_FRACO ? 'ruim' : p < 85 ? 'medio' : 'bom'}" title="${n.c} certas de ${n.q} questões">${p === null ? 'sem questões' : `${p}% · ${n.c}/${n.q}`}</span>
        </span>
        <span class="est-sub-acoes">
          <button type="button" class="est-plano-btn sutil" onclick="estSub.mover('${n.s.id}', -1)" ${i ? '' : 'disabled'} aria-label="Subir ${esc(n.s.nome)}">↑</button>
          <button type="button" class="est-plano-btn sutil" onclick="estSub.mover('${n.s.id}', 1)" ${i < assuntos.length - 1 ? '' : 'disabled'} aria-label="Descer ${esc(n.s.nome)}">↓</button>
          <button type="button" class="est-plano-btn sutil" onclick="estSub.renomearPerguntando('${n.s.id}')" aria-label="Renomear ${esc(n.s.nome)}" title="Renomear">✎</button>
          <button type="button" class="est-plano-btn sutil" onclick="estSub.excluir('${n.s.id}')" aria-label="Excluir ${esc(n.s.nome)}" title="Excluir">✕</button>
        </span>
        <span class="est-sub-tec">${campoPaginas(n.s, pdfUnico)}${n.s.tec_link
          ? `<a href="${esc(n.s.tec_link)}" target="_blank" rel="noopener" class="est-ed-tec-link">Abrir caderno ↗</a><button type="button" class="est-ed-link" onclick="estSub.editarTec('${n.s.id}')">Alterar link</button>`
          : `<button type="button" class="est-ed-link" onclick="estSub.editarTec('${n.s.id}')">+ Colar link do caderno</button>`}</span>
      </li>`;
    }).join('');
    const semTxt = [sem.q && plural(sem.q, 'questão', 'questões'), sem.erros && plural(sem.erros, 'erro', 'erros'), sem.min && fmtMin(sem.min)].filter(Boolean).join(' · ');
    const reclass = sem.sessoes.length * temSessoes + sem.errosLista.length * temErros;
    return `
      <section class="est-ed-ficha-bloco est-sub-bloco">
        <h3>Assuntos (subtópicos)</h3>
        ${assuntos.length ? `<ul class="est-sub-lista">${linhas}</ul>`
          : '<p class="est-ed-ficha-vazio">Nenhum assunto ainda. Crie durante o estudo, na coluna “Assuntos” da janela de estudo, ou aqui.</p>'}
        ${semTxt ? `<p class="est-ed-ficha-vazio">Sem subtópico: ${semTxt}.</p>` : ''}
        <div class="est-ed-ficha-linha">
          <button type="button" class="est-plano-btn" onclick="estSub.novoPerguntando('${t.id}')">＋ Novo assunto</button>
          ${assuntos.length > 1 ? `<button type="button" class="est-ed-link" onclick="estSub.abrirPainel('${t.id}', 'mesclar')">Mesclar duplicados</button>` : ''}
          ${assuntos.length && reclass ? `<button type="button" class="est-ed-link" onclick="estSub.abrirPainel('${t.id}', 'reclassificar')">Reclassificar sem subtópico (${reclass})</button>` : ''}
        </div>
        ${painel && painel.tId === t.id ? htmlPainel(t, assuntos, sem) : ''}
        ${!remoto || !temSessoes || !temErros ? '<p class="est-ed-ficha-vazio">Para guardar os assuntos no servidor e dividir questões e erros por assunto, rode <code>supabase/subtopicos.sql</code> no Supabase.</p>' : ''}
      </section>`;
  }

  function htmlPainel(t, assuntos, sem) {
    if (painel.tipo === 'mesclar') {
      const de = painel.de || assuntos[0].s.id;
      const sDe = porId(de);
      const sug = sDe && sugestao(t.id, sDe.nome, de).parecido;
      const para = (sug && sug.id) || (assuntos.find(n => n.s.id !== de) || {}).s.id;
      return `<div class="est-sub-painel" id="est-sub-painel">
        <p><strong>Mesclar assuntos duplicados</strong></p>
        <label>Juntar <select class="est-form-select" id="est-sub-de">${opcoesAssuntos(assuntos, de)}</select></label>
        <label>em <select class="est-form-select" id="est-sub-para">${opcoesAssuntos(assuntos, para)}</select></label>
        <p class="est-ed-ficha-vazio">O resumo, os PDFs, o link do TEC, os erros, o tempo e as questões do primeiro passam para o segundo, e o primeiro deixa de existir.</p>
        <div class="est-ed-ficha-linha">
          <button type="button" class="est-plano-btn primario" onclick="estSub.confirmarMesclar()">Mesclar</button>
          <button type="button" class="est-ed-link" onclick="estSub.fecharPainel()">Cancelar</button>
        </div>
      </div>`;
    }
    const soTotal = sem.q - sem.sessoes.reduce((a, s) => a + (s.questionsTotal || 0), 0);
    const sessoes = temSessoes ? sem.sessoes.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))) : [];
    const errosL = temErros ? sem.errosLista : [];
    const tipo = s => (s.tipo === 'revisao' ? 'Revisão' : s.tipo === 'reforco' ? 'Reforço' : 'Estudo');
    const dataBr = s => String(s || '').slice(0, 10).split('-').reverse().join('/');
    const trecho = er => { const tx = String(er.enunciado || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); return tx ? curto(tx, 90) : '(imagem)'; };
    return `<div class="est-sub-painel" id="est-sub-painel">
      <p><strong>Reclassificar o que está sem subtópico</strong></p>
      ${sessoes.length ? `<p class="est-sub-painel-tit">Sessões</p><ul class="est-sub-marcar">${sessoes.map(s => `<li><label>
        <input type="checkbox" data-sessao="${esc(s.id)}" /> <span>${dataBr(s.date)} · ${tipo(s)} · ${fmtMin(s.timeMinutes || 0)}${s.questionsTotal ? ` · ${s.questionsCorrect}/${s.questionsTotal} questões` : ''}</span></label></li>`).join('')}</ul>` : ''}
      ${errosL.length ? `<p class="est-sub-painel-tit">Erros do caderno</p><ul class="est-sub-marcar">${errosL.map(er => `<li><label>
        <input type="checkbox" data-erro="${esc(er.id)}" /> <span>${dataBr(er.criado_em)} · ${esc(trecho(er))}</span></label></li>`).join('')}</ul>` : ''}
      ${soTotal > 0 ? `<p class="est-ed-ficha-vazio">${plural(soTotal, 'questão foi lançada', 'questões foram lançadas')} só no total do item (“Registrar questões” ou “Corrigir totais”), sem sessão: ${soTotal === 1 ? 'ela continua' : 'elas continuam'} sem subtópico.</p>` : ''}
      <label>Mover os marcados para <select class="est-form-select" id="est-sub-destino">${opcoesAssuntos(assuntos, painel.para)}</select></label>
      <div class="est-ed-ficha-linha">
        <button type="button" class="est-plano-btn primario" onclick="estSub.confirmarReclassificar()">Mover</button>
        <button type="button" class="est-ed-link" onclick="estSub.marcarTodos()">Marcar todos</button>
        <button type="button" class="est-ed-link" onclick="estSub.fecharPainel()">Cancelar</button>
      </div>
    </div>`;
  }

  function abrirPainel(tId, tipo, de) {
    painel = { tId, tipo, de };
    redesenhar();
    const el = document.getElementById('est-sub-painel');
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function fecharPainel() { painel = null; redesenhar(); }

  function marcarTodos() {
    document.querySelectorAll('#est-sub-painel input[type=checkbox]').forEach(c => { c.checked = true; });
  }

  async function confirmarMesclar() {
    const de = document.getElementById('est-sub-de').value, para = document.getElementById('est-sub-para').value;
    if (de === para) { aviso('Escolha dois assuntos diferentes.'); return; }
    const a = porId(de), b = porId(para);
    if (!(await window.customConfirm(`Juntar “${a.nome}” em “${b.nome}”? “${a.nome}” deixa de existir; nada do que estava nele se perde.`))) return;
    await mesclar(de, para);
    painel = null;
    aviso(`“${a.nome}” foi juntado em “${b.nome}”.`);
    redesenhar();
  }

  async function confirmarReclassificar() {
    const marcados = sel => [...document.querySelectorAll(`#est-sub-painel input[${sel}]:checked`)].map(c => c.getAttribute(sel));
    const sessoes = marcados('data-sessao'), errosM = marcados('data-erro');
    const para = document.getElementById('est-sub-destino').value;
    if (!sessoes.length && !errosM.length) { aviso('Marque o que quer mover.'); return; }
    await reclassificar(para, sessoes, errosM);
    painel = null;
    aviso(`${[sessoes.length && plural(sessoes.length, 'sessão movida', 'sessões movidas'), errosM.length && plural(errosM.length, 'erro movido', 'erros movidos')].filter(Boolean).join(' e ')} para “${porId(para).nome}”.`);
    redesenhar();
  }

  // Pergunta o nome e avisa se já existe um igual ou parecido
  async function nomeConferido(tId, texto, padrao, exceto) {
    const nome = ((await window.customPrompt(texto, padrao)) || '').trim();
    if (!nome) return null;
    const { exato, parecido } = sugestao(tId, nome, exceto);
    if (exato) { aviso(`Já existe o assunto “${exato.nome}” neste item.`); return null; }
    if (parecido && !(await window.customConfirm(`“${nome}” é parecido com “${parecido.nome}”, que já existe neste item. Continuar mesmo assim?`))) return null;
    return nome;
  }

  async function novoPerguntando(tId) {
    const nome = await nomeConferido(tId, 'Nome do novo assunto deste item:', '');
    if (nome && await criar(tId, nome)) redesenhar();
  }

  async function renomearPerguntando(id) {
    const s = porId(id);
    if (!s) return;
    const nome = await nomeConferido(s.topico_id, 'Novo nome do assunto (o resumo dele vai junto):', s.nome, s.id);
    if (nome && await renomear(id, nome)) redesenhar();
  }

  // Excluir só assunto sem dados; com resumo, questões, tempo ou erros, oferece mesclar
  async function excluir(id) {
    const s = porId(id);
    const ref = s && acharTopico(s.topico_id);
    if (!ref) return;
    const n = numeros(ref.t).assuntos.find(x => x.s.id === id);
    const pags = docDo(ref);
    const pag = paginaDe(pags, s.nome);
    const temResumo = !!pag && !vazio(pag.html);
    const dados = [temResumo && 'resumo', n.q && plural(n.q, 'questão', 'questões'), n.min && 'tempo de estudo', n.erros && plural(n.erros, 'erro', 'erros')].filter(Boolean);
    if (dados.length) {
      if (doTopico(s.topico_id).length < 2) { aviso(`“${s.nome}” tem ${dados.join(', ')} e não pode ser excluído. Renomeie-o, se quiser.`); return; }
      if (await window.customConfirm(`“${s.nome}” tem ${dados.join(', ')}, por isso não pode ser excluído. Juntá-lo com outro assunto (mesclar)?`)) abrirPainel(s.topico_id, 'mesclar', id);
      return;
    }
    if (!(await window.customConfirm(`Excluir o assunto “${s.nome}”?${s.tec_link ? ' O link do caderno do TEC dele também sai.' : ''}`))) return;
    await apagarLinha(id);
    if (pag) await gravarDoc(ref, pags.filter(p => p !== pag));
    redesenhar();
  }

  /* =============================================
     DESEMPENHO POR ASSUNTO (card da seção Desempenho, estudos.plano.js)
     Disciplina → item → assunto. Barra = % de acerto, numa cor só; o traço marca 70%.
  ============================================= */
  const temPdf = t => !!(window.estPlano && window.estPlano.paginasDoTopico(t.id) > 0);
  const somaT = (lista, k) => lista.reduce((a, t) => a + (t[k] || 0), 0);

  function linhaViz({ nome, sub, q, c, extra, acao, destaque, cls }) {
    const p = q ? Math.round(c / q * 100) : null;
    const tag = acao ? 'button' : 'div';
    const v = p === null ? 'Sem questões' : `${p}% de acerto`;
    const l = [nome, q ? `${c} de ${q} questões` : '', extra].filter(Boolean).join(' · ');
    return `<${tag} ${acao ? `type="button" onclick="${acao}"` : 'tabindex="0"'} class="est-viz-linha est-sub-linha ${cls || ''}" data-v="${esc(v)}" data-l="${esc(l)}">
      <span class="est-viz-linha-nome">${esc(nome)}${destaque ? ` <span class="est-sub-tag ${destaque.cls}">${destaque.txt}</span>` : ''}<small>${sub || ''}</small></span>
      <span class="est-viz-fina est-sub-trilho">${p ? `<i style="width:${p}%;background:var(--est-blue)"></i>` : ''}<b class="est-sub-ref" style="left:${ACERTO_FRACO}%"></b></span>
      <strong>${p === null ? '—' : p + '%'}</strong>
    </${tag}>`;
  }

  function nivelDisciplinas(e) {
    return e.disciplinas.map(d => {
      const lacunas = d.topicos.filter(t => !temPdf(t)).length;
      const nSub = d.topicos.reduce((a, t) => a + doTopico(t.id).length, 0);
      return linhaViz({
        nome: d.nome, q: somaT(d.topicos, 'questoesFeitas'), c: somaT(d.topicos, 'questoesCertas'), acao: `estSub.ver('${d.id}')`,
        sub: [plural(d.topicos.length, 'item', 'itens'), nSub && `🧩 ${plural(nSub, 'assunto', 'assuntos')}`, lacunas && `${lacunas} sem PDF`].filter(Boolean).join(' · ')
      });
    }).join('');
  }

  function nivelItens(d) {
    const linhas = d.topicos.map(t => {
      const n = doTopico(t.id).length, er = errosDo(t.id).length;
      return linhaViz({
        nome: curto(t.nome), q: t.questoesFeitas || 0, c: t.questoesCertas || 0, acao: `estSub.ver('${d.id}', '${t.id}')`,
        extra: temPdf(t) ? '' : 'sem PDF',
        sub: [n ? `🧩 ${plural(n, 'assunto', 'assuntos')}` : 'sem assuntos', er && `❌ ${plural(er, 'erro', 'erros')}`,
          !temPdf(t) && '<span class="est-sub-tag lacuna">sem PDF</span>'].filter(Boolean).join(' · ')
      });
    }).join('');
    const lacunas = d.topicos.filter(t => !temPdf(t));
    return linhas + (lacunas.length
      ? `<h4 class="est-viz-sub est-sub-lacunas-tit">Itens sem nenhum PDF (lacunas do material): ${lacunas.length}</h4>
         <ul class="est-sub-lacunas">${lacunas.map(t => `<li>${esc(t.nome)}</li>`).join('')}</ul>`
      : '<p class="est-plano-sub est-sub-lacunas-tit">Todos os itens desta disciplina têm PDF.</p>');
  }

  function nivelAssuntos(t) {
    const { assuntos, sem } = numeros(t);
    const comparaveis = assuntos.filter(n => n.q >= MIN_Q);
    const pior = comparaveis.length > 1 ? comparaveis.reduce((a, n) => (n.c / n.q < a.c / a.q ? n : a)) : null;
    const detalhe = n => [plural(n.q, 'questão', 'questões'), n.erros && `❌ ${plural(n.erros, 'erro', 'erros')}`, n.min && `⏱ ${fmtMin(n.min)}`].filter(Boolean);
    const linhas = assuntos.map(n => {
      const p = pct(n);
      const destaque = !n.q ? { cls: 'sem', txt: 'sem questões' }
        : n === pior ? { cls: 'ruim', txt: '⚠ pior acerto' }
        : n.q >= MIN_Q && p < ACERTO_FRACO ? { cls: 'ruim', txt: '⚠ abaixo de 70%' } : null;
      return linhaViz({ nome: n.s.nome, q: n.q, c: n.c, destaque, extra: n.erros ? plural(n.erros, 'erro', 'erros') : '',
        sub: [...detalhe(n), `📄 ${plural(n.s.pdfs.length, 'PDF', 'PDFs')}`].join(' · ') });
    }).join('');
    const temSem = sem.q || sem.erros || sem.min;
    return linhaViz({ nome: 'Item inteiro', q: t.questoesFeitas || 0, c: t.questoesCertas || 0, cls: 'total',
        sub: `${plural(assuntos.length, 'assunto', 'assuntos')}${temSem ? ' + sem subtópico' : ''}` })
      + (assuntos.length ? linhas : '<p class="est-plano-vazio">Este item ainda não tem assuntos. Crie durante o estudo (coluna “Assuntos” da janela) ou na ficha do item.</p>')
      + (temSem ? linhaViz({ nome: 'Sem subtópico', q: sem.q, c: sem.c, cls: 'sem-sub', extra: sem.erros ? plural(sem.erros, 'erro', 'erros') : '',
        sub: [...detalhe(sem), 'registros de antes dos assuntos ou não divididos'].join(' · ') }) : '');
  }

  function corpoDesempenho() {
    const e = editaisData.find(x => x.id === currentEditalId);
    if (!e) return '';
    const d = visao && e.disciplinas.find(x => x.id === visao.dId);
    const t = d && visao.tId && d.topicos.find(x => x.id === visao.tId);
    const trilha = d ? `<nav class="est-sub-trilha" aria-label="Nível do detalhamento">
        <button type="button" class="est-ed-link" onclick="estSub.ver()">Disciplinas</button> ›
        ${t ? `<button type="button" class="est-ed-link" onclick="estSub.ver('${d.id}')">${esc(d.nome)}</button> › <span>${esc(curto(t.nome, 70))}</span>` : `<span>${esc(d.nome)}</span>`}
      </nav>` : '';
    return `<h3 class="est-plano-card-title">🔎 Desempenho por assunto <span class="est-plano-sub">(clique para detalhar: disciplina → item → assunto; traço: ${ACERTO_FRACO}%)</span></h3>
      ${trilha}
      <div class="est-sub-viz">${t ? nivelAssuntos(t) : d ? nivelItens(d) : nivelDisciplinas(e)}</div>`;
  }

  const htmlDesempenho = () => `<div class="est-plano-card" id="est-sub-desemp">${corpoDesempenho()}</div>`;

  function ver(dId, tId) {
    visao = dId ? { dId, tId: tId || null } : null;
    const el = document.getElementById('est-sub-desemp');
    if (el) el.innerHTML = corpoDesempenho();
  }

  window.estSub = {
    carregar, migrar, doTopico, porId, doRegistro, sugestao, topicoPorNomes, ligarPaginas,
    criar, vincular, desvincular, faixa, paginasNoPdf, definirTec, linkDoCaderno, editarTec, renomear, mover, mesclar, reclassificar, excluir,
    numerosDe, distribuir, selo, blocoFicha, abrirPainel, fecharPainel, marcarTodos, confirmarMesclar,
    confirmarReclassificar, novoPerguntando, renomearPerguntando, htmlDesempenho, ver,
    temSessoes: () => temSessoes, temErros: () => temErros, remoto: () => remoto,
    _base: base   // usado no teste
  };
})();
