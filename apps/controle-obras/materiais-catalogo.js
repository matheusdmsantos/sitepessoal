/* ─── apps/controle-obras/materiais-catalogo.js — catálogo da Solicitação de materiais ───
 *
 * Materiais frequentes com especificação guiada. Quando o nome digitado no item contém
 * uma das palavras de "chaves" (sem acento, minúsculas), o item ganha os campos abaixo
 * e o texto da especificação é montado por texto(c), onde c = { idDoCampo: valor }.
 *
 * COMO INCLUIR UM MATERIAL NOVO: copie um bloco e ajuste.
 *   id          identificador único (sem espaço)
 *   chaves      palavras que reconhecem o material no nome digitado
 *   nome        nome sugerido na lista de materiais
 *   unidade     unidade padrão (uma de OB_UNIDADES)
 *   modalidade  'compra' ou 'locacao' (padrão do item)
 *   embalagem   texto padrão de "Forma de venda / embalagem" (opcional)
 *   campos      lista de campos:
 *     { id, rotulo, tipo, opcoes?, padrao?, dica? }
 *     tipo: 'texto' | 'numero' | 'opcao' (lista) | 'varios' (caixas de marcar) | 'item' (outro item da lista)
 *   texto(c)    monta a especificação; use OB_NUM(valor, casas) para números no formato 3,00
 *   avisos(c, item)  (opcional) devolve uma lista de avisos mostrados antes de salvar
 */
window.OB_UNIDADES = ['un', 'pç', 'kg', 'm', 'm²', 'm³', 'rolo', 'pacote', 'saco', 'barra', 'jogo'];

// "3" → "3,00"; "2.5" ou "2,5" → "2,5" (casas = mínimo de casas decimais); vazio → ''
window.OB_NUM = (v, casas = 0) => {
  const x = Number(String(v == null ? '' : v).replace(',', '.'));
  return String(v == null ? '' : v).trim() === '' || !isFinite(x) ? '' : x.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: 2 });
};

