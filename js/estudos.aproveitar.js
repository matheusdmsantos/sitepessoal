/* ─── js/estudos.aproveitar.js — Aproveitar estudos de outro edital ───
 *
 * Num edital novo, muitas disciplinas se repetem. Esta tela liga cada disciplina e
 * cada tópico do edital novo ao equivalente de um edital antigo (por semelhança de
 * texto, a mesma do estudos.incidencia.js) e, depois da revisão do usuário, copia
 * o progresso para o novo: estudado, questões, tempo, link do TEC, resumo,
 * revisões, PDFs, peso/nível no plano e erros do caderno. O edital antigo não muda.
 *
 * Um tópico antigo pode ir para vários novos (o edital novo dividiu o assunto):
 * todos herdam estudado, revisões e resumo; questões, tempo e erros vão só para o
 * primeiro, para não contar em dobro. Abre sozinha depois de importar um edital
 * (estudos.importar.js) e pelo botão ♻ ao lado do seletor de editais.
 */
(function () {
  const sb = window.supabaseClient;
  const $ = id => document.getElementById(id);
  let ctx = null;   // { novo, antigo, discs: { idNova: idAntiga }, ligacoes: { idTópicoNovo: idTópicoAntigo } }

  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // "1.2 Atos administrativos." → "atos administrativos": compara o nome sem a numeração do edital
  const nomeLimpo = s => semAcento(s).replace(/^[\s\d.)–-]+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const temProgresso = t => t.estudado || (t.questoesFeitas || 0) > 0 || (t.tempoGasto || 0) > 0;
  const progressoDoEdital = e => e.disciplinas.reduce((s, d) => s + d.topicos.filter(temProgresso).length, 0);
  const curto = (s, max = 70) => (s.length > max ? s.slice(0, max - 1) + '…' : s);
  const aviso = msg => window.estPlano.aviso(msg);
  const chaveTopico = (d, t) => nomeLimpo(d.nome) + '|' + nomeLimpo(t.nome);

  /* =============================================
     FORA DO EDITAL ATIVO
     Tópicos de editais desativados que não foram levados para outro edital: nem são a
     origem de um tópico (coluna topicos.origem, gravada ao aproveitar) nem têm o mesmo
     nome de um tópico do edital ativo. Numa sequência 1 → 2 → 3, sobra só a versão
     mais recente de cada assunto. Aparecem em cinza no Edital Verticalizado, em Meus
     Resumos e no Caderno de Erros.
  ============================================= */
  function indice() {
    const ativo = editaisData.find(e => e.id === currentEditalId);
    const origens = new Set(editaisData.flatMap(e => e.disciplinas.flatMap(d => d.topicos.map(t => t.origem).filter(Boolean))));
    const doAtivo = new Set(ativo ? ativo.disciplinas.flatMap(d => d.topicos.map(t => chaveTopico(d, t))) : []);
    const fora = [], levados = [];
    editaisData.filter(e => e.status === 'desativado' && e !== ativo).forEach(e => e.disciplinas.forEach(d => d.topicos.forEach(t => {
      (origens.has(t.id) || doAtivo.has(chaveTopico(d, t)) ? levados : fora).push({ e, d, t });
    })));
    return { fora, levados };
  }

  const temResumo = (d, t) => { const r = resumosMap[makeResumoKey(d.nome, t.nome)]; return !!(r && r.conteudo); };

  // Para a lista: só os que têm algo guardado (estudo, questões, tempo, resumo ou erro)
  function foraDoAtivo() {
    return indice().fora.filter(({ d, t }) => temProgresso(t) || temResumo(d, t) || (window.estErros && window.estErros.temErro(t.id)));
  }

  function estaFora(tId) {
    return indice().fora.some(x => x.t.id === tId);
  }

  /* Resumos dos tópicos levados adiante: a cópia com o nome novo já está no edital ativo,
     então o de nome antigo não aparece de novo em Meus Resumos */
  function resumosLevados() {
    const ativo = editaisData.find(e => e.id === currentEditalId);
    const doAtivo = new Set(ativo ? ativo.disciplinas.flatMap(d => d.topicos.map(t => makeResumoKey(d.nome, t.nome))) : []);
    return new Set(indice().levados.map(({ d, t }) => makeResumoKey(d.nome, t.nome)).filter(k => !doAtivo.has(k)));
  }

  /* =============================================
     DESATIVAR / REATIVAR EDITAL (status em editais)
  ============================================= */
  async function mudarStatus(e, status) {
    const { error } = await sb.from('editais').update({ status }).eq('id', e.id);
    if (error) {
      console.error('Erro ao mudar o status do edital:', error);
      aviso('Não foi possível salvar no servidor. Confira sua conexão.');
      return false;
    }
    e.status = status;
    saveEditais();
    return true;
  }

  function depoisDeMudar(idAtual) {
    currentEditalId = idAtual;
    renderEditalSelect();
    renderEdital();
    window.estPlano.editalTrocado();
  }

  async function desativar(e, semPerguntar) {
    if (!e || e.status === 'desativado') return;
    if (!semPerguntar && !(await customConfirm(`Desativar “${e.titulo}”? Ele vai para o grupo “Desativados” da lista. Nada é apagado: os assuntos que não estiverem no edital ativo continuam aparecendo em cinza, com resumos, acertos e erros.`))) return;
    if (!(await mudarStatus(e, 'desativado'))) return;
    const proximo = editaisData.find(x => x.status !== 'desativado');
    depoisDeMudar(currentEditalId === e.id && proximo ? proximo.id : currentEditalId);
    aviso(`“${e.titulo}” desativado.`);
  }

  async function reativar(e) {
    if (!e || !(await mudarStatus(e, 'aberto'))) return;
    depoisDeMudar(e.id);
    aviso(`“${e.titulo}” reativado.`);
  }

  /* =============================================
     SUGESTÕES
  ============================================= */
  // Nota mínima de semelhança para sugerir um tópico antigo (abaixo disso, começa do zero)
  const NOTA_MIN = 2;

  function sugerirDisciplina(d, antigo, usadas) {
    const livres = antigo.disciplinas.filter(x => !usadas.has(x.id));
    const igual = livres.find(x => nomeLimpo(x.nome) === nomeLimpo(d.nome));
    if (igual) return igual.id;
    const r = window.estIncidencia.montarComparador(livres)(d.nome, true);
    return r.nota >= NOTA_MIN ? r.id : '';
  }

  function sugerirTopicos(dNova, dAntiga) {
    const r = {};
    if (!dAntiga) return r;
    const comparar = window.estIncidencia.montarComparador(dAntiga.topicos);
    const porNome = new Map(dAntiga.topicos.map(t => [nomeLimpo(t.nome), t.id]));
    dNova.topicos.forEach(t => {
      const igual = porNome.get(nomeLimpo(t.nome));
      const s = igual ? { id: igual, nota: Infinity } : comparar(t.nome, true);
      if (s.id && s.nota >= NOTA_MIN) r[t.id] = s.id;
    });
    return r;
  }

  function sugerirTudo() {
    ctx.discs = {};
    ctx.ligacoes = {};
    const usadas = new Set();
    ctx.novo.disciplinas.forEach(d => {
      const ad = sugerirDisciplina(d, ctx.antigo, usadas);
      if (!ad) return;
      usadas.add(ad);
      ctx.discs[d.id] = ad;
      Object.assign(ctx.ligacoes, sugerirTopicos(d, ctx.antigo.disciplinas.find(x => x.id === ad)));
    });
  }

  /* =============================================
     TELA
  ============================================= */
  function abrir(editalId, depoisDeImportar) {
    const novo = editaisData.find(e => e.id === editalId);
    const outros = editaisData.filter(e => e.id !== editalId);
    if (!novo || !outros.length) { aviso('Cadastre o edital novo primeiro: os estudos vêm de outro edital já cadastrado.'); return; }
    // Sugere o edital antigo com mais progresso; depois de importar, só abre se houver o que aproveitar
    const antigo = [...outros].sort((a, b) => progressoDoEdital(b) - progressoDoEdital(a))[0];
    if (depoisDeImportar && !progressoDoEdital(antigo)) return;
    ctx = { novo, antigo };
    $('est-aprov-origem').innerHTML = outros.map(e =>
      `<option value="${escapeHtml(e.id)}">${escapeHtml(e.titulo)} (${progressoDoEdital(e)} tópicos com progresso)</option>`).join('');
    $('est-aprov-origem').value = antigo.id;
    $('est-aprov-destino').textContent = novo.titulo;
    mostrarDesativar();
    sugerirTudo();
    render();
    $('est-modal-aproveitar').classList.add('active');
  }

  // Um edital de cada vez: o de origem já pode ser desativado junto
  function mostrarDesativar() {
    const caixa = $('est-aprov-desativar');
    caixa.hidden = ctx.antigo.status === 'desativado';
    caixa.querySelector('input').checked = true;
    caixa.querySelector('span').textContent = `Desativar “${ctx.antigo.titulo}” depois de aproveitar (nada é apagado)`;
  }

  function fechar() {
    $('est-modal-aproveitar').classList.remove('active');
    ctx = null;
  }

  function rotuloAntigo(t) {
    const pct = t.questoesFeitas > 0 ? ` · ${Math.round(t.questoesCertas / t.questoesFeitas * 100)}%` : '';
    return `${t.estudado ? '✓ ' : ''}${curto(t.nome, 60)}${t.questoesFeitas ? ` (${t.questoesFeitas} q${pct})` : ''}`;
  }

  function render() {
    const { novo, antigo } = ctx;
    const optsDisc = ['<option value="">— Não aproveitar —</option>']
      .concat(antigo.disciplinas.map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.nome)}</option>`)).join('');
    $('est-aprov-lista').innerHTML = novo.disciplinas.map(d => {
      const ad = antigo.disciplinas.find(x => x.id === ctx.discs[d.id]);
      const optsTop = ad ? ['<option value="">— Começar do zero —</option>']
        .concat(ad.topicos.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(rotuloAntigo(t))}</option>`)).join('') : '';
      return `
        <details class="est-aprov-disc" data-disc="${escapeHtml(d.id)}" ${ad ? 'open' : ''}>
          <summary>
            <span class="est-aprov-disc-nome">${escapeHtml(d.nome)}</span>
            <span class="est-aprov-conta" data-conta="${escapeHtml(d.id)}"></span>
          </summary>
          <label class="est-aprov-de">Aproveitar de
            <select class="est-form-select" data-acao="disc" data-disc="${escapeHtml(d.id)}" aria-label="Disciplina antiga para ${escapeHtml(d.nome)}">${optsDisc}</select>
          </label>
          ${ad ? d.topicos.map(t => `
          <div class="est-inc-assunto ${ctx.ligacoes[t.id] ? '' : 'solto'}" data-topico="${escapeHtml(t.id)}">
            <span class="est-inc-assunto-nome">${escapeHtml(t.nome)}</span>
            <select class="est-form-select" data-acao="topico" data-topico="${escapeHtml(t.id)}" aria-label="Tópico antigo para ${escapeHtml(t.nome)}">${optsTop}</select>
          </div>`).join('') : ''}
        </details>`;
    }).join('');
    $('est-aprov-lista').querySelectorAll('select[data-acao=disc]').forEach(s => { s.value = ctx.discs[s.dataset.disc] || ''; });
    $('est-aprov-lista').querySelectorAll('select[data-acao=topico]').forEach(s => { s.value = ctx.ligacoes[s.dataset.topico] || ''; });
    contar();
  }

  function contar() {
    const antigos = acharAntigos();
    let ligados = 0, estudados = 0;
    ctx.novo.disciplinas.forEach(d => {
      const n = d.topicos.filter(t => ctx.ligacoes[t.id]).length;
      const el = document.querySelector(`[data-conta="${CSS.escape(d.id)}"]`);
      if (el) el.textContent = ctx.discs[d.id] ? `${n} de ${d.topicos.length} tópicos ligados` : 'começa do zero';
      ligados += n;
      estudados += d.topicos.filter(t => (antigos[ctx.ligacoes[t.id]] || {}).estudado).length;
    });
    $('est-aprov-resumo').textContent = ligados
      ? `${ligados} tópico${ligados > 1 ? 's' : ''} do edital novo vão receber o progresso do antigo (${estudados} já como estudado${estudados === 1 ? '' : 's'}).`
      : 'Nenhum tópico ligado ainda.';
    $('est-aprov-salvar').disabled = !ligados;
  }

  const acharAntigos = () => Object.fromEntries(ctx.antigo.disciplinas.flatMap(d => d.topicos.map(t => [t.id, t])));

  /* =============================================
     CÓPIA
  ============================================= */
  async function aproveitar() {
    const { novo, antigo, ligacoes, discs } = ctx;
    const botao = $('est-aprov-salvar');
    botao.disabled = true;
    botao.textContent = 'Aproveitando…';
    const antigos = acharAntigos();
    const discAntigaDe = Object.fromEntries(antigo.disciplinas.flatMap(d => d.topicos.map(t => [t.id, d])));
    const jaUsado = new Set();   // tópico antigo cujas questões e tempo já foram para um novo
    const alterados = [];
    const ligados = [];
    const resumos = [];

    novo.disciplinas.forEach(d => d.topicos.forEach(t => {
      const o = antigos[ligacoes[t.id]];
      if (!o) return;
      t.origem = o.id;   // o antigo deixa de aparecer como "fora do edital"
      ligados.push(t);
      if (temProgresso(t)) return;   // tópico novo que já tem progresso fica como está
      t.estudado = !!o.estudado;
      if (!t.tecLink && o.tecLink) t.tecLink = o.tecLink;
      if (!jaUsado.has(o.id)) {
        jaUsado.add(o.id);
        t.questoesFeitas = o.questoesFeitas || 0;
        t.questoesCertas = o.questoesCertas || 0;
        t.tempoGasto = o.tempoGasto || 0;
      }
      alterados.push(t);
      const resumo = resumosMap[makeResumoKey(discAntigaDe[o.id].nome, o.nome)];
      if (resumo && resumo.conteudo && !resumosMap[makeResumoKey(d.nome, t.nome)]) resumos.push([d.nome, t.nome, resumo.conteudo]);
    }));

    // Sem a coluna topicos.origem (SQL ainda não rodado), grava o resto e reconhece pelo nome
    let semOrigem = false;
    const salvar = async t => {
      const dados = alterados.includes(t) ? {
        estudado: t.estudado, questoes_feitas: t.questoesFeitas, questoes_certas: t.questoesCertas,
        tempo_gasto: t.tempoGasto, tec_link: t.tecLink || ''
      } : {};
      if (!semOrigem) {
        const r = await sb.from('topicos').update({ ...dados, origem: t.origem }).eq('id', t.id);
        if (!r.error) return true;
        if (!/origem/.test(r.error.message || '')) { console.error(r.error); return false; }
        semOrigem = true;
      }
      if (!Object.keys(dados).length) return true;
      const r = await sb.from('topicos').update(dados).eq('id', t.id);
      if (r.error) console.error(r.error);
      return !r.error;
    };
    let falhas = 0;
    for (let i = 0; i < ligados.length; i += 20) {
      const r = await Promise.all(ligados.slice(i, i + 20).map(salvar));
      falhas += r.filter(ok => !ok).length;
    }
    for (const [dn, tn, html] of resumos) await salvarResumo(dn, tn, html, true);
    saveEditais();

    const ligAproveitadas = Object.fromEntries(Object.entries(ligacoes).filter(([, a]) => antigos[a]));
    const plano = await window.estPlano.aproveitarDe(novo, antigo, ligAproveitadas, discs);
    const erros = window.estErros ? await window.estErros.copiarPara(novo, ligAproveitadas) : 0;

    const desativarOrigem = !$('est-aprov-desativar').hidden && $('est-aprov-desativar').querySelector('input').checked;
    botao.textContent = 'Aproveitar estudos';
    fechar();
    if (desativarOrigem && !falhas) await desativar(antigo, true);
    renderEdital();
    if (semOrigem) console.warn('Coluna topicos.origem ausente; rode o fim do supabase/estudos-plano.sql.');
    if (falhas) console.error(`aproveitar: ${falhas} tópico(s) não foram salvos no Supabase`);
    aviso(falhas ? `Não foi possível salvar ${falhas} tópico(s) no servidor. Confira a conexão e tente de novo.`
      : `${alterados.length} tópicos aproveitados, ${resumos.length} resumos, ${plano.revisoes} revisões, ${plano.pdfs} PDFs e ${erros} erros copiados.` +
        (semOrigem ? ' Rode o fim do supabase/estudos-plano.sql para guardar as ligações.' : ''));
  }

  function init() {
    if (!$('est-modal-aproveitar')) return;
    const atual = () => editaisData.find(e => e.id === currentEditalId);
    $('est-btn-aproveitar').addEventListener('click', () => abrir(currentEditalId));
    $('est-btn-desativar-edital').addEventListener('click', () => desativar(atual()));
    $('est-btn-reativar-edital').addEventListener('click', () => reativar(atual()));
    $('est-aprov-origem').addEventListener('change', e => {
      ctx.antigo = editaisData.find(x => x.id === e.target.value);
      mostrarDesativar();
      sugerirTudo();
      render();
    });
    $('est-aprov-lista').addEventListener('change', e => {
      const s = e.target.closest('select');
      if (!s || !ctx) return;
      if (s.dataset.acao === 'disc') {
        const d = ctx.novo.disciplinas.find(x => x.id === s.dataset.disc);
        d.topicos.forEach(t => delete ctx.ligacoes[t.id]);
        if (s.value) ctx.discs[d.id] = s.value; else delete ctx.discs[d.id];
        Object.assign(ctx.ligacoes, sugerirTopicos(d, ctx.antigo.disciplinas.find(x => x.id === s.value)));
        render();
      } else {
        if (s.value) ctx.ligacoes[s.dataset.topico] = s.value; else delete ctx.ligacoes[s.dataset.topico];
        s.closest('.est-inc-assunto').classList.toggle('solto', !s.value);
        contar();
      }
    });
    $('est-aprov-salvar').addEventListener('click', aproveitar);
    $('est-aprov-cancelar').addEventListener('click', fechar);
    $('est-modal-aproveitar-close').addEventListener('click', fechar);
    $('est-modal-aproveitar').addEventListener('click', e => { if (e.target.id === 'est-modal-aproveitar') fechar(); });
  }

  document.addEventListener('DOMContentLoaded', init);

  window.estAproveitar = { abrir, sugerirTopicos, nomeLimpo, foraDoAtivo, estaFora, resumosLevados, desativar, reativar };
})();
