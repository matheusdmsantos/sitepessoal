-- =====================================================================
-- PAINEL DE ESTUDOS: tabelas do plano semanal, revisões e sessões
-- Execute no Supabase: SQL Editor → New query → cole tudo → Run.
-- Depois rode supabase/rls.sql de novo para proteger as tabelas novas.
--
-- Os ids são texto, no mesmo formato das tabelas editais/disciplinas/topicos.
-- Pode rodar mais de uma vez: só cria o que ainda não existe.
-- =====================================================================

-- Sessões de estudo (antes ficavam só no localStorage do navegador)
create table if not exists public.sessoes (
  id              text primary key,
  data            date not null,
  criado_em       timestamptz not null default now(),
  edital_id       text,
  disciplina_id   text,
  topico_id       text,
  disciplina      text,
  topico          text,
  minutos         integer not null default 0,
  questoes        integer not null default 0,
  acertos         integer not null default 0,
  tipo            text not null default 'estudo',   -- estudo | revisao | reforco
  meta_concluida  boolean not null default false
);
create index if not exists sessoes_data_idx on public.sessoes (data);

-- Configuração do plano semanal (uma linha por edital)
create table if not exists public.plano_estudos (
  edital_id      text primary key,
  horas_semana   numeric not null default 20,
  dias_semana    integer[] not null default '{1,2,3,4,5,6}',  -- 0 = domingo
  disciplinas    jsonb not null default '{}'::jsonb,           -- { disc_id: { peso, nivel, ativa } }
  atualizado_em  timestamptz not null default now()
);

-- Metas geradas para cada semana
create table if not exists public.metas (
  id             text primary key,
  edital_id      text not null,
  semana         date not null,      -- segunda-feira da semana
  dia            date not null,
  disciplina_id  text,
  topico_id      text,
  tipo           text not null default 'estudo',
  minutos        integer not null default 0,
  concluida      boolean not null default false,
  ordem          integer not null default 0
);
create index if not exists metas_semana_idx on public.metas (edital_id, semana);

-- Revisões espaçadas e reforços
create table if not exists public.revisoes (
  id             text primary key,
  edital_id      text,
  disciplina_id  text,
  topico_id      text not null,
  etapa          integer not null default 1,
  tipo           text not null default 'revisao',   -- revisao | reforco
  data_prevista  date not null,
  concluida_em   date,
  acerto         integer,                           -- % de acerto na revisão
  intervalo      integer,                           -- dias desde a etapa anterior (revisão adaptativa)
  minutos        integer                            -- duração prevista
);
create index if not exists revisoes_data_idx on public.revisoes (data_prevista);

-- Para quem já tinha rodado uma versão anterior deste script
alter table public.revisoes add column if not exists intervalo integer;
alter table public.revisoes add column if not exists minutos integer;
