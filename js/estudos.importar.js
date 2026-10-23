/* ─── js/estudos.importar.js — Importação de edital (PDF ou texto) ───
 *
 * Lê o PDF no próprio navegador com o pdf.js (carregado só quando usado),
 * encontra o conteúdo programático, separa os cargos e monta disciplinas e
 * tópicos. Antes de criar o edital, tudo passa por uma tela de revisão.
 *
 * Feito para o formato mais comum (Cebraspe, FGV, FCC):
 *   DISCIPLINA: 1 Tópico. 2 Tópico. 2.1 Subtópico. ...
 *   CARGO 13: NOME DO CARGO   (seguido das disciplinas específicas)
 * Notas como "(EXCETO PARA O CARGO 1, CARGO 2)" valem na escolha do cargo.
 *
 * Depende de estudos.v5.js: editaisData, currentEditalId, saveEditais,
 * renderEditalSelect, renderEdital, escapeHtml, setTargetDate, updateCountdown.
 */
(function () {
  const PDFJS_BASE = window.EST_PDFJS_BASE || 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const MINUSCULAS = ['a', 'à', 'ao', 'aos', 'as', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'na', 'nas', 'no', 'nos', 'o', 'os', 'ou', 'para', 'pela', 'pelo', 'por'];
  const SIGLAS = ['TI', 'IA', 'BI', 'SQL', 'SUS', 'TCE', 'TCU', 'MA', 'CF', 'ONU', 'BDI', 'LGPD'];

  let analise = null;   // resultado de analisarEdital()
  let carregando = null;

  /* =============================================
     PDF → TEXTO
  ============================================= */
  function carregarScript(src) {
    return new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = ok;
      s.onerror = () => falha(new Error('Não foi possível baixar ' + src));
      document.head.appendChild(s);
    });
  }

  // O worker roda na própria página: mais simples e não depende de Web Worker de outra origem.
  function carregarPdfjs() {
    if (window.pdfjsLib && window.pdfjsWorker) return Promise.resolve();
    if (!carregando) {
      carregando = carregarScript(PDFJS_BASE + 'pdf.min.js')
        .then(() => carregarScript(PDFJS_BASE + 'pdf.worker.min.js'))
        .catch(e => { carregando = null; throw e; });
    }
    return carregando;
  }

  /* Remonta as linhas pela posição dos trechos; o espaço entre trechos vem da distância real
     entre eles, o que evita palavras partidas como "EDIFICA Ç ÕES". */
  async function extrairTextoPdf(arquivo, progresso) {
    await carregarPdfjs();
    const dados = new Uint8Array(await arquivo.arrayBuffer());
    const pdf = await window.pdfjsLib.getDocument({ data: dados }).promise;
    const saida = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      if (progresso) progresso(p, pdf.numPages);
      const conteudo = await (await pdf.getPage(p)).getTextContent();
      const linhas = [];
      conteudo.items.forEach(it => {
        if (!it.str) return;
        const altura = Math.abs(it.transform[3]) || it.height || 10;
        const y = it.transform[5];
        let linha = linhas.find(l => Math.abs(l.y - y) < altura * 0.5);
        if (!linha) { linha = { y, itens: [] }; linhas.push(linha); }
        linha.itens.push({ x: it.transform[4], w: it.width, s: it.str.normalize('NFC'), h: altura });
      });
      linhas.sort((a, b) => b.y - a.y);
      linhas.forEach(l => {
        l.itens.sort((a, b) => a.x - b.x);
        let texto = '';
        let fim = null;
        let anteriorSolto = false;
        let espacoPendente = false;
        l.itens.forEach(it => {
          // Trechos só de espaço viram um espaço pendente, decidido no próximo trecho com texto
          if (!it.s.trim()) { if (fim !== null) espacoPendente = true; return; }
          // Letras acentuadas às vezes vêm num trecho à parte ("EDIFICA" "Ç" "ÕES"): cola nas vizinhas
          const solto = /^[ÇÃÕÁÉÍÓÚÂÊÔçãõáéíóúâêô]$/.test(it.s.trim());
          if (fim !== null) {
            const distancia = it.x - fim;
            const colar = ((solto || anteriorSolto) && distancia < it.h * 0.6) ||
              (anteriorSolto && /^[A-ZÀ-Þ]{1,3}\b/.test(it.s) && distancia < it.h * 1.5); // "FISCALIZA Ç Ã O"
            if (!colar && (espacoPendente || distancia > it.h * 0.2) && !texto.endsWith(' ') && !it.s.startsWith(' ')) texto += ' ';
          }
          texto += solto ? it.s.trim() : it.s;
          fim = it.x + it.w;
          anteriorSolto = solto;
          espacoPendente = false;
        });
        texto = texto.replace(/\s+/g, ' ').trim();
        if (texto) saida.push(texto);
      });
    }
    return { texto: saida.join('\n'), paginas: pdf.numPages };
  }

  /* =============================================
     TEXTO → DISCIPLINAS
  ============================================= */
  const temMinuscula = s => /[a-zà-ÿ]/.test(s);
  const ehMaiuscula = s => /[A-ZÀ-Þ]/.test(s) && !temMinuscula(s);
  const ROMANO = /^(I|II|III|IV|V|VI|VII|VIII|IX|X)$/;

  function nomeBonito(str) {
    return str.replace(/\s+/g, ' ').trim().split(' ').map((p, i) => {
      if (SIGLAS.includes(p.replace(/[^A-Za-zÀ-ÿ]/g, ''))) return p;
      if (/^[^aeiouáéíóúâêôãõAEIOUÁÉÍÓÚÂÊÔÃÕ]+$/.test(p) && /[A-Z]/.test(p)) return p; // siglas sem vogal
      const m = p.toLowerCase();
      if (i > 0 && MINUSCULAS.includes(m)) return m;
      return m.charAt(0).toUpperCase() + m.slice(1);
    }).join(' ');
  }

  function limparTopico(s) {
    s = s.replace(/\s+/g, ' ').replace(/\s+([,.;:)])/g, '$1').replace(/\(\s+/g, '(').trim().replace(/[.;]+$/, '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /* Encontra "NOME EM MAIÚSCULAS: 1 ..." no texto corrido de um bloco */
  function acharDisciplinas(stream) {
    const tokens = stream.split(' ');
    const achados = [];
    for (let i = 0; i < tokens.length - 1; i++) {
      let tok = tokens[i];
      let fimNome = i;
      if (tok === ':') { fimNome = i - 1; }
      else if (tok.endsWith(':') && tok.length > 1) { tok = tok.slice(0, -1); }
      else continue;
      const prox = tokens[i + 1];
      if (!/^\d+\.?$/.test(prox) && !ROMANO.test(prox)) continue;

      // Volta pelas palavras em maiúsculas até achar texto normal ou fim de frase
      const nome = [];
      for (let j = fimNome; j >= 0; j--) {
        let t = j === i ? tok : tokens[j];
        if (j < fimNome && (/[.:]$/.test(t))) break;
        if (temMinuscula(t)) break;
        nome.unshift(t);
      }
      // "I HISTÓRIA DO..." → "HISTÓRIA DO..."; números soltos no início são resto do tópico anterior
      while (nome.length && (ROMANO.test(nome[0]) || !/[A-ZÀ-Þ]/.test(nome[0]))) nome.shift();
      const nomeTexto = nome.join(' ');
      if (!/[A-ZÀ-Þ]{3}/.test(nomeTexto)) continue;
      const inicioNome = i - (fimNome === i ? nome.length - 1 : nome.length);
      achados.push({ nome: nomeTexto, inicio: inicioNome, corpo: i + 1 });
    }
    return achados.map((a, k) => ({
      nomeBruto: a.nome,
      corpo: tokens.slice(a.corpo, k + 1 < achados.length ? achados[k + 1].inicio : tokens.length).join(' ')
    }));
  }

  /* Divide "1 A. 2 B. 2.1 C." em itens, aceitando só números em sequência
     (evita cortar em "programa 5 S" ou "Lei nº 14.133/2021"). */
  function dividirItens(corpo) {
    const re = /(^|[.;:]\s+)(\d+(?:\.\d+)*)\.?\s+(?=\S)/g;
    const marcas = [];
    let caminho = null;
    let m;
    while ((m = re.exec(corpo))) {
      const num = m[2].split('.').map(Number);
      if (!caminho) {
        if (num.length !== 1 || num[0] !== 1) continue;
      } else {
        const valido = (() => {
          if (num.length === caminho.length + 1) return num.slice(0, -1).join('.') === caminho.join('.') && num[num.length - 1] === 1;
          if (num.length > caminho.length + 1) return false;
          const base = caminho.slice(0, num.length - 1);
          return num.slice(0, -1).join('.') === base.join('.') && num[num.length - 1] === caminho[num.length - 1] + 1;
        })();
        if (!valido) continue;
      }
      caminho = num;
      marcas.push({ num: m[2], nivel: num.length, pos: m.index + m[1].length, ini: m.index + m[0].length });
    }
    return marcas.map((mk, k) => ({
      num: mk.num, nivel: mk.nivel,
      texto: limparTopico(corpo.slice(mk.ini, k + 1 < marcas.length ? marcas[k + 1].pos : corpo.length))
    })).filter(x => x.texto);
  }

  function montarTopicos(corpo, separar) {
    const itens = dividirItens(corpo);
    if (!itens.length) {
      const t = limparTopico(corpo.replace(/^([IVX]+\s+)/, ''));
      return t ? [t.length > 220 ? t.slice(0, 217) + '…' : t] : [];
    }
    if (separar) return itens.map(i => `${i.num} ${i.texto}`);
    const topicos = [];
    itens.forEach(i => {
      if (i.nivel === 1 || !topicos.length) topicos.push({ base: `${i.num} ${i.texto}`, subs: [] });
      else topicos[topicos.length - 1].subs.push(i.texto);
    });
    return topicos.map(t => t.subs.length ? `${t.base.replace(/[.:]$/, '')}: ${t.subs.join('; ')}` : t.base);
  }

  function regraCargo(nomeBruto) {
    const m = nomeBruto.match(/\((EXCETO|SOMENTE|APENAS)[^)]*\)/);
    if (!m) return null;
    const cargos = (m[0].match(/\d+/g) || []).map(Number);
    if (!cargos.length) return null;
    return { tipo: m[1] === 'EXCETO' ? 'exceto' : 'somente', cargos };
  }

  function valeParaCargo(regra, cargo) {
    if (!regra || cargo === null) return true;
    return regra.tipo === 'exceto' ? !regra.cargos.includes(cargo) : regra.cargos.includes(cargo);
  }

  function prepararDisciplina(d) {
    const nome = nomeBonito(d.nomeBruto.replace(/\([^)]*\)/g, ' ').replace(/[\s:]+$/, ''));
    return { nome, regra: regraCargo(d.nomeBruto), corpo: d.corpo };
  }

  function datasDaProva(linhas) {
    const datas = [];
    linhas.forEach((l, i) => {
      if (!/aplica[çc][ãa]o\s+d[aeo]s?\s+provas?/i.test(l)) return;
      const janela = linhas.slice(i, i + 3).join(' ');
      const m = janela.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})\b/);
      if (!m) return;
      const data = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      if (datas.some(d => d.data === data)) return;
      const rotulo = janela.replace(m[0], '').replace(/\s+/g, ' ').trim();
      datas.push({ data, rotulo: rotulo.length > 110 ? rotulo.slice(0, 107) + '…' : rotulo });
    });
    return datas;
  }

  function analisarEdital(texto) {
    let linhas = texto.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
      .filter(l => !/^(p[áa]gina\s*)?\d+(\s*(de|\/)\s*\d+)?$/i.test(l));
    const datas = datasDaProva(linhas);

    // Recorta o conteúdo programático: do título da seção até o primeiro ANEXO
    const ehCabecalhoDisc = l => /^[^a-zà-ÿ]{4,}?\s?:\s*(\d+|[IVX]+)\s/.test(l);
    const ini = linhas.findIndex((l, i) =>
      ehMaiuscula(l) && /(CONHECIMENTOS|CONTEÚDO PROGRAMÁTICO|CONTEÚDOS PROGRAMÁTICOS|OBJETOS DE AVALIAÇÃO)/.test(l) &&
      linhas.slice(i + 1, i + 6).some(ehCabecalhoDisc));
    if (ini >= 0) {
      let fim = linhas.findIndex((l, i) => i > ini && /^ANEXO\b/.test(l));
      linhas = linhas.slice(ini, fim > 0 ? fim : undefined);
    }

    // Separa os blocos: comum a todos e um por cargo
    const blocos = [{ cargo: null, nome: 'Comum a todos os cargos', linhas: [] }];
    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i];
      const c = l.match(/^CARGO\s*(\d+)\s*[:\-–]?\s*(.*)$/);
      if (c && ehMaiuscula(l)) {
        let nome = c[2];
        while (i + 1 < linhas.length && ehMaiuscula(linhas[i + 1]) && !ehCabecalhoDisc(linhas[i + 1]) && !/^CARGO\s*\d/.test(linhas[i + 1])) {
          nome += ' ' + linhas[++i];
        }
        blocos.push({ cargo: Number(c[1]), nome: nomeBonito(nome.replace(/\s*[–-]\s*/g, ' – ')), linhas: [] });
        continue;
      }
      if (/^\d+(\.\d+)+\s+[^a-zà-ÿ]+$/.test(l)) continue; // títulos como "14.2.3 CONHECIMENTOS GERAIS"
      blocos[blocos.length - 1].linhas.push(l);
    }

    // Disciplinas que só agrupam subdivisões ("I HISTÓRIA ... II GEOGRAFIA ...") ficam vazias e saem
    blocos.forEach(b => {
      b.disciplinas = acharDisciplinas(b.linhas.join(' ').replace(/\s+/g, ' '))
        .map(prepararDisciplina)
        .filter(d => d.corpo.replace(/^[IVX]+\s*/, '').trim().length > 0);
    });

    return {
      comum: blocos[0].disciplinas,
      cargos: blocos.slice(1).filter(b => b.disciplinas.length),
      datas
    };
  }

  function disciplinasDoCargo(an, cargo, separar) {
    const comum = an.comum.filter(d => valeParaCargo(d.regra, cargo));
    const especificas = cargo === null ? an.cargos.flatMap(c => c.disciplinas) : (an.cargos.find(c => c.cargo === cargo) || { disciplinas: [] }).disciplinas;
    return [...comum, ...especificas].map(d => ({ nome: d.nome, topicos: montarTopicos(d.corpo, separar) }));
  }

  /* =============================================
     TELA DE REVISÃO
  ============================================= */
  const $ = id => document.getElementById(id);

  function mostrarEtapa(revisao) {
    $('est-edital-form').style.display = revisao ? 'none' : '';
    $('est-importar-revisao').style.display = revisao ? '' : 'none';
    $('est-modal-edital').querySelector('.est-modal').classList.toggle('est-modal-largo', revisao);
  }

  function status(msg, erro) {
    const el = $('est-importar-status');
    el.textContent = msg;
    el.classList.toggle('erro', !!erro);
    el.style.display = msg ? '' : 'none';
  }

  function analisar(titulo, texto) {
    analise = analisarEdital(texto);
    const total = analise.comum.length + analise.cargos.reduce((a, c) => a + c.disciplinas.length, 0);
    if (!total) {
      // Formato não reconhecido: usa o leitor antigo (disciplinas em maiúsculo, tópicos numerados)
      analise = { comum: parseEditalText(texto).map(d => ({ nome: d.nome, regra: null, corpo: null, prontos: d.topicos.map(t => t.nome) })), cargos: [], datas: [] };
    }
    $('est-importar-titulo').value = titulo || '';

    const sel = $('est-importar-cargo');
    const grupo = $('est-importar-cargo-grupo');
    if (analise.cargos.length) {
      sel.innerHTML = analise.cargos.map(c => `<option value="${c.cargo}">Cargo ${c.cargo} — ${escapeHtml(c.nome)}</option>`).join('');
      const eng = analise.cargos.find(c => /engenharia$/i.test(c.nome) || /engenharia civil/i.test(c.nome));
      if (eng) sel.value = String(eng.cargo);
      grupo.style.display = '';
    } else {
      sel.innerHTML = '';
      grupo.style.display = 'none';
    }

    const datas = $('est-importar-datas');
    datas.innerHTML = analise.datas.length ? `
      <span class="est-form-label">Data da prova encontrada no edital</span>
      ${analise.datas.map((d, i) => `
        <label class="est-importar-opcao"><input type="radio" name="est-importar-data" value="${d.data}" ${i === 0 ? 'checked' : ''}/>
          <span><strong>${d.data.split('-').reverse().join('/')}</strong> — ${escapeHtml(d.rotulo)}</span></label>`).join('')}
      <label class="est-importar-opcao"><input type="radio" name="est-importar-data" value=""/><span>Não alterar a data da prova</span></label>` : '';

    renderDisciplinas();
    mostrarEtapa(true);
  }

  function renderDisciplinas() {
    const cargo = analise.cargos.length ? Number($('est-importar-cargo').value) : null;
    const separar = $('est-importar-separar').checked;
    const lista = analise.comum[0] && analise.comum[0].prontos
      ? analise.comum.map(d => ({ nome: d.nome, topicos: d.prontos }))
      : disciplinasDoCargo(analise, cargo, separar);

    const c = analise.cargos.find(x => x.cargo === cargo);
    const titulo = $('est-importar-titulo');
    if (c && (!titulo.value.trim() || titulo.dataset.auto === '1')) { titulo.value = c.nome; titulo.dataset.auto = '1'; }

    // Marca a data da prova cujo texto cita o cargo escolhido ("...para os cargos de Auditor")
    const radios = [...document.querySelectorAll('input[name="est-importar-data"]')];
    const palavra = c ? (c.nome.split(' ')[0] || '').toLowerCase() : '';
    const certa = palavra.length >= 4 && radios.find(r => r.value && r.parentElement.textContent.toLowerCase().includes(palavra));
    if (certa) certa.checked = true;

    $('est-importar-lista').innerHTML = lista.map((d, i) => `
      <div class="est-importar-disc">
        <div class="est-importar-disc-head">
          <input type="checkbox" class="est-importar-incluir" checked aria-label="Incluir ${escapeHtml(d.nome)}"/>
          <input type="text" class="est-form-input est-importar-nome" value="${escapeHtml(d.nome)}" aria-label="Nome da disciplina"/>
          <button type="button" class="est-plano-btn est-importar-ver" aria-expanded="false" aria-controls="est-importar-t${i}">
            <span class="est-importar-qtd">${d.topicos.length} tópicos</span> ▾
          </button>
        </div>
        <textarea id="est-importar-t${i}" class="est-form-input est-importar-topicos" hidden rows="${Math.min(14, Math.max(4, d.topicos.length + 1))}" aria-label="Tópicos de ${escapeHtml(d.nome)}, um por linha">${escapeHtml(d.topicos.join('\n'))}</textarea>
      </div>`).join('') || '<p class="est-plano-vazio">Nenhuma disciplina encontrada. Volte e cole o trecho do conteúdo programático.</p>';
    atualizarResumo();
  }

  function atualizarResumo() {
    let discs = 0, tops = 0;
    document.querySelectorAll('.est-importar-disc').forEach(el => {
      const n = el.querySelector('.est-importar-topicos').value.split('\n').filter(l => l.trim()).length;
      el.querySelector('.est-importar-qtd').textContent = `${n} tópico${n === 1 ? '' : 's'}`;
      if (el.querySelector('.est-importar-incluir').checked) { discs++; tops += n; }
    });
    $('est-importar-resumo').textContent = `${discs} disciplina${discs === 1 ? '' : 's'} e ${tops} tópicos serão criados.`;
  }

  async function criarEdital() {
    const titulo = $('est-importar-titulo').value.trim();
    if (!titulo) { $('est-importar-titulo').focus(); return; }
    const base = Date.now();
    const disciplinas = [];
    let nTopico = 0;
    document.querySelectorAll('.est-importar-disc').forEach((el, i) => {
      if (!el.querySelector('.est-importar-incluir').checked) return;
      const nome = el.querySelector('.est-importar-nome').value.trim() || `Disciplina ${i + 1}`;
      const id = `d_${base}_${String(i).padStart(4, '0')}`;
      const topicos = el.querySelector('.est-importar-topicos').value.split('\n').map(l => l.trim()).filter(Boolean)
        .map(nomeT => ({ id: `t_${base}_${String(nTopico++).padStart(5, '0')}`, nome: nomeT, estudado: false, questoesFeitas: 0, questoesCertas: 0, tecLink: '', tempoGasto: 0 }));
      disciplinas.push({ id, nome, topicos });
    });

    const botao = $('est-importar-criar');
    botao.disabled = true;
    botao.textContent = 'Criando…';
    const edital = { id: 'e_' + base.toString(36), titulo, status: 'aberto', disciplinas };
    const sb = window.supabaseClient;
    try {
      const r1 = await sb.from('editais').insert({ id: edital.id, cargo: titulo, orgao: 'Importado', status: 'aberto' });
      if (r1.error) throw r1.error;
      if (disciplinas.length) {
        const r2 = await sb.from('disciplinas').insert(disciplinas.map(d => ({ id: d.id, edital_id: edital.id, nome: d.nome })));
        if (r2.error) throw r2.error;
      }
      const linhas = disciplinas.flatMap(d => d.topicos.map(t => ({
        id: t.id, disciplina_id: d.id, nome: t.nome, estudado: false,
        questoes_feitas: 0, questoes_certas: 0, tec_link: '', tempo_gasto: 0
      })));
      for (let i = 0; i < linhas.length; i += 500) {
        const r3 = await sb.from('topicos').insert(linhas.slice(i, i + 500));
        if (r3.error) throw r3.error;
      }
    } catch (e) {
      console.error('Erro ao salvar edital importado:', e);
      alert('Não foi possível salvar o edital no Supabase. Detalhe: ' + (e.message || e));
      botao.disabled = false;
      botao.textContent = 'Criar edital';
      return;
    }

    editaisData.push(edital);
    currentEditalId = edital.id;
    saveEditais();
    renderEditalSelect();
    renderEdital();

    const data = document.querySelector('input[name="est-importar-data"]:checked');
    if (data && data.value) { setTargetDate(data.value); updateCountdown(); }

    fechar();
    window.estPlano.editalTrocado();
    botao.disabled = false;
    botao.textContent = 'Criar edital';
  }

  function fechar() {
    $('est-modal-edital').classList.remove('active');
    $('est-edital-form').reset();
    $('est-importar-titulo').dataset.auto = '';
    status('');
    mostrarEtapa(false);
    analise = null;
  }

  async function lerArquivo(arquivo) {
    if (!arquivo) return;
    if (!/\.pdf$/i.test(arquivo.name) && arquivo.type !== 'application/pdf') { status('Escolha um arquivo PDF.', true); return; }
    status('Carregando o leitor de PDF…');
    try {
      const { texto, paginas } = await extrairTextoPdf(arquivo, (p, n) => status(`Lendo página ${p} de ${n}…`));
      if (texto.replace(/\s/g, '').length < 200) {
        status('Este PDF parece ser uma imagem escaneada: não há texto para ler. Copie o conteúdo programático e cole no campo abaixo.', true);
        return;
      }
      $('est-edital-text').value = texto;
      status(`${paginas} páginas lidas.`);
      analisar($('est-edital-title').value.trim(), texto);
    } catch (e) {
      console.error('Erro ao ler PDF:', e);
      status('Não foi possível ler o PDF. Detalhe: ' + (e.message || e), true);
    }
  }

  function init() {
    if (!$('est-importar-revisao')) return;
    $('est-edital-pdf').addEventListener('change', e => lerArquivo(e.target.files[0]));
    $('est-importar-cargo').addEventListener('change', renderDisciplinas);
    $('est-importar-separar').addEventListener('change', renderDisciplinas);
    $('est-importar-titulo').addEventListener('input', e => { e.target.dataset.auto = ''; });
    $('est-importar-lista').addEventListener('click', e => {
      const botao = e.target.closest('.est-importar-ver');
      if (!botao) return;
      const area = $(botao.getAttribute('aria-controls'));
      area.hidden = !area.hidden;
      botao.setAttribute('aria-expanded', String(!area.hidden));
    });
    $('est-importar-lista').addEventListener('input', atualizarResumo);
    $('est-importar-lista').addEventListener('change', atualizarResumo);
    $('est-importar-voltar').addEventListener('click', () => mostrarEtapa(false));
    $('est-importar-criar').addEventListener('click', criarEdital);
    $('est-modal-edital-close').addEventListener('click', fechar);
  }

  document.addEventListener('DOMContentLoaded', init);

  window.estImportar = { analisar, analisarEdital, disciplinasDoCargo, extrairTextoPdf };
})();
