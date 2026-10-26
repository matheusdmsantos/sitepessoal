-- =====================================================================
-- CADERNO DE ERROS do Painel de Estudos (js/estudos.erros.js)
-- Execute no Supabase: SQL Editor → New query → cole tudo → Run.
-- Já cria a tabela com a coluna "dono" e a política "cada_um_o_seu":
-- cada usuário vê e grava só os próprios erros. Pode ser rodado mais de uma vez.
-- =====================================================================

create table if not exists public.erros (
  id               text primary key,
  dono             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  edital_id        text,
  disciplina_id    text,
  topico_id        text,
  disciplina_nome  text,          -- para mostrar o erro mesmo se o tópico sair do edital
  topico_nome      text,
  tec_id           text,          -- número da questão no TEC
  link             text,
  tipo             text not null default 'ce',   -- 'ce' (Certo/Errado) ou 'me' (A a E)
  gabarito         text not null,
  resposta         text,          -- a resposta dada na prova/caderno ('' = em branco)
  motivo           text,          -- conteudo, esqueci, leitura, pegadinha, pressa, gabarito
  regra            text,          -- a regra certa, em uma frase
  enunciado        text not null default '',     -- HTML (imagens em base64)
  comentario       text,
  etapa            integer not null default 0,   -- acertos seguidos nas revisões
  proxima          date,          -- próxima revisão; vazio quando dominada
  revisoes         integer not null default 0,
  acertos          integer not null default 0,
  ultima_revisao   date,
  dominado_em      date,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz
);

create index if not exists erros_dono_idx on public.erros (dono);
create index if not exists erros_topico_idx on public.erros (topico_id);

alter table public.erros enable row level security;
drop policy if exists cada_um_o_seu on public.erros;
create policy cada_um_o_seu on public.erros
  for all to authenticated
  using (dono = (select auth.uid()))
  with check (dono = (select auth.uid()));

-- Conferência: deve mostrar rls = true e a política cada_um_o_seu
select c.relname as tabela, c.relrowsecurity as rls, p.policyname as politica
from pg_class c
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where c.relname = 'erros';
