/* ─── js/estudos.erros.js — Caderno de Erros ───
 *
 * Cada questão errada do TEC vira um cartão ligado a um tópico do edital: enunciado
 * (colado do site, com imagens), gabarito, a resposta dada, o motivo do erro e a
 * regra certa em uma frase.
 *
 * Revisão por cartão: o enunciado aparece sem o gabarito e a pessoa responde de novo.
 * Acertou, o intervalo cresce (INTERVALOS: 1, 7, 30 e 90 dias); errou, volta para
 * amanhã. Depois de acertar em todas as etapas, a questão está dominada.
 *
 * Os dados ficam na tabela erros (supabase/erros.sql). Sem ela, ficam só neste
 * navegador (localStorage 'est_erros') e são enviados quando a tabela aparecer.
 *
 * Depende de estudos.v5.js (editaisData, currentEditalId, dataLocal, navigateTo),
 * de estudos.plano.js (renderSecao) e de estudos.sessao.js (colar e imagens).
 */
(function () {
  const sb = window.supabaseClient;
  const INTERVALOS = [1, 7, 30, 90];   // dias até a revisão, por etapa
  const MOTIVOS = [
    { id: 'conteudo', icone: '📖', nome: 'Não sabia o conteúdo' },
    { id: 'esqueci', icone: '🧠', nome: 'Sabia, mas esqueci' },
    { id: 'leitura', icone: '👀', nome: 'Li errado / não vi a palavra-chave' },
    { id: 'pegadinha', icone: '⚖️', nome: 'Caí na pegadinha da banca' },
    { id: 'pressa', icone: '⏱', nome: 'Pressa ou chute' },
    { id: 'gabarito', icone: '❓', nome: 'Gabarito discutível' }
  ];
  const OPCOES = { ce: [['C', 'Certo'], ['E', 'Errado']], me: ['A', 'B', 'C', 'D', 'E'].map(l => [l, l]) };
  const LOCAL = 'est_erros';
  const ULTIMO = 'est_erros_ultimo';   // disciplina/tópico do último registro

  let erros = [];
  let remoto = false;
  let carregado = false;
  let filtro = { disc: '', topico: '', motivo: '', situacao: '', busca: '' };
  let abertos = new Set();
  let form = null;      // { id?, tipo, gabarito, resposta, motivo } enquanto o formulário está aberto
  let fila = null;      // { itens, i, respondida }

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hoje = () => dataLocal();
  const novoId = () => 'err_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const motivo = id => MOTIVOS.find(m => m.id === id);

  function somarDias(str, n) {
    const d = new Date(str + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return dataLocal(d);
  }

  function fmtData(str) {
    if (!str) return '';
    const [a, m, d] = str.slice(0, 10).split('-');
    return `${d}/${m}${a !== String(new Date().getFullYear()) ? '/' + a.slice(2) : ''}`;
  }

  const rotuloOpcao = (tipo, v) => v === '' || v == null ? 'Em branco'
    : ((OPCOES[tipo] || OPCOES.ce).find(o => o[0] === v) || [v, v])[1];

  /* =============================================
     DADOS
  ============================================= */
  function lerLocal() {
    try { return JSON.parse(localStorage.getItem(LOCAL)) || []; } catch { return []; }
  }

  function salvarLocal() {
    try { localStorage.setItem(LOCAL, JSON.stringify(erros)); }
    catch (e) { aviso('Sem espaço no navegador para guardar o erro. Rode o supabase/erros.sql.'); }
  }

  async function carregar() {
    const user = await window.authReady;
    if (!user) return;
    const { data, error } = await sb.from('erros').select('*');
    if (!error) {
      remoto = true;
      erros = data || [];
      // Envia o que tinha sido guardado só aqui antes de a tabela existir
      const locais = lerLocal().filter(l => !erros.some(r => r.id === l.id));
      if (locais.length) {
        const r = await sb.from('erros').upsert(locais.map(({ dono, ...l }) => l));
        if (!r.error) { erros.push(...locais); localStorage.removeItem(LOCAL); }
      } else {
        localStorage.removeItem(LOCAL);
      }
    } else {
      console.warn('Tabela erros indisponível; o caderno fica só neste navegador.', error);
      erros = lerLocal();
    }
    carregado = true;
    renderTudo();
  }

  async function gravar(e) {
    e.atualizado_em = new Date().toISOString();
    if (!remoto) { salvarLocal(); return true; }
    const { dono, ...linha } = e;   // o banco preenche o dono
    const { error } = await sb.from('erros').upsert(linha);
    if (error) {
      console.error('Erro ao salvar no caderno de erros:', error);
      aviso('Não foi possível salvar no servidor. Confira sua conexão.');
      return false;
    }
    return true;
  }

  async function apagar(id) {
    erros = erros.filter(e => e.id !== id);
    if (!remoto) { salvarLocal(); return; }
    const { error } = await sb.from('erros').delete().eq('id', id);
    if (error) { console.error(error); aviso('Não foi possível excluir no servidor.'); }
  }

  /* =============================================
     EDITAL: disciplinas e tópicos
  ============================================= */
  const editalAtual = () => (typeof editaisData !== 'undefined' ? editaisData : []).find(e => e.id === currentEditalId);

  function acharTopico(tId) {
    for (const e of (typeof editaisData !== 'undefined' ? editaisData : [])) {
      for (const d of e.disciplinas) {
        const t = d.topicos.find(x => x.id === tId);
        if (t) return { e, d, t };
      }
    }
    return null;
  }

  function acharDisc(dId) {
    for (const e of (typeof editaisData !== 'undefined' ? editaisData : [])) {
      const d = e.disciplinas.find(x => x.id === dId);
      if (d) return { e, d };
    }
    return null;
  }

  const nomeDisc = er => (acharDisc(er.disciplina_id) || {}).d?.nome || er.disciplina_nome || 'Sem disciplina';
  const nomeTopico = er => (er.topico_id && (acharTopico(er.topico_id) || {}).t?.nome) || er.topico_nome || '';

  // Erros do edital ativo (os de editais apagados também aparecem)
  function doEdital() {
    const e = editalAtual();
    return erros.filter(er => !e || er.edital_id === e.id || !acharDisc(er.disciplina_id));
  }

  /* =============================================
     SITUAÇÃO E REVISÃO
  ============================================= */
  function situacao(er) {
    if (er.dominado_em) return 'dominada';
    if (er.proxima && er.proxima <= hoje()) return 'hoje';
    return 'revisao';
  }

  const pendentes = lista => lista.filter(er => situacao(er) === 'hoje')
    .sort((a, b) => (a.proxima || '').localeCompare(b.proxima || ''));

  function aplicarResposta(er, r) {
    const certo = r === er.gabarito;
    er.revisoes = (er.revisoes || 0) + 1;
    if (certo) er.acertos = (er.acertos || 0) + 1;
    er.ultima_revisao = hoje();
    if (certo) {
      er.etapa = (er.etapa || 0) + 1;
      if (er.etapa >= INTERVALOS.length) { er.dominado_em = hoje(); er.proxima = null; }
      else er.proxima = somarDias(hoje(), INTERVALOS[er.etapa]);
    } else {
      er.etapa = 0;
      er.dominado_em = null;
      er.proxima = somarDias(hoje(), INTERVALOS[0]);
    }
    return certo;
  }

  /* =============================================
     HTML COLADO: limpeza e segurança
     O enunciado vem do site do TEC; só ficam tags de texto, tabelas e imagens.
  ============================================= */
  const TAGS_OK = new Set(['P', 'DIV', 'BR', 'SPAN', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'STRIKE', 'DEL', 'SUB', 'SUP',
    'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'IMG', 'A', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'PRE', 'CODE', 'HR']);
  const TAGS_FORA = /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|FORM|INPUT|BUTTON|TEXTAREA|SELECT|SVG|MATH|LINK|META|TITLE|NOSCRIPT|VIDEO|AUDIO)$/;

  function sanitizar(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    doc.body.querySelectorAll('*').forEach(el => {
      if (TAGS_FORA.test(el.tagName)) { el.remove(); return; }
      if (!TAGS_OK.has(el.tagName)) { el.replaceWith(...el.childNodes); return; }
      [...el.attributes].forEach(a => {
        const n = a.name.toLowerCase();
        const ok = n === 'style' || n === 'width' || n === 'colspan' || n === 'rowspan' ||
          (n === 'src' && el.tagName === 'IMG' && /^(data:image\/|https:)/i.test(a.value)) ||
          (n === 'href' && /^https?:/i.test(a.value));
        if (!ok) el.removeAttribute(a.name);
      });
      if (el.tagName === 'A') { el.target = '_blank'; el.rel = 'noopener'; }
      if (el.tagName === 'IMG' && !el.getAttribute('src')) el.remove();
    });
    return doc.body.innerHTML;
  }

  const textoDe = html => {
    const tpl = document.createElement('template');
    // Espaço entre parágrafos, para o trecho não juntar "correta.A) Todo…"
    tpl.innerHTML = String(html || '').replace(/<\/(p|div|li|tr|td|th|h\d)>|<br\s*\/?>/gi, m => m + ' ');
    return tpl.content.textContent.replace(/\s+/g, ' ').trim();
  };

  // Insere no cursor; sem cursor no campo, acrescenta no fim
  function inserirHtml(html, el) {
    const sel = window.getSelection();
    const noCampo = el && sel.rangeCount && el.contains(sel.getRangeAt(0).commonAncestorContainer);
    if (noCampo && document.execCommand('insertHTML', false, html)) return;
    if (el) el.insertAdjacentHTML('beforeend', html);
  }

  // Editor simples (contenteditable): cola do TEC limpo e imagens reduzidas
  function prepararEditor(el, aoColar) {
    el.addEventListener('paste', async ev => {
      const d = ev.clipboardData;
      if (!d) return;
      ev.preventDefault();
      const arquivos = Array.from(d.items || []).filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile());
      const html = d.getData('text/html');
      const texto = d.getData('text/plain');
      const temTexto = html && new DOMParser().parseFromString(html, 'text/html').body.textContent.trim();
      if (arquivos.length && !temTexto) {
        for (const f of arquivos) {
          try { inserirHtml(`<img src="${await reduzir(f)}" alt="">`, el); }
          catch (e) { aviso('Não foi possível colar a imagem.'); }
        }
      } else if (html) {
        const limpar = window.estSessao && window.estSessao.limparHtmlColado;
        inserirHtml(sanitizar(limpar ? limpar(html) : html), el);
      } else if (texto) {
        inserirHtml(esc(texto).replace(/\r?\n/g, '<br>'), el);
      }
      if (aoColar) aoColar(texto || textoDe(html));
    });
    el.addEventListener('drop', async ev => {
      const arquivos = Array.from(ev.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
      if (!arquivos.length) return;
      ev.preventDefault();
      el.focus();
      for (const f of arquivos) inserirHtml(`<img src="${await reduzir(f)}" alt="">`, el);
    });
  }

  function reduzir(arquivo) {
    if (window.estSessao && window.estSessao.reduzirImagem) return window.estSessao.reduzirImagem(arquivo);
    return new Promise((ok, falha) => {
      const r = new FileReader();
      r.onload = () => ok(r.result);
      r.onerror = falha;
      r.readAsDataURL(arquivo);
    });
  }

  /* Pistas no texto colado: número da questão no TEC e o formato (Certo/Errado ou A–E) */
  function detectar(texto) {
    const t = String(texto || '');
    const id = (t.match(/tecconcursos\.com\.br\/questoes\/(\d+)/i) || t.match(/quest[aã]o\s*(?:n[ºo°.]*\s*)?#?\s*(\d{5,})/i) || [])[1];
    if (id && !$('est-erro-tec').value.trim()) $('est-erro-tec').value = id;
    const alternativas = (t.match(/(^|\n|\s)[A-E]\s*[)\-.]\s+\S/g) || []).length;
    if (!form.gabarito) {
      if (/\bcerto\b[\s\S]{0,40}\berrado\b/i.test(t) && alternativas < 3) mudarTipo('ce');
      else if (alternativas >= 3) mudarTipo('me');
    }
  }

  // "1234567", "#1234567" ou a URL da questão
  function lerTec(valor) {
    const v = String(valor || '').trim();
    if (!v) return { tec_id: null, link: null };
    const id = (v.match(/questoes\/(\d+)/) || v.match(/^#?\s*(\d{4,})$/) || [])[1] || null;
    const link = /^https?:\/\//i.test(v) ? v : id ? `https://www.tecconcursos.com.br/questoes/${id}` : null;
    return { tec_id: id, link };
  }

  /* =============================================
     FORMULÁRIO: registrar / editar
  ============================================= */
  function preencherDiscs(edital, dId, tId) {
    const sel = $('est-erro-disc');
    const discs = edital ? edital.disciplinas : [];
    sel.innerHTML = '<option value="">Escolha a disciplina</option>' +
      discs.map(d => `<option value="${esc(d.id)}">${esc(d.nome)}</option>`).join('');
    sel.value = discs.some(d => d.id === dId) ? dId : '';
    preencherTopicos(tId);
  }

  function preencherTopicos(tId) {
    const ref = acharDisc($('est-erro-disc').value);
    const sel = $('est-erro-topico');
    const tops = ref ? ref.d.topicos : [];
    sel.innerHTML = '<option value="">Sem tópico</option>' +
      tops.map(t => `<option value="${esc(t.id)}">${esc(t.nome.length > 90 ? t.nome.slice(0, 89) + '…' : t.nome)}</option>`).join('');
    sel.value = tops.some(t => t.id === tId) ? tId : '';
  }

  function renderOpcoes() {
    const grupo = (campo, valor, comBranco) => (OPCOES[form.tipo].concat(comBranco ? [['', 'Em branco']] : []))
      .map(([v, rotulo]) => `<button type="button" class="est-erro-op ${valor === v ? 'ativa' : ''}" data-campo="${campo}" data-valor="${esc(v)}" aria-pressed="${valor === v}">${esc(rotulo)}</button>`).join('');
    $('est-erro-gabarito').innerHTML = grupo('gabarito', form.gabarito, false);
    $('est-erro-resposta').innerHTML = grupo('resposta', form.resposta, form.tipo === 'ce');
    document.querySelectorAll('input[name="est-erro-tipo"]').forEach(r => { r.checked = r.value === form.tipo; });
    $('est-erro-motivos').innerHTML = MOTIVOS.map(m => `
      <button type="button" class="est-erro-motivo ${form.motivo === m.id ? 'ativa' : ''}" data-campo="motivo" data-valor="${m.id}" aria-pressed="${form.motivo === m.id}">
        <span aria-hidden="true">${m.icone}</span> ${esc(m.nome)}
      </button>`).join('');
  }

  function mudarTipo(tipo) {
    if (form.tipo === tipo) return;
    form.tipo = tipo;
    form.gabarito = null;
    form.resposta = null;
    renderOpcoes();
  }

  function lerUltimo() {
    try { return JSON.parse(localStorage.getItem(ULTIMO)) || {}; } catch { return {}; }
  }

  /* contexto: { discId, topicoId } (ficha do tópico, janela de estudo) ou um erro para editar */
  function novo(contexto = {}) {
    abrirForm(null, contexto);
  }

  function editar(id) {
    const er = erros.find(x => x.id === id);
    if (er) abrirForm(er, {});
  }

  function abrirForm(er, contexto) {
    const ultimo = lerUltimo();
    const dId = er ? er.disciplina_id : contexto.discId || ultimo.discId;
    const tId = er ? er.topico_id : contexto.topicoId || (contexto.discId ? '' : ultimo.topicoId);
    const edital = er ? (acharDisc(er.disciplina_id) || {}).e || editalAtual() : editalAtual();
    form = {
      id: er ? er.id : null,
      tipo: er ? er.tipo : 'ce',
      gabarito: er ? er.gabarito : null,
      resposta: er ? er.resposta : null,
      motivo: er ? er.motivo : null,
      edital
    };
    $('est-erro-form-titulo').textContent = er ? 'Editar erro' : 'Registrar questão errada';
    $('est-erro-tec').value = er ? (er.link || er.tec_id || '') : '';
    $('est-erro-enunciado').innerHTML = er ? sanitizar(er.enunciado) : '';
    $('est-erro-comentario').innerHTML = er ? sanitizar(er.comentario) : '';
    $('est-erro-regra').value = er ? er.regra || '' : '';
    $('est-erro-comentario-bloco').open = !!(er && er.comentario);
    $('est-erro-outro').hidden = !!er;
    preencherDiscs(edital, dId, tId);
    renderOpcoes();
    statusForm('');
    $('est-modal-erro').classList.add('active');
    setTimeout(() => (er ? $('est-erro-regra') : $('est-erro-enunciado')).focus(), 50);
  }

  function fecharForm() {
    $('est-modal-erro').classList.remove('active');
    form = null;
  }

  function statusForm(msg) {
    const el = $('est-erro-form-status');
    el.textContent = msg;
    el.hidden = !msg;
  }

  async function salvarForm(outro) {
    if (!form) return;
    const enunciado = sanitizar($('est-erro-enunciado').innerHTML);
    const discId = $('est-erro-disc').value;
    const topicoId = $('est-erro-topico').value;
    if (!textoDe(enunciado) && !/<img/i.test(enunciado)) return statusForm('Cole o enunciado da questão.');
    if (!form.gabarito) return statusForm('Marque o gabarito.');
    if (!discId) return statusForm('Escolha a disciplina.');
    const refD = acharDisc(discId);
    const refT = topicoId ? acharTopico(topicoId) : null;
    const tec = lerTec($('est-erro-tec').value);
    const comentario = sanitizar($('est-erro-comentario').innerHTML);
    const existente = form.id ? erros.find(x => x.id === form.id) : null;
    const er = existente || {
      id: novoId(), etapa: 0, proxima: somarDias(hoje(), INTERVALOS[0]),
      revisoes: 0, acertos: 0, ultima_revisao: null, dominado_em: null, criado_em: new Date().toISOString()
    };
    Object.assign(er, {
      edital_id: refD ? refD.e.id : null,
      disciplina_id: discId,
      topico_id: topicoId || null,
      disciplina_nome: refD ? refD.d.nome : null,
      topico_nome: refT ? refT.t.nome : null,
      tec_id: tec.tec_id,
      link: tec.link,
      tipo: form.tipo,
      gabarito: form.gabarito,
      resposta: form.resposta,
      motivo: form.motivo,
      regra: $('est-erro-regra').value.trim() || null,
      enunciado,
      comentario: textoDe(comentario) || /<img/i.test(comentario) ? comentario : null
    });
    if (!existente) erros.push(er);
    try { localStorage.setItem(ULTIMO, JSON.stringify({ discId, topicoId })); } catch { /* só conveniência */ }
    $('est-erro-salvar').disabled = true;
    const ok = await gravar(er);
    $('est-erro-salvar').disabled = false;
    renderTudo();
    if (!ok) return;
    if (outro) {
      toast('Erro registrado. Cole a próxima questão.');
      abrirForm(null, { discId, topicoId });
    } else {
      fecharForm();
      toast(existente ? 'Erro atualizado.' : 'Erro registrado. A primeira revisão é amanhã.');
    }
  }

  /* =============================================
     REVISÃO POR CARTÃO
  ============================================= */
  function revisar(ids) {
    const lista = ids ? ids.map(id => erros.find(e => e.id === id)).filter(Boolean) : pendentes(filtrados());
    if (!lista.length) { toast('Nenhuma questão para revisar agora.'); return; }
    fila = { itens: lista, i: 0, respondida: null, certos: 0 };
    renderCartao();
    $('est-modal-erro-rev').classList.add('active');
  }

  function renderCartao() {
    const er = fila.itens[fila.i];
    const r = fila.respondida;
    const certo = r !== null && r === er.gabarito;
    const m = motivo(er.motivo);
    const ultimo = fila.i === fila.itens.length - 1;
    $('est-erro-rev-conteudo').innerHTML = `
      <div class="est-erro-rev-topo">
        <div>
          <span class="est-plano-tag">Revisão de erros · ${fila.i + 1} de ${fila.itens.length}</span>
          <h2 class="est-modal-title" id="est-erro-rev-titulo">${esc(nomeTopico(er) || nomeDisc(er))}</h2>
          <span class="est-plano-sub">${esc(nomeDisc(er))}${er.tec_id ? ` · Questão ${esc(er.tec_id)} do TEC` : ''}</span>
        </div>
        <button type="button" class="est-modal-close" data-acao="fechar-rev" aria-label="Fechar revisão">✕</button>
      </div>
      <div class="est-erro-enunciado-ver">${sanitizar(er.enunciado)}</div>
      <div class="est-erro-rev-ops" role="group" aria-label="Sua resposta">
        ${OPCOES[er.tipo === 'me' ? 'me' : 'ce'].map(([v, rotulo]) => `
          <button type="button" class="est-erro-op grande ${r === null ? '' : v === er.gabarito ? 'certa' : v === r ? 'errada' : ''}"
            data-acao="responder" data-valor="${esc(v)}" ${r === null ? '' : 'disabled'}>${esc(rotulo)}</button>`).join('')}
      </div>
      ${r === null ? `
      <div class="est-erro-rev-rodape">
        <button type="button" class="est-plano-btn sutil" data-acao="pular">Pular</button>
      </div>` : `
      <div class="est-erro-resultado ${certo ? 'bom' : 'ruim'}" role="status">
        <strong>${certo ? '✓ Acertou!' : '✗ Errou de novo.'}</strong>
        <span>${er.dominado_em ? 'Questão dominada: sai das revisões.' : `Próxima revisão em ${fmtData(er.proxima)}.`}</span>
      </div>
      <dl class="est-erro-detalhes">
        <div><dt>Gabarito</dt><dd>${esc(rotuloOpcao(er.tipo, er.gabarito))}</dd></div>
        <div><dt>Quando errou</dt><dd>${esc(rotuloOpcao(er.tipo, er.resposta))}</dd></div>
        ${m ? `<div><dt>Motivo</dt><dd>${m.icone} ${esc(m.nome)}</dd></div>` : ''}
      </dl>
      ${er.regra ? `<p class="est-erro-regra"><span>Regra</span>${esc(er.regra)}</p>` : ''}
      ${er.comentario ? `<details class="est-erro-coment"><summary>Comentário</summary><div class="est-erro-enunciado-ver">${sanitizar(er.comentario)}</div></details>` : ''}
      <div class="est-erro-rev-rodape">
        ${er.link ? `<a class="est-plano-btn sutil" href="${esc(er.link)}" target="_blank" rel="noopener">Abrir no TEC ↗</a>` : '<span></span>'}
        <button type="button" class="est-plano-btn primario" data-acao="proxima">${ultimo ? 'Concluir' : 'Próxima →'}</button>
      </div>`}`;
  }

  async function responder(v) {
    const er = fila.itens[fila.i];
    fila.respondida = v;
    if (aplicarResposta(er, v)) fila.certos++;
    renderCartao();
    await gravar(er);
    renderTudo();
  }

  function proxima() {
    fila.i++;
    fila.respondida = null;
    if (fila.i >= fila.itens.length) {
      const n = fila.itens.length;
      toast(`Revisão concluída: ${fila.certos} de ${n} acerto${n === 1 ? '' : 's'}.`);
      fecharRevisao();
      return;
    }
    renderCartao();
  }

  function fecharRevisao() {
    $('est-modal-erro-rev').classList.remove('active');
    fila = null;
  }

  /* =============================================
     SEÇÃO "CADERNO DE ERROS"
  ============================================= */
  function filtrados() {
    const busca = filtro.busca.trim().toLowerCase();
    return doEdital().filter(er =>
      (!filtro.disc || er.disciplina_id === filtro.disc) &&
      (!filtro.topico || er.topico_id === filtro.topico) &&
      (!filtro.motivo || er.motivo === filtro.motivo) &&
      (!filtro.situacao || situacao(er) === filtro.situacao) &&
      (!busca || `${textoDe(er.enunciado)} ${er.regra || ''} ${er.tec_id || ''} ${nomeTopico(er)}`.toLowerCase().includes(busca)));
  }

  function bannerLocal() {
    return remoto ? '' : `<div class="est-plano-banner">⚠️ A tabela <code>erros</code> ainda não existe no Supabase: rode o <code>supabase/erros.sql</code>. Até lá, o caderno fica só neste navegador.</div>`;
  }

  function htmlMotivos(lista) {
    const cont = MOTIVOS.map(m => ({ m, n: lista.filter(e => e.motivo === m.id).length })).filter(x => x.n);
    if (!cont.length) return '';
    const total = lista.filter(e => e.motivo).length;
    const max = Math.max(...cont.map(x => x.n));
    cont.sort((a, b) => b.n - a.n);
    return `
      <div class="est-plano-card">
        <h3 class="est-plano-card-title">Por que você erra</h3>
        <div class="est-erro-barras">${cont.map(x => `
          <button type="button" class="est-erro-barra ${filtro.motivo === x.m.id ? 'ativa' : ''}" data-acao="motivo" data-valor="${x.m.id}" title="Filtrar por este motivo">
            <span>${x.m.icone} ${esc(x.m.nome)}</span>
            <strong>${x.n} <small>${Math.round(x.n / total * 100)}%</small></strong>
            <div class="est-inc-barra"><div style="width:${x.n / max * 100}%"></div></div>
          </button>`).join('')}
        </div>
      </div>`;
  }

  function htmlItem(er) {
    const aberto = abertos.has(er.id);
    const m = motivo(er.motivo);
    const sit = situacao(er);
    const selo = sit === 'dominada' ? '<span class="est-erro-selo bom">✓ Dominada</span>'
      : sit === 'hoje' ? '<span class="est-erro-selo hoje">Revisar hoje</span>'
      : `<span class="est-erro-selo">Revisão ${fmtData(er.proxima)}</span>`;
    const txt = textoDe(er.enunciado);
    return `
      <article class="est-erro ${aberto ? 'aberto' : ''}">
        <header class="est-erro-cab">
          <div class="est-erro-ref">
            <span class="est-plano-tag">${esc(nomeDisc(er))}</span>
            <span class="est-erro-topico">${esc(nomeTopico(er) || 'Sem tópico')}</span>
          </div>
          <div class="est-erro-selos">
            ${m ? `<span class="est-erro-selo motivo" title="${esc(m.nome)}">${m.icone} ${esc(m.nome)}</span>` : ''}
            ${selo}
          </div>
        </header>
        ${aberto
          ? `<div class="est-erro-enunciado-ver">${sanitizar(er.enunciado)}</div>
             <dl class="est-erro-detalhes">
               <div><dt>Gabarito</dt><dd>${esc(rotuloOpcao(er.tipo, er.gabarito))}</dd></div>
               <div><dt>Sua resposta</dt><dd>${esc(rotuloOpcao(er.tipo, er.resposta))}</dd></div>
               <div><dt>Revisões</dt><dd>${er.revisoes ? `${er.acertos || 0} de ${er.revisoes} certas` : 'nenhuma ainda'}</dd></div>
               <div><dt>Registrado</dt><dd>${fmtData(er.criado_em)}</dd></div>
             </dl>
             ${er.regra ? `<p class="est-erro-regra"><span>Regra</span>${esc(er.regra)}</p>` : ''}
             ${er.comentario ? `<details class="est-erro-coment"><summary>Comentário</summary><div class="est-erro-enunciado-ver">${sanitizar(er.comentario)}</div></details>` : ''}`
          : `<p class="est-erro-trecho">${esc(txt.length > 240 ? txt.slice(0, 240) + '…' : txt || '(imagem)')}</p>
             ${er.regra ? `<p class="est-erro-regra curta"><span>Regra</span>${esc(er.regra)}</p>` : ''}`}
        <footer class="est-erro-acoes">
          <button type="button" class="est-plano-btn sutil" data-acao="abrir" data-id="${er.id}" aria-expanded="${aberto}">${aberto ? 'Recolher' : 'Ver questão'}</button>
          <button type="button" class="est-plano-btn" data-acao="revisar-um" data-id="${er.id}">▶ Revisar</button>
          ${er.link ? `<a class="est-plano-btn sutil" href="${esc(er.link)}" target="_blank" rel="noopener">TEC ↗</a>` : ''}
          <span class="est-erro-espaco"></span>
          <button type="button" class="est-plano-btn sutil" data-acao="editar" data-id="${er.id}">Editar</button>
          <button type="button" class="est-plano-btn sutil est-erro-excluir" data-acao="excluir" data-id="${er.id}">Excluir</button>
        </footer>
      </article>`;
  }

  function render() {
    const el = $('est-erros');
    if (!el) return;
    if (!carregado) { el.innerHTML = '<p class="est-plano-vazio">Carregando o caderno…</p>'; return; }
    const e = editalAtual();
    const todos = doEdital();
    const lista = filtrados().sort((a, b) => (b.criado_em || '').localeCompare(a.criado_em || ''));
    const paraHoje = pendentes(filtrados()).length;
    const discs = e ? e.disciplinas.filter(d => todos.some(x => x.disciplina_id === d.id)) : [];
    const refD = filtro.disc && acharDisc(filtro.disc);
    const tops = refD ? refD.d.topicos.filter(t => todos.some(x => x.topico_id === t.id)) : [];
    const n = s => todos.filter(x => situacao(x) === s).length;

    el.innerHTML = `
      ${bannerLocal()}
      <div class="est-plano-topo">
        <div>
          <h2 class="est-plano-titulo">❌ Caderno de Erros</h2>
          <span class="est-plano-sub">${e ? esc(e.titulo) + ' · ' : ''}cada questão errada volta em 1, 7, 30 e 90 dias até você acertar todas as vezes</span>
        </div>
        <div class="est-plano-topo-acoes">
          <button type="button" class="est-plano-btn" data-acao="novo">＋ Registrar erro</button>
          <button type="button" class="est-plano-btn primario" data-acao="revisar" ${paraHoje ? '' : 'disabled'}>▶ Revisar ${paraHoje ? `(${paraHoje})` : ''}</button>
        </div>
      </div>

      ${todos.length ? `
      <div class="est-plano-kpis">
        <div class="est-plano-kpi"><span>Registrados</span><strong>${todos.length}</strong></div>
        <div class="est-plano-kpi"><span>Para revisar hoje</span><strong>${n('hoje')}</strong></div>
        <div class="est-plano-kpi"><span>Em revisão</span><strong>${n('revisao')}</strong></div>
        <div class="est-plano-kpi"><span>Dominados</span><strong>${n('dominada')}</strong></div>
      </div>

      ${htmlMotivos(filtro.motivo ? todos.filter(x => (!filtro.disc || x.disciplina_id === filtro.disc)) : filtrados())}

      <div class="est-erro-filtros" role="search">
        <input type="search" class="est-form-input" id="est-erro-busca" placeholder="Buscar no enunciado, na regra ou nº da questão" value="${esc(filtro.busca)}" aria-label="Buscar erros" />
        <select class="est-form-select" data-filtro="disc" aria-label="Disciplina">
          <option value="">Todas as disciplinas</option>
          ${discs.map(d => `<option value="${esc(d.id)}" ${filtro.disc === d.id ? 'selected' : ''}>${esc(d.nome)}</option>`).join('')}
        </select>
        <select class="est-form-select" data-filtro="topico" aria-label="Tópico" ${refD ? '' : 'disabled'}>
          <option value="">${refD ? 'Todos os tópicos' : 'Escolha a disciplina'}</option>
          ${tops.map(t => `<option value="${esc(t.id)}" ${filtro.topico === t.id ? 'selected' : ''}>${esc(t.nome.length > 70 ? t.nome.slice(0, 69) + '…' : t.nome)}</option>`).join('')}
        </select>
        <select class="est-form-select" data-filtro="motivo" aria-label="Motivo">
          <option value="">Todos os motivos</option>
          ${MOTIVOS.map(m => `<option value="${m.id}" ${filtro.motivo === m.id ? 'selected' : ''}>${m.icone} ${esc(m.nome)}</option>`).join('')}
        </select>
        <select class="est-form-select" data-filtro="situacao" aria-label="Situação">
          <option value="">Todas as situações</option>
          <option value="hoje" ${filtro.situacao === 'hoje' ? 'selected' : ''}>Para revisar hoje</option>
          <option value="revisao" ${filtro.situacao === 'revisao' ? 'selected' : ''}>Em revisão</option>
          <option value="dominada" ${filtro.situacao === 'dominada' ? 'selected' : ''}>Dominadas</option>
        </select>
      </div>

      <div class="est-erro-lista">
        ${lista.length ? lista.map(htmlItem).join('') : '<p class="est-plano-vazio">Nenhum erro com estes filtros.</p>'}
      </div>` : `
      <div class="est-plano-card est-erro-vazio">
        <p class="est-plano-texto">Ainda não há erros registrados${e ? ' neste edital' : ''}.</p>
        <p class="est-plano-sub">Errou uma questão no TEC? Copie o enunciado, clique em <strong>＋ Registrar erro</strong> e cole. Marque o gabarito, o motivo do erro e a regra certa em uma frase. Também dá para registrar pela ficha do tópico (Edital Verticalizado) e pela janela de estudo.</p>
      </div>`}`;
    atualizarSelo();
  }

  // Número de questões para revisar hoje no item do menu
  function atualizarSelo() {
    const item = document.querySelector('.est-sidebar-item[data-section="erros"]');
    if (!item) return;
    let selo = item.querySelector('.est-erro-contador');
    const n = carregado ? pendentes(doEdital()).length : 0;
    if (!n) { if (selo) selo.remove(); return; }
    if (!selo) {
      selo = document.createElement('span');
      selo.className = 'est-erro-contador';
      item.appendChild(selo);
    }
    selo.textContent = n;
    selo.title = `${n} questão${n === 1 ? '' : 'ões'} para revisar hoje`;
  }

  function renderTudo() {
    if (typeof currentSection !== 'undefined' && currentSection === 'erros') render();
    else atualizarSelo();
    if (window.estEdital && document.querySelector('#est-ed-ficha.aberta')) window.estEdital.render();
  }

  /* Bloco da ficha lateral do tópico (estudos.edital.js) */
  function blocoFicha(eId, dId, tId) {
    const lista = erros.filter(x => x.topico_id === tId);
    const hojeN = lista.filter(x => situacao(x) === 'hoje').length;
    const dom = lista.filter(x => situacao(x) === 'dominada').length;
    const arg = JSON.stringify({ discId: dId, topicoId: tId }).replace(/"/g, '&quot;');
    return `
      <section class="est-ed-ficha-bloco">
        <h3>Caderno de erros</h3>
        ${lista.length
          ? `<p class="est-ed-ficha-resumo">${lista.length} quest${lista.length === 1 ? 'ão' : 'ões'} errada${lista.length === 1 ? '' : 's'}${hojeN ? ` · <strong>${hojeN} para revisar hoje</strong>` : ''}${dom ? ` · ${dom} dominada${dom === 1 ? '' : 's'}` : ''}</p>`
          : '<p class="est-ed-ficha-vazio">Nenhum erro registrado neste tópico.</p>'}
        <div class="est-ed-ficha-linha">
          <button type="button" class="est-plano-btn" onclick="estErros.novo(${arg})">＋ Registrar erro</button>
          ${lista.length ? `<button type="button" class="est-ed-link" onclick="estErros.verTopico('${esc(dId)}', '${esc(tId)}')">Ver no caderno</button>` : ''}
          ${hojeN ? `<button type="button" class="est-ed-link" onclick="estErros.revisarTopico('${esc(tId)}')">▶ Revisar agora</button>` : ''}
        </div>
      </section>`;
  }

  function verTopico(dId, tId) {
    filtro = { disc: dId, topico: tId, motivo: '', situacao: '', busca: '' };
    if (window.estEdital) window.estEdital.fecharFicha();
    navigateTo('erros');
  }

  function revisarTopico(tId) {
    revisar(pendentes(erros.filter(x => x.topico_id === tId)).map(x => x.id));
  }

  /* =============================================
     AVISOS
  ============================================= */
  function toast(msg) {
    if (window.estPlano && window.estPlano.aviso) window.estPlano.aviso(msg);
  }
  const aviso = toast;

  /* =============================================
     EVENTOS
  ============================================= */
  function init() {
    if (!$('est-modal-erro')) return;

    // A seção é desenhada quando o menu a abre (navigateTo → estPlano.renderSecao)
    if (window.estPlano && window.estPlano.renderSecao) {
      const original = window.estPlano.renderSecao;
      window.estPlano.renderSecao = secao => { original(secao); if (secao === 'erros') render(); };
    }

    const sec = $('est-erros');
    sec.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-acao]');
      if (!b) return;
      const id = b.dataset.id;
      switch (b.dataset.acao) {
        case 'novo': novo(filtro.disc ? { discId: filtro.disc, topicoId: filtro.topico } : {}); break;
        case 'revisar': revisar(); break;
        case 'revisar-um': revisar([id]); break;
        case 'editar': editar(id); break;
        case 'abrir':
          abertos.has(id) ? abertos.delete(id) : abertos.add(id);
          render();
          break;
        case 'motivo':
          filtro.motivo = filtro.motivo === b.dataset.valor ? '' : b.dataset.valor;
          render();
          break;
        case 'excluir':
          if (!(await window.customConfirm('Excluir esta questão do caderno de erros?'))) return;
          await apagar(id);
          renderTudo();
          break;
      }
    });
    sec.addEventListener('change', ev => {
      const campo = ev.target.dataset.filtro;
      if (!campo) return;
      filtro[campo] = ev.target.value;
      if (campo === 'disc') filtro.topico = '';
      render();
    });
    let atraso = null;
    sec.addEventListener('input', ev => {
      if (ev.target.id !== 'est-erro-busca') return;
      clearTimeout(atraso);
      atraso = setTimeout(() => {
        filtro.busca = ev.target.value;
        const pos = ev.target.selectionStart;
        render();
        const campo = $('est-erro-busca');
        campo.focus();
        campo.setSelectionRange(pos, pos);
      }, 250);
    });

    // Formulário
    prepararEditor($('est-erro-enunciado'), detectar);
    prepararEditor($('est-erro-comentario'));
    $('est-modal-erro').addEventListener('click', ev => {
      if (ev.target.id === 'est-modal-erro') return fecharForm();
      const b = ev.target.closest('button[data-campo]');
      if (!b || !form) return;
      const v = b.dataset.valor;
      form[b.dataset.campo] = form[b.dataset.campo] === v ? null : v;
      renderOpcoes();
    });
    document.querySelectorAll('input[name="est-erro-tipo"]').forEach(r =>
      r.addEventListener('change', () => { if (r.checked) mudarTipo(r.value); }));
    $('est-erro-disc').addEventListener('change', () => preencherTopicos(''));
    $('est-erro-tec').addEventListener('change', ev => detectar(ev.target.value));
    $('est-erro-form').addEventListener('submit', ev => { ev.preventDefault(); salvarForm(false); });
    $('est-erro-outro').addEventListener('click', () => salvarForm(true));
    $('est-erro-cancelar').addEventListener('click', fecharForm);
    $('est-modal-erro-close').addEventListener('click', fecharForm);

    // Revisão
    $('est-modal-erro-rev').addEventListener('click', ev => {
      if (ev.target.id === 'est-modal-erro-rev') return fecharRevisao();
      const b = ev.target.closest('[data-acao]');
      if (!b || !fila) return;
      if (b.dataset.acao === 'responder') responder(b.dataset.valor);
      else if (b.dataset.acao === 'proxima') proxima();
      else if (b.dataset.acao === 'pular') { fila.respondida = null; proxima(); }
      else if (b.dataset.acao === 'fechar-rev') fecharRevisao();
    });

    // Janela de estudo: registra o erro no tópico que está aberto
    const botaoSessao = $('est-sessao-erro');
    if (botaoSessao) botaoSessao.addEventListener('click', () => {
      const c = window.estSessao && window.estSessao.contexto();
      const e = editalAtual();
      const d = c && e && e.disciplinas.find(x => x.nome === c.disc);
      const t = d && d.topicos.find(x => x.nome === c.topico);
      novo({ discId: d ? d.id : '', topicoId: t ? t.id : '' });
    });

    carregar();
  }

  document.addEventListener('DOMContentLoaded', init);

  window.estErros = { novo, editar, revisar, revisarTopico, verTopico, blocoFicha, render };
})();
