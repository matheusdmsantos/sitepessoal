# CLAUDE.md — Site Pessoal (Matheus Miranda)

Instruções e contexto para o Claude Code neste repositório. Leia este arquivo inteiro antes de mexer em qualquer coisa.

## Sobre o projeto

Site pessoal que funciona como **repositório de aplicações próprias**. Ele tem uma página pública (o portfólio de engenheiro civil) e uma área privada, protegida por login, com um hub de apps.

- **Domínio:** https://matheusmirandaeng.com.br
- **Repositório:** github.com/matheusdmsantos/sitepessoal, branch `main`. ⚠️ Hoje está **público**; a ideia é passar para privado.
- **Deploy:** Netlify, projeto `shiny-moxie-5ef02b`, ligado ao GitHub. **Todo push na `main` publica em produção automaticamente** (em cerca de 30 s).
- **Mudança para o Cloudflare Pages** (branch `cloudflare`, novembro de 2026; os créditos de deploy do Netlify acabaram): publica a própria pasta, sem build. `_headers` faz o papel dos headers do `netlify.toml`; as funções ficam em `functions/` (`api/ia-resumo.js`, `api/usuarios.js`, `agenda/[[caminho]].js`) e só repassam para `tratar(req, env)` dos módulos de `netlify/functions/`, que servem às duas hospedagens (no Netlify, `/api/*` é redirecionado para `/.netlify/functions/*`). As chaves vêm de `context.env` (painel do Pages: Settings > Variables and Secrets). `functions/_middleware.js` dá 404 em `supabase/`, `netlify/`, `functions/`, `ferramentas/`, `CLAUDE.md` etc.; `_routes.json` limita as funções a esses caminhos e a `/api/*` e `/agenda/*` (o resto é estático e não gasta a cota de 100 mil chamadas/dia do plano gratuito).
- **Login e banco:** Supabase, projeto `https://smbvlquqqhtgmvgddjlq.supabase.co`.
- **Editor:** VS Code com a extensão Claude Code, em Windows.
- **Idioma:** a interface, os comentários, as mensagens de commit e as respostas ao usuário são em **português (pt-BR)**.

## Stack e restrições

- HTML, CSS e JavaScript puros. **Sem framework, sem bundler e sem etapa de build.** Não introduza nenhum desses sem pedir.
- Bibliotecas por CDN, sempre com **versão fixa**:
  - supabase-js `@2.45.4` (jsdelivr)
  - Quill 1.3.6
  - html2pdf 0.10.1, carregado sob demanda
  - html2canvas 1.4.1 (só no app de louvor)
  - html-docx-js 0.3.1 (jsdelivr), carregado sob demanda na exportação de resumos para Word
  - pdf.js 3.11.174 (cdnjs), carregado sob demanda na importação de edital; o worker roda na própria página
  - SheetJS (xlsx) 0.18.5 (cdnjs), carregado sob demanda na importação de incidência do TEC
- Fontes do Google carregadas por `<link>` no `<head>`, **nunca** por `@import` no CSS.
- O `netlify.toml` define `publish = "."`, os headers de segurança e o cache de `/assets/*` por 30 dias. Por causa desse cache, ao trocar uma imagem é preciso **trocar o nome do arquivo**.

## Estrutura

```
index.html            login (Supabase Auth, e-mail + senha)
apps.html             hub de aplicações (lê apps.json; rota por #id-do-app)
apps.json             cadastro dos apps exibidos no hub
portfolio.html        página pública
estudos.html          Painel de Estudos (usa js/estudos.v5.js)
leitor.html           leitor de PDF (pdf.js 3.11.174) aberto pelo "Ler agora"; pega o arquivo da aba do painel por window.opener
netlify.toml          publicação, headers e cache
README.md             como adicionar apps
css/                  login.css, apps.css, estudos.css, style.css (portfólio)
js/
  supabase-client.js  cria window.supabaseClient (chave anon: pública por design)
  auth.js             autenticação, API global (ver abaixo)
  apps.js             lógica do hub
  main.js             portfólio
  estudos.v5.js       Painel de Estudos (~97 KB)
  estudos.plano.js    Metas da semana, revisões condicionais e desempenho (carregado depois do v5)
  estudos.importar.js Importa edital de PDF (pdf.js 3.11.174 sob demanda) ou texto, com tela de revisão
  estudos.incidencia.js Importa a planilha de incidência do TEC e liga assuntos a tópicos
  estudos.materiais.js PDFs de estudo por disciplina: páginas e ligação aos tópicos
  estudos.sessao.js   Janela de estudo/resumo: cronômetro (livre/Pomodoro, só pelo plano) e resumo em páginas
  estudos.resumos.js  Meus Resumos: resumo geral da matéria montado dos resumos dos assuntos; exporta Word/PDF
  estudos.edital.js   Edital Verticalizado: painel, filtros, selos por tópico, ficha lateral, exporta PDF/Excel
  estudos.erros.js    Caderno de Erros: questões erradas do TEC, revisão por cartão (1/7/30/90 dias)
  estudos.aproveitar.js Aproveitar estudos de outro edital: liga tópicos novos aos antigos e copia o progresso
  estudos.tec.js      Cria o caderno do TEC de um tópico pelo userscript "TEC – Criar cadernos em fila" (Tampermonkey, fora do repo): abre o TEC com #tecauto=[caderno] e recebe o link por postMessage (origem conferida) em topicos.tec_link ; ao salvar a incidência, guarda os assuntos exatos do TEC (com a matéria, sem subassunto de pai já incluído) por tópico em localStorage `est_tec_assuntos_<tópico>` e a lista inteira da disciplina em `est_tec_arvore_<disciplina>`; o botão "📝 Gerar caderno" (meta de questões e janela de estudo) abre uma lista com caixas de marcar (subassunto de pai marcado fica travado)
  estudos.usuario.js  Separa por usuário as chaves est_*/disc_order_* do localStorage (roda antes do v5)
ferramentas/estudopdf/  instalador (rodar no Windows, fora do site; /ferramentas/* dá 404) do link `estudopdf:` que abre o PDF da meta no Foxit, na página; ver "Ler agora"
editais/              PDFs de teste; fora do git (.gitignore) para não serem publicados
assets/               imagens (inclui a logo do papel timbrado da proposta: logo-mm*.webp)
apps/
  _modelo/            template de app novo, já com login
  louvor/             Escala de Louvor (dados só em localStorage, sem login)
  controle-obras/     Controle de Obras: processos estilo SEI (index.html, app.js, app.css)
  usuarios/           Usuários (só o dono): cria contas, escolhe os apps de cada uma, troca senha e exclui, via a função abaixo
netlify/functions/usuarios.mjs  Netlify Function com a chave service_role (variável de ambiente)
netlify/functions/agenda.mjs    agenda iCal da Gestão de Contratos em /agenda/<token>.ics (Google Agenda)
netlify/functions/ia-resumo.mjs "✨ IA" do editor de resumo: chama a API do Claude com a chave ANTHROPIC_API_KEY (variável de ambiente; só o dono)
supabase/rls.sql      Row Level Security: por usuário nas tabelas com coluna dono; só o dono nas demais
supabase/multiusuario.sql  coluna dono nas tabelas do Painel de Estudos e papel 'dono' no app_metadata
supabase/estudos-plano.sql  tabelas do Painel de Estudos (sessoes, metas, revisoes, plano_estudos…)
supabase/erros.sql    tabela do Caderno de Erros, já com dono e RLS
supabase/obras.sql    tabelas do Controle de Obras e o bucket "obras-docs"
supabase/acompanhamento.sql  tabelas do Acompanhamento de Obra (obras, obra_*), já com dono e RLS
supabase/agenda.sql   tabela agenda_links (link secreto da agenda iCal), já com dono e RLS
supabase/financeiro.sql  tabela recebimentos (financeiro), já com dono e RLS; copia as mensalidades de obra_honorarios
```

