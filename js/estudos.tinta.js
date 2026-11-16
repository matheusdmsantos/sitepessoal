/* ─── js/estudos.tinta.js — Tinta da caneta por cima do texto do resumo ───
 *
 * Uma camada transparente sobre o editor da janela de estudo (estudos.sessao.js): com a tinta
 * ligada (botão 🖊️ da barra), a caneta grifa, sublinha e puxa setas por cima do que está
 * digitado; o dedo rola a folha. Desligada, a tinta continua à vista e o texto se usa normalmente.
 *
 * Cada traço fica preso a um ponto do texto (âncora: posição + o texto em volta, como uma
 * citação). Se o texto acima muda (alguém digitando no PC), o traço acompanha o trecho; se a
 * largura da folha é outra (PC × tablet), ele acompanha a palavra. Traços em
 * public.resumo_tinta (supabase/sincronia.sql), um por linha, buscados a cada poucos segundos
 * pela sincronização da janela (estTinta.puxar), então aparecem no outro aparelho.
 * Botão da S Pen: alterna borracha ⇄ caneta (como no desenho). A borracha apaga o traço inteiro.
 * Também aparece em Meus Resumos e no PDF exportado (desenharNoDocumento); no Word, não.
 */
(function () {
  const CORES = ['#dc2626', '#1d4ed8', '#111827', '#15803d'];
  const CORES_MARCA = ['#fde047', '#86efac', '#f9a8d4', '#93c5fd'];
  const LARGURA = { caneta: 2, marca: 3.5 };   // o marca-texto sai 4× mais largo (desenharTraco)
  const RAIO_BORRACHA = 10;
  const CONTEXTO = 16;                          // letras de cada lado guardadas na âncora
  const FOLGA_MS = 15000;                       // ao buscar "o que mudou desde", volta um pouco (commit atrasado)
  const CHAVE_LIGADA = 'est_tinta_ligada';

  let o = null;                 // opções do iniciar
  let cv = null, g = null, barra = null, cont = null;
  let ligada = false, ferramenta = 'caneta', antes = 'caneta', cor = CORES[0], corMarca = CORES_MARCA[0];
  let resumoId = null, disponivel = null, ultimo = null;
  const tracos = new Map();     // id → linha { id, resumo_id, pagina, ancora, traco, apagado, atualizado_em }
  const pendentes = new Map();  // id → linha ainda não gravada
  let pos = new Map();          // id → { x, y }: âncora no conteúdo do editor (cache)
  let desfazer = [];            // [{ tipo: 'add' | 'apagar', ids }]
  let atual = null, ponteiro = null, apagando = false, apagadosAgora = [], dedo = null, ultimoBotao = 0, quadro = 0;

  const sb = () => window.supabaseClient;
  const ler = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const gravar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* só não lembra */ } };
  const novoId = () => 'tn_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const aviso = msg => (window.estPlano ? window.estPlano.aviso(msg) : alert(msg));
  const r1 = n => Math.round(n * 10) / 10;
  const daPagina = () => [...tracos.values()].filter(t => !t.apagado && t.pagina === o.pagina());

  function iniciar(opcoes) {
    o = opcoes;
    cont = o.quill.container;           // .ql-container: é ele que rola
    const folha = cont.parentElement;
    cv = document.createElement('canvas');
    cv.className = 'est-tinta';
    folha.appendChild(cv);
    g = cv.getContext('2d');
    barra = document.createElement('div');
    barra.className = 'est-tinta-barra';
    barra.hidden = true;
    barra.setAttribute('role', 'toolbar');
    barra.setAttribute('aria-label', 'Tinta');
    folha.appendChild(barra);
    barra.addEventListener('click', ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.ferr) { ferramenta = b.dataset.ferr; if (ferramenta !== 'borracha') antes = ferramenta; }
      if (b.dataset.cor) { if (ferramenta === 'marca') corMarca = b.dataset.cor; else { cor = b.dataset.cor; if (ferramenta === 'borracha') ferramenta = antes = 'caneta'; } }
      if (b.dataset.acao === 'desfazer') desfazerUltimo();
      if (b.dataset.acao === 'sair') ligar(false);
      montarBarra();
    });

    cont.addEventListener('scroll', redesenhar, { passive: true });
    o.quill.on('text-change', agendar);
    o.quill.root.addEventListener('load', agendar, true);   // foto que termina de carregar empurra o texto
    if (document.fonts) document.fonts.addEventListener('loadingdone', agendar);
    new ResizeObserver(() => { posicionar(); agendar(); }).observe(cont);

    cv.addEventListener('pointerdown', inicio);
    cv.addEventListener('pointermove', mover);
    cv.addEventListener('pointerup', fim);
    cv.addEventListener('pointercancel', fim);
    // Sem isto a caneta seleciona texto, abre a lupa ou o teclado
    cv.addEventListener('touchstart', ev => ev.preventDefault(), { passive: false });
    cv.addEventListener('wheel', ev => { cont.scrollTop += ev.deltaY; ev.preventDefault(); }, { passive: false });
    // Botão da S Pen (Chrome/Android manda um contextmenu a cada aperto): borracha ⇄ caneta
    cv.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      if (ev.pointerType === 'touch' || Date.now() - ultimoBotao < 300) return;
      ultimoBotao = Date.now();
      if (ferramenta === 'borracha') ferramenta = antes; else { antes = ferramenta; ferramenta = 'borracha'; }
      montarBarra();
    });
    posicionar();
  }

  /* ---------- ligar / desligar ---------- */
  // silencioso: ao abrir a janela (lembrado do último uso), sem avisos se não der
  async function ligar(v, silencioso) {
    if (v) {
      const falta = msg => { if (!silencioso) aviso(msg); };
      if (!o.resumoId() && !silencioso) await o.garantirResumo();
      if (!o.resumoId()) { falta('Escreva algo no resumo antes de anotar por cima.'); return; }
      await puxar();
      if (disponivel === false) { falta('Para usar a tinta, rode no Supabase o arquivo supabase/sincronia.sql.'); return; }
    }
    ligada = v;
    gravar(CHAVE_LIGADA, v ? '1' : '0');
    cv.classList.toggle('ligada', v);
    barra.hidden = !v;
    if (v) o.quill.blur();
    montarBarra();
    if (o.aoMudar) o.aoMudar(v);
  }

  function montarBarra() {
    if (!barra) return;
    const lista = ferramenta === 'marca' ? CORES_MARCA : CORES;
    const ativa = ferramenta === 'marca' ? corMarca : ferramenta === 'caneta' ? cor : null;
    barra.innerHTML = `
      <button type="button" data-ferr="caneta" class="${ferramenta === 'caneta' ? 'ativo' : ''}" title="Caneta">✒️</button>
      <button type="button" data-ferr="marca" class="${ferramenta === 'marca' ? 'ativo' : ''}" title="Marca-texto">🖍</button>
      <button type="button" data-ferr="borracha" class="${ferramenta === 'borracha' ? 'ativo' : ''}" title="Borracha (apaga o traço inteiro; o botão da S Pen também alterna)">🧽</button>
      <span class="est-tinta-sep"></span>
      ${lista.map(c => `<button type="button" class="est-tinta-cor ${c === ativa ? 'ativo' : ''}" data-cor="${c}" style="background:${c}" aria-label="Cor ${c}"></button>`).join('')}
      <span class="est-tinta-sep"></span>
      <button type="button" data-acao="desfazer" title="Desfazer o último traço ou apagamento" ${desfazer.length ? '' : 'disabled'}>↶</button>
      <button type="button" data-acao="sair" title="Desligar a tinta (volta a digitar)">✕</button>`;
  }

  /* ---------- posição na tela ---------- */
  function posicionar() {
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cont.clientWidth, h = cont.clientHeight;
    cv.style.top = cont.offsetTop + 'px';
    cv.style.left = cont.offsetLeft + 'px';
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    redesenhar();
  }

  // Texto da página com um caractere por item do Quill (foto/desenho/tabela = 1), como os índices dele
  const textoDoEditor = () => o.quill.getContents().ops.map(op => (typeof op.insert === 'string' ? op.insert : '￼')).join('');

  // Onde a âncora está hoje: o texto em volta (o mais perto da posição antiga); sem ele, a posição
  function acharIndice(a, t) {
    const todas = (s, desloc) => {
      const r = [];
      if (!s) return r;
      for (let k = t.indexOf(s); k >= 0 && r.length < 500; k = t.indexOf(s, k + 1)) r.push(k + desloc);
      return r;
    };
    const perto = l => l.reduce((m, k) => (m === null || Math.abs(k - a.i) < Math.abs(m - a.i) ? k : m), null);
    let k = perto(todas(a.pre + a.pos, a.pre.length));
    if (k === null && a.pos.length >= 4) k = perto(todas(a.pos, 0));
    if (k === null && a.pre.length >= 4) k = perto(todas(a.pre, a.pre.length));
    if (k === null) k = a.i;
    return Math.max(0, Math.min(k, t.length - 1));
  }

  function noConteudo(i) {
    const b = o.quill.getBounds(i);
    return { x: b.left + cont.scrollLeft, y: b.top + cont.scrollTop };
  }

  function recalcular() {
    pos = new Map();
    const lista = daPagina();
    if (!lista.length) return;
    const t = textoDoEditor(), porIndice = new Map();
    lista.forEach(l => {
      const i = acharIndice(l.ancora, t);
      if (!porIndice.has(i)) porIndice.set(i, noConteudo(i));
      pos.set(l.id, porIndice.get(i));
    });
  }

  function agendar() {
    if (quadro) return;
    quadro = setTimeout(() => { quadro = 0; recalcular(); redesenhar(); }, 16);   // junta as mudanças de um mesmo instante
  }

  function redesenhar() {
    if (!g) return;
    const dpr = window.devicePixelRatio || 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    const st = cont.scrollTop, sl = cont.scrollLeft, h = cont.clientHeight;
    const pinta = (t, x, y) => {
      g.setTransform(dpr, 0, 0, dpr, (x - sl) * dpr, (y - st) * dpr);
      window.estDesenho.desenharTraco(g, t, 1);
    };
    daPagina().forEach(l => {
      const p = pos.get(l.id);
      if (!p) return;
      const [y0, y1] = faixaY(l.traco);
      if (p.y + y1 < st - 20 || p.y + y0 > st + h + 20) return;   // fora da tela
      pinta(l.traco, p.x, p.y);
    });
    if (atual) pinta(atual, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  function faixaY(t) {
    if (!t._y) {
      let a = Infinity, b = -Infinity;
      for (let i = 1; i < t.p.length; i += 3) { a = Math.min(a, t.p[i]); b = Math.max(b, t.p[i]); }
      t._y = [a - 20, b + 20];
    }
    return t._y;
  }

  /* ---------- caneta, dedo e borracha ---------- */
  function ponto(ev) {
    const r = cont.getBoundingClientRect();
    const pr = ev.pointerType === 'pen' && ev.pressure > 0 ? ev.pressure : 0.5;
    return [r1(ev.clientX - r.left + cont.scrollLeft), r1(ev.clientY - r.top + cont.scrollTop), Math.round(pr * 100)];
  }

  function inicio(ev) {
    if (!ligada) return;
    if (ev.pointerType === 'touch') {
      if (ponteiro === null && !dedo) dedo = { id: ev.pointerId, y: ev.clientY };   // o dedo rola
      return;
    }
    if (ponteiro !== null) return;
    const ponta = ev.pointerType === 'pen' && (ev.button === 5 || (ev.buttons & 32) > 0);   // ponta de borracha
    if (ev.button > 0 && !ponta) return;
    ev.preventDefault();
    ponteiro = ev.pointerId;
    dedo = null;
    try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* ponteiro que já saiu */ }
    apagando = ferramenta === 'borracha' || ponta;
    if (apagando) { apagadosAgora = []; apagarEm(ponto(ev)); return; }
    const marca = ferramenta === 'marca';
    atual = { f: marca ? 'marca' : 'caneta', c: marca ? corMarca : cor, l: LARGURA[marca ? 'marca' : 'caneta'], p: ponto(ev), cliente: [ev.clientX, ev.clientY] };
    redesenhar();
  }

  function mover(ev) {
    if (dedo && ev.pointerId === dedo.id) {
      cont.scrollTop -= ev.clientY - dedo.y;
      dedo.y = ev.clientY;
      return;
    }
    if (ev.pointerId !== ponteiro) return;
    ev.preventDefault();
    const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
    for (const e of (evs.length ? evs : [ev])) {
      const pt = ponto(e);
      if (apagando) { apagarEm(pt); continue; }
      const p = atual.p, n = p.length;
      if (Math.hypot(pt[0] - p[n - 3], pt[1] - p[n - 2]) >= 0.8) p.push(...pt);
    }
    if (atual) redesenhar();
  }

  function fim(ev) {
    if (dedo && ev.pointerId === dedo.id) { dedo = null; return; }
    if (ev.pointerId !== ponteiro) return;
    ponteiro = null;
    if (apagando) {
      apagando = false;
      if (apagadosAgora.length) { desfazer.push({ tipo: 'apagar', ids: apagadosAgora }); enviar(); }
      montarBarra();
      return;
    }
    const t = atual;
    atual = null;
    if (t) guardarTraco(t);
    redesenhar();
  }

  // Ponto do texto onde o traço começa; sem texto ali, a linha mais perto acima
  function indiceDoTraco(t) {
    cv.style.pointerEvents = 'none';   // senão o navegador acha a camada, não o texto
    let i = o.indiceEm(t.cliente[0], t.cliente[1]);
    cv.style.pointerEvents = '';
    if (i === null) {
      i = 0;
      const y = t.p[1];
      for (const linha of o.quill.getLines()) {
        const k = o.quill.getIndex(linha);
        if (noConteudo(k).y <= y) i = k; else break;
      }
    }
    return i;
  }

  function guardarTraco(t) {
    const txt = textoDoEditor();
    const i = indiceDoTraco(t);
    const a = noConteudo(i);
    const traco = { f: t.f, c: t.c, l: t.l, p: t.p.map((n, k) => (k % 3 === 0 ? r1(n - a.x) : k % 3 === 1 ? r1(n - a.y) : n)) };
    const linha = {
      id: novoId(), resumo_id: resumoId, pagina: o.pagina(), apagado: false, traco,
      ancora: { i, pre: txt.slice(Math.max(0, i - CONTEXTO), i), pos: txt.slice(i, i + CONTEXTO) }
    };
    tracos.set(linha.id, linha);
    pos.set(linha.id, a);
    pendentes.set(linha.id, linha);
    desfazer.push({ tipo: 'add', ids: [linha.id] });
    montarBarra();
    enviar();
  }

  function apagarEm(pt) {
    let mudou = false;
    daPagina().forEach(l => {
      const p = pos.get(l.id);
      if (!p || !window.estDesenho.tocaTraco(l.traco, [pt[0] - p.x, pt[1] - p.y], RAIO_BORRACHA)) return;
      l.apagado = true;
      pendentes.set(l.id, l);
      apagadosAgora.push(l.id);
      mudou = true;
    });
    if (mudou) redesenhar();
  }

  function desfazerUltimo() {
    const op = desfazer.pop();
    if (!op) return;
    op.ids.forEach(id => {
      const l = tracos.get(id);
      if (!l) return;
      l.apagado = op.tipo === 'add';
      pendentes.set(id, l);
    });
    agendar();
    enviar();
  }

  /* ---------- servidor ---------- */
  const semTabela = e => e && (e.code === '42P01' || e.code === 'PGRST205' || /resumo_tinta/.test(e.message || ''));

  async function enviar() {
    if (!pendentes.size || disponivel === false || !navigator.onLine) return;
    const lote = [...pendentes.values()].map(l => ({ l, apagado: l.apagado }));
    const { error } = await sb().from('resumo_tinta').upsert(lote.map(({ l }) => ({
      id: l.id, resumo_id: l.resumo_id, pagina: l.pagina, ancora: l.ancora, apagado: l.apagado,
      traco: { f: l.traco.f, c: l.traco.c, l: l.traco.l, p: l.traco.p }
    })));
    if (semTabela(error)) { disponivel = false; return; }
    if (error) { console.warn('Tinta não gravada; tenta de novo na próxima sincronização.', error); return; }
    disponivel = true;
    // Só sai da fila o que não mudou durante o envio (desfazer troca o "apagado")
    lote.forEach(({ l, apagado }) => { if (pendentes.get(l.id) === l && l.apagado === apagado) pendentes.delete(l.id); });
  }

  // Traz o que o outro aparelho riscou ou apagou (a sincronização da janela chama a cada poucos segundos)
  async function puxar() {
    if (!o || disponivel === false || !navigator.onLine) return;   // offline: a cópia do sw.js é velha
    const id = o.resumoId();
    if (id !== resumoId) { resumoId = id; tracos.clear(); pendentes.clear(); desfazer = []; ultimo = null; agendar(); }
    if (!resumoId) return;
    await enviar();
    let q = sb().from('resumo_tinta').select('*').eq('resumo_id', resumoId);
    q = ultimo ? q.gt('atualizado_em', new Date(Date.parse(ultimo) - FOLGA_MS).toISOString()) : q.eq('apagado', false);
    const { data, error } = await q;
    if (semTabela(error)) { disponivel = false; return; }
    if (error || resumoId !== o.resumoId()) return;
    disponivel = true;
    let mudou = false;
    (data || []).forEach(l => {
      if (!ultimo || l.atualizado_em > ultimo) ultimo = l.atualizado_em;
      if (pendentes.has(l.id)) return;
      const v = tracos.get(l.id);
      if (v && v.atualizado_em === l.atualizado_em) return;
      if (v && !v.atualizado_em && v.apagado === l.apagado) { v.atualizado_em = l.atualizado_em; return; }   // o que este aparelho mesmo gravou
      tracos.set(l.id, l);
      mudou = true;
    });
    if (mudou) agendar();
  }

  // Janela aberta em outro resumo (ou fechada): começa do zero
  function trocarResumo() {
    resumoId = null; tracos.clear(); pendentes.clear(); desfazer = []; ultimo = null; atual = null; ponteiro = null; dedo = null;
    agendar();
  }

  async function abrirResumo() {
    trocarResumo();
    if (ligada) await ligar(false);
    if (ler(CHAVE_LIGADA) === '1' && matchMedia('(pointer: coarse)').matches) await ligar(true, true);
    else await puxar();
    posicionar();
  }

  async function fechar() {
    await enviar();
    trocarResumo();
  }

  /* ---------- Meus Resumos e o PDF dele ----------
     O documento marca cada página de resumo com data-tinta-resumo (id) e data-tinta-pagina (a
     mesma chave da janela). Ali não há Quill: o texto é lido do HTML contando como ele (cada
     linha termina em \n; foto, desenho e tabela = 1 caractere), a âncora é achada do mesmo jeito
     e a tinta vai num canvas por página. O tamanho acompanha a letra do documento (12pt na tela). */
  const LETRA_DO_EDITOR = 16;   // 12pt, a letra padrão da janela de estudo
  let repintarDoc = null;       // redesenha o documento de Meus Resumos aberto (fonte que chegou depois)

  function mapaDoTrecho(raiz) {
    let t = '';
    const refs = [];
    const um = (c, ref) => { t += c; refs.push(ref); };
    const inline = nos => nos.forEach(n => {
      if (n.nodeType === 3) { for (let k = 0; k < n.data.length; k++) um(n.data[k], { no: n, k }); }
      else if (n.nodeType === 1 && n.tagName === 'IMG') um('￼', { el: n });
      else if (n.nodeType === 1 && n.tagName !== 'BR') inline(n.childNodes);
    });
    const bloco = el => { const ini = refs.length; inline(el.childNodes); um('\n', { fim: el, ini }); };
    raiz.childNodes.forEach(n => {
      if (n.nodeType === 3) { if (n.data.trim()) inline([n]); return; }
      if (n.nodeType !== 1 || n.tagName === 'CANVAS') return;
      if (n.matches('ol, ul')) n.querySelectorAll(':scope > li').forEach(bloco);
      else if (n.matches('table, img')) um('￼', { el: n });
      else bloco(n);
    });
    return { t, refs };
  }

  // Canto de cima à esquerda do caractere i, como o getBounds do Quill (fim de linha: depois da última letra)
  function lugarNoTrecho(m, i) {
    const caixa = (no, k) => { const r = document.createRange(); r.setStart(no, k); r.setEnd(no, k + 1); return r.getBoundingClientRect(); };
    const ref = m.refs[i];
    if (!ref) return null;
    if (ref.no) { const q = caixa(ref.no, ref.k); return { x: q.left, y: q.top }; }
    if (ref.el) { const q = ref.el.getBoundingClientRect(); return { x: q.left, y: q.top }; }
    const ant = i > ref.ini ? m.refs[i - 1] : null;
    if (ant && ant.no) { const q = caixa(ant.no, ant.k); return { x: q.right, y: q.top }; }
    const q = ref.fim.getBoundingClientRect();
    return { x: q.left + (parseFloat(getComputedStyle(ref.fim).paddingLeft) || 0), y: q.top };
  }

  function pintarDocumento(raiz, linhas) {
    const MARGEM = 24;   // a tinta pode passar um pouco da página (setas, círculos)
    const escala = (parseFloat(getComputedStyle(raiz).fontSize) || LETRA_DO_EDITOR) / LETRA_DO_EDITOR;
    raiz.querySelectorAll('[data-tinta-resumo]').forEach(bl => {
      const velho = bl.querySelector(':scope > canvas.est-tinta-doc');
      if (velho) velho.remove();
      const minhas = linhas.filter(l => l.resumo_id === bl.dataset.tintaResumo && l.pagina === bl.dataset.tintaPagina);
      if (!minhas.length) return;
      const m = mapaDoTrecho(bl);
      if (!m.t.length) return;
      const caixa = bl.getBoundingClientRect();
      const w = caixa.width + 2 * MARGEM, h = caixa.height + 2 * MARGEM;
      const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16e6 / (w * h)));
      const c = document.createElement('canvas');
      c.className = 'est-tinta-doc';
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.cssText = `position:absolute;left:-${MARGEM}px;top:-${MARGEM}px;width:${w}px;height:${h}px;pointer-events:none;`;
      const gg = c.getContext('2d');
      minhas.forEach(l => {
        const p = lugarNoTrecho(m, acharIndice(l.ancora, m.t));
        if (!p) return;
        gg.setTransform(dpr * escala, 0, 0, dpr * escala, (p.x - caixa.left + MARGEM) * dpr, (p.y - caixa.top + MARGEM) * dpr);
        window.estDesenho.desenharTraco(gg, l.traco, 1);
      });
      bl.style.position = 'relative';
      bl.appendChild(c);
    });
  }

  // Busca a tinta das páginas marcadas em raiz e desenha. Na tela, redesenha quando a largura muda.
  async function desenharNoDocumento(raiz, naTela = true) {
    const ids = [...new Set([...raiz.querySelectorAll('[data-tinta-resumo]')].map(b => b.dataset.tintaResumo))];
    if (!ids.length || disponivel === false || !window.estDesenho) return;
    const { data, error } = await sb().from('resumo_tinta').select('resumo_id, pagina, ancora, traco').in('resumo_id', ids).eq('apagado', false);
    if (semTabela(error)) { disponivel = false; return; }
    // Fonte que ainda está chegando muda onde o texto quebra a linha
    if (document.fonts) await document.fonts.ready;
    if (error || !raiz.isConnected) return;
    pintarDocumento(raiz, data || []);
    if (!naTela) return;
    // Largura nova ou foto que terminou de carregar mudam onde o texto está (os canvas não mudam o tamanho)
    let t = null;
    const repintar = () => { clearTimeout(t); t = setTimeout(() => { if (raiz.isConnected) pintarDocumento(raiz, data || []); }, 150); };
    if (raiz._tintaObs) raiz._tintaObs.disconnect();
    raiz._tintaObs = new ResizeObserver(repintar);
    raiz._tintaObs.observe(raiz);
    if (!repintarDoc && document.fonts) document.fonts.addEventListener('loadingdone', () => repintarDoc && repintarDoc());
    repintarDoc = repintar;
  }

  window.estTinta = {
    iniciar, ligar, ligada: () => ligada, puxar, abrirResumo, fechar, pagina: agendar, posicionar, desenharNoDocumento,
    _acharIndice: acharIndice, _pos: id => pos.get(id), _tracos: () => [...tracos.values()]   // usados no teste
  };
})();
