/* ─── js/estudos.tec.js — Criar o caderno do TEC de um tópico ───
 *
 * Funciona junto com o userscript "TEC – Criar cadernos em fila" (Tampermonkey), instalado
 * no navegador do usuário: o site abre o TEC com #tecauto=[caderno], o userscript carrega o
 * filtro salvo, adiciona os assuntos, gera o caderno e devolve por postMessage
 * { tipo: 'tec-caderno', status: 'ok' | 'erro', url, ref, erro }. ref = id do tópico, e a
 * url volta para o tópico como link do caderno (topicos.tec_link).
 * Sem o userscript, a aba do TEC abre normalmente e nada é criado.
 */
(function () {
  const TEC = 'https://www.tecconcursos.com.br';
  const chaveAssuntos = topicId => 'est_tec_assuntos_' + topicId;   // últimos assuntos digitados

  function acharTopico(topicId) {
    for (const e of editaisData) for (const d of e.disciplinas) {
      const t = d.topicos.find(x => x.id === topicId);
      if (t) return { e, d, t };
    }
    return null;
  }

  const aviso = msg => (window.estPlano ? window.estPlano.aviso(msg) : alert(msg));

  async function criar(topicId) {
    const ref = acharTopico(topicId);
    if (!ref) return;
    let sugestao = '';
    try { sugestao = localStorage.getItem(chaveAssuntos(topicId)) || ''; } catch { /* só conveniência */ }
    if (!sugestao) sugestao = ref.t.nome.replace(/^[\d.\s-]+/, '').trim();
    const txt = await window.customPrompt(
      'Assuntos do TEC para o caderno, separados por ";". Use o nome exato da árvore de assuntos do TEC:', sugestao);
    if (txt === null) return;
    const assuntos = txt.split(';').map(s => s.trim()).filter(Boolean);
    if (!assuntos.length) return;
    try { localStorage.setItem(chaveAssuntos(topicId), assuntos.join('; ')); } catch { /* só conveniência */ }

    const caderno = { ref: topicId, nome: `${ref.d.nome} – ${ref.t.nome}`.slice(0, 120), assuntos: assuntos.map(nome => ({ nome })) };
    // Sem noopener: o userscript precisa do window.opener para devolver o link
    const aba = window.open(`${TEC}/questoes/filtrar#tecauto=${encodeURIComponent(JSON.stringify([caderno]))}`, 'tec-cadernos');
    aviso(aba ? 'Criando o caderno no TEC… o link volta para o assunto quando ele ficar pronto.'
      : 'O navegador bloqueou a aba do TEC. Libere pop-ups para este site e tente de novo.');
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

  window.estTec = { criar, daJanela };
})();