`/supabase/*`, `/netlify/*` e `/README.md` retornam 404 no site, por regra no `netlify.toml`.

## Autenticação: `js/auth.js`

Nenhuma senha fica no código: o login é feito pelo Supabase Auth. O arquivo expõe funções globais com a **mesma API da versão antiga**, para não quebrar o `estudos.html`:

| Função | Tipo | O que faz |
|---|---|---|
| `isAuthenticated()` | síncrona | Lê `localStorage['sb-<ref>-auth-token']` e verifica se há `refresh_token` |
| `requireAuth()` | síncrona | Sem sessão, redireciona para `/index.html?next=<caminho>` |
| `login(email, senha)` | async | Devolve `{ ok }` ou `{ ok: false, message }` |
| `logout()` | async | Faz `signOut` e volta para o login |
| `getSessionUser()` | síncrona | Devolve o e-mail do usuário logado |
| `isOwner(user?)` | síncrona | `true` se `app_metadata.papel = 'dono'` (do `user` dado ou da sessão guardada) |
| `userApps(user?)` | síncrona | ids dos apps liberados; `null` para o dono (todos) |
| `canUseApp(id, user?)` | síncrona | O usuário pode abrir o app `id`? |
| `getPostLoginUrl()` | síncrona | Usa `?next=` se for um caminho interno; senão, `/apps.html` |
| `authReady` | Promise | Confirma o usuário no servidor; redireciona se a sessão for inválida |

