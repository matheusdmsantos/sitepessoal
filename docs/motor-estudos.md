# Motor de estudos — documento de passagem

Documento para a sessão que vai construir as telas do motor. Descreve o schema, as funções públicas, os eventos que a interface precisa disparar, os parâmetros e o que ficou pendente.

Estado: branch `feat/motor-estudos`, não publicada. Prévia em `feat-motor-estudos.matheusmirandaeng.pages.dev`, que usa o mesmo banco da produção. O motor **ainda não grava metas**: na prévia, o botão "Ver a semana do motor" mostra o que ele geraria.

## 1. Os quatro pilares

1. **O PDF é a espinha do planejamento.** Dentro de cada disciplina, as metas de leitura percorrem as páginas dos PDFs em ordem, sem saltar. O ciclo alterna as disciplinas.
2. **O subtópico é a unidade de registro e de estatística, não de agendamento.** Ele divide o PDF em faixas de páginas, recebe os acertos de cada bloco e guarda os vínculos com o edital.
3. **A revisão tem duas frentes.**
   - Questões inéditas: uma fila por PDF, com intervalo adaptativo.
   - Erros registrados: cada erro tem agenda própria (2, 7 e 21 dias).
4. **A fração de questões na semana cresce com a leitura.** Começa em 30% e chega a 100% quando a leitura termina.

## 2. Arquivos

| Arquivo | Conteúdo |
|---|---|
| `js/estudos.config.js` | Todos os parâmetros numéricos (`window.estConfig`) |
| `js/estudos.motor.migracao.js` | Migração do edital por PDF (`window.estMotorMigracao`) |
| `js/estudos.motor.leitura.js` | B. Metas de leitura (`window.estMotorLeitura`) |
| `js/estudos.motor.erros.js` | C. Agenda de erros (`window.estMotorErros`) |
| `js/estudos.motor.questoes.js` | D. Questões por PDF e modelo de memória (`window.estMotorQuestoes`) |
| `js/estudos.motor.semana.js` | E. Orçamento, rampa, geração da semana e projeção (`window.estMotorSemana`) |
| `js/estudos.plano.js` | A ligação com a interface atual: carrega `motor_pdfs` e `motor_blocos` e expõe `migrarMotor`, `verSemanaDoMotor` e `converterAgendaErros` |
| `supabase/motor.sql` | Schema (só aditivo) |
| `ferramentas/testes/motor.html` + `motor-etapas.js` | 72 testes, rodam no navegador pelo servidor local |

Os módulos do motor são funções puras: não leem o banco nem a tela. Eles carregam no `estudos.html` antes do `estudos.plano.js`, na ordem: config, migracao, leitura, erros, questoes, semana.

Para rodar os testes, abra `http://127.0.0.1:8765/ferramentas/testes/motor.html` com o servidor local ligado. A pasta `ferramentas/` dá 404 no site publicado.

## 3. Schema final

Tudo vem do `supabase/motor.sql`, que só acrescenta tabelas e colunas. As duas tabelas novas têm `dono uuid default auth.uid()` e a política `cada_um_o_seu`.

### Hierarquia

- **Disciplina** é a tabela `disciplinas` (sem mudança).
- **PDF** é a linha de `materiais` (nome, páginas) junto com a linha de `motor_pdfs` de mesmo `id`.
- **Subtópico** é a tabela `subtopicos`, com as colunas novas. No edital por PDF, cada PDF tem um "item" (linha de `topicos`) por baixo, onde ficam o resumo, as sessões e os totais. O motor não usa o item, só a interface atual.

### `motor_pdfs` (nova; uma linha por PDF, `id` = id em `materiais`)

Os dados do PDF ficam aqui, e não em `materiais`, porque a interface atual regrava as linhas de `materiais` ao salvar a lista de PDFs de uma disciplina.

