/* Cadastro de subtópicos de um PDF — funções puras (testes em ferramentas/testes/motor.html).
   Um subtópico aqui: { nome, pag_ini, pag_fim, tec_link, nao_cai }. */
(function () {
  const PONTILHADO = /[.…_·]{3,}|(\s\.){3,}/;

  /* A2: cadastro rápido. Uma linha por subtópico: "nome; pág. inicial-final; link do caderno" (o link é
     opcional). Devolve [{ linha, texto, nome, pag_ini, pag_fim, tec_link, erros: [] }]. */
  function lerLinhas(texto, paginas) {
    return String(texto || '').split(/\r?\n/).map((l, i) => ({ l: l.trim(), n: i + 1 })).filter(x => x.l).map(({ l, n }) => {
      const p = l.split(';').map(x => x.trim());
      const r = { linha: n, texto: l, nome: p[0] || '', pag_ini: null, pag_fim: null, tec_link: null, erros: [] };
      if (!r.nome) r.erros.push('sem nome');
      const pags = (p[1] || '').replace(/^p[áa]g(inas?|s)?\.?\s*/i, '').replace(/\s+/g, '');
      const m = pags.match(/^(\d+)(?:[-–a](\d+))?$/i);
      if (!pags) r.erros.push('sem páginas');
      else if (!m) r.erros.push(`páginas "${p[1]}" fora do formato 12-30`);
      else {
        r.pag_ini = Number(m[1]);
        r.pag_fim = Number(m[2] || m[1]);
        if (r.pag_ini < 1) r.erros.push('a página inicial é 1 ou mais');
        else if (r.pag_fim < r.pag_ini) r.erros.push('a página final vem antes da inicial');
        else if (paginas && r.pag_fim > paginas) r.erros.push(`passa da última página do PDF (${paginas})`);
      }
      if (p[2]) { if (/^https?:\/\//i.test(p[2])) r.tec_link = p[2]; else r.erros.push('o link do caderno começa com https://'); }
      if (p.length > 3) r.erros.push('mais de 3 campos (separe só com ";")');
      return r;
    });
  }

  // [3, 4, 5, 9] → "3–5, 9"
  function faixasTexto(pags) {
    const r = [];
    pags.forEach(p => { const u = r[r.length - 1]; if (u && p === u[1] + 1) u[1] = p; else r.push([p, p]); });
    return r.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');
  }

  /* A4: valida a lista inteira. Erros impedem salvar; avisos não.
     Devolve { erros: [{ i, msg }], avisos: [texto], descobertas: [páginas] } (i = posição na lista). */
  function validar(subs, paginas) {
    const erros = [], avisos = [];
    const nomes = {};
    subs.forEach((s, i) => {
      const nome = String(s.nome || '').trim();
      if (!nome) erros.push({ i, msg: 'sem nome' });
      else {
        const k = nome.toLowerCase();
        if (k in nomes) erros.push({ i, msg: `nome repetido (linha ${nomes[k] + 1})` });
        else nomes[k] = i;
      }
      const a = Number(s.pag_ini) || 0, b = Number(s.pag_fim) || 0;
      if (!a && !b) return;
      if (!a || !b) erros.push({ i, msg: 'falta a página inicial ou a final' });
      else if (b < a) erros.push({ i, msg: 'a página final vem antes da inicial' });
      else if (a < 1 || (paginas && b > paginas)) erros.push({ i, msg: `fora do PDF (1 a ${paginas})` });
    });
    const comFaixa = subs.map((s, i) => ({ i, a: Number(s.pag_ini) || 0, b: Number(s.pag_fim) || 0 })).filter(x => x.a && x.b && x.b >= x.a);
    comFaixa.forEach((x, k) => comFaixa.slice(k + 1).forEach(y => {
      if (!(x.a <= y.b && y.a <= x.b)) return;
      const de = Math.max(x.a, y.a), ate = Math.min(x.b, y.b);
      erros.push({ i: y.i, msg: `${de === ate ? `página ${de} também está` : `páginas ${de}–${ate} também estão`} em “${subs[x.i].nome}”` });
    }));
    const semFaixa = subs.filter(s => !(Number(s.pag_ini) && Number(s.pag_fim)));
    if (semFaixa.length) avisos.push(`${semFaixa.length} subtópico(s) sem páginas: ${semFaixa.map(s => s.nome || '(sem nome)').join(', ')}.`);
    const descobertas = [];
    if (paginas) for (let p = 1; p <= paginas; p++) if (!comFaixa.some(x => p >= x.a && p <= x.b)) descobertas.push(p);
    if (descobertas.length && comFaixa.length) avisos.push(`Páginas sem nenhum subtópico: ${faixasTexto(descobertas)}. Elas também são lidas; marque um subtópico “não cai” se quiser pulá-las.`);
    return { erros, avisos, descobertas };
  }

  /* A3: sugestão pelo sumário. linhas = texto das primeiras páginas, uma entrada por linha. Lê as linhas
     com pontilhado (ou, depois de "Sumário"/"Índice", terminadas em número) e monta as faixas: cada item vai
     da página dele até a véspera do seguinte; o último, até o fim do PDF. Devolve [{ nome, pag_ini, pag_fim }]. */
  function lerSumario(linhas, paginas) {
    const itens = [];
    let noIndice = false;
    linhas.forEach(l => {
      l = String(l).replace(/\s+/g, ' ').trim();
      if (/^(sum[aá]rio|[ií]ndice)(?!\p{L})/iu.test(l)) { noIndice = true; return; }
      if (/^p[áa]g(ina)?\.?\s*\d/i.test(l) || /\d+\s+(de|\/)\s+\d+$/.test(l)) return;   // rodapé "Página 2 de 60"
      const m = l.match(/^(.*\p{L}.*?)\s*(?:[.…_·]{2,}|(?:\s\.){2,}|\s)\s*(\d{1,4})$/u);
      if (!m || !(PONTILHADO.test(l) || noIndice)) return;
      const nome = m[1].replace(PONTILHADO, ' ').replace(/[.…_·]+$/, '').replace(/^\s*\d+(\.\d+)*\s*[).\-–]?\s*/, '').replace(/\s+/g, ' ').trim();
      const pag = Number(m[2]);
      if (nome.length < 3 || pag < 1 || (paginas && pag > paginas)) return;
      if (itens.length && pag < itens[itens.length - 1].pag_ini) return;   // fora de ordem: não é o sumário
      if (itens.some(x => x.nome.toLowerCase() === nome.toLowerCase())) return;
      itens.push({ nome, pag_ini: pag });
    });
    // Itens na mesma página: o anterior some (fica o mais específico, que vem depois)
    const r = itens.filter((x, k) => !(itens[k + 1] && itens[k + 1].pag_ini === x.pag_ini));
    return r.map((x, k) => ({ nome: x.nome, pag_ini: x.pag_ini, pag_fim: r[k + 1] ? r[k + 1].pag_ini - 1 : paginas || x.pag_ini }));
  }

  window.estCadastroPdf = { lerLinhas, validar, lerSumario, faixasTexto };
})();