**Toda página privada** precisa destes 4 scripts, nesta ordem:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4"></script>
<script src="/js/supabase-client.js"></script>
<script src="/js/auth.js"></script>
<script>if (!requireAuth()) throw new Error('Não autenticado');</script>
```

A página usa `<body class="auth-pending">` (com `visibility: hidden`) e remove a classe depois que `authReady` resolve com um usuário.

## Como adicionar um app

1. Copie `apps/_modelo/` para `apps/<id>/` e construa o app ali.
2. Registre o app em `apps.json`:
   ```json
   {
     "id": "meu-app",
     "nome": "Meu App",
     "descricao": "O que ele faz, em uma frase.",
     "icone": "🧮",
     "cor": "rgba(100, 160, 220, 0.15)",
     "categoria": "engenharia",
     "url": "apps/meu-app/index.html",
     "abrirEm": "visualizador"
   }
   ```
   - `categoria`: `engenharia`, `produtividade`, `gestao` ou `utilitarios`.
   - `abrirEm`: `"visualizador"` abre em iframe dentro do hub; `"pagina"` abre em tela cheia.
   - `url: null` mostra o card como "Em breve".
3. Se o app guarda dados no Supabase, crie a tabela e **rode `supabase/rls.sql` de novo** para proteger a tabela nova.

## Supabase

- Tabelas: `editais`, `disciplinas` (com `ordem`, ver `estudos-plano.sql`), `topicos`, `resumos` e, criadas por `supabase/estudos-plano.sql`, `sessoes`, `metas`, `revisoes`, `plano_estudos`, `incidencias` e `materiais`; criada por `supabase/erros.sql`, `erros`; criadas por `supabase/obras.sql`, `processos`, `documentos`, `andamentos`, `prazos` e `modelos_mensagem` (as três do meio são filhas com `on delete cascade`). Os ids são texto.
- Storage: bucket privado `obras-docs` (25 MB por arquivo), com a política `obras_docs_dono` em `storage.objects` criada pelo próprio `obras.sql` (o `rls.sql` só cobre as tabelas de `public`). Arquivos abrem por link assinado de 10 min.
- `incidencias` e `materiais` são carregadas à parte: se faltarem, só os dados delas ficam no navegador e o resto do plano continua no Supabase.
- Sem as tabelas do plano, o `estudos.plano.js` guarda tudo no `localStorage` e mostra um aviso; quando elas aparecem, envia esses dados uma vez (flag `est_plano_migrado`).
- **Vários usuários** (`supabase/multiusuario.sql`): as tabelas do Painel de Estudos e do Controle de Obras têm a coluna `dono uuid default auth.uid()` (o front não envia; o banco preenche). Regras e índices de valor único passam a incluir o dono (ex.: `processos_numero_idx`). Arquivos do bucket `obras-docs`: a política `obras_docs_dono` libera o caminho cujo 1º segmento é um processo do usuário. O dono do site tem `app_metadata.papel = 'dono'` e vê todos os apps. Os outros veem só os de `app_metadata.apps` (ids do `apps.json`), escolhidos no app Usuários; sem essa lista (contas antigas), só `estudos`. `canUseApp(id, user)`/`userApps(user)` no `auth.js` fazem a conta; o hub filtra por eles e cada app manda quem não tem acesso de volta ao hub. `"soDono": true` no `apps.json` tira o app da lista de escolha. A Escala de Louvor não tem login (dados no navegador), então liberar só mostra o card. Novos usuários são criados no app Usuários (cadastro público desligado). Tabela nova de um app precisa da coluna `dono` (inclua-a na lista do `multiusuario.sql`) antes de rodar o `rls.sql`.
- O `rls.sql` liga o RLS em todas as tabelas de `public` e **apaga todas as políticas existentes**. Nas tabelas com coluna `dono`, cria `cada_um_o_seu` (`dono = auth.uid()`); nas demais, `dono_acesso_total`, que só libera para `auth.jwt()->>'email' = 'ecivilmatheus@gmail.com'`.
- A chave `anon` pode ficar no front-end. A chave `service_role` **nunca** pode aparecer no código: ela fica só na variável de ambiente `SUPABASE_SERVICE_ROLE_KEY` do Netlify, usada pela `netlify/functions/usuarios.mjs` (sem dependências; chama a API admin do Auth com `fetch`). A função confirma o token de quem chama em `/auth/v1/user` e só atende `app_metadata.papel = 'dono'`; não exclui a conta do dono. Não roda no `python -m http.server`: teste na prévia da branch do Netlify.

## Fluxo de trabalho

1. Edite localmente.
2. Teste com um servidor local, porque abrir o arquivo direto não funciona: use o Live Server ou `npx serve .`. ⚠️ Mesmo local, o login e os dados são os **reais** do Supabase.
3. Faça commits pequenos e frequentes, com mensagens em português (ex.: `perf: otimiza imagem do portfólio`, `feat: app conversor de unidades`).
4. **Só faça push para a `main` quando o usuário confirmar**, porque push publica em produção. Para mudanças grandes, prefira uma branch: o Netlify gera um endereço de prévia para ela.

## Regras para o Claude Code

- **Nunca** faça `git push` para a `main` sem confirmação explícita do usuário.
- **Nunca** coloque senha, token ou chave secreta no código, nem em mensagem de commit.
- Não reintroduza `@import` de fontes, bibliotecas sem versão fixa ou bibliotecas que não são usadas.
- Antes de editar `estudos.v5.js` (arquivo grande e sensível), explique o plano e confirme com o usuário.
- Mantenha a API pública de `auth.js` compatível. O `estudos.html` depende dela.
- Ao terminar uma tarefa, resuma em português o que mudou e o que o usuário precisa testar.

## Estado atual

**Feito:**
- **v2 no ar.** Login via Supabase (a senha em texto puro do `auth.js` antigo foi removida), hub lendo `apps.json`, template de app, `netlify.toml` com headers, deploy automático pelo GitHub.
- Código morto removido: `estudos.js` e `estudos.v4.js`. Ficaram fora do repositório `app.py`, `build.js`, `scratch/` e `.dist/`.

**Pendente com o usuário. Pergunte o status antes de assumir:**
- [x] Usuário criado em Supabase → Authentication → Users (login funcionando). Conferir se o cadastro público está desativado.
- [x] `supabase/estudos-plano.sql` e `supabase/rls.sql` executados no SQL Editor (23/10/2026): 10 tabelas com RLS e `dono_acesso_total`.
- [x] Variável `ANTHROPIC_API_KEY` criada no Netlify (secreta, valor de produção; 08/11/2026) e publicada no deploy seguinte: a função respondeu 401 sem login, ou seja, achou a chave. Se a chave vencer ou for trocada, é preciso um novo deploy.
- [ ] Senha antiga trocada nos outros serviços onde era usada (ela ficou exposta no site antigo).
- [ ] Repositório do GitHub passado para privado.
- [ ] `supabase/erros.sql` executado (Caderno de Erros).
- [x] `supabase/acompanhamento.sql` executado (Acompanhamento de Obra): tabelas `obras` e `obra_etapas` conferidas em 08/11/2026.
- [x] `supabase/financeiro.sql` executado (Financeiro): tabela `recebimentos` conferida em 08/11/2026.
- [ ] `supabase/agenda.sql` executado (Google Agenda).
- [ ] Colunas `prazos.mensagem`, `prazos.para_nome` e `prazos.para_telefone` criadas (3 `alter table` no fim do `obras.sql`).
- [ ] Coluna `topicos.origem` criada (`alter table public.topicos add column if not exists origem text;`, no fim do `estudos-plano.sql`).
- [ ] Coluna `processos.mensal` criada (`alter table public.processos add column if not exists mensal boolean not null default false;`, também no fim do `obras.sql`).

**Plano semanal no Painel de Estudos (branch `feat/plano-semanal`, ainda não publicada).** Inspirado na Guruja:
- *Planejamento Semanal* (seção `metas`): um planejamento só, com tópicos novos e revisões juntos em cada dia. Horas/semana, dias de estudo, peso e nível por disciplina; rodízio ponderado (a disciplina da vez é a que recebeu menos tempo em relação a peso × (4 − nível)); tempo do tópico pelo nível: 120/90/60 min.
- Só a semana atual é gravada (`metas`). As seguintes são uma projeção recalculada a cada tela (`projetar()`), até cobrir o edital, já reservando as revisões que cada tópico vai gerar (com o acerto médio da disciplina).
- *Revisões adaptativas*: o intervalo é multiplicado por 2 (70–84%), 3 (85–94%) ou 4 (≥ 95%); abaixo de 70% entra reforço (40 min); acima de 120 dias o tópico está dominado e sai do plano. Duração 15 min (≥ 90%) ou 25 min. Revisões ocupam no máximo 50% do tempo do dia (`diaComFolga`). A antiga tela "Revisões e Reforços" foi removida.
- *Desempenho* (`renderDesempenho`, gráficos SVG/HTML próprios no `estudos.plano.js`): **Cobertura da prova** (`cobertura`: % do que costuma cair já estudado; dentro da disciplina cada tópico pesa pela incidência do TEC, sem planilha todos iguais; entre disciplinas, pelo "Peso na prova" do plano; PDF em leitura conta pela fração das páginas lidas), com barra segmentada, linhas por disciplina e "Maior ganho de cobertura" (5 tópicos não estudados que mais somariam); KPIs; Constância (mapa de calor de 26 semanas e sequências de dias); horas por semana × meta; acerto nas questões por semana (linha, 70% tracejado); Maturidade do edital (tópicos por etapa: não estudado → estudado → 1/2/3+ revisões → dominado); previsão; tabela por disciplina (com cobertura); pontos fracos. Cores: série única em `--est-blue`; rampa azul `RAMPA` (validada com a skill de dataviz no fundo `#222640`) para grandezas ordenadas; `SEM_DADO` = trilho. Balão único (`ligarBalao`) lê `data-v`/`data-l` das marcas; as explicações das linhas tracejadas ficam no subtítulo do cartão (rótulo na linha colidia com os dados).
- *⏩ Adiantar* (`adiantar`): quem terminou a semana antes traz para hoje as metas (estudo e questões) do próximo dia previsto; viram metas da semana atual e a projeção se refaz sem elas. Revisões não são adiantadas (dependem da data).
- Regras e constantes ficam no topo de `js/estudos.plano.js`. Botão "⟲ Reiniciar do zero" (`reiniciarPlanejamento`, com confirmação): apaga todas as metas e revisões do edital ativo e gera a semana de novo; configuração, PDFs, incidência e progresso dos tópicos ficam.
- *Questões depois do estudo*: quando a leitura do PDF do tópico chega à metade das páginas (lidas + planejadas; sem PDF, depois do estudo), entra uma única meta `tipo = 'questoes'` no mesmo dia ou no próximo com espaço: 20/15/10 questões pela incidência do TEC (≥ 10% da disciplina / meio / < 2%) ou, sem ela, pelo peso da disciplina; 3 min por questão (o número de questões é `minutos / 3`). Concluir registra questões e acertos, sem marcar o tópico como estudado. Só estudos a partir de `INICIO_QUESTOES` geram a meta. A janela de estudo mostra o PDF e as páginas da meta (`roteiroDeLeitura`).
- *Incidência do TEC*: na configuração do plano, cada disciplina tem "📊 Importar". A planilha "Índice do Caderno" do TEC tem as colunas Hierarquia (vazia), Índice, Quantidade e Porcentagem, e declara a dimensão errada (`A1:D1`), por isso o intervalo é recalculado. Cada assunto é ligado a um tópico por semelhança (radicais, peso pela raridade, números de lei valem 2×); as correções do usuário ficam lembradas em `localStorage` (`est_inc_mapa_<disciplina>`). No plano: tópicos ordenados por incidência e tempo de 0,5× a 1,5× do bloco do nível (`blocoDoTopico`). Testado com Direito Administrativo (Cebraspe): 104 de 110 assuntos ligados sozinhos.
- *Material em PDF*: na configuração do plano, "📚 PDFs" por disciplina (`js/estudos.materiais.js`). Vários PDFs de uma vez; o pdf.js conta as páginas e sugere os tópicos: pelo nome do arquivo (sem "curso", "aula", números e códigos) ou, se ele não diz nada (apostila do Estratégia: `curso-393065-aula-00-….pdf`), pelo índice/sumário das 4 primeiras páginas (linhas com pontilhado), ligando o PDF a cada tópico que os itens do índice citam (até 6); itens genéricos (questões comentadas, gabarito, nomes de bancas) são ignorados, e se menos de 1/3 dos itens bater com o edital o PDF fica sem tópico (é de outra matéria). Sem índice, vale o texto das primeiras páginas sem cabeçalho/rodapé. Reenviar um PDF que já está na lista oferece trocar as ligações pela nova sugestão. Sem PDF (livro, apostila impressa), o material pode ser digitado à mão: nome, páginas e tópico (sugerido pelo nome); o número de páginas fica editável na lista. Um PDF pode ir para vários tópicos, com faixa de páginas opcional; sem faixa, as páginas que sobram são divididas igualmente (`contarPaginas`). O arquivo não é enviado: a tabela `materiais` guarda só nome, páginas e `topicos` (jsonb `[{topico_id, de, ate}]`). Com incidência, a ordem dos tópicos é por questões por página (`prioridadeDosTopicos`; tópico sem PDF usa a mediana de páginas da disciplina). A caixa "Seguir a ordem dos PDFs" na tela de materiais troca isso pela ordem dos PDFs da lista e das páginas de cada um (tópicos sem PDF no fim); fica em `plano_estudos.disciplinas[id].ordemPdf` (`ordemPdfDe`; sem plano ainda, espera em memória até a configuração ser salva). Tópico com PDF leva o tempo de leitura (`PAGINAS_POR_HORA` = 20) e, se passar de 2h (`PARTE_MAX`), vira várias metas com `parte`/`partes` (colunas em `metas`), divididas por igual e em dias seguidos. Ao concluir uma meta de tópico com PDF, o usuário informa a página do PDF em que parou (convertida em `metas.paginas_lidas`; com "Terminei", `ajustarFaixas` muda o fim da faixa do tópico para essa página e o início do tópico seguinte do mesmo PDF para a próxima); o que falta é recalculado pelas páginas (`paginasLidas`/`faltaDoTopico`). Só **"✓ Terminei este PDF"** marca o tópico como estudado e agenda a primeira revisão; as partes que sobraram saem do plano, e sem essa marcação entra mais uma parte. Tópico sem PDF mantém o bloco do nível e da incidência.
- *Importar edital*: PDF ou texto → recorta o conteúdo programático até o primeiro ANEXO, separa "CARGO N", aplica "(EXCETO/SOMENTE PARA O CARGO …)", agrupa subitens no tópico principal (ou separa, por opção) e sugere a data de "Aplicação das provas". Testado com o edital do TCE-MA (Cebraspe): 16 cargos; cargo 13 com 15 disciplinas e 135 tópicos.

