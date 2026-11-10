/* Resumo de véspera (motor de estudos, interface etapa 6): por disciplina, agrupado por PDF e subtópico,
   as "regras certas em uma frase" dos erros registrados. Recorrentes primeiro e destacados. Editar uma
   linha muda a regra do próprio erro; tirar uma linha só a esconde do resumo (plano_estudos.motor.vespera).
   Exporta em PDF. Não gera meta nenhuma. Montagem pura em estVespera.montar (testes em ferramentas/testes). */
(function () {
  const FORA = 'gabarito';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* erros: linhas de "erros"; pdfs: [{ id, nome, ordem }]; subs: [{ id, nome, pag_ini, material_id }];
     ocultos: ids escondidos. Devolve { pdfs: [{ id, nome, subtopicos: [{ id, nome, linhas: [{ id, regra, recorrencias }] }] }],
     semRegra, ocultos } — só da disciplina pedida. */
  function montar(erros, { discId, pdfs = [], subs = [], ocultos = [] } = {}) {
    const esconder = new Set(ocultos);
    const lista = erros.filter(e => e.disciplina_id === discId && e.motivo !== FORA);
    const comRegra = lista.filter(e => String(e.regra || '').trim());
    const pdfDe = id => pdfs.find(p => p.id === id);
    const subDe = id => subs.find(s => s.id === id);
    const grupos = new Map();
    comRegra.filter(e => !esconder.has(e.id)).forEach(e => {
      const p = pdfDe(e.material_id), s = subDe(e.subtopico_id);
      const kp = p ? p.id : '';
      if (!grupos.has(kp)) grupos.set(kp, { id: kp || null, nome: p ? p.nome : 'Sem PDF', ordem: p ? p.ordem : 1e9, subs: new Map() });
      const g = grupos.get(kp), ks = s ? s.id : '';
      if (!g.subs.has(ks)) g.subs.set(ks, { id: ks || null, nome: s ? s.nome : 'Sem subtópico', pag: s ? s.pag_ini || 1e9 : 1e9, linhas: [] });
      g.subs.get(ks).linhas.push({ id: e.id, regra: String(e.regra).trim(), recorrencias: e.recorrencias || 0, criado: e.criado_em || '' });
    });
    const pdfsOut = [...grupos.values()].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome)).map(g => ({
      id: g.id, nome: g.nome,
      subtopicos: [...g.subs.values()].sort((a, b) => a.pag - b.pag || a.nome.localeCompare(b.nome)).map(s => ({
        id: s.id, nome: s.nome,
        // G1: recorrentes primeiro (mais recorrências antes); depois na ordem em que foram registrados
        linhas: s.linhas.sort((a, b) => b.recorrencias - a.recorrencias || a.criado.localeCompare(b.criado))
      }))
    }));
    return { pdfs: pdfsOut, semRegra: lista.length - comRegra.length, ocultos: comRegra.filter(e => esconder.has(e.id)).length };
  }

  /* ---------- Tela ---------- */
  let discAtual = '', mostrarOcultos = false, editando = null;
  const $ = id => document.getElementById(id);

  function dados() {
    const e = (typeof editaisData !== 'undefined' ? editaisData : []).find(x => x.id === currentEditalId);
    const P = window.estPlano;
    const plano = e && P && P.planoDoEdital ? P.planoDoEdital(e.id) : null;
    const erros = window.estErros ? window.estErros.todos().filter(x => e && x.edital_id === e.id) : [];
    return { e, plano, erros, ocultos: ((plano && plano.motor && plano.motor.vespera) || {}).ocultos || [] };
  }

  function render() {
    const el = $('est-vespera');
    if (!el) return;
    const { e, erros, ocultos } = dados();
    if (!e) { el.innerHTML = '<p class="est-plano-vazio">Escolha um edital.</p>'; return; }
    const discs = e.disciplinas.filter(d => erros.some(x => x.disciplina_id === d.id && x.motivo !== FORA));
    if (!discs.some(d => d.id === discAtual)) discAtual = discs[0] ? discs[0].id : '';
    const P = window.estPlano;
    const pdfs = discAtual && P.pdfsDaDisciplina ? P.pdfsDaDisciplina(discAtual).map((p, i) => ({ ...p, ordem: i })) : [];
    const subs = window.estSub ? e.disciplinas.filter(d => d.id === discAtual).flatMap(d => d.topicos.flatMap(t => window.estSub.doTopico(t.id))) : [];
    const r = montar(erros, { discId: discAtual, pdfs, subs, ocultos: mostrarOcultos ? [] : ocultos });
    const disc = e.disciplinas.find(d => d.id === discAtual);
    const ocultosSet = new Set(ocultos);
    el.innerHTML = `
      <div class="est-plano-topo">
        <div>
          <h2 class="est-plano-titulo">📝 Resumo de véspera</h2>
          <span class="est-plano-sub">As regras certas dos erros que você registrou, por PDF e subtópico. Os erros que voltaram a acontecer vêm primeiro.</span>
        </div>
        <div class="est-plano-topo-acoes">
          ${discs.length ? `<select class="est-form-select" id="est-vespera-disc" aria-label="Disciplina">${discs.map(d => `<option value="${esc(d.id)}" ${d.id === discAtual ? 'selected' : ''}>${esc(d.nome)}</option>`).join('')}</select>` : ''}
          ${r.pdfs.length ? '<button type="button" class="est-plano-btn primario" data-a="pdf">⬇ Exportar PDF</button>' : ''}
        </div>
      </div>
      ${!discs.length ? '<div class="est-plano-card"><p class="est-plano-vazio">Ainda não há erros registrados com a regra certa. Ao registrar uma questão errada, escreva a regra em uma frase: ela aparece aqui.</p></div>' : `
      <div class="est-plano-card est-vespera" id="est-vespera-folha">
        <h3 class="est-vespera-disc">${esc(disc ? disc.nome : '')}</h3>
        ${r.pdfs.map(p => `<section class="est-vespera-pdf"><h4>📄 ${esc(p.nome)}</h4>
          ${p.subtopicos.map(s => `<div class="est-vespera-sub"><h5>${esc(s.nome)}</h5><ul>
            ${s.linhas.map(l => `<li class="${l.recorrencias ? 'recorrente' : ''} ${ocultosSet.has(l.id) ? 'oculta' : ''}" data-id="${esc(l.id)}">
              ${l.recorrencias ? `<span class="est-vespera-rec" title="Errou de novo ${l.recorrencias} vez(es) na revisão">↻ ${l.recorrencias}</span>` : ''}
              ${editando === l.id ? `<input class="est-form-input est-vespera-edit" value="${esc(l.regra)}" maxlength="500" aria-label="Regra" />`
                : `<span class="est-vespera-regra">${esc(l.regra)}</span>`}
              <span class="est-vespera-acoes">
                ${editando === l.id ? '<button type="button" class="est-plano-btn sutil" data-a="salvar">Salvar</button>'
                  : `<button type="button" class="est-plano-btn sutil" data-a="editar" title="Editar a regra (muda também no erro)" aria-label="Editar">✎</button>`}
                ${ocultosSet.has(l.id) ? '<button type="button" class="est-plano-btn sutil" data-a="mostrar" title="Voltar ao resumo">↺</button>'
                  : '<button type="button" class="est-plano-btn sutil" data-a="ocultar" title="Tirar do resumo (o erro continua no caderno)" aria-label="Tirar do resumo">✕</button>'}
              </span></li>`).join('')}
          </ul></div>`).join('')}</section>`).join('') || '<p class="est-plano-vazio">Nada para mostrar nesta disciplina.</p>'}
      </div>
      <p class="est-plano-sub">${r.semRegra ? `${r.semRegra} erro(s) sem a regra escrita não aparecem (escreva no Caderno de Erros). ` : ''}${ocultos.length ? `${ocultos.length} linha(s) tirada(s) do resumo · <button type="button" class="est-ed-link" data-a="ver-ocultos">${mostrarOcultos ? 'esconder' : 'mostrar'}</button>` : ''}</p>`}`;
  }

  async function salvarOcultos(ocultos) {
    const { plano } = dados();
    if (!plano || !window.estPlano.salvarMotorPlano) return false;
    return window.estPlano.salvarMotorPlano(plano, { vespera: { ocultos } });
  }

  async function acao(a, li) {
    const id = li && li.dataset.id;
    const { ocultos } = dados();
    if (a === 'editar') { editando = id; render(); const i = document.querySelector('.est-vespera-edit'); if (i) { i.focus(); i.select(); } return; }
    if (a === 'salvar') {
      const v = li.querySelector('.est-vespera-edit').value.trim();
      editando = null;
      if (v && window.estErros.atualizarRegra) await window.estErros.atualizarRegra(id, v);
      render();
      return;
    }
    if (a === 'ocultar') { if (await salvarOcultos([...new Set([...ocultos, id])])) render(); return; }
    if (a === 'mostrar') { if (await salvarOcultos(ocultos.filter(x => x !== id))) render(); return; }
    if (a === 'ver-ocultos') { mostrarOcultos = !mostrarOcultos; render(); return; }
    if (a === 'pdf') exportar();
  }

  async function exportar() {
    const folha = $('est-vespera-folha');
    if (!folha) return;
    const { e } = dados();
    const disc = e.disciplinas.find(d => d.id === discAtual);
    const nome = `Resumo de véspera - ${disc ? disc.nome : ''}.pdf`.replace(/[\\/:*?"<>|]/g, '');
    try {
      await window.carregarHtml2pdf();
      const el = document.createElement('div');
      el.className = 'est-vespera-pdf-doc';
      el.innerHTML = `<style>
        .est-vespera-pdf-doc { font: 11pt/1.45 Arial, sans-serif; color: #111; }
        .est-vespera-pdf-doc h1 { font-size: 16pt; margin: 0 0 4px; } .est-vespera-pdf-doc .sub { color: #555; font-size: 9pt; margin: 0 0 12px; }
        .est-vespera-pdf-doc h2 { font-size: 13pt; margin: 14px 0 4px; border-bottom: 1px solid #ccc; } .est-vespera-pdf-doc h3 { font-size: 11pt; margin: 8px 0 2px; color: #333; }
        .est-vespera-pdf-doc ul { margin: 0 0 6px 18px; padding: 0; } .est-vespera-pdf-doc li { margin: 2px 0; }
        .est-vespera-pdf-doc li.rec { font-weight: bold; } .est-vespera-pdf-doc .rec-n { background: #fff59d; padding: 0 4px; border-radius: 3px; font-size: 9pt; }
      </style>
      <h1>Resumo de véspera — ${esc(disc ? disc.nome : '')}</h1>
      <p class="sub">${esc(e.titulo)} · ${new Date().toLocaleDateString('pt-BR')} · ↻ = errou de novo na revisão</p>
      ${[...folha.querySelectorAll('.est-vespera-pdf')].map(p => `<h2>${esc(p.querySelector('h4').textContent.replace(/^📄\s*/, ''))}</h2>
        ${[...p.querySelectorAll('.est-vespera-sub')].map(s => `<h3>${esc(s.querySelector('h5').textContent)}</h3><ul>
          ${[...s.querySelectorAll('li:not(.oculta)')].map(li => { const n = li.querySelector('.est-vespera-rec');
            return `<li class="${n ? 'rec' : ''}">${n ? `<span class="rec-n">${esc(n.textContent)}</span> ` : ''}${esc(li.querySelector('.est-vespera-regra').textContent)}</li>`; }).join('')}</ul>`).join('')}`).join('')}`;
      const blob = await html2pdf().set({ margin: 15, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'], avoid: ['li', 'h2', 'h3'] } }).from(el).outputPdf('blob');
      if (window.estResumos && window.estResumos.gravarArquivo) await window.estResumos.gravarArquivo(blob, nome);
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
    } catch (err) {
      console.error('Resumo de véspera:', err);
      window.estPlano.aviso('Não foi possível gerar o PDF. Verifique a conexão e tente de novo.');
    }
  }

  function init() {
    const sec = $('est-vespera');
    if (!sec) return;
    if (window.estPlano && window.estPlano.renderSecao) {
      const original = window.estPlano.renderSecao;
      window.estPlano.renderSecao = s => { original(s); if (s === 'vespera') render(); };
    }
    sec.addEventListener('click', ev => {
      const b = ev.target.closest('[data-a]');
      if (b) acao(b.dataset.a, b.closest('li'));
    });
    sec.addEventListener('change', ev => { if (ev.target.id === 'est-vespera-disc') { discAtual = ev.target.value; editando = null; render(); } });
    sec.addEventListener('keydown', ev => {
      if (!ev.target.classList.contains('est-vespera-edit')) return;
      if (ev.key === 'Enter') acao('salvar', ev.target.closest('li'));
      if (ev.key === 'Escape') { editando = null; render(); }
    });
  }
  document.addEventListener('DOMContentLoaded', init);

  window.estVespera = { montar, render };
})();
