# CLAUDE.md — Site Pessoal (Matheus Miranda)

Instruções e contexto para o Claude Code neste repositório. Leia este arquivo inteiro antes de mexer em qualquer coisa.

## Sobre o projeto

Site pessoal que funciona como **repositório de aplicações próprias**. Ele tem uma página pública (o portfólio de engenheiro civil) e uma área privada, protegida por login, com um hub de apps.

- **Domínio:** https://matheusmirandaeng.com.br
- **Repositório:** github.com/matheusdmsantos/sitepessoal, branch `main`. ⚠️ Hoje está **público**; a ideia é passar para privado.
- **Deploy:** Netlify, projeto `shiny-moxie-5ef02b`, ligado ao GitHub. **Todo push na `main` publica em produção automaticamente** (em cerca de 30 s).
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
editais/              PDFs de teste; fora do git (.gitignore) para não serem publicados
assets/               imagens
apps/
  _modelo/            template de app novo, já com login
  louvor/             Escala de Louvor (dados só em localStorage, sem login)
supabase/rls.sql      Row Level Security: só o dono lê e grava
supabase/estudos-plano.sql  tabelas sessoes, metas, revisoes e plano_estudos
```

`/supabase/*` e `/README.md` retornam 404 no site, por regra no `netlify.toml`.

## Autenticação: `js/auth.js`

Nenhuma senha fica no código: o login é feito pelo Supabase Auth. O arquivo expõe funções globais com a **mesma API da versão antiga**, para não quebrar o `estudos.html`:

| Função | Tipo | O que faz |
|---|---|---|
| `isAuthenticated()` | síncrona | Lê `localStorage['sb-<ref>-auth-token']` e verifica se há `refresh_token` |
| `requireAuth()` | síncrona | Sem sessão, redireciona para `/index.html?next=<caminho>` |
| `login(email, senha)` | async | Devolve `{ ok }` ou `{ ok: false, message }` |
| `logout()` | async | Faz `signOut` e volta para o login |
| `getSessionUser()` | síncrona | Devolve o e-mail do usuário logado |
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

- Tabelas: `editais`, `disciplinas`, `topicos`, `resumos` e, criadas por `supabase/estudos-plano.sql`, `sessoes`, `metas`, `revisoes`, `plano_estudos`, `incidencias` e `materiais`. Os ids são texto.
- `incidencias` e `materiais` são carregadas à parte: se faltarem, só os dados delas ficam no navegador e o resto do plano continua no Supabase.
- Sem as tabelas do plano, o `estudos.plano.js` guarda tudo no `localStorage` e mostra um aviso; quando elas aparecem, envia esses dados uma vez (flag `est_plano_migrado`).
- O `rls.sql` liga o RLS em todas as tabelas de `public`, **apaga todas as políticas existentes** e cria `dono_acesso_total`, que só libera para `auth.jwt()->>'email' = 'ecivilmatheus@gmail.com'`.
- A chave `anon` pode ficar no front-end. A chave `service_role` **nunca** pode aparecer no código.

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
- [ ] Senha antiga trocada nos outros serviços onde era usada (ela ficou exposta no site antigo).
- [ ] Repositório do GitHub passado para privado.

**Plano semanal no Painel de Estudos (branch `feat/plano-semanal`, ainda não publicada).** Inspirado na Guruja:
- *Planejamento Semanal* (seção `metas`): um planejamento só, com tópicos novos e revisões juntos em cada dia. Horas/semana, dias de estudo, peso e nível por disciplina; rodízio ponderado (a disciplina da vez é a que recebeu menos tempo em relação a peso × (4 − nível)); tempo do tópico pelo nível: 120/90/60 min.
- Só a semana atual é gravada (`metas`). As seguintes são uma projeção recalculada a cada tela (`projetar()`), até cobrir o edital, já reservando as revisões que cada tópico vai gerar (com o acerto médio da disciplina).
- *Revisões adaptativas*: o intervalo é multiplicado por 2 (70–84%), 3 (85–94%) ou 4 (≥ 95%); abaixo de 70% entra reforço (40 min); acima de 120 dias o tópico está dominado e sai do plano. Duração 15 min (≥ 90%) ou 25 min. Revisões ocupam no máximo 50% do tempo do dia (`diaComFolga`). A antiga tela "Revisões e Reforços" foi removida.
- *Desempenho*: horas por semana × meta, média diária, acerto por disciplina, pontos fracos e previsão de término do edital.
- Regras e constantes ficam no topo de `js/estudos.plano.js`.
- *Incidência do TEC*: na configuração do plano, cada disciplina tem "📊 Importar". A planilha "Índice do Caderno" do TEC tem as colunas Hierarquia (vazia), Índice, Quantidade e Porcentagem, e declara a dimensão errada (`A1:D1`), por isso o intervalo é recalculado. Cada assunto é ligado a um tópico por semelhança (radicais, peso pela raridade, números de lei valem 2×); as correções do usuário ficam lembradas em `localStorage` (`est_inc_mapa_<disciplina>`). No plano: tópicos ordenados por incidência e tempo de 0,5× a 1,5× do bloco do nível (`blocoDoTopico`). Testado com Direito Administrativo (Cebraspe): 104 de 110 assuntos ligados sozinhos.
- *Material em PDF*: na configuração do plano, "📚 PDFs" por disciplina (`js/estudos.materiais.js`). Vários PDFs de uma vez; o pdf.js conta as páginas e o nome do arquivo (ou o texto das 2 primeiras páginas) sugere o tópico. Um PDF pode ir para vários tópicos, com faixa de páginas opcional; sem faixa, as páginas que sobram são divididas igualmente (`contarPaginas`). O arquivo não é enviado: a tabela `materiais` guarda só nome, páginas e `topicos` (jsonb `[{topico_id, de, ate}]`). Com incidência, a ordem dos tópicos é por questões por página (`prioridadeDosTopicos`; tópico sem PDF usa a mediana de páginas da disciplina). Tópico com PDF leva o tempo de leitura (`PAGINAS_POR_HORA` = 20) e, se passar de 2h (`PARTE_MAX`), vira várias metas com `parte`/`partes` (colunas em `metas`), divididas por igual e em dias seguidos. Ao concluir uma meta de tópico com PDF, o usuário informa as páginas lidas (`metas.paginas_lidas`); o que falta é recalculado pelas páginas (`paginasLidas`/`faltaDoTopico`). Só **"✓ Terminei este PDF"** marca o tópico como estudado e agenda a primeira revisão; as partes que sobraram saem do plano, e sem essa marcação entra mais uma parte. Tópico sem PDF mantém o bloco do nível e da incidência.
- *Importar edital*: PDF ou texto → recorta o conteúdo programático até o primeiro ANEXO, separa "CARGO N", aplica "(EXCETO/SOMENTE PARA O CARGO …)", agrupa subitens no tópico principal (ou separa, por opção) e sugere a data de "Aplicação das provas". Testado com o edital do TCE-MA (Cebraspe): 16 cargos; cargo 13 com 15 disciplinas e 135 tópicos.

**Otimização de desempenho: aplicada** (commit `perf: aplica otimização preparada`, na mesma branch). O conteúdo era este:
- `assets/profile.png` (JPEG de 1024 px, 772 KB) vira `assets/profile.webp` (21 KB) com `assets/profile.jpg` de reserva, servidos por `<picture>` no portfólio com `fetchpriority="high"`. Depois disso, apagar `profile.png`.
- `@import` de fontes sai de todos os CSS e as fontes passam para `<link>` no `<head>`. O portfólio deixa de baixar Inter e Cormorant, que não usa.
- `estudos.html`: sai o ApexCharts (não é usado; os gráficos são SVG próprios), o supabase-js fica fixo em `@2.45.4`, e o html2pdf passa a ser carregado sob demanda por `window.carregarHtml2pdf()`. As funções `exportResumoPDF` e `exportarDisciplinaPDF` do `estudos.v5.js` ficam `async` e aguardam esse carregamento.
- `netlify.toml`: cache de 30 dias em `/assets/*`.
- `og:image` e `og:url` adicionadas no portfólio.
- Teste obrigatório depois de aplicar: exportar um resumo em PDF no Painel de Estudos.

## Próximos passos planejados

1. **Identidade visual unificada.** Criar `css/base.css` com tokens de cor, tipografia, espaçamento e componentes, e redesenhar login, hub e portfólio com uma direção coerente. Hoje cada página tem um estilo próprio. Incluir responsividade, foco visível e `prefers-reduced-motion`.
2. **Portfólio como página inicial.** Hoje `/` é o login. Avaliar mover o login para `/login.html`, o que exige atualizar `LOGIN_PAGE` em `auth.js` e os links que apontam para ele.
3. **App de louvor.** Adicionar os scripts de login e avaliar migrar os dados de `localStorage` para o Supabase.
4. **"Salvar em .DOCX".** Hoje depende de um `app.py` (Flask) rodando no PC do usuário, então não funciona no site publicado. Opções: gerar o `.docx` no navegador ou usar uma Netlify Function com Supabase Storage.
5. **Apps "Em breve"** no `apps.json`: Calculadora de Estruturas, Controle de Obras, Orçamentador Rápido, Diário de Obra Digital e Conversor de Unidades.