**Janela de estudo (branch `feat/janela-estudo`).** Clicar no texto de uma meta ou revisão do plano abre `js/estudos.sessao.js`:
- *Ler agora*: cada PDF da linha "Ler agora" é um botão. Na 1ª vez abre o seletor de arquivos (`showOpenFilePicker`) e guarda o atalho (FileSystemFileHandle) no IndexedDB `est-pdfs` pelo nome do material; depois abre direto no `leitor.html` (nova aba, pdf.js, já na página inicial da meta), que lê o arquivo por `window.opener.estSessao.pdfAberto()`. Abrir o blob direto não serve: com "Baixar PDFs" ligado no Chrome/Edge, ele baixa. "alterar PDF" escolhe outro. Sem a API (Firefox), escolhe a cada vez; se o navegador barrar a aba, o botão vira link. Botão "abre no navegador ⇄ abre no Foxit" (`localStorage['est_pdf_modo']`, por computador): no modo Foxit, o clique vai para `estudopdf:abrir?arquivo=<nome.pdf>&pagina=N` (nome do arquivo escolhido, ou do material + .pdf). O `ferramentas/estudopdf/instalar.cmd` registra o protocolo em HKCU (comando `conhost.exe --headless powershell.exe … abrir.ps1 "%1"`; sem VBS, que a política da máquina da empresa barra), guarda as pastas e o caminho do Foxit em `%LOCALAPPDATA%\EstudoPDF\config.json`; o `abrir.ps1` aceita só nome `.pdf` sem pasta/curinga, procura nas pastas (com subpastas) e roda o Foxit com `/A page=N` (sem Foxit, o leitor padrão).
- *Cronômetro* livre ou Pomodoro (ciclos `CICLOS` 25/5, 50/10 ou 90/20; padrão 50/10, escolha em `localStorage['est_pomodoro_ciclo']`; bipe na troca; só o foco conta). O estado fica em `localStorage['est_crono']` por id da meta/revisão, guardado como horários, então continua certo com a janela fechada. A lista mostra o selo "⏱ N min". O "Concluir" (da janela ou do item) preenche o tempo com o cronômetro, que é zerado ao salvar a conclusão.
- *Resumo em páginas*: é o mesmo resumo de "Meus Resumos" (tabela `resumos`, gravado por `salvarResumo` do v5). Cada página começa com `<h1 class="est-pagina">`; o que vem antes do primeiro título é a primeira página (resumos antigos ficam intactos). O blot `pagina` é registrado no Quill pelo próprio `estudos.sessao.js`. Salva sozinho 2 s depois da última edição e ao fechar.
- *Imagens*: ao colar, arrastar ou inserir, a foto é reduzida para no máximo 1600 px (JPEG 85%; PNG pequeno sem redução fica PNG). Clicar na imagem mostra alças nos cantos e os botões 25/50/75/100%; a largura vai no atributo `width` (o Image do Quill 1.3.6 preserva). Na exportação para Word, as imagens ganham `width`/`height` limitados a 640 px (`imagensParaWord`).
- *Colar de sites* (comentários do TEC): `limparHtmlColado` mantém negrito, itálico, sublinhado, tachado, realce em trechos (`<mark>` vira amarelo; realce escuro é clareado) e texto colorido legível; descarta fundo de cartão/página, texto cinza/branco, fontes e classes do site (as `ql-*` ficam). Ctrl+Shift+V cola sem formatação.
- *Fontes*: lista `FONTES` no topo do `estudos.sessao.js` (11 de texto, 9 manuscritas do Google Fonts, carregadas por um `<link>` no `estudos.html` e baixadas só quando usadas). O formato `font` é um `Attributor.Style` próprio: o valor é o id, o HTML guarda o `font-family` completo. `serif`/`monospace` (classe `ql-font-*`) continuam valendo. No PDF, as fontes usadas são carregadas antes da captura; no Word, só aparecem se estiverem instaladas no PC.
- *✨ IA* (só o dono; botão na barra do editor, `melhorarComIA`): o trecho selecionado (até `MAX_TRECHO_IA` = 6.000 caracteres) vai em HTML para `netlify/functions/ia-resumo.mjs` (token do Supabase conferido; só `papel = 'dono'`), que chama a Messages API por `fetch` (sem SDK, como as outras funções): `claude-haiku-5-5` (o mais barato, cerca de US$ 0,001 por clique; não aceita `fallbacks`), `output_config.effort: 'medium'`, `anthropic-version: 2026-10-21`, prazo de 50 s (a função tem 60 s). Trocar de modelo = a constante `MODELO` (Opus/Sonnet podem voltar a usar `fallbacks: 'default'` com o beta `server-side-fallback-2026-07-01`). Falta de crédito na API vira aviso próprio; os outros erros da API mostram o motivo dela. As instruções pedem o mesmo conteúdo, sem fatos novos, organizado com títulos, listas, negrito, `<mark>` (vira realce `#fff59d`), tabelas e emojis. Fotos não vão para a IA (viram `<img data-ref="N">` e voltam no lugar; nenhuma some). A resposta passa por `sanitizarHtml` e troca a seleção numa só etapa do histórico. Bug do Quill 1.3.6: com tabela (bloco, vale também para o vídeo nativo) e texto depois dela, a etapa gravada desfaz errado; por isso ela é trocada pela troca do documento inteiro (`history.stack.undo`). O editor fica travado durante a chamada. Não roda no servidor local (404).
- *Tabelas* (blot `tabela`, `BlockEmbed` com `tagName` TABLE, registrado no topo do `estudos.sessao.js`): o Quill 1.3.6 não tem tabela; ela vira um bloco fechado (`contenteditable=false`, não se edita célula a célula; selecionar e Delete apaga) com o HTML limpo por `limparTabela`. Vem da IA e de tabelas coladas de sites. CSS em `.ql-editor table.est-tabela` (editor e Meus Resumos) e em `ESTILO_EXPORT` (Word/PDF).
- *É o único editor de resumo*: `promptResumo`/`promptResumoByName` do v5 abrem a mesma janela, sem cronômetro (`estSessao.abrirResumo`). O modal antigo, o formulário "Salvar no Word" e tudo o que chamava o `app.py` (`localhost:5000`) foram removidos.