| Coluna | Tipo | Uso |
|---|---|---|
| `id` | text | id do PDF em `materiais` |
| `edital_id`, `disciplina_id` | text | |
| `ordem` | integer | Ordem de leitura dentro da disciplina (B1) |
| `tec_link` | text | Caderno do TEC do PDF; o subtópico sem caderno herda este (A3) |
| `peso` | numeric | Peso opcional (prioridade na revisão, E4) |
| `itens_edital` | jsonb | Ids de itens do edital, só para PDF sem subtópicos (A2) |
| `concluido_em` | date | Leitura concluída; a fila de revisão começa aqui (D7) |
| `meia_vida` | double | Dias; vazio até o 1º bloco |
| `ultimo_contato` | date | Último bloco que contou |
| `proxima_data` | date | Próximo bloco de revisão (vale com o PDF concluído) |
| `blocos` | integer | Blocos que contaram (sem fixação) |
| `graduado` | boolean | Saiu da fila própria e está na manutenção da disciplina (D8) |

### `motor_blocos` (nova; histórico, uma linha por PDF de cada bloco)

| Coluna | Uso |
|---|---|
| `material_id`, `meta_id`, `data` | PDF, meta que gerou o bloco e data |
| `tipo_bloco` | `primeiro`, `revisao`, `manutencao` ou `fixacao` |
| `tipo_questao` | `ce` (certo/errado) ou `me` (múltipla escolha de 5) |
| `itens` | jsonb `[{ subtopico_id, total, acertos }]`; `subtopico_id` null quando é o PDF inteiro |
| `total`, `acertos` | Somas |
| `dias` | Desde o último contato com o PDF |
| `previsto` | Acerto previsto antes do bloco (0 a 1) |
| `mv_antes`, `mv_depois`, `intervalo` | Meia-vida antes e depois, e o intervalo calculado |

### Colunas novas em tabelas existentes

- **`subtopicos`:** `material_id` (PDF dono), `pag_ini`, `pag_fim`, `peso` (incidência, opcional), `nao_cai` (boolean), `itens_edital` (jsonb, lista de ids de itens do edital) e `estudado_em` (date, B4).
  - A interface atual ainda grava as páginas no campo antigo `pdfs: [{material_id, de, ate}]`; a migração re-sincroniza.
  - Na publicação, a interface deve passar a gravar nas colunas novas.
- **`erros`:** `material_id`, `confianca` (`certeza`, `duvida` ou `chute`) e `recorrencias`. Os outros campos de A4 já existiam:
  - passo da agenda = `etapa` (é também o número de acertos seguidos, porque um erro volta ao começo);
  - próxima revisão = `proxima`;
  - estado = `dominado_em` (vazio = aberto);
  - causa = `motivo`; `subtopico_id` já existia.
- **`metas`:** `material_id`, `pag_ini`, `pag_fim`, `tipo_bloco`, `alvos` (jsonb) e `subtopico_id`.
- **`plano_estudos`:** `data_prova`.

### Tabelas sem uso

`memoria` e `blocos`, do `memoria.sql` (modelo por assunto, nunca publicado), existem no banco, vazias. Podem ser apagadas depois da publicação.

## 4. Funções públicas do motor

Datas são texto `AAAA-MM-DD`. Todas as funções são puras.

### `estMotorLeitura` (B)

**PDF de leitura** é `{ id, nome, ordem, paginas, lidas, subtopicos: [{ id, pag_ini, pag_fim, nao_cai }] }`, em que `lidas` é a última página lida.

| Função | Faz | Quando chamar |
|---|---|---|
| `proximaMeta(pdfs, alvoMin)` | Devolve a próxima meta de leitura da disciplina: `{ material_id, pag_ini, pag_fim, paginas, minutos, concluidos, fimDoPdf }` ou `null` | Usada por `gerarSemana`; também para "adiantar" uma meta |
| `concluidos(pdf, de, ate)` | Ids dos subtópicos cuja última página está em (de, ate] | Ao concluir uma meta de leitura (B4) |
| `paginasALer(pdf)` | Faixas de páginas a ler, sem as de subtópicos "não cai" | Telas de progresso |
| `restantes(pdf)` | Páginas que ainda faltam | Telas de progresso |
| `totalALer(pdf)` | Total de páginas a ler | Telas de progresso |
| `faltam(pdf)` | Quantas páginas faltam | Telas de progresso |
| `minutosDe(paginas)` | Converte páginas em minutos pelo ritmo de leitura | Estimativas |

