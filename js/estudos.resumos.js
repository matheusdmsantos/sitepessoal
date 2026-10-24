/* =============================================
   MEUS RESUMOS (estudos.resumos.js)
   Cada assunto do edital tem o seu resumo (tabela resumos, gravado por salvarResumo do v5
   e editado na janela com páginas do estudos.sessao.js). O resumo geral da matéria não é
   guardado: é montado aqui, na ordem do edital, com a hierarquia tirada da numeração
   ("1", "1.1", "1.1.1"). Assim, salvar o resumo de um assunto já atualiza o da matéria.

   Títulos: matéria = H1; assunto = H2 a H4 pelo nível; página do resumo = um nível abaixo.
   Exporta a matéria em .docx (html-docx-js 0.3.1, sob demanda) ou PDF (html2pdf), na pasta
   escolhida (File System Access, Chrome/Edge) ou em Downloads.
============================================= */
(function () {
  const HTML_DOCX_URL = 'https://cdn.jsdelivr.net/npm/html-docx-js@0.3.1/dist/html-docx.js';
  const CHAVE_MATERIA = 'est_res_materia';
  const CHAVE_TODOS = 'est_res_todos';
  const OUTROS = '__outros__';              // matéria virtual: resumos de disciplinas fora do edital
  const NIVEL_MAX = 3;                      // assuntos vão até H4 (matéria é H1)

  let materiaAtiva = lerLocal(CHAVE_MATERIA, null);
  let mostrarTodos = lerLocal(CHAVE_TODOS, '0') === '1';
  let busca = '';
  let itensDoc = [];        // assuntos do documento aberto (índices usados nos onclick)
  let alvos = [];           // assuntos da árvore ou da busca
  let listaAtual = [];      // matérias da lista lateral

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const vazio = html => !html || html.trim() === '' || html === '<p><br></p>';
  const normalizar = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function lerLocal(chave, padrao) {
    try { const v = localStorage.getItem(chave); return v === null ? padrao : v; } catch (e) { return padrao; }
  }
  function gravarLocal(chave, valor) {
    try { localStorage.setItem(chave, valor); } catch (e) { /* sem armazenamento */ }
  }

  function aviso(msg) {
    if (window.estPlano && window.estPlano.aviso) window.estPlano.aviso(msg);
  }

  function resumoDe(disc, topico) {
    const r = resumosMap[makeResumoKey(disc, topico)];
    return r && !vazio(r.conteudo) ? r : null;
  }

  function texto(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html || '';
    return tpl.content.textContent || '';
  }

  // "id" estável para o âncora de um assunto
  function ancora(disc, topico) {
    const k = makeResumoKey(disc, topico);
    let h = 0;
    for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0;
    return 'res-' + (h >>> 0).toString(36);
  }

  /* =============================================
     MATÉRIAS E HIERARQUIA
  ============================================= */
  function editalAtual() {
    return editaisData.find(e => e.id === currentEditalId) || editaisData[0] || null;
  }

  function numeracao(nome) {
    const m = /^\s*(\d+(?:\.\d+)*)[.)]?\s/.exec(nome || '');
    return m ? m[1] : null;
  }

  /* Matérias do edital ativo + resumos que não têm lugar nele.
     Retorna [{ nome, chave, assuntos: [{ disc, topico, num, nivel, foraDoEdital }] }] */
  function materias() {
    const e = editalAtual();
    const lista = [];
    const conhecidos = new Set();
    const porDisc = {};

    (e ? e.disciplinas : []).forEach(d => {
      const nums = d.topicos.map(t => numeracao(t.nome));
      const niveis = nums.map(n => n ? n.split('.').length : 1);
      const base = Math.min(...niveis, 99) - 1;  // edital que só começa em "1.1" também vira nível 1
      const assuntos = d.topicos.map((t, i) => {
        conhecidos.add(makeResumoKey(d.nome, t.nome));
        return { disc: d.nome, topico: t.nome, num: nums[i], nivel: Math.min(NIVEL_MAX, Math.max(1, niveis[i] - base)) };
      });
      const m = { nome: d.nome, chave: d.nome, assuntos };
      lista.push(m);
      porDisc[normalizar(d.nome.trim())] = m;
    });

    // Resumos de assuntos renomeados, apagados ou de outro edital
    const outros = { nome: 'Outros resumos', chave: OUTROS, assuntos: [], outros: true };
    Object.keys(resumosMap).sort().forEach(k => {
      const r = resumosMap[k];
      if (!r || vazio(r.conteudo) || conhecidos.has(k)) return;
      const [dk, tk] = k.split('|||');
      const disc = r.disciplina_nome || dk;
      const topico = r.topico_nome || tk;
      const dono = porDisc[normalizar(disc.trim())];
      (dono ? dono.assuntos : outros.assuntos).push({ disc, topico, num: null, nivel: 1, foraDoEdital: true });
    });
    if (outros.assuntos.length) lista.push(outros);
    return lista;
  }

  /* Assuntos que entram no documento: os que têm resumo e os "pais" deles (pela numeração),
     ou todos, com "Mostrar todos os assuntos" */
  function assuntosDoDocumento(m, todos = mostrarTodos) {
    const comResumo = m.assuntos.map(a => !!resumoDe(a.disc, a.topico));
    const pais = new Set();
    m.assuntos.forEach((a, i) => {
      if (!comResumo[i] || !a.num) return;
      const partes = a.num.split('.');
      for (let n = 1; n < partes.length; n++) pais.add(partes.slice(0, n).join('.'));
    });
    return m.assuntos
      .map((a, i) => ({ ...a, temResumo: comResumo[i] }))
      .filter(a => todos || a.temResumo || (a.num && pais.has(a.num)));
  }

  /* =============================================
     MONTAGEM DO DOCUMENTO
  ============================================= */
  // Desce os títulos escritos dentro do resumo para ficarem abaixo do título da página/assunto
  function rebaixarTitulos(html, base) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    tpl.content.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
      const nivel = Math.min(6, base + Math.max(1, parseInt(h.tagName[1], 10) - 1));
      const novo = document.createElement('h' + nivel);
      Array.from(h.attributes).forEach(at => novo.setAttribute(at.name, at.value));
      novo.innerHTML = h.innerHTML;
      h.replaceWith(novo);
    });
    return tpl.innerHTML;
  }

  function conteudoDoAssunto(a, hAssunto) {
    const r = resumoDe(a.disc, a.topico);
    if (!r) return '';
    const paginas = window.estSessao ? window.estSessao.separarPaginas(r.conteudo) : [{ titulo: '', html: r.conteudo, semTitulo: true }];
    const soUma = paginas.length === 1 && paginas[0].semTitulo;
    const hPag = Math.min(6, hAssunto + 1);
    return paginas.map(p => {
      const titulo = soUma || (p.semTitulo && vazio(p.html)) ? '' : `<h${hPag} class="est-pagina">${esc(p.titulo)}</h${hPag}>`;
      return titulo + rebaixarTitulos(vazio(p.html) ? '' : p.html, soUma ? hAssunto : hPag);
    }).join('');
  }

  /* paraExportar: sem botões, sem avisos de "sem resumo" */
  function montarDocumento(m, itens, paraExportar) {
    let html = `<h1>${esc(m.nome)}</h1>`;
    let foraJaAnunciado = false;
    itens.forEach((a, i) => {
      if (a.foraDoEdital && !m.outros && !foraJaAnunciado) {
        html += `<h2>Assuntos fora do edital</h2>`;
        foraJaAnunciado = true;
      }
      // Em "Outros resumos", agrupa pela disciplina
      if (m.outros && (i === 0 || itens[i - 1].disc !== a.disc)) html += `<h2>${esc(a.disc)}</h2>`;
      const h = a.foraDoEdital ? 3 : 1 + a.nivel;
      const corpo = conteudoDoAssunto(a, h);
      if (paraExportar) {
        html += `<h${h}>${esc(a.topico)}</h${h}>${corpo}`;
        return;
      }
      html += `
        <section class="est-res-assunto ${a.temResumo ? '' : 'sem-resumo'}" id="${ancora(a.disc, a.topico)}">
          <div class="est-res-assunto-topo">
            <h${h}>${esc(a.topico)}</h${h}>
            <span class="est-res-assunto-acoes">
              <button type="button" onclick="estResumos.editar(${i})" title="Editar o resumo deste assunto">${a.temResumo ? '✏️ Editar' : '＋ Escrever'}</button>
              ${a.temResumo ? `<button type="button" class="perigo" onclick="estResumos.apagar(${i})" title="Apagar o resumo deste assunto" aria-label="Apagar resumo de ${esc(a.topico)}">🗑</button>` : ''}
            </span>
          </div>
          ${corpo}
        </section>`;
    });
    return html;
  }

  /* =============================================
     TELA
  ============================================= */
  function render() {
    const raiz = $('est-resumos');
    if (!raiz) return;
    const secao = $('est-section-resumos');
    if (secao && !secao.classList.contains('active')) return;   // navigateTo('resumos') desenha de novo
    if (document.querySelector('#est-modal-sessao.active')) return;  // a janela de resumo chama render() ao fechar

    if (!$('est-res-busca')) {
      raiz.innerHTML = `
        <aside class="est-res-lado" aria-label="Matérias e assuntos">
          <div class="est-res-lado-topo">
            <h2>Meus Resumos</h2>
            <input type="search" id="est-res-busca" class="est-res-busca" placeholder="Buscar assunto ou texto…" aria-label="Buscar nos resumos" autocomplete="off" />
          </div>
          <nav id="est-res-lista" class="est-res-lista"></nav>
        </aside>
        <div class="est-res-principal" id="est-res-principal"></div>`;
      let t = null;
      $('est-res-busca').addEventListener('input', ev => {
        clearTimeout(t);
        t = setTimeout(() => { busca = ev.target.value.trim(); renderLista(); }, 180);
      });
    }

    const lista = materias();
    if (!lista.some(m => m.chave === materiaAtiva)) {
      const comResumo = lista.find(m => m.assuntos.some(a => resumoDe(a.disc, a.topico)));
      materiaAtiva = (comResumo || lista[0] || {}).chave || null;
    }
    renderLista(lista);
    renderDocumento(lista);
  }

  function renderLista(lista = materias()) {
    const el = $('est-res-lista');
    if (!el) return;
    listaAtual = lista;
    alvos = [];
    const alvo = a => { alvos.push(a); return alvos.length - 1; };

    if (busca) {
      const q = normalizar(busca);
      const achados = [];
      lista.forEach(m => m.assuntos.forEach(a => {
        const r = resumoDe(a.disc, a.topico);
        const noNome = normalizar(a.topico).includes(q);
        const corpo = r ? texto(r.conteudo) : '';
        const pos = normalizar(corpo).indexOf(q);
        if (noNome || pos >= 0) achados.push({ a, m, trecho: pos >= 0 ? corpo.slice(Math.max(0, pos - 40), pos + q.length + 60) : '' });
      }));
      el.innerHTML = achados.length
        ? `<p class="est-res-lista-info">${achados.length} resultado${achados.length > 1 ? 's' : ''}</p>` + achados.slice(0, 80).map(({ a, m, trecho }) => `
            <button type="button" class="est-res-achado" onclick="estResumos.abrirAlvo(${alvo({ ...a, materia: m.chave })})">
              <span class="est-res-achado-disc">${esc(m.outros ? a.disc : m.nome)}</span>
              <span class="est-res-achado-top">${esc(a.topico)}</span>
              ${trecho ? `<span class="est-res-achado-trecho">…${esc(trecho)}…</span>` : ''}
            </button>`).join('')
        : `<p class="est-res-lista-info">Nada encontrado para "${esc(busca)}".</p>`;
      return;
    }

    if (!lista.length) {
      el.innerHTML = `<p class="est-res-lista-info">Nenhum edital cadastrado. Importe um edital em "Edital Verticalizado" para organizar os resumos por matéria.</p>`;
      return;
    }

    el.innerHTML = lista.map((m, idx) => {
      const total = m.assuntos.filter(a => !a.foraDoEdital).length;
      const feitos = m.assuntos.filter(a => (m.outros || !a.foraDoEdital) && resumoDe(a.disc, a.topico)).length;
      const ativa = m.chave === materiaAtiva;
      const arvore = ativa ? `
        <ul class="est-res-arvore">
          ${m.assuntos.map(a => {
            const tem = !!resumoDe(a.disc, a.topico);
            return `<li class="nivel-${a.nivel} ${tem ? 'tem' : ''}">
              <button type="button" onclick="estResumos.abrirAlvo(${alvo({ ...a, materia: m.chave })})" title="${tem ? 'Ir para o resumo' : 'Escrever resumo'}">
                <span class="est-res-ponto" aria-hidden="true"></span>
                <span class="est-res-arvore-nome">${esc(a.topico)}</span>
              </button>
            </li>`;
          }).join('')}
        </ul>` : '';
      return `
        <div class="est-res-materia ${ativa ? 'ativa' : ''}">
          <button type="button" class="est-res-materia-btn" aria-expanded="${ativa}" onclick="estResumos.escolherMateria(${idx})">
            <span class="est-res-materia-nome">${esc(m.nome)}</span>
            <span class="est-res-materia-conta">${m.outros ? feitos : `${feitos}/${total}`}</span>
          </button>
          ${arvore}
        </div>`;
    }).join('');
  }

  function renderDocumento(lista = materias()) {
    const el = $('est-res-principal');
    if (!el) return;
    const m = lista.find(x => x.chave === materiaAtiva);
    if (!m) {
      el.innerHTML = `<div class="est-res-vazio"><span>📄</span><p>Nenhuma matéria para mostrar.</p></div>`;
      return;
    }
    const rolagem = el.scrollTop;
    itensDoc = assuntosDoDocumento(m);
    const feitos = m.assuntos.filter(a => (m.outros || !a.foraDoEdital) && resumoDe(a.disc, a.topico)).length;
    const total = m.assuntos.filter(a => !a.foraDoEdital).length;
    const pastaOk = !!window.showDirectoryPicker;

    el.innerHTML = `
      <header class="est-res-topo">
        <div class="est-res-topo-info">
          <span class="est-plano-tag">Resumo geral da matéria</span>
          <span class="est-res-topo-conta">${m.outros ? `${feitos} resumo${feitos === 1 ? '' : 's'} fora do edital ativo` : `${feitos} de ${total} assuntos com resumo`}</span>
        </div>
        <div class="est-res-topo-acoes">
          ${m.outros ? '' : `<label class="est-res-todos"><input type="checkbox" ${mostrarTodos ? 'checked' : ''} onchange="estResumos.alternarTodos(this.checked)"> Mostrar todos os assuntos</label>`}
          <button type="button" class="est-plano-btn" onclick="estResumos.exportar('docx')" ${feitos ? '' : 'disabled'}>📄 Word</button>
          <button type="button" class="est-plano-btn" onclick="estResumos.exportar('pdf')" ${feitos ? '' : 'disabled'}>🖨️ PDF</button>
          ${pastaOk ? `<button type="button" class="est-plano-btn sutil" id="est-res-pasta" onclick="estResumos.trocarPasta()" title="Pasta onde os arquivos exportados são salvos">📁 Escolher pasta</button>` : ''}
        </div>
      </header>
      ${itensDoc.length ? `
      <article class="est-res-folha ql-snow">
        <div class="ql-editor est-res-doc">${montarDocumento(m, itensDoc, false)}</div>
      </article>` : `
      <div class="est-res-vazio">
        <span>✍️</span>
        <p>Nenhum resumo em <strong>${esc(m.nome)}</strong> ainda.</p>
        <p class="sutil">Escolha um assunto na lista ao lado para escrever. O que você salvar aparece aqui, no lugar dele no edital.</p>
        <button type="button" class="est-plano-btn primario" onclick="estResumos.alternarTodos(true)">Mostrar todos os assuntos</button>
      </div>`}`;
    el.scrollTop = rolagem;
    if (pastaOk) mostrarPasta();
  }

  function escolher(chave) {
    if (materiaAtiva !== chave) {
      materiaAtiva = chave;
      gravarLocal(CHAVE_MATERIA, chave);
      const el = $('est-res-principal');
      if (el) el.scrollTop = 0;
    }
    render();
  }

  function alternarTodos(v) {
    mostrarTodos = !!v;
    gravarLocal(CHAVE_TODOS, mostrarTodos ? '1' : '0');
    renderDocumento();
  }

  function rolarAte(disc, topico) {
    const sec = document.getElementById(ancora(disc, topico));
    if (!sec) return false;
    sec.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    sec.classList.remove('destaque');
    void sec.offsetWidth;
    sec.classList.add('destaque');
    return true;
  }

  /* Clique na árvore ou na busca: vai até o resumo; assunto sem resumo abre o editor */
  function abrirAlvo(i) {
    const a = alvos[i];
    if (!a) return;
    if (!resumoDe(a.disc, a.topico)) { window.estSessao.abrirResumo(a.disc, a.topico); return; }
    if (busca) {
      busca = '';
      $('est-res-busca').value = '';
    }
    if (a.materia !== materiaAtiva) escolher(a.materia); else renderLista();
    rolarAte(a.disc, a.topico);
  }

  /* Vindo da janela de resumo ("📚 Resumo da matéria") */
  function irPara(disc, topico) {
    navigateTo('resumos');
    const m = materias().find(x => x.assuntos.some(a => makeResumoKey(a.disc, a.topico) === makeResumoKey(disc, topico)));
    busca = '';
    if ($('est-res-busca')) $('est-res-busca').value = '';
    if (m) escolher(m.chave); else render();
    setTimeout(() => rolarAte(disc, topico), 50);
  }

  function editar(i) {
    const a = itensDoc[i];
    if (a) window.estSessao.abrirResumo(a.disc, a.topico);
  }

  async function apagar(i) {
    const a = itensDoc[i];
    const r = a && resumoDe(a.disc, a.topico);
    if (!r) return;
    if (!(await window.customConfirm(`Apagar o resumo de "${a.topico}"? Todas as páginas dele serão perdidas.`))) return;
    const key = makeResumoKey(a.disc, a.topico);
    delete resumosMap[key];
    try {
      const backups = JSON.parse(localStorage.getItem('est_resumos_backup') || '{}');
      delete backups[key];
      localStorage.setItem('est_resumos_backup', JSON.stringify(backups));
    } catch (e) { /* backup local indisponível */ }
    if (r.id) {
      const { error } = await window.supabaseClient.from('resumos').delete().eq('id', r.id);
      if (error) { console.error('Erro ao apagar resumo:', error); aviso('Apagado neste navegador, mas houve erro ao apagar no servidor.'); }
    }
    render();
  }

  /* =============================================
     EXPORTAÇÃO (Word e PDF) E PASTA DE DESTINO
  ============================================= */
  function idb(modo, fn) {
    return new Promise((ok, falha) => {
      const req = indexedDB.open('est-resumos', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onerror = () => falha(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('kv', modo);
        const r = fn(tx.objectStore('kv'));
        tx.oncomplete = () => { db.close(); ok(r && r.result); };
        tx.onerror = () => { db.close(); falha(tx.error); };
      };
    });
  }
  const lerPasta = () => idb('readonly', st => st.get('pasta')).catch(() => null);
  const gravarPasta = h => idb('readwrite', st => st.put(h, 'pasta')).catch(() => {});

  async function mostrarPasta() {
    const pasta = await lerPasta();
    const btn = $('est-res-pasta');
    if (btn) btn.textContent = pasta ? `📁 ${pasta.name}` : '📁 Escolher pasta';
  }

  async function escolherPasta() {
    const pasta = await window.showDirectoryPicker({ id: 'resumos', mode: 'readwrite' });
    await gravarPasta(pasta);
    mostrarPasta();
    return pasta;
  }

  async function trocarPasta() {
    try { await escolherPasta(); } catch (e) { /* cancelado */ }
  }

  /* Pede a pasta (ou a permissão de novo) ainda no clique, antes das esperas longas.
     null = vai para Downloads. Lança AbortError se o usuário cancelar a escolha. */
  async function pastaDestino() {
    if (!window.showDirectoryPicker) return null;
    const pasta = await lerPasta();
    if (pasta) {
      let perm = await pasta.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') perm = await pasta.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') return pasta;
    }
    return escolherPasta();
  }

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

  // Classes do Quill viram estilos, que o Word e o PDF entendem sem a folha do Quill
  function estilosEmLinha(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    tpl.content.querySelectorAll('[class*="ql-"]').forEach(el => {
      const css = [];
      el.classList.forEach(c => {
        let m;
        if ((m = /^ql-align-(center|right|justify)$/.exec(c))) css.push(`text-align:${m[1]}`);
        else if ((m = /^ql-indent-(\d)$/.exec(c))) css.push(`margin-left:${m[1] * 3}em`);
        else if (c === 'ql-font-serif') css.push('font-family:Georgia,serif');
        else if (c === 'ql-font-monospace') css.push('font-family:Consolas,monospace');
      });
      if (css.length) el.setAttribute('style', (el.getAttribute('style') || '') + ';' + css.join(';'));
    });
    tpl.content.querySelectorAll('img').forEach(img => { img.style.maxWidth = '100%'; });
    return tpl.innerHTML;
  }

  /* No Word, max-width não vale: a imagem precisa de largura e altura em pixels,
     limitadas à página (A4 com margens de 2 cm ≈ 640 px) */
  const LARGURA_PAGINA_PX = 640;
  async function imagensParaWord(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    for (const img of tpl.content.querySelectorAll('img')) {
      const el = new Image();
      el.src = img.getAttribute('src');
      try { await el.decode(); } catch (e) { continue; }
      if (!el.naturalWidth) continue;
      const w = Math.min(parseInt(img.getAttribute('width'), 10) || el.naturalWidth, LARGURA_PAGINA_PX);
      img.setAttribute('width', w);
      img.setAttribute('height', Math.round(w * el.naturalHeight / el.naturalWidth));
      img.style.maxWidth = '';
    }
    return tpl.innerHTML;
  }

  const ESTILO_EXPORT = `
    body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #000; line-height: 1.4; }
    h1 { font-size: 20pt; color: #1f3864; }
    h2 { font-size: 16pt; color: #2f5496; }
    h3 { font-size: 13pt; color: #2f5496; }
    h4 { font-size: 12pt; color: #1f3864; }
    h5, h6 { font-size: 11pt; color: #1f3864; }
    blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 12px; color: #444; }
    pre { background: #f3f4f6; padding: 8px; font-family: Consolas, monospace; font-size: 10pt; }`;

  function nomeArquivo(nome, ext) {
    return nome.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() + '.' + ext;
  }

  async function exportar(formato) {
    const m = materias().find(x => x.chave === materiaAtiva);
    if (!m) return;
    const itens = assuntosDoDocumento(m, false);   // o arquivo leva só o que tem resumo (e os títulos "pai")
    if (!itens.some(a => a.temResumo)) { aviso('Esta matéria ainda não tem resumos.'); return; }

    let pasta = null;
    try { pasta = await pastaDestino(); } catch (e) { if (e.name === 'AbortError') return; console.warn('Sem acesso à pasta, o arquivo vai para Downloads:', e); }

    const corpo = estilosEmLinha(montarDocumento(m, itens, true));
    const nome = nomeArquivo(m.outros ? 'Outros resumos' : m.nome, formato);
    aviso(`Gerando ${nome}…`);
    let blob;
    try {
      if (formato === 'docx') {
        await carregarScript(HTML_DOCX_URL, 'htmlDocx');
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(m.nome)}</title><style>${ESTILO_EXPORT}</style></head><body>${await imagensParaWord(corpo)}</body></html>`;
        blob = window.htmlDocx.asBlob(html, { orientation: 'portrait', margins: { top: 1134, right: 1134, bottom: 1134, left: 1134 } });
      } else {
        await window.carregarHtml2pdf();
        const el = document.createElement('div');
        el.innerHTML = `<style>${ESTILO_EXPORT.replace(/body/g, '.est-res-pdf')}</style><div class="est-res-pdf">${corpo}</div>`;
        blob = await html2pdf().set({
          margin: 15,
          image: { type: 'jpeg', quality: 0.95 },
          html2canvas: { scale: 2 },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'], avoid: ['h1', 'h2', 'h3', 'h4', 'img'] }
        }).from(el).outputPdf('blob');
      }
    } catch (e) {
      console.error('Erro ao gerar o arquivo:', e);
      aviso('Não foi possível gerar o arquivo. Verifique a conexão e tente de novo.');
      return;
    }

    if (pasta) {
      try {
        const arq = await pasta.getFileHandle(nome, { create: true });
        const w = await arq.createWritable();
        await w.write(blob);
        await w.close();
        aviso(`Salvo em ${pasta.name}/${nome}`);
        return;
      } catch (e) {
        console.error('Erro ao gravar na pasta:', e);
        aviso(`Não deu para gravar em ${pasta.name} (o arquivo está aberto no Word?). Baixando em Downloads.`);
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  window.estResumos = {
    render,
    escolherMateria: i => listaAtual[i] && escolher(listaAtual[i].chave),
    alternarTodos, abrirAlvo, irPara, editar, apagar, exportar, trocarPasta
  };
})();