**Meus Resumos (`js/estudos.resumos.js`, mesma branch).** O resumo geral da matéria **não é gravado**: é montado na hora, na ordem do edital ativo, a partir dos resumos de cada assunto. Por isso, salvar um assunto já atualiza a matéria.
- Hierarquia pela numeração do nome do tópico (`1`, `1.1`, `1.1.1`, até 3 níveis): matéria = H1, assunto = H2–H4, página = um nível abaixo do assunto; títulos escritos dentro do resumo são rebaixados (`rebaixarTitulos`). Sem "Mostrar todos os assuntos", entram só os que têm resumo e os seus "pais".
- Resumo cujo nome não bate com o edital: vai para "Assuntos fora do edital" da matéria, ou para a matéria virtual "Outros resumos" se a disciplina também não existe. `resumosMap` agora guarda `disciplina_nome`/`topico_nome` para isso.
- Exporta a matéria em `.docx` (html-docx-js) ou PDF (html2pdf). No Chrome/Edge, grava na pasta escolhida (File System Access; o handle fica no IndexedDB `est-resumos`); nos outros, baixa em Downloads.

**Edital Verticalizado (`js/estudos.edital.js`, branch `feat/janela-estudo`).** O `renderEdital()` do v5 só chama `estEdital.render()`; as ações continuam no v5 (`toggleTopic`, `promptRefazer`, `promptRevisao`, `promptTempo`, `deleteTopic`, `addTopic`, `addDisc`, `reorderDisc`, `updateTopicName`, `updateDiscName`).
- *Painel*: progresso, questões e acerto (com "pontos fracos": < 70% com ao menos 5 questões), tempo, revisões (atrasadas/hoje/7 dias/dominados) e previsão de término (`estPlano.projetar`).
- *Busca e filtros*: não estudados, acerto < 70%, revisão atrasada, sem resumo, alta incidência (≥ 1,5× a média da disciplina). Disciplinas abertas ficam em `localStorage['est_edital_abertas_<edital>']`, então redesenhar não fecha nada.
- *Tópico*: recuo pela numeração; selos de incidência, páginas, resumo, revisão (`estPlano.revisoesDoTopico`) e tempo; acerto colorido. Clicar abre a *ficha lateral* (números, ações, TEC, resumo, revisões, PDFs, histórico de sessões, renomear/excluir). Renomear tópico ou disciplina leva junto o resumo (atualiza `disciplina_nome`/`topico_nome` em `resumos`).
- *Subtópicos*: a ficha de um tópico com subtópicos (numeração `1` → `1.1`, `1.2.1`…) tem "⊟ Agrupar neste tópico" (`agruparSubtopicos`: nome vira `1 Assunto: sub; sub`, como o importador grava; questões, tempo e TEC somados; subtópicos apagados; incidência, PDFs e metas abertas por `estPlano.juntarTopicos`). Um tópico agrupado tem "⊞ Separar" (`separarSubtopicos`: cria `1.1…` com id `<id do pai>_01…`, que ordena logo depois do pai; progresso, incidência e PDFs ficam no principal).
- *Ordem das disciplinas*: coluna `disciplinas.ordem` (adicionada no fim do `estudos-plano.sql`); sem ela, vale a ordem do navegador.
- *Exportar*: PDF (html2pdf) e Excel (SheetJS 0.18.5), na pasta escolhida em Meus Resumos (`estResumos.pastaDestino`/`gravarArquivo`).

