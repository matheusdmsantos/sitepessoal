/* ─── js/estudos.tec.js — Criar o caderno do TEC de um tópico ───
 *
 * Funciona junto com o userscript "TEC – Criar cadernos em fila" (Tampermonkey), instalado
 * no navegador do usuário: o site abre o TEC com #tecauto=[cadernos], o userscript carrega o
 * filtro salvo, adiciona os assuntos, gera cada caderno e devolve por postMessage
 * { tipo: 'tec-caderno', status: 'ok' | 'erro', url, ref, erro }. ref = id do tópico, e a
 * url volta para o tópico como link do caderno (topicos.tec_link).
 * Sem o userscript, a aba do TEC abre normalmente e nada é criado.
 *
 * Os assuntos do TEC de cada tópico vêm da planilha de incidência (guardarAssuntos, com o
 * nome exato e a matéria) ou do que o usuário digitou.
 * shortcut: ficam só no localStorage deste navegador; se precisar em outro aparelho, levar
 * para uma coluna em incidencias.
 */
(function () {
  const TEC = 'https://www.tecconcursos.com.br';
  const chaveAssuntos = topicId => 'est_tec_assuntos_' + topicId;

  function acharTopico(topicId) {
    for (const e of editaisData) for (const d of e.disciplinas) {
      const t = d.topicos.find(x => x.id === topicId);
      if (t) return { e, d, t };
    }
    return null;
  }

  const aviso = msg => (window.estPlano ? window.estPlano.aviso(msg) : alert(msg));

  /* [{ nome, materia? }] guardados do tópico (aceita o formato antigo "a; b") */
  function lerAssuntos(topicId) {
    let v = null;
    try { v = localStorage.getItem(chaveAssuntos(topicId)); } catch { /* sem armazenamento */ }
    if (!v) return [];
    try { const l = JSON.parse(v); if (Array.isArray(l)) return l; } catch { /* formato antigo */ }
    return v.split(';').map(s => s.trim()).filter(Boolean).map(nome => ({ nome }));
  }

  function gravarAssuntos(topicId, lista) {
    try { localStorage.setItem(chaveAssuntos(topicId), JSON.stringify(lista)); } catch { /* só conveniência */ }
  }

  /* Chamado ao salvar a incidência: assuntos = [{ assunto, hier, materia, topicoId }].
     Um subassunto cujo "pai" (código da hierarquia) foi para o mesmo tópico sai da lista:
     no TEC o pai já inclui as questões dele. Devolve os ids dos tópicos com assuntos. */
  function guardarAssuntos(assuntos) {
    const porTopico = {};
    assuntos.filter(a => a.topicoId).forEach(a => (porTopico[a.topicoId] = porTopico[a.topicoId] || []).push(a));
    Object.entries(porTopico).forEach(([topicId, lista]) => {
      const codigos = new Set(lista.map(a => a.hier).filter(Boolean));
      const temPai = h => h.split('.').some((_, i, p) => i > 0 && codigos.has(p.slice(0, i).join('.')));
      gravarAssuntos(topicId, lista.filter(a => !a.hier || !temPai(a.hier))
        .map(a => (a.materia ? { nome: a.assunto, materia: a.materia } : { nome: a.assunto })));
    });
    return Object.keys(porTopico);
  }

  const caderno = (ref, assuntos) => ({ ref: ref.t.id, nome: `${ref.d.nome} – ${ref.t.nome}`.slice(0, 120), assuntos });

  // Sem noopener: o userscript precisa do window.opener para devolver o link
  function abrirTec(cadernos) {
    const aba = window.open(`${TEC}/questoes/filtrar#tecauto=${encodeURIComponent(JSON.stringify(cadernos))}`, 'tec-cadernos');
    aviso(!aba ? 'O navegador bloqueou a aba do TEC. Libere pop-ups para este site e tente de novo.'
      : cadernos.length > 1 ? `Criando ${cadernos.length} cadernos no TEC… cada link volta para o seu tópico quando ficar pronto. Deixe a aba do TEC aberta.`
      : 'Criando o caderno no TEC… o link volta para o assunto quando ele ficar pronto.');
  }

  async function criar(topicId) {
    const ref = acharTopico(topicId);
    if (!ref) return;
    const guardados = lerAssuntos(topicId);
    const sugestao = guardados.length ? guardados.map(a => a.nome).join('; ') : ref.t.nome.replace(/^[\d.\s-]+/, '').trim();
    const txt = await window.customPrompt(
      'Assuntos do TEC para o caderno, separados por ";". Use o nome exato da árvore de assuntos do TEC:', sugestao);
    if (txt === null) return;
    const nomes = txt.split(';').map(s => s.trim()).filter(Boolean);
    if (!nomes.length) return;
    // Mantém a matéria dos assuntos que vieram da planilha
    const assuntos = nomes.map(nome => guardados.find(a => a.nome === nome) || { nome });
    gravarAssuntos(topicId, assuntos);
    abrirTec([caderno(ref, assuntos)]);
  }

  /* Vários tópicos numa fila só (o userscript cria um de cada vez) */
  function criarVarios(topicIds) {
    const cadernos = topicIds.map(acharTopico).filter(Boolean)
      .sort((a, b) => a.d.topicos.indexOf(a.t) - b.d.topicos.indexOf(b.t))   // na ordem do edital
      .map(ref => { const assuntos = lerAssuntos(ref.t.id); return assuntos.length ? caderno(ref, assuntos) : null; })
      .filter(Boolean);
    if (cadernos.length) abrirTec(cadernos);
  }

  // Botão da janela de estudo: abre o caderno do tópico ou, se ainda não houver, cria
  function daJanela() {
    const ctx = window.estSessao && window.estSessao.contexto();
    const ref = ctx && ctx.topicoId && acharTopico(ctx.topicoId);
    if (!ref) return;
    if (ref.t.tecLink) window.open(ref.t.tecLink, '_blank', 'noopener');
    else criar(ref.t.id);
  }

  window.addEventListener('message', async ev => {
    if (ev.origin !== TEC || !ev.data || ev.data.tipo !== 'tec-caderno') return;
    const ref = acharTopico(ev.data.ref);
    if (!ref) return;
    if (ev.data.status !== 'ok') {
      aviso(`O TEC não criou o caderno de "${ref.t.nome}": ${ev.data.erro || 'erro desconhecido'}`);
      return;
    }
    const url = String(ev.data.url || '');
    if (!url.startsWith(`${TEC}/questoes/cadernos/`)) return;
    ref.t.tecLink = url;
    saveEditais();
    const { error } = await window.supabaseClient.from('topicos').update({ tec_link: url }).eq('id', ref.t.id);
    if (error) console.error('Erro ao salvar link do TEC:', error);
    renderEdital();
    if (window.estPlano) window.estPlano.renderTudo();
    aviso(`Caderno do TEC criado${ev.data.questoes ? ` (${ev.data.questoes} questões)` : ''}: o link foi salvo em "${ref.t.nome}".`);
  });

  window.estTec = { criar, criarVarios, daJanela, guardarAssuntos };
})();
