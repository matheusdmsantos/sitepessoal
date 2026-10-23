# Site Pessoal — Matheus Miranda

Site estático publicado no Netlify (matheusmirandaeng.com.br).
Login e dados ficam no Supabase.

## Estrutura

    index.html          login (Supabase Auth)
    apps.html           hub de aplicações
    apps.json           cadastro dos apps exibidos no hub
    portfolio.html      página pública
    estudos.html        Painel de Estudos
    css/  js/  assets/
    apps/<id>/          um app por pasta
    apps/_modelo/       ponto de partida para um app novo
    supabase/rls.sql    regras de acesso do banco
    netlify.toml        configuração de publicação

## Adicionar um app

1. Copie `apps/_modelo/` para `apps/<id-do-app>/` e construa o app ali.
   Os 4 scripts de login no fim do `index.html` do modelo devem ficar.
2. Acrescente o app em `apps.json`:

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

   `abrirEm`: "visualizador" abre dentro do hub; "pagina" abre em tela cheia.
   `url: null` mostra o card como "Em breve".
3. Publique a pasta no Netlify.

## Login

Não há senha no código. O usuário é criado em Supabase → Authentication → Users,
e o cadastro público fica desligado (Authentication → Sign In / Providers →
"Allow new users to sign up" desativado).

## Fora do deploy

`app.py` (servidor local do "Salvar em .DOCX"), `build.js`, `scratch/`,
`__pycache__/` e `.dist/` ficam só na pasta de desenvolvimento.