**Caderno de Erros (`js/estudos.erros.js`, branch `feat/caderno-erros`).** Seção "Caderno de Erros" do painel (antes um espaço reservado):
- *Registro por questão* (só do TEC): link ou número da questão (`tec_id`/`link`; o número também é achado no texto colado), enunciado colado num editor simples (contenteditable; limpeza por `estSessao.limparHtmlColado` e depois `sanitizar`, que só deixa tags de texto, tabelas e imagens; imagem colada reduzida por `estSessao.reduzirImagem`), tipo Certo/Errado ou A–E (detectado no texto colado), gabarito, a resposta dada (no C/E pode ser "em branco"), motivo (`MOTIVOS`: conteúdo, esqueci, leitura, pegadinha, pressa, gabarito discutível), a regra certa em uma frase e um comentário opcional. Disciplina e tópico vêm do contexto ou do último registro (`est_erros_ultimo`). "Salvar e registrar outra" mantém disciplina e tópico.
- *Onde registrar*: botão na seção, bloco "Caderno de erros" na ficha lateral do tópico (`estErros.blocoFicha`, chamado pelo `estudos.edital.js`) e "❌ Registrar erro" na janela de estudo (usa `estSessao.contexto()`).
- *Revisão por cartão*: o enunciado aparece sem gabarito; acertou, avança a etapa (`INTERVALOS` = 1, 7, 30, 90 dias); errou, volta para amanhã (etapa 0). Acertar na última etapa marca `dominado_em` e tira a questão da fila. A primeira revisão é no dia seguinte ao registro. O menu mostra quantas estão para hoje.
- *Tela*: KPIs, "Por que você erra" (barras por motivo; clicar filtra), filtros por disciplina, tópico, motivo, situação e busca. Mostra os erros do edital ativo.
- Sem a tabela `erros`, tudo fica em `localStorage['est_erros']` (separado por usuário pelo `estudos.usuario.js`) e é enviado quando a tabela aparece. O `.page-estudos button` zera borda e fundo, por isso os botões do caderno usam seletores `.page-estudos .est-erro-*`.

**Aproveitar estudos de outro edital (`js/estudos.aproveitar.js`).** Abre sozinho depois de importar um edital (`estudos.importar.js`, se outro edital tem progresso) e pelo botão ♻ ao lado do seletor de editais. Liga cada disciplina e cada tópico do edital novo ao equivalente do antigo (nome igual sem a numeração, ou semelhança pelo `estIncidencia.montarComparador` com nota ≥ `NOTA_MIN` = 2); o usuário confere numa tela de revisão. Copia para o novo: estudado, link do TEC e resumo (`salvarResumo` com o nome novo) para todos os tópicos ligados ao mesmo antigo; questões, tempo e erros do caderno (`estErros.copiarPara`) só para o primeiro, para não contar em dobro; revisões (com etapa e datas), PDFs (assunto dividido em vários tópicos perde a faixa e divide as páginas) e peso/nível/horas do plano (`estPlano.aproveitarDe`, que regera a semana). Tópico novo que já tem progresso não é sobrescrito, e rodar de novo não duplica nada. Incidência do TEC e metas não são copiadas (dependem da banca e da semana). O edital antigo não muda.
- *Um edital de cada vez*: a lixeira virou **Desativar edital** (`editais.status = 'desativado'`; nada é apagado). Desativados ficam no grupo "Desativados" do seletor, com **Reativar** e **Excluir de vez**; a tela de aproveitamento já oferece desativar o edital de origem (marcado). O aproveitamento grava em cada tópico novo de onde veio (`topicos.origem`, `alter table` no fim do `estudos-plano.sql`; sem a coluna, reconhece pelo nome).
- *Fora do edital ativo* (`estAproveitar.foraDoAtivo`/`estaFora`): tópicos de editais desativados que não são origem de outro tópico nem têm o nome de um tópico do ativo (numa sequência 1 → 2 → 3 sobra só a versão mais recente). Aparecem em cinza: bloco "Fora do edital ativo" no fim do Edital Verticalizado (só os que têm estudo, questões, tempo, resumo ou erro; não entram no progresso nem no plano; a ficha abre normalmente), assuntos fora do edital em Meus Resumos (os resumos de nome antigo já copiados somem, `resumosLevados`) e erros com o selo "Fora do edital" no Caderno, que continuam na revisão por cartão.