(() => {
  const N = window.OB_NUM;
  const lista = xs => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`);
  const marcados = v => (Array.isArray(v) ? v : []);
  const BWG = { 10: '3,40', 12: '2,77', 14: '2,11', 16: '1,65', 18: '1,24', 20: '0,89', 22: '0,71' };

  window.OB_CATALOGO_MATERIAIS = [
    {
      id: 'escora', chaves: ['escora'], nome: 'Escora metálica', unidade: 'un', modalidade: 'locacao',
      campos: [
        { id: 'tipo', rotulo: 'Tipo', tipo: 'opcao', opcoes: ['telescópica regulável', 'fixa'], padrao: 'telescópica regulável' },
        { id: 'min', rotulo: 'Altura mínima (m)', tipo: 'numero' },
        { id: 'max', rotulo: 'Altura máxima (m)', tipo: 'numero' },
        { id: 'acess', rotulo: 'Acessórios', tipo: 'varios', opcoes: ['base', 'cabeçal (forcado)'] }
      ],
      texto: c => `Escora metálica ${c.tipo || 'telescópica regulável'}` +
        (c.min || c.max ? `, ajuste de ${N(c.min, 2) || '?'} a ${N(c.max, 2) || '?'} m` : '') +
        (marcados(c.acess).length ? `, com ${lista(marcados(c.acess))}` : ''),
      avisos: c => (!c.min || !c.max ? ['Escora sem a faixa de altura (mínima e máxima).'] : [])
    },
    {
      id: 'tabua', chaves: ['tabua'], nome: 'Tábua de madeira', unidade: 'un', modalidade: 'compra',
      campos: [
        { id: 'madeira', rotulo: 'Tipo de madeira', tipo: 'texto', dica: 'ex.: pinus, eucalipto, cambará' },
        { id: 'esp', rotulo: 'Espessura (cm)', tipo: 'numero' },
        { id: 'larg', rotulo: 'Largura (cm)', tipo: 'numero' },
        { id: 'comp', rotulo: 'Comprimento (m)', tipo: 'numero' }
      ],
      texto: c => `Tábua de madeira${c.madeira ? ` ${c.madeira}` : ''}` +
        [c.esp && `espessura ${N(c.esp)} cm`, c.larg && `largura ${N(c.larg)} cm`, c.comp && `comprimento ${N(c.comp, 2)} m`]
          .filter(Boolean).map((t, i) => (i ? ' × ' : ', ') + t).join(''),
      avisos: c => [
        ...(!c.esp || !c.larg || !c.comp ? ['Tábua sem alguma das medidas (espessura, largura e comprimento).'] : []),
        ...(Number(String(c.esp || '').replace(',', '.')) > 10 ? [`Tábua com espessura de ${N(c.esp)} cm: confira se não trocou espessura por largura.`] : [])
      ]
    },
    {
      id: 'prego', chaves: ['prego'], nome: 'Prego', unidade: 'kg', modalidade: 'compra', embalagem: 'pacote de 1 kg',
      campos: [
        { id: 'cabeca', rotulo: 'Cabeça', tipo: 'opcao', opcoes: ['com cabeça', 'sem cabeça'], padrao: 'com cabeça' },
        { id: 'bitola', rotulo: 'Bitola', tipo: 'texto', dica: 'ex.: 18x27' }
      ],
      texto: c => `Prego ${c.cabeca || 'com cabeça'}${c.bitola ? `, bitola ${c.bitola}` : ''}`,
      avisos: (c, it) => [
        ...(!c.bitola ? ['Prego sem a bitola (ex.: 18x27).'] : []),
        ...(c.bitola && it.foto ? [`Confira se a foto do prego corresponde à bitola ${c.bitola}.`] : [])
      ]
    },
    {
      id: 'arame', chaves: ['arame'], nome: 'Arame recozido', unidade: 'rolo', modalidade: 'compra', embalagem: 'rolo de 1 kg',
      campos: [
        { id: 'bwg', rotulo: 'Número BWG', tipo: 'opcao', opcoes: Object.keys(BWG), padrao: '18', dica: 'BWG 18 = 1,24 mm' }
      ],
      texto: c => `Arame recozido BWG ${c.bwg || '18'} (${BWG[c.bwg || '18'] || '?'} mm)`,
      avisos: (c, it) => (/torcid/i.test(`${it.material} ${it.espec}`) ? ['Arame: "recozido" e "torcido" são produtos diferentes. Deixe só o que você quer comprar.'] : [])
    },
    {
      id: 'andaime', chaves: ['andaime'], nome: 'Andaime tubular', unidade: 'pç', modalidade: 'locacao',
      campos: [
        { id: 'tipo', rotulo: 'Tipo', tipo: 'opcao', opcoes: ['fachadeiro (painel)', 'torre'], padrao: 'fachadeiro (painel)' },
        { id: 'larg', rotulo: 'Largura do painel (m)', tipo: 'numero' },
        { id: 'alt', rotulo: 'Altura do painel (m)', tipo: 'numero' },
        { id: 'qtdE', rotulo: 'A quantidade representa', tipo: 'opcao', opcoes: ['painéis', 'módulos completos'], padrao: 'painéis' },
        { id: 'acess', rotulo: 'Acessórios', tipo: 'varios', opcoes: ['diagonais', 'travessas', 'sapatas', 'rodízios', 'travas', 'guarda-corpo', 'rodapé'] }
      ],
      texto: c => `Andaime tubular ${c.tipo || 'fachadeiro (painel)'}` +
        (c.larg || c.alt ? `, painel de ${N(c.larg, 2) || '?'} x ${N(c.alt, 2) || '?'} m` : '') +
        `; quantidade em ${c.qtdE || 'painéis'}` +
        (marcados(c.acess).length ? `; com ${lista(marcados(c.acess))}` : ''),
      avisos: c => [
        ...(!c.larg || !c.alt ? ['Andaime sem as dimensões do painel.'] : []),
        ...(!marcados(c.acess).includes('guarda-corpo') || !marcados(c.acess).includes('rodapé')
          ? ['Andaime sem guarda-corpo e rodapé: verifique a NR-18 conforme a altura de trabalho.'] : [])
      ]
    },
    {
      id: 'plataforma', chaves: ['plataforma'], nome: 'Plataforma para andaime', unidade: 'pç', modalidade: 'locacao',
      campos: [
        { id: 'mat', rotulo: 'Material', tipo: 'opcao', opcoes: ['metálica', 'de madeira'], padrao: 'metálica' },
        { id: 'extras', rotulo: 'Características', tipo: 'varios', opcoes: ['antiderrapante', 'com travas'] },
        { id: 'comp', rotulo: 'Comprimento (m)', tipo: 'numero' },
        { id: 'larg', rotulo: 'Largura (m)', tipo: 'numero' },
        { id: 'compat', rotulo: 'Compatível com o item nº', tipo: 'item' }
      ],
      texto: (c, nomeDoItem) => `Plataforma ${c.mat || 'metálica'} para andaime` +
        (marcados(c.extras).length ? `, ${lista(marcados(c.extras))}` : '') +
        (c.comp || c.larg ? `, ${N(c.comp, 2) || '?'} x ${N(c.larg, 2) || '?'} m` : '') +
        (c.compat ? `, compatível com o item ${c.compat}${nomeDoItem ? ` (${nomeDoItem(c.compat)})` : ''}` : ''),
      avisos: c => (!c.comp || !c.larg ? [`Plataforma sem as dimensões${c.compat ? ` (ou confirme que basta ser compatível com o item ${c.compat})` : ''}.`] : [])
    }
  ];
})();
