/* ─── apps/controle-obras/proposta-textos.js — serviços que podem entrar na proposta ───
 *
 * A ordem da lista é a ordem das seções e das etapas do prazo. Cada serviço tem:
 *   nome        como aparece na lista de valores e no prazo
 *   detalhe     o que está incluído, entre parênteses na lista de valores
 *   prazo       sugestão de prazo; "unidade" troca dias úteis por meses (serviço contínuo)
 *   titulo      título da seção técnica
 *   intro       parágrafo de abertura
 *   vantagens   [rótulo, texto] da lista "Nossos serviços são desenvolvidos para assegurar"
 *   escopo      [grupo, [itens]] do "Escopo Técnico de Serviços"
 *   contratante obrigações do contratante que só valem com este serviço
 *   sondagem    true se o prazo depende do laudo de sondagem
 */
window.OB_PROPOSTA_SERVICOS = [
  {
    id: 'estrutural',
    nome: 'Projeto Estrutural em Concreto Armado',
    detalhe: 'fundações, superestrutura, escada e reservatório',
    prazo: 10,
    sondagem: true,
    titulo: 'PROJETO ESTRUTURAL EM CONCRETO ARMADO',
    intro: 'O Projeto Estrutural é a base de toda a edificação: é ele que garante a estabilidade, a segurança e a durabilidade da construção ao longo de toda a sua vida útil, em total conformidade com a NBR 6118 – Projeto de estruturas de concreto.',
    vantagens: [
      ['Segurança e Conformidade', 'O dimensionamento de fundações, pilares, vigas e lajes segue estritamente as normas técnicas vigentes (NBR 6118, NBR 6120, NBR 6122, NBR 6123 e NBR 8681), garantindo a estabilidade global da edificação e evitando patologias como fissuras, flechas excessivas e recalques.'],
      ['Economia e Otimização', 'O lançamento racional da estrutura e o dimensionamento preciso evitam o superdimensionamento, reduzindo o consumo de concreto, aço e formas e, consequentemente, o custo da obra.'],
      ['Compatibilização com a Arquitetura', 'Pilares e vigas são posicionados respeitando o layout dos ambientes, os vãos livres e a circulação vertical, preservando a funcionalidade e a estética do projeto arquitetônico.'],
      ['Facilidade de Execução', 'Detalhamento claro e completo das armaduras e formas, permitindo uma execução rápida, segura e sem improvisos no canteiro de obras.']
    ],
    escopo: [
      ['Concepção e Lançamento Estrutural', [
        'Análise do projeto arquitetônico e definição do sistema estrutural mais adequado (pilares, vigas e lajes).',
        'Locação dos elementos estruturais compatibilizada com os ambientes internos, a escada e os demais elementos de circulação.'
      ]],
      ['Análise e Dimensionamento', [
        'Levantamento das ações permanentes e variáveis (NBR 6120) e das ações do vento (NBR 6123), com as devidas combinações (NBR 8681).',
        'Análise da estabilidade global da edificação e dimensionamento dos elementos nos Estados-Limites Último e de Serviço (flechas e fissuração), considerando a classe de agressividade ambiental e os cobrimentos.'
      ]],
      ['Fundações', [
        'Dimensionamento das fundações conforme a NBR 6122, com base no laudo de sondagem do terreno.',
        'Planta de locação e cargas dos pilares e detalhamento dos elementos de fundação e das vigas baldrame.'
      ]],
      ['Plantas e Detalhamento Executivo', [
        'Plantas de Formas: baldrame, pavimentos, cobertura e reservatório.',
        'Detalhamento das Armaduras: pilares, vigas e lajes de todos os pavimentos.',
        'Elementos Especiais: detalhamento da escada, do reservatório superior e, quando houver, do poço do elevador.'
      ]],
      ['Quantitativos e Especificações', [
        'Resumo de aço por bitola, volume de concreto e área de formas, essenciais para o orçamento e a gestão de compras da obra, além das notas técnicas (fck, cobrimentos e especificações dos materiais).'
      ]]
    ],
    contratante: ['Fornecer o laudo de sondagem do terreno (SPT), indispensável ao dimensionamento das fundações;']
  },
  {
    id: 'hidraulico',
    nome: 'Projeto de Instalações Hidráulicas',
    detalhe: 'água fria, reservatórios e recalque',
    prazo: 3,
    titulo: 'PROJETO DE INSTALAÇÕES HIDRÁULICAS (ÁGUA FRIA)',
    intro: 'O Projeto de Instalações Hidráulicas garante o suprimento eficiente de água em todos os pontos de consumo da edificação, em conformidade com a NBR 5626 – Sistemas prediais de água fria e água quente.',
    vantagens: [
      ['Eficiência e Conforto', 'Pressão e vazão adequadas em todos os pontos de consumo, sem falta de água em chuveiros e torneiras dos pavimentos superiores.'],
      ['Economia', 'Reservatórios e tubulações dimensionados na medida certa, sem desperdício de material nem de água.'],
      ['Planejamento de Obra', 'Traçado exato das tubulações, compatibilizado com a estrutura, e levantamento de quantitativos para a gestão de compras.']
    ],
    escopo: [
      ['Água Fria', [
        'Cálculo de consumo e dimensionamento dos reservatórios inferior e superior e do sistema de recalque, quando necessário.',
        'Dimensionamento de barrilete, colunas, ramais e sub-ramais; previsão de hidrômetros individuais por unidade, quando solicitado.',
        'Plantas de distribuição, isométricos dos ambientes molhados e detalhes de barrilete e cavalete.'
      ]],
      ['Especificação e Lista de Materiais', [
        'Especificação de tubos, conexões, registros e acessórios e quantitativo completo para a gestão de compras da obra.'
      ]]
    ],
    contratante: ['Informar os equipamentos previstos (ar-condicionado, bombas, aquecedores, elevador) e eventuais preferências de pontos elétricos e hidráulicos;']
  },
  {
    id: 'sanitario',
    nome: 'Projeto de Instalações Sanitárias e Drenagem Pluvial',
    detalhe: 'esgoto sanitário e drenagem de águas pluviais do telhado',
    prazo: 3,
    titulo: 'PROJETO DE INSTALAÇÕES SANITÁRIAS E DRENAGEM PLUVIAL',
    intro: 'O Projeto de Instalações Sanitárias garante o correto escoamento do esgoto e a captação das águas de chuva do telhado, em conformidade com as normas NBR 8160 (esgoto sanitário) e NBR 10844 (águas pluviais). Um projeto bem resolvido evita conflitos entre prumadas, vazamentos e infiltrações entre pavimentos.',
    vantagens: [
      ['Higiene e Saúde', 'Ventilação da rede de esgoto e uso correto de caixas sifonadas, evitando o retorno de gases e odores para os ambientes.'],
      ['Proteção da Edificação', 'Captação e condução corretas das águas de chuva do telhado, evitando infiltrações, transbordamento de calhas e manchas em fachadas e lajes.'],
      ['Planejamento de Obra', 'Traçado exato das tubulações, compatibilizado com a estrutura, e levantamento de quantitativos para a gestão de compras.']
    ],
    escopo: [
      ['Esgoto Sanitário', [
        'Dimensionamento de ramais de descarga, ramais de esgoto, tubos de queda, subcoletores e coletor predial.',
        'Sistema de ventilação, caixas de inspeção e de gordura e destinação final (rede pública ou fossa e sumidouro).'
      ]],
      ['Drenagem de Águas Pluviais do Telhado', [
        'Cálculo da vazão de projeto conforme a NBR 10844, a partir das áreas de contribuição da cobertura.',
        'Dimensionamento de calhas, rufos, condutores verticais e horizontais, caixas de areia e destinação das águas.',
        'Planta de cobertura com indicação das quedas d’água e detalhes de calhas e conexões.'
      ]],
      ['Especificação e Lista de Materiais', [
        'Especificação de tubos, conexões, caixas e acessórios e quantitativo completo para a gestão de compras da obra.'
      ]]
    ]
  },
  {
    id: 'eletrico',
    nome: 'Projeto de Instalações Elétricas',
    detalhe: 'pontos, circuitos, quadros e entrada de energia',
    prazo: 5,
    titulo: 'PROJETO DE INSTALAÇÕES ELÉTRICAS',
    intro: 'O Projeto de Instalações Elétricas é essencial para garantir a segurança dos usuários, a eficiência energética e a funcionalidade da edificação, em total conformidade com a NBR 5410 e com as normas da concessionária local.',
    vantagens: [
      ['Segurança e Conformidade', 'Dimensionamento e detalhamento segundo a NBR 5410, protegendo os usuários e o patrimônio contra curtos-circuitos, sobrecargas e choques elétricos.'],
      ['Otimização e Economia', 'Estudo de demanda e distribuição racional dos circuitos, evitando o sobredimensionamento e gerando economia na compra de materiais.'],
      ['Independência entre Unidades', 'Quando houver mais de uma unidade, medição e quadros de distribuição individuais para cada uma, além dos circuitos de uso comum.'],
      ['Flexibilidade e Manutenção', 'Projeto concebido para futuras expansões e para facilitar a manutenção.']
    ],
    escopo: [
      ['Estudo de Demanda e Dimensionamento', [
        'Cálculo de carga e de demanda de cada unidade e das áreas comuns.',
        'Dimensionamento de condutores, eletrodutos, disjuntores, quadros de distribuição (QDs) e entrada de energia.'
      ]],
      ['Plantas e Detalhamento Executivo', [
        'Planta de pontos: tomadas, iluminação, interruptores e pontos específicos (chuveiros, ar-condicionado, etc.).',
        'Planta de eletrodutos e circuitos, diagramas unifilares dos QDs e do Quadro de Medição, conforme o padrão da concessionária.'
      ]],
      ['Aterramento e Proteção', [
        'Detalhamento do sistema de aterramento e especificação de DR e DPS, conforme as exigências normativas.'
      ]],
      ['Lista de Materiais', [
        'Quantitativo de cabos, eletrodutos, disjuntores, tomadas, interruptores e quadros, para o planejamento de compras.'
      ]]
    ],
    contratante: ['Informar os equipamentos previstos (ar-condicionado, bombas, aquecedores, elevador) e eventuais preferências de pontos elétricos e hidráulicos;']
  },
  {
    id: 'incendio',
    nome: 'Projeto de Prevenção e Combate a Incêndio',
    detalhe: 'medidas de segurança exigidas pelo Corpo de Bombeiros',
    prazo: 5,
    titulo: 'PROJETO DE PREVENÇÃO E COMBATE A INCÊNDIO',
    intro: 'O Projeto de Prevenção e Combate a Incêndio define as medidas de segurança que protegem a vida dos ocupantes e o patrimônio, e é exigido para a regularização da edificação junto ao Corpo de Bombeiros Militar, em conformidade com a legislação estadual de segurança contra incêndio e as normas técnicas aplicáveis.',
    vantagens: [
      ['Segurança dos Ocupantes', 'Rotas de fuga, sinalização e iluminação de emergência que permitem a saída rápida e segura da edificação.'],
      ['Aprovação sem Retrabalho', 'Medidas definidas a partir da classificação correta da edificação (ocupação, altura, área e carga de incêndio), evitando exigências e devoluções no processo de análise.'],
      ['Compatibilização', 'Equipamentos e tubulações posicionados em harmonia com a arquitetura, a estrutura e as demais instalações.']
    ],
    escopo: [
      ['Classificação e Medidas de Segurança', [
        'Classificação da edificação quanto à ocupação, altura, área construída e carga de incêndio e definição das medidas de segurança exigidas.'
      ]],
      ['Sistemas e Dispositivos', [
        'Saídas de emergência, extintores, sinalização de emergência (NBR 13434) e iluminação de emergência (NBR 10898).',
        'Hidrantes ou mangotinhos (NBR 13714), alarme e detecção, quando exigidos para a edificação.'
      ]],
      ['Plantas e Documentação', [
        'Plantas com a locação dos sistemas, detalhes, memorial descritivo e de cálculo e formulários exigidos pelo Corpo de Bombeiros.',
        'Acompanhamento do processo de análise do projeto, com o atendimento de eventuais exigências.'
      ]]
    ]
  },
  {
    id: 'acompanhamento',
    nome: 'Acompanhamento Técnico da Obra',
    detalhe: 'visitas periódicas e relatório de cada visita',
    prazo: 3,
    unidade: 'meses',
    titulo: 'ACOMPANHAMENTO TÉCNICO DA OBRA',
    intro: 'O Acompanhamento Técnico garante que a obra seja executada conforme os projetos e as boas práticas de engenharia, antecipando problemas antes que se tornem patologias ou retrabalho.',
    vantagens: [
      ['Qualidade da Execução', 'Conferência das etapas críticas, como formas e armaduras antes da concretagem, evitando erros difíceis de corrigir depois.'],
      ['Economia', 'Orientação à equipe da obra para evitar desperdício de material e retrabalho.'],
      ['Registro e Transparência', 'Relatório de cada visita com fotos, pendências e recomendações.']
    ],
    escopo: [
      ['Visitas Técnicas', [
        'Visitas periódicas à obra, em datas combinadas com o contratante e nas etapas críticas da execução.',
        'Verificação da conformidade da execução com os projetos e esclarecimento de dúvidas da equipe.'
      ]],
      ['Relatórios', [
        'Relatório de cada visita, com registro fotográfico, pendências encontradas e recomendações.'
      ]]
    ]
  }
];
