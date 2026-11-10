-- =====================================================================
-- ASSUNTOS (SUBTÓPICOS) dos itens do edital — Painel de Estudos (js/estudos.subtopicos.js)
-- Execute no Supabase: SQL Editor → New query → cole tudo → Run.
-- Já cria a tabela com a coluna "dono" e a política "cada_um_o_seu":
-- cada usuário vê e grava só os próprios assuntos. Pode ser rodado mais de uma vez.
--
-- O resumo de cada assunto continua na tabela resumos (é a "página" com o mesmo nome no
-- resumo do item). Aqui ficam só o nome, a ordem, o caderno do TEC e os PDFs.
-- =====================================================================

create table if not exists public.subtopicos (
  id             text primary key,
  dono           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  edital_id      text,
  disciplina_id  text,
  topico_id      text not null,                       -- item do edital
  nome           text not null,
  ordem          integer not null default 0,
  tec_link       text,                                -- caderno de questões do TEC deste assunto
  pdfs           jsonb not null default '[]'::jsonb,  -- [{ material_id, de, ate }]: PDFs onde aparece (faixa opcional)
  criado_em      timestamptz not null default now()
);
create index if not exists subtopicos_topico_idx on public.subtopicos (topico_id);
create index if not exists subtopicos_dono_idx on public.subtopicos (dono);

alter table public.subtopicos enable row level security;
drop policy if exists cada_um_o_seu on public.subtopicos;
create policy cada_um_o_seu on public.subtopicos
  for all to authenticated
  using (dono = (select auth.uid()))
  with check (dono = (select auth.uid()));

-- Tempo e questões de cada assunto dentro da sessão: [{ subtopico_id, minutos, questoes, acertos }]
-- (o que não foi dividido fica no item como "sem subtópico")
alter table public.sessoes add column if not exists assuntos jsonb;

-- Assunto do erro (vazio = "sem subtópico")
alter table public.erros add column if not exists subtopico_id text;

-- Conferência: deve mostrar rls = true e a política cada_um_o_seu
select c.relname as tabela, c.relrowsecurity as rls, p.policyname as politica
from pg_class c
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where c.relname = 'subtopicos';

-- Metas por assunto (Painel de Estudos): a meta de questões de um assunto guarda o assunto.
-- Sem esta coluna, o plano faz uma meta de questões por item, como antes.
alter table public.metas add column if not exists subtopico_id text;
