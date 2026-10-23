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
assets/               imagens
apps/
  _modelo/            template de app novo, já com login
  louvor/             Escala de Louvor (dados só em localStorage, sem login)
supabase/rls.sql      Row Level Security: só o dono lê e grava
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

- Tabelas conhecidas: `resumos`, `topicos`, `disciplinas`. O `estudos.v5.js` provavelmente usa outras, ligadas a editais e sessões.
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
- [ ] Usuário criado em Supabase → Authentication → Users, e cadastro público desativado.
- [ ] `supabase/rls.sql` executado no SQL Editor, **depois** de confirmar que o login funciona.
- [ ] Senha antiga trocada nos outros serviços onde era usada (ela ficou exposta no site antigo).
- [ ] Repositório do GitHub passado para privado.

**Otimização de desempenho preparada, ainda não aplicada.** Se existir um `otimizacao-site.zip` na pasta, o conteúdo dele é este:
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