Como `proximaMeta` decide o corte:
- percorre o primeiro PDF que ainda tem páginas, na ordem;
- pula as páginas de subtópicos "não cai";
- encerra no fim de um subtópico quando ele fica a até 20% do tempo-alvo (B3);
- nunca passa de `maxMin`.

### `estMotorErros` (C)

| Função | Faz |
|---|---|
| `agendar(erro, hoje)` | Erro recém-registrado: devolve `{ etapa: 0, proxima: hoje+2, recorrencias, dominado_em: null }`, ou `null` se o motivo for "Gabarito discutível" (C2) |
| `responder(item, acertou, hoje)` | Devolve os campos novos e `releitura` (true quando um erro de "Não sabia o conteúdo" se repete, C4) |
| `vencidos(erros, dia)` | Itens da agenda com `proxima ≤ dia` |
| `naAgenda(e)` | O erro está na fila? |
| `nasEstatisticas(e)` | O erro entra nas estatísticas? (falso para "Gabarito discutível") |
| `meta(itens, dia)` | Uma meta só com os vencidos do dia, 75 s por item (C3) |
| `minutos(n)` | Minutos de uma meta com `n` itens |
| `converter(erros)` | Conversão 1/7/30/90 → 2/7/21: devolve só os que mudam, `[{ id, de, para }]` |

Como `responder` atualiza o item:
- **Acerto:** avança um passo (`proxima` = hoje + 7, depois + 21). O 3º acerto seguido marca `dominado_em`.
- **Erro:** volta a `etapa 0` (`proxima` = hoje + 2) e soma 1 em `recorrencias`.

### `estMotorQuestoes` (D)

**Estado do PDF** = a linha de `motor_pdfs`.

| Função | Faz | Quando chamar |
|---|---|---|
| `registrarBloco(estado, bloco, hoje, dataProva)` | Devolve `{ estado, registro }`; `registro` é a linha de `motor_blocos` (sem os ids) | Ao concluir um bloco de questões |
| `concluirPdf(estado, hoje, dataProva)` | Marca `concluido_em` e calcula `proxima_data` pela meia-vida que os blocos de 1º contato ajustaram | Quando a meta com a última página do PDF é concluída |
| `escolherSubtopicos(subtopicos, stats, dia, max)` | Até 3 subtópicos já estudados antes de `dia` (D3) | Ao gerar um bloco de revisão |
| `dividir(total, ids)` | Divide as questões entre os alvos | Ao montar um bloco |
| `emRevisao(estado, dia)` / `emManutencao(estado, dia)` | O PDF está vencido na fila própria / na manutenção? | Geração da semana |
| `retencaoEm(estado, dia)` / `prioridade(estado, dia)` | Retenção prevista; prioridade = retenção ÷ peso (E4) | Ordenar revisões |
| `calcular(...)`, `corrigir`, `acertoPrevisto`, `retencao`, `intervaloDe`, `meiaVidaInicial` | Contas de D4 a D7 | Para mostrar o previsto no card |

Detalhes de `registrarBloco`:
- **`bloco`** = `{ tipo_bloco, tipo_questao, itens: [{ subtopico_id, total, acertos }], estudadosHoje: [ids], diasDesdeEstudo }`.
- **Fixação:** subtópicos estudados hoje são ignorados. Se não sobra nada, o registro vira `tipo_bloco: 'fixacao'` e o estado não muda (D1).
- **PDF em leitura:** atualiza a meia-vida, sem `proxima_data` (D7).
- **PDF concluído:** grava `proxima_data`. Gradua quando o intervalo passa de 45 dias. Na manutenção, um lapso volta o PDF para a fila própria (D8).

Ordem de `escolherSubtopicos`: menor acerto acumulado primeiro (sem questões = primeiro), depois o mais tempo sem ver. Nunca entra o estudado no dia nem o "não cai". `stats = { idDoSubtopico: { total, acertos, ultimo } }`.

### `estMotorSemana` (E)

