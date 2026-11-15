/* ─── js/estudos.desenho.js — Desenho à mão (caneta do tablet) no resumo ───
 *
 * estDesenho.abrir(tracosJson?) abre uma folha para escrever com a caneta e devolve
 * { src, tracos } (PNG + traços em JSON, para reabrir e continuar), { apagar: true } se a folha
 * ficou vazia ao editar, ou null se cancelou. Quem insere no resumo é o estudos.sessao.js
 * (blot "desenho": <img class="est-desenho" data-tracos="…">).
 *
 * Só a caneta (e o mouse) desenha: o dedo rola a folha e a palma encostada é ignorada,
 * salvo com "Dedo desenha" ligado. Traço com pressão; marca-texto translúcido; a borracha
 * apaga o traço inteiro que tocar.
 */
(function () {
  const LARGURA = 1000;            // largura lógica da folha (os traços ficam nessa escala)
  const ALTURA_INICIAL = 700;
  const MAIS_ESPACO = 400;
  const ESCALA_PNG = 1.5;          // PNG um pouco maior que a folha, para ficar nítido
  const CORES = ['#111827', '#1d4ed8', '#dc2626', '#15803d', '#7c3aed'];
  const CORES_MARCA = ['#fde047', '#86efac', '#f9a8d4', '#93c5fd'];
  const ESPESSURAS = { fina: 2, media: 3.5, grossa: 6 };
  const RAIO_BORRACHA = 12;

  let el = null, cv = null, ctx = null, base = null;
  let tracos = [], historico = [], refazer = [], altura = ALTURA_INICIAL;
  let ferramenta = 'caneta', cor = CORES[0], corMarca = CORES_MARCA[0], espessura = 'media';
  let atual = null, ponteiro = null, rolando = null, mudou = false, resolver = null, editando = false;

  const $ = s => el.querySelector(s);
  const ler = s => { try { return localStorage.getItem(s); } catch (e) { return null; } };
  const gravar = (s, v) => { try { localStorage.setItem(s, v); } catch (e) { /* sem espaço: só não lembra */ } };

  function criar() {
    el = document.createElement('div');
    el.id = 'est-desenho';
    el.className = 'est-desenho-modal';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Desenho à mão');
    el.innerHTML = `
      <div class="est-desenho-barra">
        <div class="est-desenho-grupo" role="group" aria-label="Ferramenta">
          <button type="button" data-ferr="caneta" title="Caneta">✒️ Caneta</button>
          <button type="button" data-ferr="marca" title="Marca-texto">🖍 Marca-texto</button>
          <button type="button" data-ferr="borracha" title="Borracha (apaga o traço inteiro)">🧽 Borracha</button>
        </div>
        <div class="est-desenho-grupo est-desenho-cores" role="group" aria-label="Cor"></div>
        <select class="est-desenho-esp" aria-label="Espessura">
          <option value="fina">Fina</option><option value="media">Média</option><option value="grossa">Grossa</option>
        </select>
        <div class="est-desenho-grupo" role="group" aria-label="Histórico">
          <button type="button" data-acao="desfazer" title="Desfazer (Ctrl+Z)" aria-label="Desfazer">↶</button>
          <button type="button" data-acao="refazer" title="Refazer (Ctrl+Y)" aria-label="Refazer">↷</button>
          <button type="button" data-acao="limpar" title="Apagar tudo (dá para desfazer)">🗑 Limpar</button>
        </div>
        <label class="est-desenho-dedo" title="Ligado: o dedo também desenha (sem caneta). Desligado: o dedo rola a folha."><input type="checkbox"> Dedo desenha</label>
        <span class="est-desenho-esp-vazio"></span>
        <button type="button" data-acao="cancelar">Cancelar</button>
        <button type="button" data-acao="inserir" class="est-desenho-ok">Inserir no resumo</button>
      </div>
      <div class="est-desenho-area">
        <canvas></canvas>
        <button type="button" data-acao="espaco" class="est-desenho-mais">+ Mais espaço</button>
      </div>`;
    document.body.appendChild(el);
    cv = $('canvas');
    ctx = cv.getContext('2d');
    base = document.createElement('canvas');

    el.querySelectorAll('[data-ferr]').forEach(b => b.addEventListener('click', () => { ferramenta = b.dataset.ferr; atualizarBarra(); }));
    $('.est-desenho-esp').addEventListener('change', ev => { espessura = ev.target.value; });
    const dedo = $('.est-desenho-dedo input');
    dedo.checked = ler('est_desenho_dedo') === '1';
    dedo.addEventListener('change', () => gravar('est_desenho_dedo', dedo.checked ? '1' : '0'));
    el.querySelectorAll('[data-acao]').forEach(b => b.addEventListener('click', () => acao(b.dataset.acao)));

    cv.addEventListener('pointerdown', inicio);
    cv.addEventListener('pointermove', mover);
    cv.addEventListener('pointerup', fim);
    cv.addEventListener('pointercancel', fim);
    // iPad: sem isto, a Apple Pencil seleciona texto ou abre a lupa
    cv.addEventListener('touchstart', ev => ev.preventDefault(), { passive: false });
    el.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { ev.stopPropagation(); acao('cancelar'); }
      const ctrl = ev.ctrlKey || ev.metaKey;
      if (ctrl && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.stopPropagation(); acao(ev.shiftKey ? 'refazer' : 'desfazer'); }
      if (ctrl && ev.key.toLowerCase() === 'y') { ev.preventDefault(); ev.stopPropagation(); acao('refazer'); }
    });
    window.addEventListener('resize', () => { if (!el.hidden) dimensionar(); });
  }

  function atualizarBarra() {
    el.querySelectorAll('[data-ferr]').forEach(b => b.classList.toggle('ativo', b.dataset.ferr === ferramenta));
    const lista = ferramenta === 'marca' ? CORES_MARCA : CORES;
    const sel = ferramenta === 'marca' ? corMarca : cor;
    $('.est-desenho-cores').innerHTML = ferramenta === 'borracha' ? '' : lista.map(c =>
      `<button type="button" class="est-desenho-cor ${c === sel ? 'ativo' : ''}" data-cor="${c}" style="background:${c}" aria-label="Cor ${c}"></button>`).join('');
    $('.est-desenho-cores').querySelectorAll('[data-cor]').forEach(b => b.addEventListener('click', () => {
      if (ferramenta === 'marca') corMarca = b.dataset.cor; else cor = b.dataset.cor;
      atualizarBarra();
    }));
    $('[data-acao="desfazer"]').disabled = !historico.length;
    $('[data-acao="refazer"]').disabled = !refazer.length;
  }

  /* ---------- tamanho e desenho ---------- */
  function dimensionar() {
    const area = $('.est-desenho-area');
    const larguraCss = Math.min(LARGURA, area.clientWidth - 24);
    const k = larguraCss / LARGURA, dpr = window.devicePixelRatio || 1;
    cv.style.width = larguraCss + 'px';
    cv.style.height = Math.round(altura * k) + 'px';
    cv.width = base.width = Math.round(larguraCss * dpr);
    cv.height = base.height = Math.round(altura * k * dpr);
    redesenharBase();
  }

  const fator = () => cv.width / LARGURA;   // lógico → pixels do canvas

  function desenharTraco(c, t, k) {
    const p = t.p;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = t.c;
    if (t.f === 'marca') {
      // Um caminho só: as sobreposições do próprio traço não escurecem
      c.globalAlpha = 0.4;
      c.lineWidth = t.l * 4 * k;
      c.beginPath();
      c.moveTo(p[0] * k, p[1] * k);
      for (let i = 3; i < p.length; i += 3) c.lineTo(p[i] * k, p[i + 1] * k);
      if (p.length === 3) c.lineTo(p[0] * k + 0.1, p[1] * k);
      c.stroke();
      c.globalAlpha = 1;
      return;
    }
    // Caneta: cada trecho com a largura da pressão naquele ponto
    if (p.length === 3) {
      c.fillStyle = t.c;
      c.beginPath();
      c.arc(p[0] * k, p[1] * k, Math.max(0.5, larguraDe(t, p[2]) * k / 2), 0, Math.PI * 2);
      c.fill();
      return;
    }
    for (let i = 3; i < p.length; i += 3) {
      c.lineWidth = Math.max(0.5, larguraDe(t, (p[i - 1] + p[i + 2]) / 2) * k);
      c.beginPath();
      c.moveTo(p[i - 3] * k, p[i - 2] * k);
      c.lineTo(p[i] * k, p[i + 1] * k);
      c.stroke();
    }
  }
  // Pressão 0–100 (sem caneta, 50): de 35% a 165% da espessura
  const larguraDe = (t, pr) => t.l * (0.35 + pr / 100 * 1.3);

  function redesenharBase() {
    const b = base.getContext('2d'), k = fator();
    b.clearRect(0, 0, base.width, base.height);
    tracos.forEach(t => desenharTraco(b, t, k));
    redesenhar();
  }

  function redesenhar() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(base, 0, 0);
    if (atual) desenharTraco(ctx, atual, fator());
  }

  /* ---------- caneta, dedo e borracha ---------- */
  function ponto(ev) {
    const r = cv.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width * LARGURA;
    const y = (ev.clientY - r.top) / r.height * altura;
    const pr = ev.pointerType === 'pen' && ev.pressure > 0 ? ev.pressure : 0.5;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(pr * 100)];
  }

  const desenha = ev => ev.pointerType !== 'touch' || $('.est-desenho-dedo input').checked;

  function inicio(ev) {
    if (ponteiro !== null) return;   // já há uma caneta na folha: a palma não conta
    if (!desenha(ev)) { rolando = { id: ev.pointerId, y: ev.clientY, x: ev.clientX }; return; }
    if (ev.button > 0) return;
    ev.preventDefault();
    ponteiro = ev.pointerId;
    try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* ponteiro que já saiu: segue sem captura */ }
    if (ferramenta === 'borracha') { guardarHistorico(); atual = null; apagarEm(ponto(ev)); return; }
    atual = ferramenta === 'marca'
      ? { f: 'marca', c: corMarca, l: ESPESSURAS[espessura], p: ponto(ev) }
      : { f: 'caneta', c: cor, l: ESPESSURAS[espessura], p: ponto(ev) };
    redesenhar();
  }

  function mover(ev) {
    if (rolando && ev.pointerId === rolando.id) {
      const area = $('.est-desenho-area');
      area.scrollTop -= ev.clientY - rolando.y;
      area.scrollLeft -= ev.clientX - rolando.x;
      rolando.y = ev.clientY;
      rolando.x = ev.clientX;
      return;
    }
    if (ev.pointerId !== ponteiro) return;
    ev.preventDefault();
    const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
    for (const e of (evs.length ? evs : [ev])) {
      const pt = ponto(e);
      if (ferramenta === 'borracha') { apagarEm(pt); continue; }
      const p = atual.p, n = p.length;
      if (Math.hypot(pt[0] - p[n - 3], pt[1] - p[n - 2]) < 0.8) continue;   // ponto repetido
      p.push(...pt);
    }
    if (atual) redesenhar();
  }

  function fim(ev) {
    if (rolando && ev.pointerId === rolando.id) { rolando = null; return; }
    if (ev.pointerId !== ponteiro) return;
    ponteiro = null;
    if (atual) {
      guardarHistorico();
      tracos.push(atual);
      atual = null;
      mudou = true;
      redesenharBase();
    }
    atualizarBarra();
  }

  // Distância do ponto ao trecho a-b (coordenadas lógicas)
  function distTrecho(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const u = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return Math.hypot(px - ax - u * dx, py - ay - u * dy);
  }

  function apagarEm(pt) {
    const toca = t => {
      const p = t.p, folga = RAIO_BORRACHA + (t.f === 'marca' ? t.l * 2 : t.l);
      if (p.length === 3) return Math.hypot(pt[0] - p[0], pt[1] - p[1]) < folga;
      for (let i = 3; i < p.length; i += 3) if (distTrecho(pt[0], pt[1], p[i - 3], p[i - 2], p[i], p[i + 1]) < folga) return true;
      return false;
    };
    const antes = tracos.length;
    tracos = tracos.filter(t => !toca(t));
    if (tracos.length !== antes) { mudou = true; redesenharBase(); }
  }

  /* ---------- histórico e ações ---------- */
  function guardarHistorico() {
    historico.push(tracos.slice());
    if (historico.length > 200) historico.shift();
    refazer = [];
  }

  async function acao(a) {
    if (a === 'desfazer' && historico.length) { refazer.push(tracos); tracos = historico.pop(); mudou = true; redesenharBase(); }
    if (a === 'refazer' && refazer.length) { historico.push(tracos); tracos = refazer.pop(); mudou = true; redesenharBase(); }
    if (a === 'limpar' && tracos.length) { guardarHistorico(); tracos = []; mudou = true; redesenharBase(); }
    if (a === 'espaco') { altura += MAIS_ESPACO; dimensionar(); $('.est-desenho-area').scrollTop += MAIS_ESPACO / 2; }
    if (a === 'cancelar') {
      if (mudou && tracos.length && window.customConfirm && !(await window.customConfirm('Descartar o que foi desenhado?'))) return;
      fechar(null);
    }
    if (a === 'inserir') {
      if (!tracos.length) { fechar(editando ? { apagar: true } : null); return; }
      fechar(exportar());
    }
    atualizarBarra();
  }

  // PNG transparente na largura da folha, cortado logo abaixo do último traço
  function exportar() {
    let maxY = 0;
    tracos.forEach(t => { for (let i = 1; i < t.p.length; i += 3) maxY = Math.max(maxY, t.p[i]); });
    const h = Math.min(altura, Math.ceil(maxY + 30));
    const out = document.createElement('canvas');
    out.width = Math.round(LARGURA * ESCALA_PNG);
    out.height = Math.round(h * ESCALA_PNG);
    const c = out.getContext('2d');
    tracos.forEach(t => desenharTraco(c, t, ESCALA_PNG));
    const dados = { v: 1, h: altura, t: tracos.map(t => ({ f: t.f, c: t.c, l: t.l, p: t.p.map(n => Math.round(n)) })) };
    return { src: out.toDataURL('image/png'), tracos: JSON.stringify(dados) };
  }

  function fechar(resultado) {
    el.hidden = true;
    document.documentElement.classList.remove('est-desenho-aberto');
    const r = resolver;
    resolver = null;
    if (r) r(resultado);
  }

  function abrir(json) {
    if (!el) criar();
    if (resolver) fechar(null);
    tracos = []; altura = ALTURA_INICIAL; editando = !!json;
    try {
      const d = json ? JSON.parse(json) : null;
      if (d && Array.isArray(d.t)) {
        tracos = d.t.filter(t => t && Array.isArray(t.p) && t.p.length >= 3 && /^#[0-9a-f]{3,8}$/i.test(t.c))
          .map(t => ({ f: t.f === 'marca' ? 'marca' : 'caneta', c: t.c, l: Number(t.l) || 3, p: t.p.map(Number) }));
        altura = Math.max(ALTURA_INICIAL, Number(d.h) || 0);
      }
    } catch (e) { console.warn('Traços do desenho ilegíveis; abre em branco.', e); }
    historico = []; refazer = []; atual = null; ponteiro = null; rolando = null; mudou = false;
    el.hidden = false;
    document.documentElement.classList.add('est-desenho-aberto');
    $('.est-desenho-esp').value = espessura;
    atualizarBarra();
    dimensionar();
    $('.est-desenho-area').scrollTop = 0;
    $('[data-acao="inserir"]').textContent = editando ? 'Salvar desenho' : 'Inserir no resumo';
    $('[data-ferr="caneta"]').focus();
    return new Promise(r => { resolver = r; });
  }

  window.estDesenho = { abrir };
})();
