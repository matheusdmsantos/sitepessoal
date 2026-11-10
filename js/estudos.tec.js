/* ─── js/estudos.tec.js — Criar o caderno do TEC de um tópico ───
 *
 * Funciona junto com o userscript "TEC – Criar cadernos em fila" (Tampermonkey), instalado
 * no navegador do usuário: o site abre o TEC com #tecauto=[cadernos], o userscript carrega o
 * filtro salvo, adiciona os assuntos, gera o caderno e devolve por postMessage
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
  const chaveArvore = discId => 'est_tec_arvore_' + discId;   // todos os assuntos da planilha da disciplina

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
  function guardarAssuntos(assuntos, discId) {
    if (discId) {
      const arvore = assuntos.map(a => ({ nome: a.assunto, hier: a.hier || '', materia: a.materia || '', questoes: a.questoes }))
        .sort((a, b) => (a.hier && b.hier ? a.hier.localeCompare(b.hier) : b.questoes - a.questoes));
      try { localStorage.setItem(chaveArvore(discId), JSON.stringify(arvore)); } catch { /* só conveniência */ }
    }
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
    aviso(aba ? 'Gerando o caderno no TEC… o link volta para o assunto quando ele ficar pronto.'
      : 'O navegador bloqueou a aba do TEC. Libere pop-ups para este site e tente de novo.');
  }

  // Pai incluído já traz os filhos no TEC: tira da lista quem tem um ancestral marcado
  function semFilhosDePais(lista) {
    const codigos = new Set(lista.map(a => a.hier).filter(Boolean));
    const temPai = h => h.split('.').some((_, i, p) => i > 0 && codigos.has(p.slice(0, i).join('.')));
    return lista.filter(a => !a.hier || !temPai(a.hier));
  }

  /* Lista com caixas de marcar dos assuntos da planilha da disciplina; os do tópico vêm marcados.
     Devolve [{ nome, materia? }] ou null se cancelar. */
  function escolherAssuntos(ref, arvore, guardados) {
    return new Promise(resolve => {
      const marcados = new Set(guardados.map(a => chaveNome(a.nome)));
      const ov = document.createElement('div');
      ov.className = 'est-modal-overlay active est-tec-escolha';
      ov.innerHTML = `
        <div class="est-modal" role="dialog" aria-modal="true" aria-labelledby="est-tec-titulo">
          <div class="est-modal-header">
            <h2 class="est-modal-title" id="est-tec-titulo">Assuntos do caderno</h2>
            <button type="button" class="est-modal-close" data-acao="cancelar" aria-label="Fechar">✕</button>
          </div>
          <p class="est-plano-sub">${escapeHtml(ref.d.nome)} — ${escapeHtml(ref.t.nome)}. Marque os assuntos do TEC que entram no caderno; marcar um assunto já inclui os subassuntos dele.</p>
          <input type="search" class="est-form-input" placeholder="Buscar assunto…" data-busca>
          <ul class="est-tec-lista">${arvore.map((a, i) => `
            <li data-i="${i}" style="padding-left:${(a.hier ? a.hier.split('.').length - 1 : 0) * 18}px">
              <label><input type="checkbox" ${marcados.has(chaveNome(a.nome)) ? 'checked' : ''}>
                <span>${escapeHtml(a.nome)}</span><small>${a.questoes}</small></label>
            </li>`).join('')}</ul>
          <input type="text" class="est-form-input" placeholder="Outro assunto (nome exato do TEC; vários separados por ;)" data-outro>
          <div class="est-tec-acoes">
            <span class="est-plano-sub" data-conta></span>
            <button type="button" class="est-plano-btn" data-acao="cancelar">Cancelar</button>
            <button type="button" class="est-plano-btn primario" data-acao="ok">Gerar caderno</button>
          </div>
        </div>`;
      document.body.appendChild(ov);
      const linhas = [...ov.querySelectorAll('.est-tec-lista li')];
      const caixa = li => li.querySelector('input');
      // Filho de um assunto marcado aparece marcado e travado
      const atualizar = () => {
        const codigos = new Set(linhas.filter(li => caixa(li).checked && !caixa(li).disabled).map(li => arvore[li.dataset.i].hier).filter(Boolean));
        linhas.forEach(li => {
          const h = arvore[li.dataset.i].hier;
          const coberto = !!h && h.split('.').some((_, i, p) => i > 0 && codigos.has(p.slice(0, i).join('.')));
          caixa(li).disabled = coberto;
          li.classList.toggle('coberto', coberto);
        });
        const n = escolhidos().length;
        ov.querySelector('[data-conta]').textContent = n ? `${n} assunto${n > 1 ? 's' : ''}` : 'Nenhum assunto marcado';
      };
      const escolhidos = () => {
        const daLista = semFilhosDePais(linhas.filter(li => caixa(li).checked && !caixa(li).disabled).map(li => arvore[li.dataset.i]))
          .map(a => (a.materia ? { nome: a.nome, materia: a.materia } : { nome: a.nome }));
        const outros = ov.querySelector('[data-outro]').value.split(';').map(s => s.trim()).filter(Boolean).map(nome => ({ nome }));
        return daLista.concat(outros);
      };
      const fim = valor => { ov.remove(); resolve(valor); };
      ov.addEventListener('change', atualizar);
      ov.querySelector('[data-outro]').addEventListener('input', atualizar);
      ov.querySelector('[data-busca]').addEventListener('input', ev => {
        const q = chaveNome(ev.target.value);
        linhas.forEach(li => { li.hidden = !!q && !chaveNome(arvore[li.dataset.i].nome).includes(q); });
      });
      ov.addEventListener('click', ev => {
        const acao = ev.target.closest('[data-acao]');
        if (ev.target === ov || (acao && acao.dataset.acao === 'cancelar')) fim(null);
        else if (acao && acao.dataset.acao === 'ok') {
          const lista = escolhidos();
          if (lista.length) fim(lista);
        }
      });
      atualizar();
      const primeiro = linhas.find(li => caixa(li).checked);
      if (primeiro) primeiro.scrollIntoView({ block: 'center' });
    });
  }

  const chaveNome = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function lerArvore(discId) {
    try { return JSON.parse(localStorage.getItem(chaveArvore(discId))) || []; } catch { return []; }
  }

  async function criar(topicId) {
    const ref = acharTopico(topicId);
    if (!ref) return;
    const guardados = lerAssuntos(topicId);
    const arvore = lerArvore(ref.d.id);
    if (arvore.length) {
      const assuntos = await escolherAssuntos(ref, arvore, guardados);
      if (!assuntos) return;
      gravarAssuntos(topicId, assuntos);
      abrirTec([caderno(ref, assuntos)]);
      return;
    }
    // Sem planilha importada nesta disciplina: digita os nomes
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

  // Botão da janela de estudo: mostra na própria janela o caderno do assunto selecionado; sem
  // ele, o do item ou, se ainda não houver, cria. Link de fora do TEC abre em outra aba.
  function daJanela() {
    const ctx = window.estSessao && window.estSessao.contexto();
    const ref = ctx && ctx.topicoId && acharTopico(ctx.topicoId);
    if (!ref) return;
    const sub = ctx.subtopicoId && window.estSub && window.estSub.porId(ctx.subtopicoId);
    const url = (sub && sub.tec_link) || ref.t.tecLink;
    if (!url) criar(ref.t.id);
    else if (url.startsWith(TEC + '/')) window.estSessao.mostrarTec(url);
    else window.open(url, '_blank', 'noopener');
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

  // Texto do botão da janela de estudo
  const rotulo = topicId => { const ref = acharTopico(topicId); return ref && ref.t.tecLink ? 'TEC' : '📝 Gerar caderno'; };

  window.estTec = { criar, daJanela, guardarAssuntos, rotulo };
})();