| Função | Faz |
|---|---|
| `gerarSemana(entrada)` | Gera a semana (ver abaixo) |
| `fracao(lidas, total, atraso)` | E1 e E3: `0,30 + 0,40 × lidas/total`, mais `0,10` por semana de atraso, até `0,85`; `1` quando a leitura acabou |
| `pisoLeitura(faltam, hoje, dataProva)` | E2: páginas por semana até a reta final (4 semanas antes da prova) |
| `atrasado(minutosVencidos, orcamentoQuestoes)` | E3: as revisões vencidas passaram de uma semana de orçamento? |
| `ordenarDia(metas)` | E6: questões primeiro; leitura depois, sem repetir a disciplina da meta anterior quando há outra |
| `encaixar(metasDaSemana, dias, desde, minutos)` | E5: dia com folga a partir de `desde`, ou `null` (semana seguinte) |
| `projetar({ faltam, total, minutosSemana, dataProva, hoje, semanas })` | E7: `{ semanas: [{ inicio, fracao, minutosQuestoes, minutosLeitura, paginas }], terminoLeitura }` |

**Entrada de `gerarSemana`.** Montada pelo `entradaDoMotor` do `estudos.plano.js`, a partir dos dados reais:

```
{
  dias: [{ dia, minutos }],                         // dias de estudo a partir de hoje
  dataProva,                                        // plano_estudos.data_prova
  disciplinas: [{ id, peso, pdfs: [PDF de leitura] }],
  modelos: [linhas de motor_pdfs],
  subtopicos: { idDoPdf: [{ id, estudado_em, nao_cai }] },
  stats: { idDoSubtopico: { total, acertos, ultimo } },
  erros: [linhas de erros],
  primeiros: [{ material_id, disciplina_id, subtopicos: [ids], depoisDe }],   // 1º contato pendente
  atraso: n                                         // semanas seguidas com atraso
}
```

**Saída de `gerarSemana`:**

```
{
  metas, adiados, avisos, fracao,
  orcamento: { total, questoes, leitura },
  usado, minutosVencidos, atrasoProxima, primeirosPendentes
}
```

Formatos de cada meta:
- `{ dia, tipo: 'leitura', disciplina_id, material_id, pag_ini, pag_fim, paginas, minutos, concluidos, fimDoPdf }`
- `{ dia, tipo: 'erros', itens: [ids], minutos }`
- `{ dia, tipo: 'questoes', tipo_bloco, disciplina_id, material_id, minutos, alvos }`
  - `alvos` = `[{ subtopico_id, questoes }]`; `subtopico_id` null quando é o PDF inteiro.
  - Na manutenção, `alvos` = `[{ material_id, questoes }]`.

**Regras aplicadas na geração:**

1. **Orçamento:** a fração de questões vem de E1 e E3; a leitura nunca fica abaixo do piso (E2). Se o piso não cabe na semana, sai um aviso.
2. **Prioridade das questões (E4):**
   1. revisão de erros vencidos;
   2. 1º contato, no dia de estudo seguinte ao estudo e nunca no mesmo dia (D1, D2);
   3. revisões de PDF, pela menor retenção × maior peso; o PDF que ainda espera o 1º contato não entra;
   4. manutenção: até 3 PDFs graduados da mesma disciplina.

   O que não cabe vai para `adiados` e nunca é antecipado.
3. **Leitura:** ocupa o resto de cada dia, dentro do orçamento, alternando as disciplinas pelo tempo dado ÷ peso.
   - Os subtópicos que terminam numa meta geram o 1º contato a partir do dia seguinte.
   - PDF sem subtópicos funciona como subtópico único (A3).

## 5. Eventos que a interface precisa disparar

> **Estado (interface, etapa 3):** os cinco eventos estão ligados no `js/estudos.plano.js` para o edital por PDF: `gerarSemanaMotor`, `concluirLeituraMotor`, `concluirBlocoMotor`, o formulário de erro do `js/estudos.erros.js` e `revisarErrosDaMeta`/`criarReleitura`.
>
> **Colunas a mais** (`supabase/motor-interface.sql`):
> - `erros.revisoes_log` (`[{ data, acertou, passo }]`) e `erros.bloco_id`;
> - `motor_blocos.certeza` e `motor_blocos.chute` (opcionais, no nível do bloco; dúvida = total − certeza − chute);
> - `motor_pdfs.lidas`;
> - `plano_estudos.motor` (`{ atraso, ...parâmetros }`).

