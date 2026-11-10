/* Tela do PDF (motor de estudos, etapa 1 da interface): o PDF e a lista de subtópicos com páginas,
   caderno do TEC, peso de incidência, "não cai no edital" e itens do edital vinculados. Cadastro rápido
   por linhas, sugestão pelo sumário e validação ficam no estudos.pdf.cadastro.js (puro).
   Abre pela lista de PDFs da disciplina (🧩) e pela ficha do item. Grava nas colunas novas de subtopicos
   (supabase/motor.sql) e em motor_pdfs; mantém o campo antigo subtopicos.pdfs igual, para o resto do painel. */
(function () {
  let ctx = null;   // { pdf, disc, item, motor, linhas: [{ id?, nome, pag_ini, pag_fim, tec_link, peso, nao_cai, itens_edital, apagar? }], itensEdital, previa }
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const aviso = msg => window.estPlano.aviso(msg);
  const C = () => window.estCadastroPdf;

  function overlay() {
    let ov = $('est-modal-pdf');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.className = 'est-modal-overlay';
    ov.id = 'est-modal-pdf';
    ov.innerHTML = '<div class="est-modal est-pdf-tela" role="dialog" aria-modal="true" aria-labelledby="est-pdf-titulo"></div>';
    ov.addEventListener('click', ev => { if (ev.target === ov) fechar(); });
    document.body.appendChild(ov);
    return ov;
  }

  function abrir(pdfId) {
    const P = window.estPlano;
    if (!P.temMotor()) { aviso('A tela do PDF precisa do supabase/motor.sql rodado no Supabase.'); return; }
    const motor = P.motorPdfs().find(x => x.id === pdfId);
    let pdf = null, disc = null, edital = null;
    for (const e of editaisData) for (const d of e.disciplinas) {
      const m = P.materiaisDaDisciplina(d.id).find(x => x.id === pdfId);
      if (m) { pdf = m; disc = d; edital = e; }
    }
    if (!pdf) { aviso('Salve a lista de PDFs antes de abrir a tela do PDF.'); return; }
    const item = ((pdf.topicos || []).find(l => disc.topicos.some(t => t.id === l.topico_id)) || {}).topico_id;
    if (!item) { aviso('Este PDF não tem item próprio. Use o edital por PDF.'); return; }
    const subs = window.estSub.doTopico(item).filter(s => (s.material_id ? s.material_id === pdfId : (s.pdfs || []).some(p => p.material_id === pdfId) || !(s.pdfs || []).length));
    ctx = {
      pdf, disc, edital, item, motor: motor || {},
      pdfTec: (motor && motor.tec_link) || '', pdfPeso: motor && motor.peso != null ? motor.peso : '',
      itensEdital: P.itensDoEditalDeOrigem(edital, disc.nome),
      linhas: subs.map(s => {
        const p = (s.pdfs || []).find(x => x.material_id === pdfId) || {};
        return { id: s.id, nomeAntigo: s.nome, nome: s.nome, pag_ini: s.pag_ini || p.de || null, pag_fim: s.pag_fim || p.ate || null,
          tec_link: s.tec_link || '', peso: s.peso != null ? s.peso : '', nao_cai: !!s.nao_cai, itens_edital: s.itens_edital || [] };
      }).sort((a, b) => (a.pag_ini || 1e9) - (b.pag_ini || 1e9)),
      previa: null, itensAberto: null
    };
    render();
    overlay().classList.add('active');
  }

  function fechar() {
    const ov = $('est-modal-pdf');
    if (ov) ov.classList.remove('active');
    ctx = null;
  }

  function render() {
    const v = C().validar(ctx.linhas.filter(l => !l.apagar), ctx.pdf.paginas);
    const vivas = ctx.linhas.filter(l => !l.apagar);
    const errosDe = l => v.erros.filter(e => vivas[e.i] === l).map(e => e.msg);
    const nomeItem = id => (ctx.itensEdital.find(x => x.id === id) || {}).nome || id;
    const html = `
      <div class="est-modal-header">
        <div>
          <h2 class="est-modal-title" id="est-pdf-titulo">📄 ${esc(ctx.pdf.nome)}</h2>
          <p class="est-pdf-sub">${esc(ctx.disc.nome)} · ${ctx.pdf.paginas} páginas</p>
        </div>
        <button type="button" class="est-modal-close" data-a="fechar" aria-label="Fechar">✕</button>
      </div>
      <div class="est-pdf-cab">
        <label>Caderno do TEC do PDF <small>(o subtópico sem caderno usa este)</small>
          <input type="url" class="est-form-input" data-pdf="tec" value="${esc(ctx.pdfTec)}" placeholder="https://www.tecconcursos.com.br/…" /></label>
        <label>Peso do PDF <small>(opcional)</small>
          <input type="number" class="est-form-input" data-pdf="peso" min="0" step="0.5" value="${esc(ctx.pdfPeso)}" placeholder="—" /></label>
      </div>

      <h3 class="est-pdf-h3">Subtópicos <small>(${vivas.length})</small></h3>
      <div class="est-pdf-tabela-caixa">
      <table class="est-pdf-tabela">
        <thead><tr><th>Nome</th><th>Páginas</th><th>Caderno do TEC</th><th title="Peso de incidência (opcional)">Peso</th><th title="Não cai no edital: as páginas são puladas na leitura">Não cai</th><th>Itens do edital</th><th></th></tr></thead>
        <tbody>
        ${ctx.linhas.map((l, i) => l.apagar ? '' : `
          <tr class="${errosDe(l).length ? 'erro' : ''} ${l.nao_cai ? 'nao-cai' : ''}" data-i="${i}">
            <td><input class="est-form-input" data-k="nome" value="${esc(l.nome)}" aria-label="Nome do subtópico" />
              ${errosDe(l).map(m => `<span class="est-pdf-msg">${esc(m)}</span>`).join('')}</td>
            <td class="est-pdf-pags"><input type="number" class="est-form-input" data-k="pag_ini" min="1" max="${ctx.pdf.paginas}" value="${l.pag_ini || ''}" aria-label="Página inicial" />
              <span>a</span><input type="number" class="est-form-input" data-k="pag_fim" min="1" max="${ctx.pdf.paginas}" value="${l.pag_fim || ''}" aria-label="Página final" /></td>
            <td><input type="url" class="est-form-input" data-k="tec_link" value="${esc(l.tec_link)}" placeholder="${ctx.pdfTec ? 'usa o do PDF' : 'https://…'}" aria-label="Caderno do TEC" /></td>
            <td><input type="number" class="est-form-input est-pdf-peso" data-k="peso" min="0" step="0.5" value="${esc(l.peso)}" placeholder="—" aria-label="Peso de incidência" /></td>
            <td class="est-pdf-centro"><input type="checkbox" data-k="nao_cai" ${l.nao_cai ? 'checked' : ''} aria-label="Não cai no edital" /></td>
            <td><button type="button" class="est-ed-link" data-a="itens" data-i="${i}">${l.itens_edital.length ? esc(l.itens_edital.map(nomeItem).join('; ')) : (ctx.itensEdital.length ? '+ vincular' : '—')}</button></td>
            <td><button type="button" class="est-plano-btn sutil" data-a="apagar" data-i="${i}" aria-label="Excluir ${esc(l.nome)}" title="Excluir">✕</button></td>
          </tr>
          ${ctx.itensAberto === i ? `<tr class="est-pdf-itens"><td colspan="7">
            <div class="est-pdf-itens-lista">${ctx.itensEdital.map(x => `<label><input type="checkbox" data-item="${esc(x.id)}" data-i="${i}" ${l.itens_edital.includes(x.id) ? 'checked' : ''} /> ${esc(x.nome)}</label>`).join('')}</div>
            <button type="button" class="est-plano-btn" data-a="itens" data-i="${i}">Fechar</button></td></tr>` : ''}`).join('')}
        </tbody>
      </table>
      </div>
      <div class="est-ed-ficha-linha">
        <button type="button" class="est-plano-btn" data-a="nova">＋ Subtópico</button>
        <button type="button" class="est-plano-btn" data-a="sumario" title="Escolha o arquivo do PDF: o sumário das primeiras páginas vira a sugestão">📑 Sugerir pelo sumário</button>
        <input type="file" accept="application/pdf,.pdf" id="est-pdf-arquivo" hidden />
      </div>
      ${v.avisos.length ? `<div class="est-pdf-avisos">${v.avisos.map(a => `<p>⚠ ${esc(a)}</p>`).join('')}</div>` : ''}

      <details class="est-pdf-rapido" ${ctx.previa ? 'open' : ''}>
        <summary>Cadastro rápido (colar várias linhas)</summary>
        <p class="est-pdf-sub">Uma linha por subtópico: <code>nome; pág. inicial-final; link do caderno</code> (o link é opcional). Ex.: <code>Hífen; 13-15; https://www.tecconcursos.com.br/caderno/AbC</code></p>
        <textarea class="est-form-input" id="est-pdf-colar" rows="5" placeholder="Acentuação; 1-12&#10;Hífen; 13-15; https://…">${esc(ctx.colado || '')}</textarea>
        <div class="est-ed-ficha-linha"><button type="button" class="est-plano-btn" data-a="previa">Pré-visualizar</button></div>
        ${ctx.previa ? htmlPrevia() : ''}
      </details>

      <div class="est-pdf-rodape">
        <span class="est-pdf-sub">${v.erros.length ? `<strong class="est-pdf-msg">${v.erros.length} problema(s) para corrigir antes de salvar.</strong>` : 'Pronto para salvar.'}</span>
        <button type="button" class="est-btn-cancelar" data-a="fechar">Cancelar</button>
        <button type="button" class="est-btn-register" data-a="salvar" ${v.erros.length ? 'disabled' : ''}>Salvar</button>
      </div>`;
    overlay().querySelector('.est-pdf-tela').innerHTML = html;
    ligar();
  }

  function htmlPrevia() {
    const ok = ctx.previa.filter(r => !r.erros.length);
    return `
      <table class="est-pdf-tabela est-pdf-previa">
        <thead><tr><th>Linha</th><th>Nome</th><th>Páginas</th><th>Caderno</th><th></th></tr></thead>
        <tbody>${ctx.previa.map(r => `<tr class="${r.erros.length ? 'erro' : ''}"><td>${r.linha}</td><td>${esc(r.nome)}</td>
          <td>${r.pag_ini ? `${r.pag_ini}–${r.pag_fim}` : '—'}</td><td>${r.tec_link ? '✓' : '—'}</td>
          <td>${r.erros.length ? `<span class="est-pdf-msg">${esc(r.erros.join('; '))}</span>` : '✓'}</td></tr>`).join('')}</tbody>
      </table>
      <div class="est-ed-ficha-linha">
        <button type="button" class="est-plano-btn primario" data-a="usarPrevia" ${ok.length ? '' : 'disabled'}>Adicionar ${ok.length} à lista</button>
        <span class="est-pdf-sub">${ctx.previa.length - ok.length ? `${ctx.previa.length - ok.length} linha(s) com problema ficam de fora. ` : ''}Nome igual a um subtópico da lista atualiza esse subtópico.</span>
      </div>`;
  }

  function ligar() {
    const tela = overlay().querySelector('.est-pdf-tela');
    tela.querySelectorAll('tr[data-i] [data-k]').forEach(inp => inp.addEventListener('change', () => {
      const l = ctx.linhas[inp.closest('tr').dataset.i];
      const k = inp.dataset.k;
      l[k] = k === 'nao_cai' ? inp.checked : k === 'pag_ini' || k === 'pag_fim' ? (parseInt(inp.value, 10) || null) : inp.value.trim();
      render();
    }));
    tela.querySelectorAll('[data-pdf]').forEach(inp => inp.addEventListener('change', () => {
      if (inp.dataset.pdf === 'tec') ctx.pdfTec = inp.value.trim(); else ctx.pdfPeso = inp.value;
    }));
    tela.querySelectorAll('input[data-item]').forEach(cb => cb.addEventListener('change', () => {
      const l = ctx.linhas[cb.dataset.i];
      l.itens_edital = cb.checked ? [...new Set([...l.itens_edital, cb.dataset.item])] : l.itens_edital.filter(x => x !== cb.dataset.item);
    }));
    $('est-pdf-colar').addEventListener('input', ev => { ctx.colado = ev.target.value; });
    $('est-pdf-arquivo').addEventListener('change', ev => sugerirPeloSumario(ev.target.files[0]));
    tela.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => acao(b.dataset.a, b.dataset.i)));
  }

  async function acao(a, i) {
    if (a === 'fechar') fechar();
    else if (a === 'nova') { ctx.linhas.push({ nome: '', pag_ini: null, pag_fim: null, tec_link: '', peso: '', nao_cai: false, itens_edital: [] }); render(); }
    else if (a === 'apagar') {
      const l = ctx.linhas[i];
      if (l.id) l.apagar = true; else ctx.linhas.splice(i, 1);
      render();
    } else if (a === 'itens') { ctx.itensAberto = ctx.itensAberto === Number(i) ? null : Number(i); render(); }
    else if (a === 'previa') { ctx.previa = C().lerLinhas(ctx.colado, ctx.pdf.paginas); render(); }
    else if (a === 'usarPrevia') {
      ctx.previa.filter(r => !r.erros.length).forEach(r => {
        const ja = ctx.linhas.find(l => !l.apagar && l.nome.trim().toLowerCase() === r.nome.toLowerCase());
        const campos = { pag_ini: r.pag_ini, pag_fim: r.pag_fim, ...(r.tec_link ? { tec_link: r.tec_link } : {}) };
        if (ja) Object.assign(ja, campos);
        else ctx.linhas.push({ nome: r.nome, tec_link: '', peso: '', nao_cai: false, itens_edital: [], ...campos });
      });
      ctx.previa = null;
      ctx.colado = '';
      ctx.linhas.sort((x, y) => (x.pag_ini || 1e9) - (y.pag_ini || 1e9));
      render();
    } else if (a === 'sumario') $('est-pdf-arquivo').click();
    else if (a === 'salvar') salvar();
  }

  /* A3: lê as primeiras páginas do arquivo e manda o sumário para o cadastro rápido, para conferir */
  async function sugerirPeloSumario(arquivo) {
    if (!arquivo) return;
    try {
      await window.estImportar.carregarPdfjs();
      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise;
      const linhas = [];
      for (let p = 1; p <= Math.min(6, pdf.numPages); p++) {
        const c = await (await pdf.getPage(p)).getTextContent();
        let atual = '', y = null;
        c.items.forEach(it => {
          if (typeof it.str !== 'string') return;
          const yi = it.transform[5];
          if (y !== null && Math.abs(yi - y) > 3) { linhas.push(atual); atual = ''; }
          atual += (atual && !/\s$/.test(atual) ? ' ' : '') + it.str;
          y = yi;
          if (it.hasEOL) { linhas.push(atual); atual = ''; y = null; }
        });
        if (atual) linhas.push(atual);
      }
      const paginas = pdf.numPages;
      pdf.destroy();
      const sug = C().lerSumario(linhas, ctx.pdf.paginas || paginas);
      if (!sug.length) { aviso('Não achei um sumário nas primeiras páginas. Cadastre pelas linhas ou à mão.'); return; }
      ctx.colado = sug.map(s => `${s.nome}; ${s.pag_ini}-${s.pag_fim}`).join('\n');
      ctx.previa = C().lerLinhas(ctx.colado, ctx.pdf.paginas);
      render();
      aviso(`${sug.length} subtópico(s) sugeridos pelo sumário. Confira as páginas (o sumário às vezes usa a numeração impressa) e adicione.`);
    } catch (e) {
      console.error('Sumário do PDF:', e);
      aviso('Não foi possível ler o PDF. Detalhe: ' + (e.message || e));
    }
  }

  async function salvar() {
    const v = C().validar(ctx.linhas.filter(l => !l.apagar), ctx.pdf.paginas);
    if (v.erros.length) { render(); return; }
    const S = window.estSub, pdfId = ctx.pdf.id;
    if (ctx.pdfTec && !/^https?:\/\//i.test(ctx.pdfTec)) { aviso('O caderno do PDF começa com https://'); return; }
    for (const l of ctx.linhas.filter(x => x.tec_link)) if (!/^https?:\/\//i.test(l.tec_link)) { aviso(`O caderno de “${l.nome}” começa com https://`); return; }
    await window.estPlano.salvarMotorPdf(pdfId, { tec_link: ctx.pdfTec || null, peso: ctx.pdfPeso === '' ? null : Number(ctx.pdfPeso) });
    for (const l of ctx.linhas) {
      if (l.apagar) { await S.excluir(l.id); continue; }
      let s = l.id ? S.porId(l.id) : await S.criar(ctx.item, l.nome, [pdfId]);
      if (!s) continue;
      if (l.id && l.nome.trim() !== l.nomeAntigo) { if (!(await S.renomear(s.id, l.nome.trim()))) continue; }
      const outros = (s.pdfs || []).filter(p => p.material_id !== pdfId);
      await S.atualizarCampos(s.id, {
        material_id: pdfId, pag_ini: l.pag_ini || null, pag_fim: l.pag_fim || null, tec_link: l.tec_link || '',
        peso: l.peso === '' || l.peso == null ? null : Number(l.peso), nao_cai: !!l.nao_cai, itens_edital: l.itens_edital,
        pdfs: [...outros, { material_id: pdfId, de: l.pag_ini || null, ate: l.pag_fim || null }]   // campo antigo, que o resto do painel lê
      });
    }
    fechar();
    if (window.estEdital) window.estEdital.render();
    window.estPlano.renderTudo();
    aviso('PDF e subtópicos salvos.');
  }

  window.estPdf = { abrir, fechar };
})();