**Gestão de Contratos (antes "Controle de Obras"; id, pasta `apps/controle-obras/` e tabelas mantidos).** Gerenciador de processos no estilo SEI, em `apps/controle-obras/` (abre em página cheia):
- *Processo* `AAAA.NNNN` (numeração por ano): assunto, serviço (projeto, execução, fiscalização, laudo, consultoria), cliente, contato, local, valores da proposta e do contrato, se o contrato é mensal (`processos.mensal`: os valores viram "R$/mês" e preenchem o honorário do acompanhamento de obra; o app só envia a coluna se ela existir, testada no carregamento) e fase: Prospecção → Proposta enviada → Em negociação → Contratado → Em execução → Entregue → Encerrado, ou Proposta recusada / Cancelado (finais: marcam `concluido_em`).
- *Documentos* numerados no processo (0001, 0002…): externos (arquivo no bucket `obras-docs`; PDF e imagem com pré-visualização) ou internos (escritos no Quill 1.3.6, carregado sob demanda; "Imprimir / PDF" abre uma janela de impressão). Incluir Proposta ou Contrato sugere avançar a fase (`AVANCA_FASE`).
- *Gerar proposta*: botão "📄 Gerar proposta" no formulário do processo (salva os dados antes) e no card "Dados do processo". Abre `formProposta`: serviços com caixa de marcar, prazo e valor (catálogo em `apps/controle-obras/proposta-textos.js`: estrutural, hidráulico, sanitário/pluvial, elétrico, incêndio e acompanhamento de obra, que é contínuo e conta em meses), "+ Outro serviço", dados da edificação, % de entrada e pranchas. Gera um documento interno do tipo Proposta no formato da proposta do Matheus (capa, objeto, seção técnica por serviço, obrigações, valores por extenso, pagamento, tabela de prazos por etapa, dados bancários e aceite) e grava o total em `valor_proposta`. Os dados com que foi montada ficam num comentário `<!--ob-proposta:…-->` no início do `conteudo`, e "Editar" reabre o formulário. Os dados do proponente (cabeçalho, registro, conselho, dados bancários, frase) e os últimos prazos/valores ficam no `user_metadata` da conta (`proposta_eu`, `proposta_ultimos`), não no código. "Imprimir / PDF" usa o papel timbrado em CSS, repetido em cada página (thead/tfoot); para o dono, a faixa leva a logo (`LOGO_DONO`: `assets/logo-mm.webp`, com transparência) e o símbolo `assets/logo-mm-simbolo.webp` vira marca d'água no canto de cada página. Na tela, a proposta aparece numa prévia em folhas A4 (iframe com `paginaProposta(…, 'tela')`: uma folha por seção, com o mesmo timbrado), e a impressão usa `paginaProposta(…, 'imprimir')`.
- *Revisões da proposta*: "Nova revisão" (no documento) ou "Gerar proposta" num processo que já tem proposta abre o formulário preenchido com a mais recente e salva um **documento novo** (`dados.revisao`, título "… — Rev. 01"); a anterior fica intacta. Desconto em % ou R$ (`dados.desconto`/`descontoTipo`, conta em `contaProposta`: subtotal, desconto e total; as parcelas usam o total). Motivo da revisão vai para o andamento ("Proposta revisada (Rev. 01…): R$ A → R$ B — motivo") e para o histórico mostrado acima da prévia (`htmlHistoricoProposta`: valor, diferença e "vigente"; revisão antiga avisa que foi substituída). `valor_proposta` do processo é sempre o da revisão mais recente (também ao excluir uma). Revisar com o processo em "Proposta enviada" sugere "Em negociação".
- *Andamento*: tudo o que acontece entra sozinho (abertura, fase, documentos, prazos), além de anotações manuais.
- *WhatsApp*: o processo tem "Pessoa de contato" e "WhatsApp" (`telefone`, normalizado para `55DDDNÚMERO` em `numeroWhats`). Modelos editáveis na tabela `modelos_mensagem` (5 padrões em `MODELOS_PADRAO`, criados quando a tabela está vazia; sem a tabela, valem os padrões só para leitura), com variáveis `{saudacao}`, `{nome}`, `{assunto}`, `{valor_proposta}`, `{data_proposta}` etc. Modelo com `gatilho` (fase) e `dias` cria um prazo-lembrete (`prazos.modelo_id`) quando o processo entra na fase (domingo passa para segunda); ao sair da fase, os lembretes pendentes dela são apagados. "💬 Enviar" abre `wa.me` com o texto (editável), registra a mensagem no andamento (`tipo = 'mensagem'`) e marca o lembrete como cumprido. Mensagens e anotações manuais do andamento têm ✕ para excluir (mensagem aberta e não enviada); excluir uma mensagem que cumpriu um lembrete (mesmo modelo, no mesmo dia) oferece reabri-lo.
- *Acompanhamento de obra* (`apps/controle-obras/obra.js`, `window.OB_OBRA(nucleo)`; o `app.js` passa as funções que compartilha em `nucleo()`). Rota `#/p/<processo>/obra/<aba>` (geral, visitas, cronograma, pendencias, honorarios, relatorios); item "🏗️ Acompanhamento da obra" na árvore e botão no card de dados. Tabelas do `supabase/acompanhamento.sql`: `obras` (id = processo; início, término, endereço, área, sistema, `valor_mensal`, `dia_vencimento`), `obra_etapas` (peso, %, início/fim previstos), `obra_visitas` (clima, equipe, atividades, orientações, `avancos` jsonb `[{etapa_id, de, para}]`, `fotos` jsonb `[{caminho, legenda}]`), `obra_pendencias` (gravidade, prazo, foto antes/depois) e `obra_honorarios` (competência `AAAA-MM`, vencimento no mês seguinte, `pago_em`). Sem as tabelas, a aba mostra o aviso para rodar o SQL.
  - *Iniciar*: preenche com a proposta (item em meses: valor e prazo; edificação), cria 11 etapas padrão (`ETAPAS_PADRAO`, pesos somam 100, datas distribuídas no prazo), gera as mensalidades e sugere a fase "Em execução".
  - *Avanço*: média ponderada pelo peso; previsto = linear entre início e fim de cada etapa (marcador âmbar); "atrasada" se 10 pontos abaixo (`ATRASO`). A visita guarda de/para de cada etapa alterada; `pctEm(etapa, dia)` reconstrói o % numa data. Editar visita antiga só muda o % do campo mexido.
  - *Fotos*: reduzidas a 1600 px JPEG 85% (`reduzirFoto`) e enviadas para `obras-docs/<processo>/obra/`; links assinados de 1 h (`linksFotos`). Excluir visita/pendência/processo apaga as fotos.
  - *Honorários*: aba "Financeiro" da obra = card do `financeiro.js`; "Iniciar" gera as mensalidades por `fin.gerarMensalidades`. A tabela `obra_honorarios` não é mais usada (o `financeiro.sql` copia os dados dela).
  - *Relatório Gerencial da Obra*: documento interno tipo "Relatório" com os dados num comentário `<!--ob-relatorio:…-->` (período, retrato do progresso, visitas, fotos escolhidas, pendências, próximas etapas). Prévia e impressão no papel timbrado por `paginaTimbrada` (a mesma da proposta); as fotos ganham links novos a cada abertura. Editar mantém o progresso salvo, salvo se marcar "Atualizar…" ou mudar o período.
  - *Solicitação de materiais* (aba "Materiais", `formMateriais`): documento interno tipo "Solicitação de materiais" com os dados num comentário `<!--ob-materiais:…-->` (número próprio 01, 02…, data, entrega na obra até, etapa, itens `{material, espec, qtd, unidade, foto}` (foto opcional por item: 📷 na linha, reduzida e enviada para `obras-docs/<processo>/obra/` como as das visitas; foto logo abaixo do nome do material, na folha; trocar/tirar na edição apaga a antiga, excluir o documento ou o processo apaga todas), observações, destinatário `para {nome, email}`, `enviada_em`). Folha no papel timbrado por `paginaTimbrada` com o `CSS_RELATORIO` (tabela de dados, carta ao proprietário, tabela de itens, assinatura). O e-mail do proprietário não tem coluna no processo: fica na solicitação, e a seguinte já vem com ele (e com os materiais anteriores como sugestão). "✉️ Enviar por e-mail" (`formEmailMateriais`) abre o Gmail (`mail.google.com/mail/?view=cm`) com destinatário, assunto e o texto com a lista; o PDF é salvo em "Imprimir / PDF" e anexado à mão (link de e-mail não anexa arquivo). Abrir o Gmail grava `enviada_em` e registra no andamento (tipo `mensagem`). Sem controle de entrega dos materiais (escolha do usuário). Relatório e solicitação passam pelo `ehDocObra`/`editarDoc`/`imprimirDoc` do obra.js, chamados pelo app.js.
  - Andamento: entradas do tipo `obra` (ponto laranja).