Hoje nenhum destes eventos é disparado: a interface atual continua com o agendamento antigo. A publicação troca o agendamento por estes.

### 5.1 Gerar semana

- **Quando:** segunda-feira (ou ao abrir o painel numa semana sem metas) e no botão "Regerar".
- **Passos:**
  1. Monte a entrada (`entradaDoMotor`).
  2. Chame `gerarSemana`.
  3. Grave as metas em `metas`, com `material_id`, `pag_ini`, `pag_fim`, `tipo_bloco` e `alvos`; `semana` é a segunda-feira.
  4. Guarde `atrasoProxima` (por exemplo, em `plano_estudos`) para a entrada da semana seguinte.
  5. Mostre os `avisos`.
- **Regerar:** apague só as metas não concluídas da semana.

### 5.2 Concluir meta de leitura

- **Entrada:** a meta (`material_id`, `pag_ini`, `pag_fim`) e a página em que parou (padrão `pag_fim`).
- **Passos:**
  1. Atualize as páginas lidas do PDF.
  2. `concluidos(pdf, lidasAntes, paginaFinal)`: grave `subtopicos.estudado_em = hoje` em cada um (B4).
  3. Se a página final é a última página a ler do PDF: `concluirPdf(...)` e grave `motor_pdfs`.
  4. O bloco de 1º contato nasce sozinho na próxima geração, ou insira já com `encaixar(..., desde = amanhã, 45)`.

### 5.3 Registrar bloco de questões

- **Entrada:** a meta, o tipo de questão (padrão certo/errado) e, para cada alvo, o total e os acertos.
- **Passos:**
  1. Para cada PDF do bloco (na manutenção, um por alvo), chame `registrarBloco(estado, bloco, hoje, dataProva)`, com `estudadosHoje` = os subtópicos com `estudado_em = hoje`.
  2. Grave o `estado` em `motor_pdfs` e o `registro` em `motor_blocos`.
  3. Se a nova `proxima_data` cai na semana gerada: `encaixar` (E5).
  4. Mostre o intervalo novo e o motivo: `registro.previsto` × acerto real, `mv_antes` → `mv_depois` e `lapso`.
- Mantenha a instrução de registrar erros e dificuldades no Caderno de Erros.

### 5.4 Registrar erro

- **Entrada:** os campos atuais, mais o PDF, o subtópico e a confiança.
- **Passos:** `agendar(erro, hoje)`; grave `etapa`, `proxima`, `recorrencias` e `dominado_em`. Com motivo "Gabarito discutível" o retorno é `null`: grave sem agenda.

### 5.5 Responder revisão de erro

- **Entrada:** o item e se acertou.
- **Passos:**
  1. `responder(item, acertou, hoje)`; grave os campos.
  2. Se `releitura`: crie uma meta curta de leitura das páginas do subtópico (`minReleitura` = 20 min), com `encaixar(..., desde = hoje)`.
- **Meta do dia:** a revisão de erros é uma meta só com os vencidos (`meta(vencidos(erros, hoje), hoje)`).

## 6. Parâmetros (`js/estudos.config.js`)

| Grupo | Parâmetro | Padrão |
|---|---|---|
| leitura | `paginasPorHora` | 20 |
| | `alvoMin` / `maxMin` / `minMin` | 60 / 70 / 15 min |
| | `folgaCorte` | 0,20 (B3) |
| erros | `passos` | [2, 7, 21] dias |
| | `segundosPorItem` | 75 |
| | `minReleitura` | 20 min |
| | `motivoFora` / `motivoConteudo` | `gabarito` / `conteudo` |
| questoes | `porBloco` / `minPorQuestao` | 15 questões / 3 min |
| | `maxSubtopicos` / `maxPdfsManutencao` | 3 / 3 |
| | `retencaoAlvo` / `retencaoLapso` | 0,60 / 0,25 |
| | `ganho` | 2,2 |
| | `crescimentoMax` / `reducaoMax` | 3,0 / 0,5 |
| | `tetoProva` | 0,20 |
| | `limiteGraduacao` | 45 dias |
| | `pesoBloco` | 10 (peso do bloco = n ÷ (n + 10)) |
| | `chute` | ce 0,5 / me 0,2 |
| semana | `fracaoBase` / `fracaoRampa` | 0,30 / 0,40 |
| | `fracaoAtraso` / `fracaoMaxLeitura` | 0,10 / 0,85 |
| | `retaFinalSemanas` | 4 |
| | `semanasProjecao` | 8 |

