/* ─── js/estudos.desenho.js — Desenho à mão (caneta do tablet) no resumo ───
 *
 * estDesenho.abrir(tracosJson?) abre uma folha para escrever com a caneta e devolve
 * { src, tracos } (PNG + traços em JSON, para reabrir e continuar), { apagar: true } se a folha
 * ficou vazia ao editar, ou null se cancelou. Quem insere no resumo é o estudos.sessao.js
 * (blot "desenho": <img class="est-desenho" data-tracos="…">).
 *
 * Só a caneta (e o mouse) desenha: o dedo rola a folha e a palma encostada é ignorada,
 * salvo com "Dedo desenha" ligado. Dois dedos dão zoom (pinça); também − / + e Ctrl+roda.
 * Traço com pressão; marca-texto translúcido; a borracha apaga o traço inteiro que tocar.
 * Botão lateral da caneta (S Pen) apertado ou ponta de borracha: o traço vira borracha.
 * Seleção (laço, como no Samsung Notes): contorne os traços (ou toque num) e arraste a caixa
 * para mover, um canto para redimensionar; apagar, duplicar e trocar a cor do que está marcado.
 */
(function () {
  const LARGURA = 1000;            // largura lógica da folha (os traços ficam nessa escala)
  const ALTURA_INICIAL = 700;
  const MAIS_ESPACO = 400;
  const ESCALA_PNG = 2;            // PNG maior que a folha, para a letra pequena ficar nítida no resumo
  const CORES = ['#111827', '#1d4ed8', '#dc2626', '#15803d', '#7c3aed'];
  const CORES_MARCA = ['#fde047', '#86efac', '#f9a8d4', '#93c5fd'];
  const ESPESSURAS = { fina: 2, media: 3.5, grossa: 6 };
  const RAIO_BORRACHA = 12;
  const ZOOM_MAX = 4;
  const PIXELS_MAX = 16e6;         // limite de área do canvas no iPad (Safari)

  let el = null, cv = null, ctx = null, base = null;
  let tracos = [], historico = [], refazer = [], altura = ALTURA_INICIAL;
  let ferramenta = 'caneta', cor = CORES[0], corMarca = CORES_MARCA[0], espessura = 'media';
  let atual = null, ponteiro = null, ponteiroDedo = false, mudou = false, resolver = null, editando = false;
  let apagando = false;            // traço atual é borracha (ferramenta ou botão da caneta)
  let botaoNoAr = false;           // botão da caneta apertado com ela pairando sobre a tela
  // Qualquer botão além da ponta (S Pen: lateral; outras canetas: borracha) — buttons é bit a bit
  const botaoExtra = ev => ev.pointerType === 'pen' && ((ev.buttons & ~1) > 0 || ev.button > 0);
  let zoom = 1, pinca = null;
  let laco = null, sel = null, arrasto = null;   // seleção: contorno em andamento, { tracos, box }, mover/escala
  const dedos = new Map();         // dedos na folha: id → { x, y }

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
          <button type="button" data-ferr="selecao" title="Seleção: contorne os traços para mover ou redimensionar">⬚ Seleção</button>
        </div>
        <div class="est-desenho-grupo est-desenho-sel" role="group" aria-label="Seleção" hidden>
          <button type="button" data-acao="dup" title="Duplicar o que está selecionado">⧉ Duplicar</button>
          <button type="button" data-acao="apagarSel" title="Apagar o que está selecionado (Delete)">✕ Apagar</button>
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
        <div class="est-desenho-grupo" role="group" aria-label="Zoom">
          <button type="button" data-acao="menos" title="Diminuir o zoom" aria-label="Diminuir o zoom">−</button>
          <button type="button" data-acao="zoom" class="est-desenho-zoom" title="Voltar à folha inteira">100%</button>
          <button type="button" data-acao="mais" title="Aumentar o zoom (ou pince com dois dedos)" aria-label="Aumentar o zoom">+</button>
        </div>
        <label class="est-desenho-dedo" title="Ligado: o dedo também desenha (sem caneta). Desligado: o dedo rola a folha."><input type="checkbox"> Dedo desenha</label>
        <button type="button" data-acao="diag" title="Mostra o que a caneta envia ao navegador (para ajustar o botão da S Pen)">🔎 Caneta</button>
        <span class="est-desenho-esp-vazio"></span>
        <button type="button" data-acao="cancelar">Cancelar</button>
        <button type="button" data-acao="inserir" class="est-desenho-ok">Inserir no resumo</button>
      </div>
      <pre class="est-desenho-diag" hidden></pre>
      <div class="est-desenho-area">
        <canvas></canvas>
        <button type="button" data-acao="espaco" class="est-desenho-mais">+ Mais espaço</button>
      </div>`;
    document.body.appendChild(el);
    cv = $('canvas');
    ctx = cv.getContext('2d');
    base = document.createElement('canvas');

    el.querySelectorAll('[data-ferr]').forEach(b => b.addEventListener('click', () => {
      ferramenta = b.dataset.ferr;
      if (ferramenta !== 'selecao' && sel) { sel = null; redesenhar(); }
      atualizarBarra();
    }));
    $('.est-desenho-esp').addEventListener('change', ev => { espessura = ev.target.value; });
    const dedo = $('.est-desenho-dedo input');
    dedo.checked = ler('est_desenho_dedo') === '1';
    dedo.addEventListener('change', () => gravar('est_desenho_dedo', dedo.checked ? '1' : '0'));
    el.querySelectorAll('[data-acao]').forEach(b => b.addEventListener('click', () => acao(b.dataset.acao)));

    // Na área toda (a pinça vale também na margem); caneta e mouse só desenham sobre a folha
    const area = $('.est-desenho-area');
    area.addEventListener('pointerdown', inicio);
    area.addEventListener('pointermove', mover);
    area.addEventListener('pointerup', fim);
    area.addEventListener('pointercancel', fim);
    // iPad: sem isto, a Apple Pencil seleciona texto ou abre a lupa
    cv.addEventListener('touchstart', ev => ev.preventDefault(), { passive: false });
    // Botão da caneta não abre o menu do navegador
    cv.addEventListener('contextmenu', ev => ev.preventDefault());
    // shortcut: diagnóstico da caneta (🔎) para descobrir o que o botão da S Pen envia; tirar quando estiver ajustado
    const diag = [];
    const anotar = ev => {
      const box = $('.est-desenho-diag');
      if (box.hidden) return;
      if (ev.type === 'pointermove' && ev.pointerType === 'touch') return;
      const lin = ev.type.startsWith('key') ? `${ev.type} key=${ev.key} code=${ev.code}`
        : `${ev.type} tipo=${ev.pointerType || '-'} button=${ev.button} buttons=${ev.buttons} pressão=${ev.pressure != null ? ev.pressure.toFixed(2) : '-'}`;
      if (diag[diag.length - 1] === lin) return;   // movimentos iguais seguidos viram uma linha
      diag.push(lin);
      if (diag.length > 12) diag.shift();
      box.textContent = diag.join('\n');
    };
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'contextmenu', 'auxclick'].forEach(t => el.addEventListener(t, anotar, true));
    ['keydown', 'keyup'].forEach(t => window.addEventListener(t, ev => { if (!el.hidden) anotar(ev); }, true));
    el.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { ev.stopPropagation(); if (sel) { sel = null; redesenhar(); atualizarBarra(); } else acao('cancelar'); }
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && sel) { ev.preventDefault(); ev.stopPropagation(); acao('apagarSel'); }
      const ctrl = ev.ctrlKey || ev.metaKey;
      if (ctrl && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.stopPropagation(); acao(ev.shiftKey ? 'refazer' : 'desfazer'); }
      if (ctrl && ev.key.toLowerCase() === 'y') { ev.preventDefault(); ev.stopPropagation(); acao('refazer'); }
    });
    window.addEventListener('resize', () => { if (!el.hidden) dimensionar(); });
    // Ctrl+roda (ou pinça no touchpad, que o navegador manda assim): zoom no ponto do mouse
    $('.est-desenho-area').addEventListener('wheel', ev => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      zoomEm(zoom * Math.exp(-ev.deltaY / 300), ev.clientX, ev.clientY);
      clearTimeout(zoomEm.t);
      zoomEm.t = setTimeout(dimensionar, 150);
    }, { passive: false });
  }

  function atualizarBarra() {
    el.querySelectorAll('[data-ferr]').forEach(b => b.classList.toggle('ativo', b.dataset.ferr === (apagando ? 'borracha' : ferramenta)));
    // Na seleção, as cores da caneta (ou do marca-texto, se só há marca-texto marcado) trocam a cor do que está marcado
    const soMarca = sel && sel.tracos.every(t => t.f === 'marca');
    const lista = ferramenta === 'marca' || soMarca ? CORES_MARCA : CORES;
    const ativa = ferramenta === 'marca' ? corMarca : ferramenta === 'selecao' ? null : cor;
    $('.est-desenho-cores').innerHTML = ferramenta === 'borracha' || (ferramenta === 'selecao' && !sel) ? '' : lista.map(c =>
      `<button type="button" class="est-desenho-cor ${c === ativa ? 'ativo' : ''}" data-cor="${c}" style="background:${c}" aria-label="Cor ${c}"></button>`).join('');
    $('.est-desenho-cores').querySelectorAll('[data-cor]').forEach(b => b.addEventListener('click', () => {
      if (ferramenta === 'selecao') recolorir(b.dataset.cor);
      else if (ferramenta === 'marca') corMarca = b.dataset.cor; else cor = b.dataset.cor;
      atualizarBarra();
    }));
    $('.est-desenho-sel').hidden = !sel;
    $('.est-desenho-zoom').textContent = Math.round(zoom * 100) + '%';
    $('[data-acao="menos"]').disabled = zoom <= 1;
    $('[data-acao="mais"]').disabled = zoom >= ZOOM_MAX;
    $('[data-acao="desfazer"]').disabled = !historico.length;
    $('[data-acao="refazer"]').disabled = !refazer.length;
  }

  /* ---------- tamanho e desenho ---------- */
  // Tamanho na tela: a folha inteira na largura da área, vezes o zoom
  function tamanhoCss() {
    const larguraCss = Math.min(LARGURA, $('.est-desenho-area').clientWidth - 24) * zoom;
    cv.style.width = larguraCss + 'px';
    cv.style.height = Math.round(altura * larguraCss / LARGURA) + 'px';
    return larguraCss;
  }

  // Tamanho e resolução (lento: redesenha tudo). Durante a pinça só muda o tamanho na tela.
  function dimensionar() {
    const larguraCss = tamanhoCss();
    const w = larguraCss * (window.devicePixelRatio || 1), h = w * altura / LARGURA;
    const f = Math.min(1, Math.sqrt(PIXELS_MAX / (w * h)), 8192 / w);
    cv.width = base.width = Math.round(w * f);
    cv.height = base.height = Math.round(h * f);
    redesenharBase();
    atualizarBarra();
  }

  // Zoom mantendo parado o ponto da folha que está em (cx, cy) na tela
  // (fixo: o ponto da folha, em fração, que deve ficar em (cx, cy); a pinça usa o do começo)
  function zoomEm(z, cx, cy, fixo) {
    const area = $('.est-desenho-area');
    let r = cv.getBoundingClientRect();
    const { fx, fy } = fixo || { fx: (cx - r.left) / r.width, fy: (cy - r.top) / r.height };
    zoom = Math.max(1, Math.min(ZOOM_MAX, z));
    tamanhoCss();
    r = cv.getBoundingClientRect();
    area.scrollLeft += r.left + fx * r.width - cx;
    area.scrollTop += r.top + fy * r.height - cy;
  }

  function zoomNoMeio(z) {
    const a = $('.est-desenho-area').getBoundingClientRect();
    zoomEm(z, a.left + a.width / 2, a.top + a.height / 2);
    dimensionar();
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
    // Enquanto a seleção é arrastada, ela fica fora da base e é desenhada a cada movimento
    tracos.forEach(t => { if (!(arrasto && sel.tracos.includes(t))) desenharTraco(b, t, k); });
    redesenhar();
  }

  function redesenhar() {
    const k = fator();
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(base, 0, 0);
    if (atual) desenharTraco(ctx, atual, k);
    if (arrasto) sel.tracos.forEach(t => desenharTraco(ctx, t, k));
    const px = cv.width / (cv.getBoundingClientRect().width || 1);   // pixels do canvas por pixel da tela
    if (laco && laco.length > 2) {
      ctx.save();
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = '#2563eb';
      ctx.beginPath();
      ctx.moveTo(laco[0] * k, laco[1] * k);
      for (let i = 2; i < laco.length; i += 2) ctx.lineTo(laco[i] * k, laco[i + 1] * k);
      ctx.stroke();
      ctx.restore();
    }
    if (sel) {
      const b = sel.box, lado = 12 * px;
      ctx.save();
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = '#2563eb';
      ctx.strokeRect(b.x * k, b.y * k, b.w * k, b.h * k);
      ctx.setLineDash([]);
      ctx.fillStyle = '#fff';
      cantos(b).forEach(([x, y]) => { ctx.fillRect(x * k - lado / 2, y * k - lado / 2, lado, lado); ctx.strokeRect(x * k - lado / 2, y * k - lado / 2, lado, lado); });
      ctx.restore();
    }
  }

  /* ---------- seleção ---------- */
  const cantos = b => [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]];

  function caixaDe(lista) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    lista.forEach(t => {
      const m = (t.f === 'marca' ? t.l * 2 : t.l) + 4;
      for (let i = 0; i < t.p.length; i += 3) {
        x0 = Math.min(x0, t.p[i] - m); x1 = Math.max(x1, t.p[i] + m);
        y0 = Math.min(y0, t.p[i + 1] - m); y1 = Math.max(y1, t.p[i + 1] + m);
      }
    });
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }

  // Ponto dentro do contorno (laço fechado), pelo raio que cruza as arestas
  function dentroDoLaco(x, y, l) {
    let dentro = false;
    for (let i = 0, j = l.length - 2; i < l.length; j = i, i += 2) {
      const xi = l[i], yi = l[i + 1], xj = l[j], yj = l[j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
  }

  // Onde o ponto cai na seleção: índice do canto (0–3), 'dentro' ou null
  function acertoSelecao(pt) {
    if (!sel) return null;
    const tol = 16 / (cv.getBoundingClientRect().width / LARGURA);   // 16 px da tela, em unidades da folha
    const i = cantos(sel.box).findIndex(([x, y]) => Math.hypot(pt[0] - x, pt[1] - y) < tol);
    if (i >= 0) return i;
    const b = sel.box;
    return pt[0] >= b.x && pt[0] <= b.x + b.w && pt[1] >= b.y && pt[1] <= b.y + b.h ? 'dentro' : null;
  }

  function fecharLaco() {
    const l = laco;
    laco = null;
    let xs = [], ys = [];
    for (let i = 0; i < l.length; i += 2) { xs.push(l[i]); ys.push(l[i + 1]); }
    const pequeno = Math.max(...xs) - Math.min(...xs) < 8 && Math.max(...ys) - Math.min(...ys) < 8;
    let marcados;
    if (pequeno) {
      // Toque: o traço de cima que passa ali
      const t = tracos.slice().reverse().find(t => tocaTraco(t, [l[0], l[1]], 8));
      marcados = t ? [t] : [];
    } else {
      // Contorno: os traços com ao menos metade dos pontos dentro
      marcados = tracos.filter(t => {
        let n = 0;
        for (let i = 0; i < t.p.length; i += 3) if (dentroDoLaco(t.p[i], t.p[i + 1], l)) n++;
        return n * 2 >= t.p.length / 3;
      });
    }
    sel = marcados.length ? { tracos: marcados, box: caixaDe(marcados) } : null;
  }

  // Troca os traços marcados por cópias (o histórico guarda os originais intactos)
  function copiarSelecao() {
    guardarHistorico();
    sel.tracos = sel.tracos.map(t => {
      const c = { ...t, p: t.p.slice() };
      tracos[tracos.indexOf(t)] = c;
      return c;
    });
  }

  function comecarArrasto(hit, pt) {
    copiarSelecao();
    arrasto = { hit, p0: pt, orig: sel.tracos.map(t => ({ p: t.p.slice(), l: t.l })), box0: { ...sel.box } };
    redesenharBase();
  }

  function aplicarArrasto(pt) {
    const { hit, p0, orig, box0 } = arrasto;
    if (hit === 'dentro') {
      const dx = pt[0] - p0[0], dy = pt[1] - p0[1];
      sel.tracos.forEach((t, k) => { const o = orig[k].p; for (let i = 0; i < o.length; i += 3) { t.p[i] = o[i] + dx; t.p[i + 1] = o[i + 1] + dy; } });
      sel.box = { ...box0, x: box0.x + dx, y: box0.y + dy };
      return;
    }
    // Canto: escala igual nos dois sentidos, presa no canto oposto (a espessura acompanha)
    const cs = cantos(box0), [ax, ay] = cs[3 - hit], [cx, cy] = cs[hit];
    const vx = cx - ax, vy = cy - ay;
    const f = Math.max(0.1, Math.min(10, ((pt[0] - ax) * vx + (pt[1] - ay) * vy) / (vx * vx + vy * vy)));
    sel.tracos.forEach((t, k) => {
      const o = orig[k].p;
      for (let i = 0; i < o.length; i += 3) { t.p[i] = ax + (o[i] - ax) * f; t.p[i + 1] = ay + (o[i + 1] - ay) * f; }
      t.l = Math.max(0.5, Math.min(30, orig[k].l * f));
    });
    sel.box = { x: Math.min(ax, ax + vx * f), y: Math.min(ay, ay + vy * f), w: Math.abs(vx * f), h: Math.abs(vy * f) };
  }

  function recolorir(c) {
    if (!sel) return;
    copiarSelecao();
    sel.tracos.forEach(t => { t.c = c; });
    mudou = true;
    redesenharBase();
  }

  /* ---------- caneta, dedo e borracha ---------- */
  function ponto(ev) {
    const r = cv.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width * LARGURA;
    const y = (ev.clientY - r.top) / r.height * altura;
    const pr = ev.pointerType === 'pen' && ev.pressure > 0 ? ev.pressure : 0.5;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(pr * 100)];
  }

  const dedoDesenha = () => $('.est-desenho-dedo input').checked;
  const meio = () => { const [a, b] = [...dedos.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 }; };

  function inicio(ev) {
    if (ev.pointerType === 'touch') {
      dedos.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (dedos.size === 2) {
        // Segundo dedo: vira pinça; o traço que o primeiro dedo começou é descartado
        if (ponteiroDedo) { atual = null; ponteiro = null; ponteiroDedo = false; laco = null; if (arrasto) terminarArrasto(); redesenhar(); }
        const m = meio(), r = cv.getBoundingClientRect();
        pinca = { d0: m.d, z0: zoom, fixo: { fx: (m.x - r.left) / r.width, fy: (m.y - r.top) / r.height } };
        return;
      }
      // um dedo sem "Dedo desenha" rola (em mover), salvo sobre a caixa da seleção, que ele arrasta
      const naSelecao = ferramenta === 'selecao' && ev.target === cv && acertoSelecao(ponto(ev)) !== null;
      if (dedos.size > 2 || (!dedoDesenha() && !naSelecao)) return;
    }
    if (ponteiro !== null) return;   // já há uma caneta na folha: a palma não conta
    // Botão lateral da caneta (botão 2) ou ponta de borracha (botão 5): borracha só neste traço
    const botaoCaneta = botaoExtra(ev) || (ev.pointerType === 'pen' && botaoNoAr);
    if ((ev.button > 0 && !botaoCaneta) || ev.target !== cv) return;
    apagando = ferramenta === 'borracha' || botaoCaneta;
    ev.preventDefault();
    ponteiro = ev.pointerId;
    ponteiroDedo = ev.pointerType === 'touch';
    try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* ponteiro que já saiu: segue sem captura */ }
    if (apagando) { guardarHistorico(); atual = null; apagarEm(ponto(ev)); atualizarBarra(); return; }
    if (ferramenta === 'selecao') {
      const pt = ponto(ev), hit = acertoSelecao(pt);
      if (hit !== null) comecarArrasto(hit, pt);
      else { sel = null; laco = [pt[0], pt[1]]; }
      redesenhar();
      atualizarBarra();
      return;
    }
    atual = ferramenta === 'marca'
      ? { f: 'marca', c: corMarca, l: ESPESSURAS[espessura], p: ponto(ev) }
      : { f: 'caneta', c: cor, l: ESPESSURAS[espessura], p: ponto(ev) };
    redesenhar();
  }

  function mover(ev) {
    const dedo = dedos.get(ev.pointerId);
    if (dedo && ev.pointerId !== ponteiro) {
      const antes = { x: dedo.x, y: dedo.y };
      dedo.x = ev.clientX;
      dedo.y = ev.clientY;
      const area = $('.est-desenho-area');
      if (pinca && dedos.size === 2) {
        // o ponto que estava entre os dedos fica entre eles: abrir dá zoom, andar junto arrasta
        const m = meio();
        zoomEm(pinca.z0 * m.d / pinca.d0, m.x, m.y, pinca.fixo);
      } else if (dedos.size === 1) {
        area.scrollLeft -= dedo.x - antes.x;
        area.scrollTop -= dedo.y - antes.y;
      }
      return;
    }
    if (ev.pointerId !== ponteiro) { if (ev.pointerType === 'pen') botaoNoAr = botaoExtra(ev); return; }
    ev.preventDefault();
    // Botão apertado no meio do traço: o que foi riscado fica e dali em diante apaga
    if (!apagando && !laco && !arrasto && botaoExtra(ev)) {
      if (atual) { guardarHistorico(); tracos.push(atual); atual = null; mudou = true; redesenharBase(); }
      guardarHistorico();
      apagando = true;
      atualizarBarra();
    }
    const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
    for (const e of (evs.length ? evs : [ev])) {
      const pt = ponto(e);
      if (apagando) { apagarEm(pt); continue; }
      if (laco) { laco.push(pt[0], pt[1]); continue; }
      if (arrasto) { aplicarArrasto(pt); continue; }
      if (!atual) continue;
      const p = atual.p, n = p.length;
      if (Math.hypot(pt[0] - p[n - 3], pt[1] - p[n - 2]) < 0.8) continue;   // ponto repetido
      p.push(...pt);
    }
    if (atual || laco || arrasto) redesenhar();
  }

  function terminarArrasto() {
    arrasto = null;
    sel.box = caixaDe(sel.tracos);
    mudou = true;
    redesenharBase();
  }

  function fim(ev) {
    if (dedos.delete(ev.pointerId) && pinca && dedos.size < 2) { pinca = null; dimensionar(); }
    if (ev.pointerId !== ponteiro) return;
    ponteiro = null;
    ponteiroDedo = false;
    apagando = false;
    if (laco) { fecharLaco(); redesenhar(); }
    if (arrasto) terminarArrasto();
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

  function tocaTraco(t, pt, raio) {
    const p = t.p, folga = raio + (t.f === 'marca' ? t.l * 2 : t.l);
    if (p.length === 3) return Math.hypot(pt[0] - p[0], pt[1] - p[1]) < folga;
    for (let i = 3; i < p.length; i += 3) if (distTrecho(pt[0], pt[1], p[i - 3], p[i - 2], p[i], p[i + 1]) < folga) return true;
    return false;
  }

  function apagarEm(pt) {
    const antes = tracos.length;
    tracos = tracos.filter(t => !tocaTraco(t, pt, RAIO_BORRACHA));
    if (tracos.length !== antes) { mudou = true; redesenharBase(); }
  }

  /* ---------- histórico e ações ---------- */
  function guardarHistorico() {
    historico.push(tracos.slice());
    if (historico.length > 200) historico.shift();
    refazer = [];
  }

  async function acao(a) {
    if (['desfazer', 'refazer', 'limpar'].includes(a)) sel = null;   // a seleção apontaria para traços de outra versão
    if (a === 'apagarSel' && sel) { guardarHistorico(); tracos = tracos.filter(t => !sel.tracos.includes(t)); sel = null; mudou = true; redesenharBase(); }
    if (a === 'dup' && sel) {
      guardarHistorico();
      const copias = sel.tracos.map(t => ({ ...t, p: t.p.map((n, i) => (i % 3 === 2 ? n : n + 20)) }));
      tracos.push(...copias);
      sel = { tracos: copias, box: caixaDe(copias) };
      mudou = true;
      redesenharBase();
    }
    if (a === 'desfazer' && historico.length) { refazer.push(tracos); tracos = historico.pop(); mudou = true; redesenharBase(); }
    if (a === 'refazer' && refazer.length) { historico.push(tracos); tracos = refazer.pop(); mudou = true; redesenharBase(); }
    if (a === 'limpar' && tracos.length) { guardarHistorico(); tracos = []; mudou = true; redesenharBase(); }
    if (a === 'diag') { const box = $('.est-desenho-diag'); box.hidden = !box.hidden; box.textContent = box.hidden ? '' : 'Encoste a caneta na folha com e sem o botão apertado…'; }
    if (a === 'mais') zoomNoMeio(zoom * 1.25);
    if (a === 'menos') zoomNoMeio(zoom / 1.25);
    if (a === 'zoom') zoomNoMeio(1);
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
    const dados = { v: 1, h: altura, t: tracos.map(t => ({ f: t.f, c: t.c, l: Math.round(t.l * 100) / 100, p: t.p.map((n, i) => (i % 3 === 2 ? Math.round(n) : Math.round(n * 10) / 10)) })) };   // x e y com 0,1 (letra pequena com zoom se deformava no inteiro); pressão inteira
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
    historico = []; refazer = []; atual = null; ponteiro = null; ponteiroDedo = false; mudou = false;
    zoom = 1; pinca = null; dedos.clear(); laco = null; sel = null; arrasto = null;
    if (ferramenta === 'selecao') ferramenta = 'caneta';
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