- *Financeiro* (`apps/controle-obras/financeiro.js`, `window.OB_FIN(nucleo)`, criado antes da obra, que o recebe como `nucleo.fin`). Tabela `recebimentos`: descrição, `origem` (mensal | proposta | avulso), competência, valor, vencimento, `recebido_em`/`valor_recebido`/forma, nota fiscal (`nf_numero`, `nf_emitida_em`, `nf_enviada_em`, `nf_documento_id` = documento "Nota fiscal" do processo com o PDF/XML no bucket).
  - No processo: card "💰 Financeiro" (resumo e tabela; "Gerar mensalidades" se `p.mensal`; "Parcelas da proposta": entrada (% da proposta) hoje e saldo na entrega, em dias úteis, sobre o valor dos projetos com o desconto; itens em meses ficam de fora).
  - Visão geral `#/financeiro` (botão na lista e aviso de vencidos/notas): KPIs do mês, "Mês a mês" (previsto pelo vencimento × recebido, 2 meses atrás a 5 à frente; clicar filtra), filtros A receber / Vencidos / NF a emitir (sem NF e vence em até 7 dias, vencido ou recebido) / NF a enviar / Recebidos / Todos, mês e busca.
  - Marcar recebido, emitir ou enviar NF entram no andamento (tipo `financeiro`). "💬" cobra por WhatsApp com os dados de pagamento do proponente.
- *Google Agenda* (link iCal assinado em "Outras agendas → Do URL"): botão "📅 Google Agenda" na lista (`formAgenda` no `app.js`) cria, copia, troca ou desativa o link e escolhe os itens (`agenda_links.itens`: prazos em aberto, recebimentos não pagos, prazos das pendências de obra). Token de 48 hex gerado no navegador; a `netlify/functions/agenda.mjs` acha o dono pelo token com a service_role e lê só os dados dele (eventos de dia inteiro, `TRANSP:TRANSPARENT`, UID estável por item). O `netlify.toml` redireciona `/agenda/*` para a função. Só leitura; o Google relê o link algumas vezes por dia. Só funciona no Netlify (não no servidor local).
- *Prazos* por processo (título curto; clicar edita em `formPrazo`). Podem levar uma mensagem pronta para WhatsApp e um destinatário próprio (`para_nome`/`para_telefone`, ex.: o arquiteto; sem eles, vai para o contato do processo); "💬 Enviar" abre a mensagem e cumpre o prazo. Texto longo com ":" na linha rápida abre o formulário já separado em título e mensagem (`separarPrazo`). Sem as colunas (`temPrazoMsg`), o prazo fica só com título e data; a lista mostra os vencidos e os dos próximos 7 dias. KPIs: ativos, propostas em aberto (R$), contratados/em execução (R$) e % de propostas aceitas.
- Ficou para depois: cronograma físico, medições e pendências com fotos (escolhidos antes, adiados quando o escopo virou "estilo SEI").

**Otimização de desempenho: aplicada** (commit `perf: aplica otimização preparada`, na mesma branch). O conteúdo era este:
- `assets/profile.png` (JPEG de 1024 px, 772 KB) vira `assets/profile.webp` (21 KB) com `assets/profile.jpg` de reserva, servidos por `<picture>` no portfólio com `fetchpriority="high"`. Depois disso, apagar `profile.png`.
- `@import` de fontes sai de todos os CSS e as fontes passam para `<link>` no `<head>`. O portfólio deixa de baixar Inter e Cormorant, que não usa.
- `estudos.html`: sai o ApexCharts (não é usado; os gráficos são SVG próprios), o supabase-js fica fixo em `@2.45.4`, e o html2pdf passa a ser carregado sob demanda por `window.carregarHtml2pdf()`. (As exportações de resumo agora ficam no `estudos.resumos.js` e também aguardam esse carregamento.)
- `netlify.toml`: cache de 30 dias em `/assets/*`.
- `og:image` e `og:url` adicionadas no portfólio.
- Teste obrigatório depois de aplicar: exportar um resumo em PDF no Painel de Estudos.

## Próximos passos planejados

1. **Identidade visual unificada.** Criar `css/base.css` com tokens de cor, tipografia, espaçamento e componentes, e redesenhar login, hub e portfólio com uma direção coerente. Hoje cada página tem um estilo próprio. Incluir responsividade, foco visível e `prefers-reduced-motion`.
2. **Portfólio como página inicial.** Hoje `/` é o login. Avaliar mover o login para `/login.html`, o que exige atualizar `LOGIN_PAGE` em `auth.js` e os links que apontam para ele.
3. **App de louvor.** Adicionar os scripts de login e avaliar migrar os dados de `localStorage` para o Supabase.
4. ~~"Salvar em .DOCX"~~: resolvido na branch `feat/janela-estudo` (`.docx` gerado no navegador, sem `app.py`). Pendente: imagens coladas ficam em base64 dentro de `resumos.conteudo`; se pesar, mover para o Storage.
5. **Apps "Em breve"** no `apps.json`: Calculadora de Estruturas, Orçamentador Rápido, Diário de Obra Digital e Conversor de Unidades.