A meia-vida inicial não é parâmetro: vem de `1 / log2(1 / retencaoAlvo)` (≈ 1,36 dia).

## 7. Decisões de interpretação

- **Bloco de 1º contato (D2 e D7):** atualiza a meia-vida do PDF, mas a fila de revisão só começa na conclusão do PDF (`concluirPdf`). O 1º bloco de revisão vem depois do 1º contato, nunca no mesmo dia.
- **Dias desde o último contato (D):** contam a partir do último bloco do PDF. No 1º bloco, contam os dias desde o estudo (`diasDesdeEstudo`).
- **Fração (E1):** é sobre os minutos da semana e cobre revisão de erros, blocos e manutenção. O resto é leitura.
- **Dia cheio:** o bloco entra se cabe na fatia de questões do dia. Também entra se o dia ainda não tem questões e o orçamento da semana tem espaço; assim, dias curtos não ficam sem revisão.
- **Atraso (E3):** é um contador de semanas. Com uma semana só (+0,10), a fração não passa de 0,80; o teto de 0,85 vale quando o atraso se repete.
- **Entre a meta e o lapso:** o ganho ainda vale (D7d), então um acerto abaixo de 80% e acima de 62,5% em certo/errado ainda aumenta um pouco o intervalo. Ele só encolhe no lapso.

## 8. Publicação na main (checklist)

1. Rode a migração na prévia ("Ver o que muda") até não sobrar nada a gravar. Resolva os subtópicos sem páginas e os de vários PDFs.
2. Faça a interface gravar as páginas dos subtópicos em `pag_ini` e `pag_fim` (e não só em `pdfs`) e criar as linhas de `motor_pdfs` ao salvar a lista de PDFs.
3. Ligue os eventos da seção 5. Troque o agendamento atual (`planejarSemana`, metas de questões por assunto e revisões por etapa) pela geração do motor, com o resumo do que muda antes de reagendar (H2).
4. Erros: no console do painel, rode `estPlano.converterAgendaErros()`. Ele mostra quantos mudam e só grava com confirmação. Depois troque a agenda do `js/estudos.erros.js` (`INTERVALOS` 1/7/30/90) por `estMotorErros.responder`.
5. Opcional: apague as tabelas `memoria` e `blocos`.

## 9. Pendente de interface

- Ficha do subtópico: páginas (`pag_ini`/`pag_fim`), "não cai no edital", peso, caderno do TEC (herda do PDF) e itens do edital vinculados (vários).
- Lista de PDFs por disciplina: ordem (arrastar), caderno do TEC, peso e conclusão, gravando em `motor_pdfs`.
- Decidir o dono dos subtópicos com páginas em mais de um PDF (relatório da migração).
- Cards das metas novas:
  - leitura com a faixa de páginas e os subtópicos que terminam;
  - bloco de questões com o tipo do bloco, os alvos e os cadernos;
  - revisão de erros com a lista do dia;
  - releitura.
- Conclusão:
  - de leitura (página em que parou);
  - de bloco (tipo de questão, total e acertos por alvo, com a frase do novo intervalo);
  - de revisão de erro (acertou ou errou, item a item).
- Registro de erro com PDF, subtópico e confiança (Certeza / Dúvida / Chute).
- Estatísticas: meia-vida e próxima data por PDF, histórico de intervalos, acerto por subtópico (sem fixação e sem "Gabarito discutível"), calibração previsto × real.
- Avisos da semana: piso de leitura que não cabe, revisões adiadas, atraso.
- Tela da projeção de 8 semanas e da data de término da leitura (`projetar`).
- Gravar `data_prova` pela configuração do plano.
