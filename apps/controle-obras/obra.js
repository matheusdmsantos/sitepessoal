/* ─── apps/controle-obras/obra.js — Acompanhamento de obra ───
 *
 * Parte "Obra" de um processo da Gestão de Contratos: cronograma físico (etapas
 * com peso e % concluído), visitas técnicas com fotos, pendências, honorários
 * mensais (no financeiro.js, tabela recebimentos), o Relatório Gerencial da Obra e as Solicitações de materiais
 * ao proprietário, que são documentos do processo impressos no mesmo papel timbrado da proposta.
 *
 * Tabelas: obras, obra_etapas, obra_visitas e obra_pendencias
 * (supabase/acompanhamento.sql). Fotos no bucket obras-docs, em <processo>/obra/.
 * Rotas: #/p/<processo>/obra/<aba>. Carregado antes do app.js, que chama
 * window.OB_OBRA(nucleo) com as funções que compartilha.
 */
window.OB_OBRA = function (n) {
  const { sb, BUCKET, esc, fmtData, fmtMoeda, campo, opcoes } = n;

  // Etapas sugeridas ao iniciar: [nome, peso (% da obra), início e fim previstos em fração do prazo]
  const ETAPAS_PADRAO = [
    ['Serviços preliminares e canteiro', 3, 0, 0.06], ['Fundação', 10, 0.04, 0.2], ['Estrutura', 22, 0.15, 0.55],
    ['Alvenaria', 10, 0.3, 0.6], ['Cobertura', 7, 0.5, 0.68], ['Instalações elétricas', 8, 0.4, 0.9],
    ['Instalações hidrossanitárias', 8, 0.35, 0.85], ['Revestimentos e pisos', 14, 0.55, 0.9],
    ['Esquadrias', 6, 0.7, 0.92], ['Pintura', 7, 0.8, 0.97], ['Acabamentos e limpeza final', 5, 0.9, 1]
  ];
  const CLIMAS = ['☀️ Ensolarado', '⛅ Nublado', '🌧️ Chuvoso', '⛈️ Chuva forte (obra parada)'];
  const GRAVIDADES = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };
  const ABAS = [['geral', 'Visão geral'], ['visitas', 'Visitas'], ['cronograma', 'Cronograma'],
    ['pendencias', 'Pendências'], ['materiais', 'Materiais'], ['honorarios', 'Financeiro'], ['relatorios', 'Relatórios']];
  // Documentos da obra guardam os dados num comentário no início do conteúdo
  const MARCA_RELATORIO = '<!--ob-relatorio:';
  const MARCA_MATERIAIS = '<!--ob-materiais:';
  const UNIDADES = ['un', 'pç', 'sc', 'kg', 't', 'm', 'm²', 'm³', 'l', 'gl', 'lata', 'cx', 'rolo', 'barra', 'milheiro'];
  const FOTO_MAX = 1600;   // lado maior da foto enviada (px)
  const ATRASO = 10;       // pontos abaixo do previsto para a etapa aparecer como atrasada

  let disponivel = false;
  let obras = [], etapas = [], visitas = [], pendencias = [];
  let filtroPend = 'abertas';
  const urls = {};   // links assinados das fotos: caminho → { url, ate }

  /* =============================================
     DADOS
  ============================================= */
  async function carregar() {
    const tabelas = ['obras', 'obra_etapas', 'obra_visitas', 'obra_pendencias'];
    const r = await Promise.all(tabelas.map(t => sb.from(t).select('*')));
    const falha = r.find(x => x.error);
    if (falha) {
      disponivel = false;
      if (!n.tabelaFaltando(falha.error)) console.error('Erro ao carregar o acompanhamento de obra:', falha.error);
      return;
    }
    disponivel = true;
    [obras, etapas, visitas, pendencias] = r.map(x => x.data || []);
  }

  const obraDe = pid => obras.find(o => o.processo_id === pid);
  const etapasDe = pid => etapas.filter(e => e.processo_id === pid).sort((a, b) => a.ordem - b.ordem);
  const visitasDe = pid => visitas.filter(v => v.processo_id === pid).sort((a, b) => b.data.localeCompare(a.data) || String(b.criado_em).localeCompare(String(a.criado_em)));
  const pendenciasDe = pid => pendencias.filter(x => x.processo_id === pid)
    .sort((a, b) => (!!a.corrigida_em - !!b.corrigida_em) || ordemGrav(a) - ordemGrav(b) || a.aberta_em.localeCompare(b.aberta_em));
  const ordemGrav = x => Object.keys(GRAVIDADES).indexOf(x.gravidade);
  const relatoriosDe = pid => n.docsDe(pid).filter(ehRelatorio);
  const solicitacoesDe = pid => n.docsDe(pid).filter(ehMateriais);

  function fotosDoProcesso(pid) {
    const fs = visitas.filter(v => v.processo_id === pid).flatMap(v => (v.fotos || []).map(f => f.caminho));
    pendencias.filter(x => x.processo_id === pid).forEach(x => fs.push(x.foto_antes, x.foto_depois));
    solicitacoesDe(pid).forEach(d => fs.push(...fotosDoDoc(d)));
    return fs.filter(Boolean);
  }

  function esquecer(pid) {
    const fora = x => x.processo_id !== pid;
    obras = obras.filter(fora); etapas = etapas.filter(fora); visitas = visitas.filter(fora);
    pendencias = pendencias.filter(fora);
  }

  /* =============================================
     CONTAS
  ============================================= */
  const fmtPct = v => (v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
  const limitar = v => Math.min(100, Math.max(0, Number(v) || 0));

  // Média ponderada pelo peso das etapas; pct(e) devolve o % da etapa (ou null para ignorá-la)
  function ponderado(lista, pct) {
    let soma = 0, pesos = 0;
    lista.forEach(e => {
      const v = pct(e);
      if (v == null) return;
      soma += (Number(e.peso) || 0) * v;
      pesos += Number(e.peso) || 0;
    });
    return pesos ? Math.round(soma / pesos * 10) / 10 : null;
  }

  // Previsto para a etapa numa data: linear entre o início e o fim previstos
  function previstoEtapa(e, dia) {
    if (!e.inicio || !e.fim) return null;
    if (dia < e.inicio) return 0;
    if (dia >= e.fim) return 100;
    const t = d => new Date(d + 'T12:00:00').getTime();
    return Math.round((t(dia) - t(e.inicio)) / Math.max(1, t(e.fim) - t(e.inicio)) * 1000) / 10;
  }

  // % da etapa ao fim de um dia: o atual, desfeito dos avanços das visitas posteriores
  function pctEm(e, dia) {
    const depois = visitas.filter(v => v.processo_id === e.processo_id && v.data > dia).sort((a, b) => a.data.localeCompare(b.data));
    for (const v of depois) {
      const a = (v.avancos || []).find(x => x.etapa_id === e.id);
      if (a) return Number(a.de) || 0;
    }
    return Number(e.percentual) || 0;
  }

  const avanco = pid => ponderado(etapasDe(pid), e => Number(e.percentual) || 0);
  const avancoPrevisto = (pid, dia = n.hoje()) => ponderado(etapasDe(pid), e => previstoEtapa(e, dia));

  function addMeses(dia, k) {
    const [a, m, d] = dia.split('-').map(Number);
    const ultimo = new Date(a, m - 1 + k + 1, 0).getDate();
    return n.dataLocal(new Date(a, m - 1 + k, Math.min(d, ultimo)));
  }
  const addDias = (dia, k) => { const d = new Date(dia + 'T12:00:00'); d.setDate(d.getDate() + k); return n.dataLocal(d); };
  const diaSemana = dia => new Date(dia + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long' });
  const comQuebras = s => esc(s).replace(/\n/g, '<br>');
  const dois = k => String(k).padStart(2, '0');

  /* =============================================
     FOTOS (reduzidas antes do envio; links assinados de 1 h)
  ============================================= */
  async function reduzirFoto(arquivo) {
    if (!/^image\/(jpeg|png|webp|heic|heif)/.test(arquivo.type || 'image/jpeg')) return arquivo;
    const bmp = await createImageBitmap(arquivo, { imageOrientation: 'from-image' }).catch(() => null);
    if (!bmp) return arquivo;
    const k = Math.min(1, FOTO_MAX / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise(res => c.toBlob(b => res(b || arquivo), 'image/jpeg', 0.85));
  }

  async function enviarFoto(pid, arquivo) {
    const blob = await reduzirFoto(arquivo);
    const ext = blob.type === 'image/jpeg' ? 'jpg' : (arquivo.name.split('.').pop() || 'img').toLowerCase();
    const caminho = `${pid}/obra/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const { error } = await sb.storage.from(BUCKET).upload(caminho, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
    if (error) { console.error('Erro ao enviar foto:', error); return null; }
    return caminho;
  }

  const apagarFotos = caminhos => { const cs = caminhos.filter(Boolean); if (cs.length) sb.storage.from(BUCKET).remove(cs); };

  async function linksFotos(caminhos) {
    const faltam = [...new Set(caminhos.filter(c => c && !(urls[c] && urls[c].ate > Date.now())))];
    if (faltam.length) {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(faltam, 3600);
      if (error) console.error('Erro ao abrir fotos:', error);
      (data || []).forEach(x => { if (x.signedUrl) urls[x.path] = { url: x.signedUrl, ate: Date.now() + 3300000 }; });
    }
    return Object.fromEntries(caminhos.map(c => [c, urls[c] ? urls[c].url : '']));
  }

  async function preencherFotos(raiz = document) {
    const imgs = [...raiz.querySelectorAll('img[data-foto]:not([src])')];
    if (!imgs.length) return;
    const links = await linksFotos(imgs.map(i => i.dataset.foto));
    imgs.forEach(i => { if (links[i.dataset.foto]) i.src = links[i.dataset.foto]; });
  }

  const miniatura = (caminho, legenda = '') =>
    `<button type="button" class="ob-foto" data-acao="obra-foto" data-caminho="${esc(caminho)}" title="${esc(legenda || 'Abrir foto')}"><img data-foto="${esc(caminho)}" alt="${esc(legenda)}" loading="lazy" /></button>`;

  /* =============================================
     TELAS
  ============================================= */
  function htmlArvore(p, ativo) {
    const o = obraDe(p.id);
    if (!o) return '';
    const vs = visitasDe(p.id);
    return `<a class="ob-arvore-item ob-arvore-obra ${ativo ? 'ativo' : ''}" href="#/p/${esc(p.id)}/obra">
      <span></span><span class="ob-arvore-ico">🏗️</span>
      <span class="ob-arvore-txt"><strong>Acompanhamento da obra</strong><small>${fmtPct(avanco(p.id))} concluído · ${vs.length} visita${vs.length === 1 ? '' : 's'}</small></span>
    </a>`;
  }

  function htmlTela(p, aba) {
    if (!disponivel) {
      return `<div class="ob-card"><h3 class="ob-card-titulo">🏗️ Acompanhamento da obra</h3>
        <p class="ob-aviso-inline">As tabelas do acompanhamento ainda não existem no Supabase. Rode <code>supabase/acompanhamento.sql</code> no SQL Editor e recarregue a página.</p></div>`;
    }
    const o = obraDe(p.id);
    if (!o) {
      return `<div class="ob-card ob-obra-inicio">
        <h3 class="ob-card-titulo">🏗️ Acompanhamento da obra</h3>
        <p>Registre as visitas com fotos, acompanhe o cronograma físico e as pendências, peça materiais ao proprietário, controle os honorários mensais e gere o Relatório Gerencial da Obra para o cliente.</p>
        <button type="button" class="ob-btn primario" data-acao="obra-configurar">Iniciar acompanhamento</button>
      </div>`;
    }
    const contagem = {
      visitas: visitasDe(p.id).length, cronograma: etapasDe(p.id).length,
      pendencias: pendenciasDe(p.id).filter(x => !x.corrigida_em).length, materiais: solicitacoesDe(p.id).length,
      honorarios: n.fin ? n.fin.resumoProcesso(p.id).qtdAberto : 0, relatorios: relatoriosDe(p.id).length
    };
    const sub = [o.endereco, o.inicio && `início ${fmtData(o.inicio)}`, o.termino && `término previsto ${fmtData(o.termino)}`,
      o.valor_mensal && `${fmtMoeda(o.valor_mensal)}/mês`].filter(Boolean).map(esc).join(' · ');
    const ativa = ABAS.some(([id]) => id === aba) ? aba : 'geral';
    const corpo = { geral: telaGeral, visitas: telaVisitas, cronograma: telaCronograma, pendencias: telaPendencias,
      materiais: telaMateriais, honorarios: telaHonorarios, relatorios: telaRelatorios }[ativa];
    return `
      <div class="ob-card ob-obra-cab">
        <div class="ob-obra-topo">
          <div>
            <h3 class="ob-card-titulo">🏗️ Acompanhamento da obra</h3>
            <p class="ob-sub">${sub}</p>
          </div>
          <div class="ob-obra-acoes">
            <button type="button" class="ob-btn primario" data-acao="obra-visita-nova">+ Registrar visita</button>
            <button type="button" class="ob-btn" data-acao="obra-relatorio-novo">📄 Relatório da semana</button>
            <button type="button" class="ob-btn sutil" data-acao="obra-configurar" title="Dados da obra e honorário mensal">⚙️ Configurar</button>
          </div>
        </div>
        <nav class="ob-chips ob-obra-abas" aria-label="Partes do acompanhamento">
          ${ABAS.map(([id, nome]) => `<a class="ob-chip ${id === ativa ? 'ativo' : ''}" href="#/p/${esc(p.id)}/obra/${id}">${nome}${contagem[id] ? ` <small>${contagem[id]}</small>` : ''}</a>`).join('')}
        </nav>
      </div>
      ${corpo(p, o)}`;
  }

  function telaGeral(p, o) {
    const real = avanco(p.id), prev = avancoPrevisto(p.id);
    const vs = visitasDe(p.id);
    const abertas = pendenciasDe(p.id).filter(x => !x.corrigida_em);
    const atrasadas = abertas.filter(x => x.prazo && n.diasAte(x.prazo) < 0).length;
    const fin = n.fin && n.fin.disponivel() ? n.fin.resumoProcesso(p.id) : null;
    const ult = vs[0];
    return `
      <section class="ob-kpis ob-obra-kpis">
        <div class="ob-kpi"><span>Avanço físico</span><strong>${fmtPct(real)}</strong><small>${prev != null ? `previsto para hoje: ${fmtPct(prev)}` : 'defina as datas no cronograma'}</small></div>
        <div class="ob-kpi"><span>Visitas</span><strong>${vs.length}</strong><small>${ult ? `última em ${fmtData(ult.data)}` : 'nenhuma ainda'}</small></div>
        <div class="ob-kpi"><span>Pendências abertas</span><strong>${abertas.length}</strong><small class="${atrasadas ? 'ob-erro' : ''}">${atrasadas ? `${atrasadas} com prazo vencido` : 'nenhuma atrasada'}</small></div>
        <div class="ob-kpi"><span>A receber</span><strong>${fin ? fmtMoeda(fin.aberto) : '—'}</strong><small class="${fin && fin.qtdVencido ? 'ob-erro' : ''}">${!fin ? 'rode supabase/financeiro.sql' : fin.qtdVencido ? `${fmtMoeda(fin.vencido)} vencido` : `${fin.qtdAberto} recebimento${fin.qtdAberto === 1 ? '' : 's'} em aberto`}</small></div>
      </section>
      <div class="ob-card">
        <h3 class="ob-card-titulo">Cronograma físico <a class="ob-link" href="#/p/${esc(p.id)}/obra/cronograma">ver tudo</a></h3>
        ${htmlBarraGeral(real, prev)}
        ${htmlEtapas(p, true)}
      </div>
      <div class="ob-card">
        <h3 class="ob-card-titulo">Última visita ${ult ? `<a class="ob-link" href="#/p/${esc(p.id)}/obra/visitas">todas as visitas</a>` : ''}</h3>
        ${ult ? htmlVisita(p, ult) : '<p class="ob-vazio">Nenhuma visita registrada. Use “+ Registrar visita” depois de cada ida à obra.</p>'}
      </div>`;
  }

  function htmlBarraGeral(real, prev) {
    return `<div class="ob-avanco-geral">
      <div class="ob-barra grande" role="img" aria-label="Avanço ${fmtPct(real)}${prev != null ? `, previsto ${fmtPct(prev)}` : ''}">
        <i style="width:${limitar(real)}%"></i>${prev != null ? `<b style="left:${limitar(prev)}%"></b>` : ''}
      </div>
      <p class="ob-sub"><strong>${fmtPct(real)}</strong> concluído${prev != null ? ` · previsto ${fmtPct(prev)}${real < prev - ATRASO / 2 ? ' · <span class="ob-erro">abaixo do previsto</span>' : ''}` : ''}</p>
    </div>`;
  }

  function htmlEtapas(p, resumido) {
    const es = etapasDe(p.id);
    if (!es.length) return '<p class="ob-vazio">Nenhuma etapa. Monte o cronograma em “Editar cronograma”.</p>';
    const pesos = es.reduce((s, e) => s + (Number(e.peso) || 0), 0) || 1;
    const hoje = n.hoje();
    return `<div class="ob-etapas">${es.map(e => {
      const pct = Number(e.percentual) || 0;
      const prev = previstoEtapa(e, hoje);
      const atrasada = prev != null && pct < prev - ATRASO;
      return `<div class="ob-etapa ${pct >= 100 ? 'feita' : ''}">
        <span class="ob-etapa-nome">${esc(e.nome)}${resumido ? '' : `<small>${fmtPct(Math.round((Number(e.peso) || 0) / pesos * 1000) / 10)} da obra${e.inicio ? ` · ${fmtData(e.inicio).slice(0, 5)} a ${fmtData(e.fim).slice(0, 5)}` : ''}</small>`}</span>
        <div class="ob-barra" title="${prev != null ? `Previsto para hoje: ${fmtPct(prev)}` : ''}"><i style="width:${limitar(pct)}%"></i>${prev != null ? `<b style="left:${limitar(prev)}%"></b>` : ''}</div>
        <span class="ob-etapa-pct">${fmtPct(pct)}</span>
        ${resumido ? '' : `<span class="ob-etapa-sit ${atrasada ? 'ob-erro' : ''}">${pct >= 100 ? 'concluída' : atrasada ? `${fmtPct(Math.round(prev - pct))} abaixo` : prev != null && prev > 0 ? 'no prazo' : ''}</span>`}
      </div>`;
    }).join('')}</div>`;
  }

  function telaCronograma(p) {
    return `<div class="ob-card">
      <h3 class="ob-card-titulo">Cronograma físico
        <button type="button" class="ob-btn" data-acao="obra-cronograma">✎ Editar cronograma</button></h3>
      ${htmlBarraGeral(avanco(p.id), avancoPrevisto(p.id))}
      ${htmlEtapas(p, false)}
      <p class="ob-sub ob-legenda"><i></i> concluído <b></b> previsto para hoje. O % de cada etapa é atualizado nas visitas; o peso diz quanto ela vale no total da obra.</p>
    </div>`;
  }

  function htmlVisita(p, v) {
    const nomeEtapa = id => (etapas.find(e => e.id === id) || {}).nome || 'Etapa excluída';
    const avs = (v.avancos || []).filter(a => Number(a.de) !== Number(a.para));
    const qtdPend = pendencias.filter(x => x.visita_id === v.id).length;
    return `<article class="ob-visita">
      <header>
        <strong>${fmtData(v.data)}</strong><span class="ob-sub">${esc(diaSemana(v.data))}</span>
        ${v.clima ? `<span class="ob-tag">${esc(v.clima)}</span>` : ''}
        ${v.efetivo ? `<span class="ob-tag">👷 ${esc(v.efetivo)}</span>` : ''}
        <span class="ob-visita-acoes">
          <button type="button" class="ob-btn sutil" data-acao="obra-visita-editar" data-id="${esc(v.id)}">✎ Editar</button>
          <button type="button" class="ob-btn sutil" data-acao="obra-visita-excluir" data-id="${esc(v.id)}" aria-label="Excluir visita">✕</button>
        </span>
      </header>
      ${v.atividades ? `<p><b>Atividades observadas:</b> ${comQuebras(v.atividades)}</p>` : ''}
      ${v.orientacoes ? `<p><b>Orientações:</b> ${comQuebras(v.orientacoes)}</p>` : ''}
      ${v.observacoes ? `<p><b>Observações:</b> ${comQuebras(v.observacoes)}</p>` : ''}
      ${avs.length || qtdPend ? `<div class="ob-visita-avancos">${avs.map(a => `<span class="ob-tag verde">${esc(nomeEtapa(a.etapa_id))}: ${fmtPct(a.de)} → ${fmtPct(a.para)}</span>`).join('')}
        ${qtdPend ? `<span class="ob-tag ambar">${qtdPend} pendência${qtdPend > 1 ? 's' : ''} apontada${qtdPend > 1 ? 's' : ''}</span>` : ''}</div>` : ''}
      ${(v.fotos || []).length ? `<div class="ob-fotos">${v.fotos.map(f => `<figure>${miniatura(f.caminho, f.legenda)}${f.legenda ? `<figcaption>${esc(f.legenda)}</figcaption>` : ''}</figure>`).join('')}</div>` : ''}
    </article>`;
  }

  function telaVisitas(p) {
    const vs = visitasDe(p.id);
    return `<div class="ob-card">
      <h3 class="ob-card-titulo">Visitas técnicas</h3>
      ${vs.map(v => htmlVisita(p, v)).join('') || '<p class="ob-vazio">Nenhuma visita registrada ainda.</p>'}
    </div>`;
  }

  function telaPendencias(p) {
    const todas = pendenciasDe(p.id);
    const lista = todas.filter(x => filtroPend === 'todas' || (filtroPend === 'abertas' ? !x.corrigida_em : !!x.corrigida_em));
    const qtd = { abertas: todas.filter(x => !x.corrigida_em).length, corrigidas: todas.filter(x => x.corrigida_em).length, todas: todas.length };
    return `<div class="ob-card">
      <h3 class="ob-card-titulo">Pendências e não conformidades
        <button type="button" class="ob-btn" data-acao="obra-pendencia-nova">+ Nova pendência</button></h3>
      <div class="ob-chips">${[['abertas', 'Abertas'], ['corrigidas', 'Corrigidas'], ['todas', 'Todas']].map(([id, nome]) =>
        `<button type="button" class="ob-chip ${filtroPend === id ? 'ativo' : ''}" data-acao="obra-filtro-pend" data-filtro="${id}">${nome} <small>${qtd[id]}</small></button>`).join('')}</div>
      ${lista.map(x => {
        const atrasada = !x.corrigida_em && x.prazo && n.diasAte(x.prazo) < 0;
        const info = [x.local, `aberta em ${fmtData(x.aberta_em)}`, x.prazo && `prazo ${fmtData(x.prazo)}`].filter(Boolean).map(esc).join(' · ');
        return `<div class="ob-pend ${x.corrigida_em ? 'feita' : ''}">
          <span class="ob-grav ${esc(x.gravidade)}">${esc(GRAVIDADES[x.gravidade] || x.gravidade)}</span>
          <div class="ob-pend-txt">
            <strong>${esc(x.descricao)}</strong>
            <small class="${atrasada ? 'ob-erro' : ''}">${info}${atrasada ? ' · atrasada' : ''}</small>
            ${x.corrigida_em ? `<small class="ob-ok">Corrigida em ${fmtData(x.corrigida_em)}${x.solucao ? `: ${esc(x.solucao)}` : ''}</small>` : ''}
          </div>
          <div class="ob-pend-fotos">${x.foto_antes ? miniatura(x.foto_antes, 'Antes') : ''}${x.foto_depois ? miniatura(x.foto_depois, 'Depois') : ''}</div>
          <div class="ob-pend-acoes">
            ${x.corrigida_em ? `<button type="button" class="ob-btn sutil" data-acao="obra-pendencia-reabrir" data-id="${esc(x.id)}">Reabrir</button>`
              : `<button type="button" class="ob-btn" data-acao="obra-pendencia-corrigir" data-id="${esc(x.id)}">✓ Corrigida</button>`}
            <button type="button" class="ob-btn sutil" data-acao="obra-pendencia-editar" data-id="${esc(x.id)}" aria-label="Editar pendência">✎</button>
            <button type="button" class="ob-btn sutil" data-acao="obra-pendencia-excluir" data-id="${esc(x.id)}" aria-label="Excluir pendência">✕</button>
          </div>
        </div>`;
      }).join('') || `<p class="ob-vazio">${filtroPend === 'abertas' ? 'Nenhuma pendência aberta.' : 'Nada por aqui.'}</p>`}
    </div>`;
  }

  const telaHonorarios = p => (n.fin ? n.fin.htmlCardProcesso(p) : '');

  function telaRelatorios(p) {
    const rs = relatoriosDe(p.id).slice().reverse();
    return `<div class="ob-card">
      <h3 class="ob-card-titulo">Relatórios gerenciais
        <button type="button" class="ob-btn primario" data-acao="obra-relatorio-novo">📄 Relatório da semana</button></h3>
      <p class="ob-sub">Cada relatório é um documento do processo: abra-o para ver a prévia e use “Imprimir / PDF” para mandar ao cliente.</p>
      ${rs.map(d => {
        const r = lerRelatorio(d);
        return `<a class="ob-rel-linha" href="#/p/${esc(p.id)}/d/${esc(d.id)}">
          <span class="ob-numero">${n.num4(d.numero)}</span>
          <span><strong>Relatório nº ${String(r.numero).padStart(2, '0')}</strong><small>${fmtData(r.de)} a ${fmtData(r.ate)}</small></span>
          <span>${fmtPct(r.avanco && r.avanco.atual)} concluído</span>
          <span class="ob-sub">${(r.fotos || []).length} foto${(r.fotos || []).length === 1 ? '' : 's'}</span>
        </a>`;
      }).join('') || '<p class="ob-vazio">Nenhum relatório ainda.</p>'}
    </div>`;
  }

  function telaMateriais(p) {
    const ss = solicitacoesDe(p.id).map(d => [d, lerMateriais(d)]).filter(([, m]) => m).reverse();
    return `<div class="ob-card">
      <h3 class="ob-card-titulo">Solicitações de materiais
        <button type="button" class="ob-btn primario" data-acao="obra-materiais-nova">📦 Nova solicitação</button></h3>
      <p class="ob-sub">Cada solicitação é um documento do processo, no papel timbrado: abra-a para ver a prévia, salvar o PDF e enviar ao proprietário pelo Gmail.</p>
      ${ss.map(([d, m]) => `<a class="ob-rel-linha" href="#/p/${esc(p.id)}/d/${esc(d.id)}">
          <span class="ob-numero">${n.num4(d.numero)}</span>
          <span><strong>Solicitação nº ${dois(m.numero)}</strong><small>${fmtData(m.data)}${m.etapa ? ` · ${esc(m.etapa)}` : ''}</small></span>
          <span>${qtdItens(m)}${m.prazo ? ` · entrega até ${fmtData(m.prazo)}` : ''}</span>
          <span class="ob-sub">${m.enviada_em ? `✉️ enviada em ${fmtData(m.enviada_em)}` : 'ainda não enviada'}</span>
        </a>`).join('') || '<p class="ob-vazio">Nenhuma solicitação ainda.</p>'}
    </div>`;
  }

  /* =============================================
     FORMULÁRIOS
  ============================================= */
  const botaoSalvar = (form, ligado) => form.querySelectorAll('[type=submit]').forEach(b => { b.disabled = !ligado; });
  const acoesForm = (rotulo = 'Salvar') => `<p class="ob-status inteiro" data-status></p>
    <div class="ob-form-acoes inteiro">
      <button type="button" class="ob-btn" data-acao="fechar-modal">Cancelar</button>
      <button type="submit" class="ob-btn primario">${rotulo}</button>
    </div>`;
  const status = (form, txt) => { form.querySelector('[data-status]').textContent = txt; };

  // Dados da proposta aceita para começar: acompanhamento (valor e meses) e a edificação
  function daProposta(pid) {
    const ultima = n.propostasDe(pid).pop();
    if (!ultima) return {};
    const it = ultima.dados.itens.find(x => x.unidade === 'meses' || x.id === 'acompanhamento');
    return { valor: it && it.valor, meses: it && Number(it.prazo), ed: ultima.dados.ed || {} };
  }

  function formObra(p) {
    const o = obraDe(p.id);
    const prop = o ? {} : daProposta(p.id);
    const ed = prop.ed || {};
    const inicio = o ? o.inicio : n.hoje();
    const dados = o || {
      inicio, termino: prop.meses ? addMeses(inicio, prop.meses) : '', endereco: ed.endereco || p.local || '',
      area: ed.area || '', sistema: ed.sistema || '', dia_vencimento: 5,
      valor_mensal: prop.valor || (p.mensal ? p.valor_contrato ?? p.valor_proposta : null)
    };
    const mudaFase = !o && ['prospeccao', 'proposta', 'negociacao', 'contratado'].includes(p.fase);
    n.abrirModal(o ? 'Dados da obra' : 'Iniciar acompanhamento de obra', `
      <form id="ob-form-obra" class="ob-form">
        ${prop.valor || prop.meses ? '<p class="ob-sub inteiro">Preenchido com a proposta do processo. Confira antes de salvar.</p>'
          : !o && p.mensal ? '<p class="ob-sub inteiro">Honorário mensal preenchido com o valor do processo. Confira antes de salvar.</p>' : ''}
        ${campo('Início do acompanhamento', `<input type="date" class="ob-input" name="inicio" value="${esc(dados.inicio)}" required />`)}
        ${campo('Término previsto', `<input type="date" class="ob-input" name="termino" value="${esc(dados.termino)}" />`)}
        ${campo('Endereço da obra', `<input class="ob-input" name="endereco" value="${esc(dados.endereco)}" />`, 'inteiro')}
        ${campo('Área construída (m²)', `<input class="ob-input" name="area" value="${esc(dados.area)}" placeholder="Ex.: 1.100" />`)}
        ${campo('Sistema construtivo', `<input class="ob-input" name="sistema" value="${esc(dados.sistema)}" placeholder="Ex.: estrutura mista de concreto armado e alvenaria" />`)}
        ${campo('Honorário mensal (R$)', `<input class="ob-input" name="valor_mensal" inputmode="decimal" value="${n.valorBr(dados.valor_mensal)}" placeholder="0,00" />`)}
        ${campo('Vencimento (dia do mês seguinte)', `<input type="number" min="1" max="28" class="ob-input" name="dia_vencimento" value="${esc(dados.dia_vencimento || 5)}" />`)}
        ${o ? '' : `
        <label class="ob-check azul inteiro"><input type="checkbox" name="etapas" checked /><span>Criar as etapas do cronograma (fundação, estrutura, alvenaria…), distribuídas entre o início e o término</span></label>`}
        <label class="ob-check azul inteiro"><input type="checkbox" name="mensalidades" ${o ? '' : 'checked'} /><span>${o ? 'Gerar as mensalidades que faltam' : 'Gerar as mensalidades'}, do início ao término (vencimento no mês seguinte ao trabalhado)</span></label>
        ${mudaFase ? `<label class="ob-check inteiro"><input type="checkbox" name="fase" checked /><span>Mudar a fase do processo para “<b>${esc(n.fase('execucao').nome)}</b>”</span></label>` : ''}
        ${acoesForm(o ? 'Salvar' : 'Iniciar')}
      </form>`);
    const form = document.getElementById('ob-form-obra');
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const f = new FormData(form);
      const nova = {
        id: p.id, processo_id: p.id, inicio: f.get('inicio') || null, termino: f.get('termino') || null,
        endereco: f.get('endereco').trim() || null, area: f.get('area').trim() || null, sistema: f.get('sistema').trim() || null,
        valor_mensal: n.lerNumero(f.get('valor_mensal')), dia_vencimento: Math.min(28, Math.max(1, parseInt(f.get('dia_vencimento'), 10) || 5))
      };
      if (nova.termino && nova.inicio && nova.termino <= nova.inicio) { status(form, 'O término precisa ser depois do início.'); return; }
      botaoSalvar(form, false);
      if (!(await n.gravar('obras', nova))) { botaoSalvar(form, true); return; }
      if (o) Object.assign(o, nova); else obras.push(nova);

      if (f.get('etapas')) {
        const ini = new Date(nova.inicio + 'T12:00:00').getTime();
        const dur = nova.termino ? new Date(nova.termino + 'T12:00:00').getTime() - ini : 0;
        const em = fr => (dur ? n.dataLocal(new Date(ini + dur * fr)) : null);
        const novas = ETAPAS_PADRAO.map(([nome, peso, a, b], i) => ({
          id: n.novoId('e'), processo_id: p.id, nome, ordem: i, peso, percentual: 0, inicio: em(a), fim: em(b)
        }));
        if (await n.gravar('obra_etapas', novas)) etapas.push(...novas);
      }
      let geradas = 0;
      if (f.get('mensalidades') && n.fin) {
        geradas = await n.fin.gerarMensalidades(p, { inicio: nova.inicio, fim: nova.termino, valor: nova.valor_mensal, dia: nova.dia_vencimento });
      }
      await n.registrar(p, 'obra', o ? 'Dados da obra alterados.'
        : `Acompanhamento de obra iniciado em ${fmtData(nova.inicio)}${nova.valor_mensal ? `, honorário de ${fmtMoeda(nova.valor_mensal)}/mês` : ''}.`);
      if (f.get('fase')) await n.mudarFase(p, 'execucao', 'início do acompanhamento de obra');
      n.fecharModal();
      if (geradas) n.aviso(`${geradas} mensalidade${geradas > 1 ? 's' : ''} gerada${geradas > 1 ? 's' : ''}.`);
      if (location.hash.startsWith(`#/p/${p.id}/obra`)) n.render(); else location.hash = `#/p/${p.id}/obra`;
    });
  }

  function formCronograma(p) {
    const linha = e => `<div class="ob-crono-linha" data-id="${esc(e.id || '')}">
        <input class="ob-input" name="nome" value="${esc(e.nome)}" placeholder="Etapa" aria-label="Etapa" required />
        <input class="ob-input" name="peso" inputmode="decimal" value="${esc(String(e.peso ?? 1).replace('.', ','))}" aria-label="Peso" />
        <input type="date" class="ob-input" name="inicio" value="${esc(e.inicio || '')}" aria-label="Início previsto" />
        <input type="date" class="ob-input" name="fim" value="${esc(e.fim || '')}" aria-label="Fim previsto" />
        <input type="number" min="0" max="100" step="1" class="ob-input" name="percentual" value="${esc(Number(e.percentual) || 0)}" aria-label="% concluído" />
        <span class="ob-crono-mover">
          <button type="button" class="ob-btn sutil" data-crono="subir" aria-label="Subir">↑</button>
          <button type="button" class="ob-btn sutil" data-crono="descer" aria-label="Descer">↓</button>
          <button type="button" class="ob-btn sutil" data-crono="remover" aria-label="Remover etapa">✕</button>
        </span>
      </div>`;
    n.abrirModal('Cronograma físico', `
      <form id="ob-form-crono" class="ob-form">
        <div class="ob-crono inteiro">
          <div class="ob-crono-linha ob-crono-cab"><span>Etapa</span><span>Peso</span><span>Início previsto</span><span>Fim previsto</span><span>% feito</span><span></span></div>
          <div data-linhas>${etapasDe(p.id).map(linha).join('')}</div>
        </div>
        <div class="inteiro ob-crono-rodape">
          <button type="button" class="ob-btn" data-crono="adicionar">+ Etapa</button>
          <span class="ob-sub" data-pesos></span>
        </div>
        ${acoesForm()}
      </form>`, true);
    const form = document.getElementById('ob-form-crono');
    const linhas = form.querySelector('[data-linhas]');
    const somarPesos = () => {
      const t = [...linhas.querySelectorAll('[name=peso]')].reduce((s, i) => s + (n.lerNumero(i.value) || 0), 0);
      form.querySelector('[data-pesos]').textContent = `Soma dos pesos: ${t.toLocaleString('pt-BR')} (cada etapa vale peso ÷ soma da obra).`;
    };
    somarPesos();
    form.addEventListener('input', somarPesos);
    form.addEventListener('click', ev => {
      const b = ev.target.closest('[data-crono]');
      if (!b) return;
      const l = b.closest('.ob-crono-linha');
      if (b.dataset.crono === 'adicionar') {
        linhas.insertAdjacentHTML('beforeend', linha({ nome: '', peso: 5, percentual: 0 }));
        linhas.lastElementChild.querySelector('[name=nome]').focus();
      } else if (b.dataset.crono === 'remover') l.remove();
      else if (b.dataset.crono === 'subir' && l.previousElementSibling) l.parentNode.insertBefore(l, l.previousElementSibling);
      else if (b.dataset.crono === 'descer' && l.nextElementSibling) l.parentNode.insertBefore(l.nextElementSibling, l);
      somarPesos();
    });
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const lidas = [...linhas.querySelectorAll('.ob-crono-linha')].map((l, i) => {
        const v = nome => l.querySelector(`[name=${nome}]`).value.trim();
        const antiga = etapas.find(e => e.id === l.dataset.id);
        return { ...(antiga || {}), id: l.dataset.id || n.novoId('e'), processo_id: p.id, nome: v('nome'), ordem: i,
          peso: n.lerNumero(v('peso')) ?? 1, inicio: v('inicio') || null, fim: v('fim') || null, percentual: limitar(v('percentual')) };
      }).filter(e => e.nome);
      const ruim = lidas.find(e => e.inicio && e.fim && e.fim < e.inicio);
      if (ruim) { status(form, `“${ruim.nome}”: o fim previsto está antes do início.`); return; }
      const removidas = etapasDe(p.id).filter(e => !lidas.some(x => x.id === e.id));
      botaoSalvar(form, false);
      if (lidas.length && !(await n.gravar('obra_etapas', lidas))) { botaoSalvar(form, true); return; }
      for (const e of removidas) await n.apagar('obra_etapas', e.id);
      const antes = avanco(p.id);
      etapas = etapas.filter(e => e.processo_id !== p.id).concat(lidas);
      await n.registrar(p, 'obra', `Cronograma da obra atualizado (${lidas.length} etapas${antes !== avanco(p.id) ? `; avanço ${fmtPct(antes)} → ${fmtPct(avanco(p.id))}` : ''}).`);
      n.fecharModal();
      n.render();
    });
  }

  function formVisita(p, v) {
    const es = etapasDe(p.id);
    const atuais = v ? (v.fotos || []).map(f => ({ ...f })) : [];
    const novas = [];   // { arquivo, url, legenda }
    const avancoDe = e => {
      const a = v && (v.avancos || []).find(x => x.etapa_id === e.id);
      return a ? a.para : e.percentual;
    };
    n.abrirModal(v ? `Visita de ${fmtData(v.data)}` : 'Registrar visita técnica', `
      <form id="ob-form-visita" class="ob-form">
        ${campo('Data da visita', `<input type="date" class="ob-input" name="data" value="${esc(v ? v.data : n.hoje())}" required />`)}
        ${campo('Clima', `<select class="ob-input" name="clima"><option value="">—</option>${opcoes(CLIMAS.map(c => [c, c]), v && v.clima)}</select>`)}
        ${campo('Equipe na obra', `<input class="ob-input" name="efetivo" value="${esc(v && v.efetivo)}" placeholder="Ex.: 1 mestre, 3 pedreiros, 2 serventes" />`, 'inteiro')}
        ${campo('Atividades observadas', `<textarea class="ob-input" name="atividades" rows="3" placeholder="O que estava sendo executado; o que avançou desde a última visita">${esc(v && v.atividades)}</textarea>`, 'inteiro')}
        ${campo('Orientações dadas', `<textarea class="ob-input" name="orientacoes" rows="3" placeholder="Orientações à equipe, conferências, medições, compras de material">${esc(v && v.orientacoes)}</textarea>`, 'inteiro')}
        ${campo('Observações', `<textarea class="ob-input" name="observacoes" rows="2">${esc(v && v.observacoes)}</textarea>`, 'inteiro')}

        ${es.length ? `<fieldset class="ob-grupo inteiro"><legend>Avanço das etapas (% concluído)</legend>
          <div class="ob-vis-etapas">${es.map(e => `<label><span>${esc(e.nome)}</span>
            <input type="number" min="0" max="100" step="1" class="ob-input" name="et_${esc(e.id)}" value="${esc(Number(avancoDe(e)) || 0)}" /></label>`).join('')}</div>
        </fieldset>` : ''}

        <fieldset class="ob-grupo inteiro"><legend>Fotos</legend>
          <div class="ob-vis-fotos" data-fotos></div>
          <label class="ob-btn ob-btn-arquivo">📷 Adicionar fotos<input type="file" accept="image/*" multiple data-novas hidden /></label>
          <small class="ob-sub">As fotos são reduzidas antes do envio (até ${FOTO_MAX} px). A legenda aparece no relatório.</small>
        </fieldset>

        ${campo('Pendências encontradas (uma por linha)', `<textarea class="ob-input" name="pendencias" rows="2" placeholder="Ex.: Pilar P4 com desaprumo de 2 cm"></textarea>`, 'inteiro')}
        ${acoesForm(v ? 'Salvar' : 'Registrar visita')}
      </form>`, true);
    const form = document.getElementById('ob-form-visita');
    const caixa = form.querySelector('[data-fotos]');
    const desenharFotos = () => {
      caixa.innerHTML = [
        ...atuais.map((f, i) => `<div class="ob-vis-foto ${f.remover ? 'removida' : ''}">
          <img data-foto="${esc(f.caminho)}" alt="" />
          <input class="ob-input" data-legenda="a${i}" value="${esc(f.legenda)}" placeholder="Legenda" aria-label="Legenda da foto" />
          <button type="button" class="ob-btn sutil" data-remover="a${i}" aria-label="${f.remover ? 'Manter foto' : 'Remover foto'}">${f.remover ? '↺' : '✕'}</button></div>`),
        ...novas.map((f, i) => `<div class="ob-vis-foto nova">
          <img src="${esc(f.url)}" alt="" />
          <input class="ob-input" data-legenda="n${i}" value="${esc(f.legenda)}" placeholder="Legenda" aria-label="Legenda da foto" />
          <button type="button" class="ob-btn sutil" data-remover="n${i}" aria-label="Remover foto">✕</button></div>`)
      ].join('') || '<p class="ob-vazio">Nenhuma foto.</p>';
      preencherFotos(caixa);
    };
    desenharFotos();
    const item = chave => (chave[0] === 'a' ? atuais : novas)[Number(chave.slice(1))];
    caixa.addEventListener('input', ev => { if (ev.target.dataset.legenda) item(ev.target.dataset.legenda).legenda = ev.target.value; });
    caixa.addEventListener('click', ev => {
      const b = ev.target.closest('[data-remover]');
      if (!b) return;
      const k = b.dataset.remover;
      if (k[0] === 'a') atuais[Number(k.slice(1))].remover = !atuais[Number(k.slice(1))].remover;
      else { URL.revokeObjectURL(novas[Number(k.slice(1))].url); novas.splice(Number(k.slice(1)), 1); }
      desenharFotos();
    });
    form.querySelector('[data-novas]').addEventListener('change', ev => {
      [...ev.target.files].forEach(a => novas.push({ arquivo: a, url: URL.createObjectURL(a), legenda: '' }));
      ev.target.value = '';
      desenharFotos();
    });

    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const f = new FormData(form);
      botaoSalvar(form, false);
      const enviadas = [];
      for (let i = 0; i < novas.length; i++) {
        status(form, `Enviando foto ${i + 1} de ${novas.length}…`);
        const caminho = await enviarFoto(p.id, novas[i].arquivo);
        if (!caminho) {
          status(form, `Não foi possível enviar a foto ${i + 1}. Confira a conexão e tente de novo.`);
          apagarFotos(enviadas.map(x => x.caminho));
          botaoSalvar(form, true);
          return;
        }
        enviadas.push({ caminho, legenda: novas[i].legenda.trim() });
      }
      status(form, 'Salvando…');

      // Avanço: guarda de onde saiu e para onde foi cada etapa alterada nesta visita. Só o campo
      // mexido muda o % da etapa (editar uma visita antiga não desfaz o que veio depois).
      const avancos = v ? (v.avancos || []).map(a => ({ ...a })) : [];
      const alteradas = [];
      es.forEach(e => {
        const campoEt = f.get('et_' + e.id);
        if (campoEt == null) return;
        const para = limitar(campoEt);
        if (para === limitar(avancoDe(e))) return;
        const a = avancos.find(x => x.etapa_id === e.id);
        if (a) a.para = para;
        else avancos.push({ etapa_id: e.id, de: Number(e.percentual) || 0, para });
        alteradas.push({ ...e, percentual: para });
      });
      const antes = avanco(p.id);
      const visita = {
        ...(v || { id: n.novoId('v'), processo_id: p.id, criado_em: new Date().toISOString() }),
        data: f.get('data'), clima: f.get('clima') || null, efetivo: f.get('efetivo').trim() || null,
        atividades: f.get('atividades').trim() || null, orientacoes: f.get('orientacoes').trim() || null,
        observacoes: f.get('observacoes').trim() || null, avancos: avancos.filter(a => Number(a.de) !== Number(a.para)),
        fotos: [...atuais.filter(x => !x.remover).map(({ caminho, legenda }) => ({ caminho, legenda: (legenda || '').trim() })), ...enviadas]
      };
      if (!(await n.gravar('obra_visitas', visita))) { apagarFotos(enviadas.map(x => x.caminho)); botaoSalvar(form, true); return; }
      if (v) Object.assign(v, visita); else visitas.push(visita);
      apagarFotos(atuais.filter(x => x.remover).map(x => x.caminho));
      if (alteradas.length && await n.gravar('obra_etapas', alteradas)) {
        alteradas.forEach(a => Object.assign(etapas.find(e => e.id === a.id), { percentual: a.percentual }));
      }
      const textos = String(f.get('pendencias') || '').split('\n').map(s => s.trim()).filter(Boolean);
      const novasPend = textos.map(t => ({ id: n.novoId('pd'), processo_id: p.id, descricao: t, local: null, gravidade: 'media',
        aberta_em: visita.data, prazo: null, visita_id: visita.id, foto_antes: null, corrigida_em: null, solucao: null, foto_depois: null }));
      if (novasPend.length && await n.gravar('obra_pendencias', novasPend)) pendencias.push(...novasPend);
      novas.forEach(x => URL.revokeObjectURL(x.url));

      const depois = avanco(p.id);
      const partes = [`${visita.fotos.length} foto${visita.fotos.length === 1 ? '' : 's'}`];
      if (antes !== depois) partes.push(`avanço ${fmtPct(antes)} → ${fmtPct(depois)}`);
      if (novasPend.length) partes.push(`${novasPend.length} pendência${novasPend.length > 1 ? 's' : ''}`);
      await n.registrar(p, 'obra', `${v ? 'Visita técnica alterada' : 'Visita técnica registrada'}: ${fmtData(visita.data)} (${partes.join('; ')}).`);
      n.fecharModal();
      if (location.hash.startsWith(`#/p/${p.id}/obra`)) n.render(); else location.hash = `#/p/${p.id}/obra/visitas`;
    });
  }

  async function enviarFotoDoCampo(form, nome, pid) {
    const a = form.querySelector(`[name=${nome}]`).files[0];
    if (!a) return undefined;
    status(form, 'Enviando foto…');
    const c = await enviarFoto(pid, a);
    if (!c) status(form, 'Não foi possível enviar a foto.');
    return c;
  }

  function formPendencia(p, x) {
    n.abrirModal(x ? 'Editar pendência' : 'Nova pendência', `
      <form id="ob-form-pend" class="ob-form">
        ${campo('Descrição *', `<input class="ob-input" name="descricao" required value="${esc(x && x.descricao)}" placeholder="Ex.: Ferragem exposta na viga V3" />`, 'inteiro')}
        ${campo('Local', `<input class="ob-input" name="local" value="${esc(x && x.local)}" placeholder="Ex.: Pavimento térreo, eixo B" />`)}
        ${campo('Gravidade', `<select class="ob-input" name="gravidade">${opcoes(Object.entries(GRAVIDADES), x ? x.gravidade : 'media')}</select>`)}
        ${campo('Aberta em', `<input type="date" class="ob-input" name="aberta_em" value="${esc(x ? x.aberta_em : n.hoje())}" required />`)}
        ${campo('Prazo para corrigir', `<input type="date" class="ob-input" name="prazo" value="${esc(x && x.prazo)}" />`)}
        ${campo(x && x.foto_antes ? 'Trocar a foto (antes)' : 'Foto (antes)', '<input type="file" accept="image/*" class="ob-input" name="foto" />', 'inteiro')}
        ${acoesForm()}
      </form>`);
    const form = document.getElementById('ob-form-pend');
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const f = new FormData(form);
      botaoSalvar(form, false);
      const foto = await enviarFotoDoCampo(form, 'foto', p.id);
      if (foto === null) { botaoSalvar(form, true); return; }
      const linha = {
        ...(x || { id: n.novoId('pd'), processo_id: p.id, visita_id: null, corrigida_em: null, solucao: null, foto_depois: null, foto_antes: null }),
        descricao: f.get('descricao').trim(), local: f.get('local').trim() || null, gravidade: f.get('gravidade'),
        aberta_em: f.get('aberta_em'), prazo: f.get('prazo') || null
      };
      const velha = foto && linha.foto_antes;
      if (foto) linha.foto_antes = foto;
      if (!(await n.gravar('obra_pendencias', linha))) { botaoSalvar(form, true); return; }
      if (velha) apagarFotos([velha]);
      if (x) Object.assign(x, linha);
      else {
        pendencias.push(linha);
        await n.registrar(p, 'obra', `Pendência aberta: ${linha.descricao}${linha.prazo ? ` (prazo ${fmtData(linha.prazo)})` : ''}.`);
      }
      n.fecharModal();
      n.render();
    });
  }

  function formCorrigir(p, x) {
    n.abrirModal('Pendência corrigida', `
      <form id="ob-form-corrigir" class="ob-form">
        <p class="inteiro"><strong>${esc(x.descricao)}</strong></p>
        ${campo('Corrigida em', `<input type="date" class="ob-input" name="corrigida_em" value="${esc(n.hoje())}" required />`)}
        ${campo('Foto (depois)', '<input type="file" accept="image/*" class="ob-input" name="foto" />')}
        ${campo('Como foi resolvida', '<textarea class="ob-input" name="solucao" rows="2"></textarea>', 'inteiro')}
        ${acoesForm('Marcar como corrigida')}
      </form>`);
    const form = document.getElementById('ob-form-corrigir');
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const f = new FormData(form);
      botaoSalvar(form, false);
      const foto = await enviarFotoDoCampo(form, 'foto', p.id);
      if (foto === null) { botaoSalvar(form, true); return; }
      const linha = { ...x, corrigida_em: f.get('corrigida_em'), solucao: f.get('solucao').trim() || null, foto_depois: foto || x.foto_depois };
      if (!(await n.gravar('obra_pendencias', linha))) { botaoSalvar(form, true); return; }
      if (foto && x.foto_depois) apagarFotos([x.foto_depois]);
      Object.assign(x, linha);
      await n.registrar(p, 'obra', `Pendência corrigida: ${x.descricao}.`);
      n.fecharModal();
      n.render();
    });
  }

  /* =============================================
     RELATÓRIO GERENCIAL DA OBRA
  ============================================= */
  function lerMarca(d, marca) {
    const c = d && d.conteudo;
    if (!c || !c.startsWith(marca)) return null;
    try { return JSON.parse(decodeURIComponent(c.slice(marca.length, c.indexOf('-->')))); }
    catch { return null; }
  }
  const comMarca = (marca, dados) => marca + encodeURIComponent(JSON.stringify(dados)) + '-->';
  const lerRelatorio = d => lerMarca(d, MARCA_RELATORIO);
  const lerMateriais = d => lerMarca(d, MARCA_MATERIAIS);
  const ehRelatorio = d => !!(d && d.conteudo && d.conteudo.startsWith(MARCA_RELATORIO));
  const ehMateriais = d => !!(d && d.conteudo && d.conteudo.startsWith(MARCA_MATERIAIS));
  const ehDocObra = d => ehRelatorio(d) || ehMateriais(d);

  // Retrato do avanço no período: % de cada etapa no início e no fim, e o previsto no fim
  function progressoNoPeriodo(pid, de, ate) {
    const es = etapasDe(pid);
    const vespera = addDias(de, -1);
    const linhas = es.map(e => ({ nome: e.nome, peso: Number(e.peso) || 0, anterior: pctEm(e, vespera), atual: pctEm(e, ate), previsto: previstoEtapa(e, ate) }));
    return {
      etapas: linhas,
      avanco: { anterior: ponderado(linhas, e => e.anterior), atual: ponderado(linhas, e => e.atual), previsto: ponderado(linhas, e => e.previsto) }
    };
  }

  function formRelatorio(p, d) {
    const salvo = d && lerRelatorio(d);
    const o = obraDe(p.id) || {};
    const rels = relatoriosDe(p.id).map(lerRelatorio).filter(Boolean);
    const numero = salvo ? salvo.numero : Math.max(0, ...rels.map(r => r.numero || 0)) + 1;
    const ultimoAte = rels.map(r => r.ate).sort().pop();
    const hoje = n.hoje();
    const de = salvo ? salvo.de : ultimoAte && ultimoAte < hoje ? addDias(ultimoAte, 1) : [addDias(hoje, -6), o.inicio || ''].sort().pop();
    const ate = salvo ? salvo.ate : hoje;
    let escolhidas = salvo ? new Set((salvo.fotos || []).map(f => f.caminho)) : null;   // null = todas
    const visitasNoPeriodo = (a, b) => visitasDe(p.id).filter(v => v.data >= a && v.data <= b).reverse();
    const resumoPadrao = vs => vs.filter(v => v.atividades).map(v => `${fmtData(v.data).slice(0, 5)}: ${v.atividades}`).join('\n');

    n.abrirModal(salvo ? `Relatório nº ${String(numero).padStart(2, '0')}` : 'Relatório Gerencial da Obra', `
      <form id="ob-form-rel" class="ob-form">
        ${campo('De', `<input type="date" class="ob-input" name="de" value="${esc(de)}" required />`)}
        ${campo('Até', `<input type="date" class="ob-input" name="ate" value="${esc(ate)}" required />`)}
        <p class="ob-sub inteiro" data-visitas></p>
        ${campo('Atividades da semana', `<textarea class="ob-input" name="resumo" rows="5">${esc(salvo ? salvo.resumo : '')}</textarea>`, 'inteiro')}
        ${campo('Próximas etapas / programação', `<textarea class="ob-input" name="proximos" rows="3" placeholder="O que deve ser executado na próxima semana">${esc(salvo ? salvo.proximos : '')}</textarea>`, 'inteiro')}
        <fieldset class="ob-grupo inteiro"><legend>Fotos do relatório</legend><div class="ob-rel-fotos" data-fotos></div></fieldset>
        <label class="ob-check azul inteiro"><input type="checkbox" name="pendencias" ${!salvo || salvo.pendencias ? 'checked' : ''} /><span>Incluir as pendências (abertas e as corrigidas no período)</span></label>
        ${salvo ? '<label class="ob-check azul inteiro"><input type="checkbox" name="atualizar" /><span>Atualizar o progresso físico com os percentuais de hoje</span></label>' : ''}
        ${acoesForm(salvo ? 'Salvar' : 'Gerar relatório')}
      </form>`, true);
    const form = document.getElementById('ob-form-rel');
    const resumo = form.querySelector('[name=resumo]');
    let resumoAuto = !salvo;
    resumo.addEventListener('input', () => { resumoAuto = false; });
    const atualizar = () => {
      const a = form.querySelector('[name=de]').value, b = form.querySelector('[name=ate]').value;
      const vs = a && b ? visitasNoPeriodo(a, b) : [];
      form.querySelector('[data-visitas]').textContent = vs.length
        ? `${vs.length} visita${vs.length > 1 ? 's' : ''} no período: ${vs.map(v => fmtData(v.data).slice(0, 5)).join(', ')}.`
        : 'Nenhuma visita registrada neste período.';
      if (resumoAuto) resumo.value = resumoPadrao(vs);
      const fotos = vs.flatMap(v => (v.fotos || []).map(f => ({ ...f, data: v.data })));
      form.querySelector('[data-fotos]').innerHTML = fotos.map(f => `<label class="ob-rel-foto">
          <input type="checkbox" name="foto" value="${esc(f.caminho)}" ${!escolhidas || escolhidas.has(f.caminho) ? 'checked' : ''} />
          <img data-foto="${esc(f.caminho)}" alt="" /><span>${esc(f.legenda || fmtData(f.data))}</span></label>`).join('')
        || '<p class="ob-vazio">Nenhuma foto nas visitas do período.</p>';
      preencherFotos(form);
    };
    atualizar();
    form.addEventListener('change', ev => {
      if (ev.target.name === 'foto') escolhidas = new Set([...form.querySelectorAll('[name=foto]:checked')].map(i => i.value));
      if (ev.target.name === 'de' || ev.target.name === 'ate') atualizar();
    });

    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const f = new FormData(form);
      const a = f.get('de'), b = f.get('ate');
      if (b < a) { status(form, 'O fim do período está antes do início.'); return; }
      const vs = visitasNoPeriodo(a, b);
      const marcadas = new Set(f.getAll('foto'));
      const prog = salvo && !f.get('atualizar') && salvo.de === a && salvo.ate === b ? { etapas: salvo.etapas, avanco: salvo.avanco } : progressoNoPeriodo(p.id, a, b);
      const pend = f.get('pendencias') ? pendenciasDe(p.id)
        .filter(x => x.aberta_em <= b && (!x.corrigida_em || x.corrigida_em >= a))
        .map(x => ({ descricao: x.descricao, local: x.local, gravidade: x.gravidade, aberta_em: x.aberta_em, prazo: x.prazo,
          corrigida_em: x.corrigida_em && x.corrigida_em <= b ? x.corrigida_em : null, solucao: x.corrigida_em && x.corrigida_em <= b ? x.solucao : null })) : null;
      const dados = {
        numero, de: a, ate: b, resumo: f.get('resumo').trim(), proximos: f.get('proximos').trim(),
        eu: n.meusDados(), cliente: p.cliente || '', assunto: p.assunto,
        obra: { endereco: o.endereco || p.local || '', area: o.area || '', sistema: o.sistema || '', inicio: o.inicio || '', termino: o.termino || '' },
        ...prog,
        visitas: vs.map(v => ({ data: v.data, clima: v.clima, efetivo: v.efetivo, atividades: v.atividades, orientacoes: v.orientacoes, observacoes: v.observacoes })),
        fotos: vs.flatMap(v => (v.fotos || []).filter(x => marcadas.has(x.caminho)).map(x => ({ caminho: x.caminho, legenda: x.legenda, data: v.data }))),
        pendencias: pend
      };
      const titulo = `Relatório Gerencial nº ${String(numero).padStart(2, '0')} — ${fmtData(a).slice(0, 5)} a ${fmtData(b)}`;
      const doc = { ...(d || { id: n.novoId('d'), processo_id: p.id, numero: n.proximoNumeroDoc(p), origem: 'interno', criado_em: new Date().toISOString() }),
        tipo: 'Relatório', titulo, data: b, conteudo: MARCA_RELATORIO + encodeURIComponent(JSON.stringify(dados)) + '-->' };
      botaoSalvar(form, false);
      if (!(await n.gravar('documentos', doc))) { botaoSalvar(form, true); return; }
      if (d) Object.assign(d, doc); else n.incluirDocumento(doc);
      await n.registrar(p, 'documento', d ? `Documento ${n.num4(doc.numero)} alterado: ${titulo}.`
        : `Documento ${n.num4(doc.numero)} incluído: ${titulo} (avanço ${fmtPct(dados.avanco.atual)}).`);
      n.fecharModal();
      location.hash = `#/p/${p.id}/d/${doc.id}`;
      n.render();
    });
  }

  const CSS_RELATORIO = `
    .rel-titulo { font-weight: bold; margin: 2px 0 12px; }
    .rel-titulo p { text-align: center; margin: 0 0 3px; font-size: 15.5px; }
    .rel-titulo p + p { font-size: 13px; font-weight: normal; }
    table.rel-tab { width: 100%; border-collapse: collapse; font-size: 12px; margin: 4px 0 10px; }
    .rel-tab th, .rel-tab td { border: 1px solid #999; padding: 5px 7px; vertical-align: middle; text-align: left; }
    .rel-tab thead th { background: #e8e8e8; text-align: center; }
    .rel-info th { width: 28%; background: #f1f1f1; font-weight: bold; }
    .rel-tab td.num { text-align: center; white-space: nowrap; }
    .rel-tab td.barra { width: 30%; }
    .rel-barra { position: relative; height: 9px; background: #e3e5e8; border-radius: 5px; }
    .rel-barra i { position: absolute; left: 0; top: 0; bottom: 0; background: #4b5059; border-radius: 5px; }
    .rel-barra b { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: #c0392b; }
    .rel-destaque { display: flex; gap: 10px; margin: 6px 0 8px; }
    .rel-destaque div { flex: 1; border: 1px solid #bbb; border-radius: 6px; padding: 7px 8px; text-align: center; }
    .rel-destaque strong { display: block; font-size: 19px; }
    .rel-destaque span { font-size: 10.5px; color: #444; }
    .rel-legenda { font-size: 10.5px !important; color: #444; }
    .rel-legenda i, .rel-legenda b { display: inline-block; vertical-align: middle; margin: 0 3px 0 8px; }
    .rel-legenda i { width: 14px; height: 7px; background: #4b5059; border-radius: 3px; }
    .rel-legenda b { width: 2px; height: 11px; background: #c0392b; }
    .rel-visita { margin: 0 0 8px; break-inside: avoid; }
    .rel-visita h4 { margin: 6px 0 3px; }
    .rel-alta { color: #b91c1c; font-weight: bold; }
    .rel-ok { color: #166534; }
    .rel-fotos { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; margin-top: 6px; }
    .rel-fotos figure { margin: 0; break-inside: avoid; }
    .rel-fotos img { width: 100%; height: 66mm; object-fit: contain; background: #f2f3f5; display: block; border: 1px solid #ccc; }
    .rel-fotos figcaption { font-size: 10.5px; text-align: center; margin-top: 3px; }`;

  function htmlRelatorio(r, links) {
    const eu = r.eu || {};
    const proponente = [eu.profissao, eu.nomeCompleto || eu.nome, eu.registro].filter(Boolean).join(' ');
    let k = 0;
    const sec = t => `<h3>${++k}. ${t}</h3>`;
    const av = r.avanco || {};
    const ganho = av.atual != null && av.anterior != null ? Math.round((av.atual - av.anterior) * 10) / 10 : null;
    const area = r.obra.area && n.lerNumero(r.obra.area) ? `${n.lerNumero(r.obra.area).toLocaleString('pt-BR')} m²` : r.obra.area;
    const info = [['Contratante', r.cliente], ['Obra / serviço', r.assunto], ['Endereço', r.obra.endereco],
      ['Características', [area && `${area} de área construída`, r.obra.sistema].filter(Boolean).join('; ')],
      ['Responsável técnico', proponente], ['Período do relatório', `${fmtData(r.de)} a ${fmtData(r.ate)}`],
      ['Início da obra / término previsto', r.obra.inicio ? `${fmtData(r.obra.inicio)}${r.obra.termino ? ' / ' + fmtData(r.obra.termino) : ''}` : '']]
      .filter(([, v]) => v);
    const assinatura = `<p class="prop-assinatura"><span></span>${esc(proponente || eu.nome || '')}<br>Responsável técnico</p>`;
    const fotos = (r.fotos || []).filter(f => links[f.caminho]);
    const pend = r.pendencias || [];

    return `
      <section>
        <div class="rel-titulo"><p>RELATÓRIO GERENCIAL DA OBRA Nº ${String(r.numero).padStart(2, '0')}</p><p>Período: ${fmtData(r.de)} a ${fmtData(r.ate)}</p></div>
        <table class="rel-tab rel-info"><tbody>${info.map(([a, b]) => `<tr><th>${esc(a)}</th><td>${esc(b)}</td></tr>`).join('')}</tbody></table>

        ${(r.etapas || []).length ? `${sec('PROGRESSO FÍSICO DA OBRA')}
        <div class="rel-destaque">
          <div><strong>${fmtPct(av.atual)}</strong><span>avanço acumulado</span></div>
          ${ganho != null ? `<div><strong>${ganho > 0 ? '+' : ''}${fmtPct(ganho).replace('%', '')} p.p.</strong><span>avanço no período</span></div>` : ''}
          ${av.previsto != null ? `<div><strong>${fmtPct(av.previsto)}</strong><span>previsto pelo cronograma</span></div>` : ''}
        </div>
        <table class="rel-tab"><thead><tr><th>Etapa</th><th>Anterior</th><th>Atual</th><th>Andamento</th></tr></thead>
          <tbody>${r.etapas.map(e => `<tr><td>${esc(e.nome)}</td><td class="num">${fmtPct(e.anterior)}</td><td class="num"><b>${fmtPct(e.atual)}</b></td>
            <td class="barra"><div class="rel-barra"><i style="width:${limitar(e.atual)}%"></i>${e.previsto != null ? `<b style="left:${limitar(e.previsto)}%"></b>` : ''}</div></td></tr>`).join('')}</tbody></table>
        ${r.etapas.some(e => e.previsto != null) ? '<p class="rel-legenda">Legenda:<i></i>executado<b></b>previsto pelo cronograma na data do relatório</p>' : ''}` : ''}

        ${r.resumo ? `${sec('ATIVIDADES DESENVOLVIDAS')}<p>${comQuebras(r.resumo)}</p>` : ''}

        ${(r.visitas || []).length ? `${sec('VISITAS TÉCNICAS')}${r.visitas.map(v => `<div class="rel-visita">
          <h4>${fmtData(v.data)} (${esc(diaSemana(v.data))})${v.clima ? ' — ' + esc(v.clima.replace(/^\S+\s/, '')) : ''}</h4>
          ${v.efetivo ? `<p><b>Equipe:</b> ${esc(v.efetivo)}</p>` : ''}
          ${v.atividades ? `<p><b>Atividades observadas:</b> ${comQuebras(v.atividades)}</p>` : ''}
          ${v.orientacoes ? `<p><b>Orientações:</b> ${comQuebras(v.orientacoes)}</p>` : ''}
          ${v.observacoes ? `<p><b>Observações:</b> ${comQuebras(v.observacoes)}</p>` : ''}
        </div>`).join('')}` : ''}

        ${r.pendencias ? `${sec('PENDÊNCIAS E NÃO CONFORMIDADES')}${pend.length ? `<table class="rel-tab">
          <thead><tr><th>Descrição</th><th>Gravidade</th><th>Apontada</th><th>Situação</th></tr></thead>
          <tbody>${pend.map(x => `<tr><td>${esc(x.descricao)}${x.local ? `<br><small>${esc(x.local)}</small>` : ''}</td>
            <td class="num ${x.gravidade === 'alta' ? 'rel-alta' : ''}">${esc(GRAVIDADES[x.gravidade] || '')}</td>
            <td class="num">${fmtData(x.aberta_em)}</td>
            <td>${x.corrigida_em ? `<span class="rel-ok">Corrigida em ${fmtData(x.corrigida_em)}</span>${x.solucao ? `<br><small>${esc(x.solucao)}</small>` : ''}`
              : `Em aberto${x.prazo ? ` · prazo ${fmtData(x.prazo)}` : ''}`}</td></tr>`).join('')}</tbody></table>`
          : '<p>Nenhuma pendência no período.</p>'}` : ''}

        ${r.proximos ? `${sec('PRÓXIMAS ETAPAS')}<p>${comQuebras(r.proximos)}</p>` : ''}
        ${fotos.length ? '' : assinatura}
      </section>
      ${fotos.length ? `<section class="prop-quebra">
        ${sec('REGISTRO FOTOGRÁFICO')}
        <div class="rel-fotos">${fotos.map((f, i) => `<figure><img src="${esc(links[f.caminho])}" alt="" /><figcaption>Foto ${i + 1}${f.legenda ? ' — ' + esc(f.legenda) : ''} (${fmtData(f.data)})</figcaption></figure>`).join('')}</div>
        ${assinatura}
      </section>` : ''}`.replace(/\n\s*/g, '');
  }

  async function paginaRelatorio(p, d, modo) {
    const r = lerRelatorio(d);
    const links = await linksFotos((r.fotos || []).map(f => f.caminho));
    return n.paginaTimbrada(`Relatório ${String(r.numero).padStart(2, '0')} - ${p.cliente || p.assunto}`, htmlRelatorio(r, links), r.eu, modo, CSS_RELATORIO);
  }

  /* =============================================
     SOLICITAÇÃO DE MATERIAIS (ao proprietário)
     Documento do processo no papel timbrado; os dados ficam em <!--ob-materiais:…-->.
     Vai por e-mail pelo Gmail: o PDF é salvo em "Imprimir / PDF" e anexado à mão
     (nenhum link de e-mail consegue anexar arquivo).
  ============================================= */
  const qtdItens = m => `${m.itens.length} ${m.itens.length === 1 ? 'item' : 'itens'}`;
  const emailValido = s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
  const fotosDaSolicitacao = m => (m ? m.itens.map(it => it.foto).filter(Boolean) : []);
  const fotosDoDoc = d => fotosDaSolicitacao(ehMateriais(d) && lerMateriais(d));
  // Foto do item no formulário: 📷 escolhe; com foto, a miniatura troca e o × tira.
  // shortcut: foto enviada e tirada antes de salvar (ou formulário cancelado) fica no bucket; limpar se pesar
  const celulaFoto = caminho => `<span class="ob-mat-foto" data-caminho="${esc(caminho)}">${caminho
    ? `<button type="button" class="ob-mat-mini" data-mat="foto" title="Trocar a foto" aria-label="Trocar a foto"><img data-foto="${esc(caminho)}" alt="" /></button><button type="button" class="ob-mat-tirar" data-mat="sem-foto" title="Tirar a foto" aria-label="Tirar a foto">×</button>`
    : '<button type="button" class="ob-btn sutil" data-mat="foto" title="Incluir foto do material" aria-label="Incluir foto do material">📷</button>'}</span>`;

  function formMateriais(p, d) {
    const salvo = d && lerMateriais(d);
    const anteriores = solicitacoesDe(p.id).map(lerMateriais).filter(Boolean);
    const numero = salvo ? salvo.numero : Math.max(0, ...anteriores.map(m => m.numero || 0)) + 1;
    // O e-mail do proprietário não tem campo no processo: vem da solicitação anterior
    const ultima = anteriores[anteriores.length - 1];
    const para = salvo ? salvo.para : (ultima && ultima.para) || { nome: p.cliente || p.contato || '', email: '' };
    const sugestoes = [...new Set(anteriores.flatMap(m => m.itens.map(it => it.material)))].sort((a, b) => a.localeCompare(b));
    const etapasObra = [...new Set([...etapasDe(p.id).map(e => e.nome), salvo && salvo.etapa].filter(Boolean))];
    const linhaItem = (it = {}) => `<div class="ob-mat-item">
        <input class="ob-input" name="material" value="${esc(it.material)}" placeholder="Material" aria-label="Material" list="ob-mat-sugestoes" />
        <input class="ob-input" name="espec" value="${esc(it.espec)}" placeholder="Especificação (opcional)" aria-label="Especificação" />
        <input class="ob-input" name="qtd" value="${esc(it.qtd)}" inputmode="decimal" placeholder="Qtd." aria-label="Quantidade" />
        <input class="ob-input" name="unidade" value="${esc(it.unidade)}" placeholder="Un." aria-label="Unidade" list="ob-mat-unidades" />
        ${celulaFoto(it.foto)}
        <button type="button" class="ob-btn sutil" data-mat="remover" aria-label="Remover item">✕</button>
      </div>`;

    n.abrirModal(`Solicitação de materiais nº ${dois(numero)}`, `
      <form id="ob-form-mat" class="ob-form" novalidate>
        ${campo('Data', `<input type="date" class="ob-input" name="data" value="${esc(salvo ? salvo.data : n.hoje())}" />`)}
        ${campo('Entregar na obra até (opcional)', `<input type="date" class="ob-input" name="prazo" value="${esc(salvo && salvo.prazo)}" />`)}
        ${campo('Para (proprietário)', `<input class="ob-input" name="para_nome" value="${esc(para.nome)}" />`)}
        ${campo('E-mail do proprietário', `<input type="email" class="ob-input" name="para_email" value="${esc(para.email)}" placeholder="nome@exemplo.com" />`)}
        ${etapasObra.length ? campo('Etapa da obra (opcional)', `<select class="ob-input" name="etapa"><option value="">—</option>${opcoes(etapasObra.map(e => [e, e]), salvo && salvo.etapa)}</select>`, 'inteiro') : ''}
        <div class="ob-mat-itens inteiro">
          <div class="ob-mat-item ob-mat-cab"><span>Material</span><span>Especificação</span><span>Qtd.</span><span>Un.</span><span>Foto</span><span></span></div>
          ${(salvo ? salvo.itens : [{}, {}, {}]).map(linhaItem).join('')}
          <div class="ob-prop-rodape"><button type="button" class="ob-btn sutil" data-mat="mais">+ Item</button><small class="ob-sub">Enter passa para o próximo item · Ctrl+V cola a foto na linha do cursor</small></div>
        </div>
        <datalist id="ob-mat-sugestoes">${sugestoes.map(s => `<option value="${esc(s)}"></option>`).join('')}</datalist>
        <datalist id="ob-mat-unidades">${UNIDADES.map(u => `<option value="${esc(u)}"></option>`).join('')}</datalist>
        ${campo('Observações (opcional)', `<textarea class="ob-input" name="obs" rows="3" placeholder="Ex.: descarregar pelo portão lateral; recebimento das 7h às 17h">${esc(salvo && salvo.obs)}</textarea>`, 'inteiro')}
        <input type="file" accept="image/*" data-mat-arquivo hidden />
        ${acoesForm(salvo ? 'Salvar' : 'Gerar solicitação')}
      </form>`, true);

    const form = document.getElementById('ob-form-mat');
    preencherFotos(form);
    const linhas = () => [...form.querySelectorAll('.ob-mat-item:not(.ob-mat-cab)')];
    const novaLinha = () => {
      form.querySelector('.ob-mat-itens .ob-prop-rodape').insertAdjacentHTML('beforebegin', linhaItem());
      linhas().pop().querySelector('[name=material]').focus();
    };
    const arquivo = form.querySelector('[data-mat-arquivo]');
    let celulaAlvo = null;
    let enviando = 0;
    form.addEventListener('click', ev => {
      const el = ev.target.closest('[data-mat]');
      if (!el) return;
      const acao = el.dataset.mat;
      if (acao === 'mais') novaLinha();
      else if (acao === 'foto') { celulaAlvo = el.closest('.ob-mat-foto'); arquivo.value = ''; arquivo.click(); }
      else if (acao === 'sem-foto') el.closest('.ob-mat-foto').outerHTML = celulaFoto('');
      else {
        el.closest('.ob-mat-item').remove();
        if (!linhas().length) novaLinha();
      }
    });
    arquivo.addEventListener('change', () => anexar(arquivo.files[0], celulaAlvo));
    // Ctrl+V com uma imagem (ex.: recorte do Win+Shift+S) vira a foto da linha do cursor;
    // fora de uma linha, da última linha com material
    form.addEventListener('paste', ev => {
      const img = [...((ev.clipboardData && ev.clipboardData.items) || [])].find(i => i.kind === 'file' && i.type.startsWith('image/'));
      if (!img) return;
      ev.preventDefault();
      const linha = (document.activeElement && document.activeElement.closest('.ob-mat-item:not(.ob-mat-cab)'))
        || linhas().filter(l => l.querySelector('[name=material]').value.trim()).pop() || linhas().pop();
      anexar(img.getAsFile(), linha.querySelector('.ob-mat-foto'));
    });
    async function anexar(f, alvo) {
      if (!f || !alvo) return;
      enviando++;
      botaoSalvar(form, false);
      status(form, 'Enviando a foto…');
      const caminho = await enviarFoto(p.id, f);
      enviando--;
      if (!enviando) { botaoSalvar(form, true); status(form, caminho ? '' : 'Não foi possível enviar a foto. Tente de novo.'); }
      if (!caminho || !alvo.isConnected) return;
      alvo.outerHTML = celulaFoto(caminho);
      preencherFotos(form);
    }
    // Enter numa linha de item vai para o próximo (ou cria um), em vez de enviar o formulário
    form.addEventListener('keydown', ev => {
      const linha = ev.key === 'Enter' && ev.target.closest('.ob-mat-item');
      if (!linha) return;
      ev.preventDefault();
      const prox = linha.nextElementSibling;
      if (prox && prox.matches('.ob-mat-item')) prox.querySelector('[name=material]').focus(); else novaLinha();
    });

    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const f = new FormData(form);
      const itens = linhas().map(row => {
        const v = nome => row.querySelector(`[name=${nome}]`).value.trim();
        return { material: v('material'), espec: v('espec'), qtd: v('qtd'), unidade: v('unidade'), foto: row.querySelector('.ob-mat-foto').dataset.caminho || '' };
      }).filter(it => it.material);
      if (enviando) { status(form, 'Espere a foto terminar de enviar.'); return; }
      const email = f.get('para_email').trim();
      if (!itens.length) { status(form, 'Inclua pelo menos um material.'); return; }
      if (email && !emailValido(email)) { status(form, 'Confira o e-mail do proprietário.'); return; }
      const o = obraDe(p.id) || {};
      const etapa = f.get('etapa') || '';
      const dados = {
        numero, data: f.get('data') || n.hoje(), prazo: f.get('prazo') || '', etapa, itens, obs: f.get('obs').trim(),
        para: { nome: f.get('para_nome').trim(), email }, enviada_em: (salvo && salvo.enviada_em) || '',
        eu: n.meusDados(), cliente: p.cliente || '', assunto: p.assunto, endereco: o.endereco || p.local || ''
      };
      const doc = { ...(d || { id: n.novoId('d'), processo_id: p.id, numero: n.proximoNumeroDoc(p), origem: 'interno', criado_em: new Date().toISOString() }),
        tipo: 'Solicitação de materiais', titulo: `Nº ${dois(numero)} — ${qtdItens(dados)}${etapa ? ` · ${etapa}` : ''}`,
        data: dados.data, conteudo: comMarca(MARCA_MATERIAIS, dados) };
      botaoSalvar(form, false);
      if (!(await n.gravar('documentos', doc))) { botaoSalvar(form, true); return; }
      // Fotos tiradas da solicitação saem do armazenamento
      const ficam = new Set(itens.map(it => it.foto));
      apagarFotos(salvo ? salvo.itens.map(it => it.foto).filter(c => !ficam.has(c)) : []);
      if (d) Object.assign(d, doc); else n.incluirDocumento(doc);
      await n.registrar(p, 'documento', `Documento ${n.num4(doc.numero)} ${d ? 'alterado' : 'incluído'}: Solicitação de materiais nº ${dois(numero)} (${qtdItens(dados)}).`);
      n.fecharModal();
      location.hash = `#/p/${p.id}/d/${doc.id}`;
      n.render();
    });
  }

  function htmlMateriais(m, links) {
    const eu = m.eu || {};
    const comFoto = m.itens.some(it => links[it.foto]);
    const responsavel = [eu.profissao, eu.nomeCompleto || eu.nome, eu.registro].filter(Boolean).join(' ');
    const info = [['Proprietário', m.cliente], ['Obra / serviço', m.assunto], ['Endereço da obra', m.endereco],
      ['Etapa da obra', m.etapa], ['Entrega na obra até', m.prazo ? fmtData(m.prazo) : ''], ['Responsável técnico', responsavel]]
      .filter(([, v]) => v);
    const comEspec = m.itens.some(it => it.espec);
    const nome = m.para && m.para.nome;
    return `
      <section>
        <div class="rel-titulo"><p>SOLICITAÇÃO DE MATERIAIS Nº ${dois(m.numero)}</p><p>${fmtData(m.data)}</p></div>
        <table class="rel-tab rel-info"><tbody>${info.map(([a, b]) => `<tr><th>${esc(a)}</th><td>${esc(b)}</td></tr>`).join('')}</tbody></table>
        <p>${nome ? `Prezado(a) ${esc(nome)},` : 'Prezado(a) proprietário(a),'}</p>
        <p>Para dar continuidade aos serviços da obra, solicito a aquisição e a entrega dos materiais relacionados abaixo${m.prazo ? ` até ${fmtData(m.prazo)}` : ''}.</p>
        <table class="rel-tab"><thead><tr><th>Item</th><th>Material</th>${comEspec ? '<th>Especificação</th>' : ''}<th>Qtd.</th><th>Un.</th></tr></thead>
          <tbody>${m.itens.map((it, i) => `<tr><td class="num">${i + 1}</td>
            <td class="${comFoto ? 'mat-com-foto' : ''}">${esc(it.material)}${links[it.foto] ? `<img class="mat-foto" src="${esc(links[it.foto])}" alt="Foto: ${esc(it.material)}" />` : ''}</td>
            ${comEspec ? `<td>${esc(it.espec)}</td>` : ''}<td class="num">${esc(it.qtd)}</td><td class="num">${esc(it.unidade)}</td></tr>`).join('')}</tbody></table>
        ${m.obs ? `<p><b>Observações:</b> ${comQuebras(m.obs)}</p>` : ''}
        <p>Fico à disposição para esclarecer as especificações ou avaliar a troca de algum material.</p>
        <p class="prop-assinatura"><span></span>${esc(responsavel || eu.nome || '')}<br>Responsável técnico</p>
      </section>`.replace(/\n\s*/g, '');
  }

  const CSS_MATERIAIS = `
    .rel-tab td.mat-com-foto { width: 42%; }
    .rel-tab img.mat-foto { display: block; max-width: 100%; max-height: 45mm; margin: 5px 0 2px; object-fit: contain; }
    .rel-tab tr { break-inside: avoid; }`;

  async function paginaMateriais(p, d, modo) {
    const m = lerMateriais(d);
    const links = await linksFotos(fotosDaSolicitacao(m));
    // O título vira o nome sugerido ao salvar o PDF
    return n.paginaTimbrada(`Solicitação de materiais ${dois(m.numero)} - ${p.cliente || p.assunto}`, htmlMateriais(m, links), m.eu, modo, CSS_RELATORIO + CSS_MATERIAIS);
  }

  function formEmailMateriais(p, d) {
    const m = lerMateriais(d);
    const h = new Date().getHours();
    const primeiro = ((m.para && m.para.nome) || '').trim().split(/\s+/)[0];
    const lista = m.itens.map(it => `• ${it.material}${it.espec ? ` (${it.espec})` : ''}${it.qtd || it.unidade ? ` — ${[it.qtd, it.unidade].filter(Boolean).join(' ')}` : ''}`).join('\n');
    const assunto = `Solicitação de materiais nº ${dois(m.numero)} — ${p.assunto}`;
    const assinatura = m.eu && (m.eu.nomeCompleto || m.eu.nome);
    const texto = [
      `${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'}${primeiro ? `, ${primeiro}` : ''}!`,
      `Segue em anexo a solicitação de materiais nº ${dois(m.numero)} da obra${m.endereco ? ` (${m.endereco})` : ''}${m.prazo ? `, com entrega na obra até ${fmtData(m.prazo)}` : ''}:`,
      lista,
      m.obs ? `Observações: ${m.obs}` : '',
      'Qualquer dúvida, fico à disposição.',
      assinatura ? `Atenciosamente,\n${assinatura}` : ''
    ].filter(Boolean).join('\n\n');

    n.abrirModal(`Enviar a solicitação nº ${dois(m.numero)} por e-mail`, `
      <form id="ob-form-email" class="ob-form" novalidate>
        <ol class="ob-passos inteiro">
          <li>Clique em <button type="button" class="ob-btn" data-acao="obra-materiais-pdf" data-id="${esc(d.id)}">📄 Salvar o PDF</button> e, na janela de impressão, escolha “Salvar como PDF”.</li>
          <li>Depois, clique em “Abrir no Gmail”, anexe o PDF salvo e envie.</li>
        </ol>
        ${campo('Para', `<input type="email" class="ob-input" name="para" value="${esc(m.para && m.para.email)}" placeholder="e-mail do proprietário" />`, 'inteiro')}
        ${campo('Assunto', `<input class="ob-input" name="assunto" value="${esc(assunto)}" />`, 'inteiro')}
        ${campo('Mensagem (pode editar antes de abrir)', `<textarea class="ob-input" name="texto" rows="12">${esc(texto)}</textarea>`, 'inteiro')}
        ${acoesForm('✉️ Abrir no Gmail')}
      </form>`, true);

    const form = document.getElementById('ob-form-email');
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const f = new FormData(form);
      const para = f.get('para').trim(), assuntoFinal = f.get('assunto').trim();
      if (!emailValido(para)) { status(form, 'Informe o e-mail do proprietário.'); return; }
      // Aberto antes de qualquer await, ainda no clique, para o navegador não bloquear a aba
      window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(para)}&su=${encodeURIComponent(assuntoFinal)}&body=${encodeURIComponent(f.get('texto'))}`, '_blank', 'noopener');
      n.fecharModal();
      // Guarda o e-mail (a próxima solicitação já vem com ele) e a data do envio
      const doc = { ...d, conteudo: comMarca(MARCA_MATERIAIS, { ...m, para: { ...m.para, email: para }, enviada_em: n.hoje() }) };
      if (await n.gravar('documentos', doc)) Object.assign(d, doc);
      await n.registrar(p, 'mensagem', `E-mail para ${para}: “${assuntoFinal}”.`);
      n.render();
      n.aviso('Gmail aberto. Anexe o PDF da solicitação antes de enviar.');
    });
  }

  /* =============================================
     DOCUMENTOS DA OBRA (relatório e solicitação de materiais) na árvore do processo
  ============================================= */
  function htmlDocumento(p, d) {
    const m = lerMateriais(d);
    const r = m ? null : lerRelatorio(d);
    const resumo = m
      ? `${qtdItens(m)}${m.prazo ? ` · entrega até ${fmtData(m.prazo)}` : ''} · ${m.enviada_em ? `enviada por e-mail em ${fmtData(m.enviada_em)}` : 'ainda não enviada'}`
      : `${(r.visitas || []).length} visita(s) · ${(r.fotos || []).length} foto(s) · avanço ${fmtPct(r.avanco && r.avanco.atual)}`;
    return `<div class="ob-card ob-doc">
      <div class="ob-doc-cab">
        <div>
          <p class="ob-sub">Documento ${n.num4(d.numero)} · interno · ${fmtData(d.data)}</p>
          <h3 class="ob-doc-titulo">${esc(d.tipo)} — ${esc(d.titulo)}</h3>
          <p class="ob-sub">${resumo} · <a class="ob-link" href="#/p/${esc(p.id)}/obra${m ? '/materiais' : ''}">acompanhamento da obra</a></p>
        </div>
        <div class="ob-doc-acoes">
          ${m ? `<button type="button" class="ob-btn primario" data-acao="obra-materiais-email" data-id="${esc(d.id)}">✉️ Enviar por e-mail</button>` : ''}
          <button type="button" class="ob-btn" data-acao="imprimir-doc">Imprimir / PDF</button>
          <button type="button" class="ob-btn" data-acao="editar-doc">Editar</button>
          <button type="button" class="ob-btn perigo" data-acao="excluir-doc">Excluir</button>
        </div>
      </div>
      <iframe class="ob-prop-visor" title="Prévia do documento" data-doc-obra="${esc(d.id)}"></iframe>
    </div>`;
  }

  const paginaDoc = (p, d, modo) => (ehMateriais(d) ? paginaMateriais(p, d, modo) : paginaRelatorio(p, d, modo));
  const editarDoc = (p, d) => (ehMateriais(d) ? formMateriais : formRelatorio)(p, d);

  async function imprimirDoc(p, d) {
    const w = window.open('', '_blank');   // aberta já no clique, para o navegador não bloquear
    if (!w) { n.aviso('Libere as janelas pop-up para imprimir.'); return; }
    w.document.write('<p style="font-family:sans-serif">Preparando o documento…</p>');
    const html = await paginaDoc(p, d, 'imprimir');
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  /* Depois de desenhar a tela: miniaturas das fotos e a prévia do documento da obra */
  async function depoisRender(p) {
    preencherFotos();
    const fr = document.querySelector('iframe[data-doc-obra]');
    if (!fr) return;
    const d = n.docsDe(p.id).find(x => x.id === fr.dataset.docObra);
    if (d) fr.srcdoc = await paginaDoc(p, d, 'tela');
  }

  /* =============================================
     AÇÕES
  ============================================= */
  async function aoClicar(acao, el, p) {
    if (!p) return;
    const id = el.dataset.id;
    if (acao === 'obra-configurar') formObra(p);
    else if (acao === 'obra-cronograma') formCronograma(p);
    else if (acao === 'obra-visita-nova') formVisita(p, null);
    else if (acao === 'obra-visita-editar') formVisita(p, visitas.find(v => v.id === id));
    else if (acao === 'obra-relatorio-novo') formRelatorio(p, null);
    else if (acao === 'obra-materiais-nova') formMateriais(p, null);
    else if (acao === 'obra-materiais-email' || acao === 'obra-materiais-pdf') {
      const d = n.docsDe(p.id).find(x => x.id === id);
      if (d) (acao === 'obra-materiais-pdf' ? imprimirDoc : formEmailMateriais)(p, d);
    }
    else if (acao === 'obra-pendencia-nova') formPendencia(p, null);
    else if (acao === 'obra-pendencia-editar') formPendencia(p, pendencias.find(x => x.id === id));
    else if (acao === 'obra-pendencia-corrigir') formCorrigir(p, pendencias.find(x => x.id === id));
    else if (acao === 'obra-filtro-pend') { filtroPend = el.dataset.filtro; n.render(); }
    else if (acao === 'obra-foto') {
      const c = urls[el.dataset.caminho];
      if (c) window.open(c.url, '_blank', 'noopener');
    } else if (acao === 'obra-visita-excluir') {
      const v = visitas.find(x => x.id === id);
      if (!v || !confirm(`Excluir a visita de ${fmtData(v.data)} e as ${(v.fotos || []).length} foto(s) dela? O % das etapas fica como está.`)) return;
      if (!(await n.apagar('obra_visitas', v.id))) return;
      visitas = visitas.filter(x => x.id !== v.id);
      apagarFotos((v.fotos || []).map(f => f.caminho));
      await n.registrar(p, 'obra', `Visita técnica de ${fmtData(v.data)} excluída.`);
      n.render();
    } else if (acao === 'obra-pendencia-reabrir') {
      const x = pendencias.find(y => y.id === id);
      if (!x) return;
      const linha = { ...x, corrigida_em: null };
      if (!(await n.gravar('obra_pendencias', linha))) return;
      Object.assign(x, linha);
      await n.registrar(p, 'obra', `Pendência reaberta: ${x.descricao}.`);
      n.render();
    } else if (acao === 'obra-pendencia-excluir') {
      const x = pendencias.find(y => y.id === id);
      if (!x || !confirm(`Excluir a pendência “${x.descricao}”?`)) return;
      if (!(await n.apagar('obra_pendencias', x.id))) return;
      pendencias = pendencias.filter(y => y.id !== x.id);
      apagarFotos([x.foto_antes, x.foto_depois]);
      n.render();
    }
  }

  return {
    carregar, esquecer, fotosDoProcesso, htmlArvore, htmlTela, htmlDocumento, depoisRender,
    ehDocObra, editarDoc, imprimirDoc, fotosDoDoc, aoClicar
  };
};
