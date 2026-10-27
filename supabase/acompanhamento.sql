-- =====================================================================
-- ACOMPANHAMENTO DE OBRA da Gestão de Contratos (apps/controle-obras/obra.js)
-- Execute no Supabase: SQL Editor → New query → cole tudo → Run.
-- Precisa das tabelas do supabase/obras.sql. Já cria as tabelas com a coluna
-- "dono" e a política "cada_um_o_seu": cada usuário vê e grava só os próprios
-- dados. As fotos vão para o bucket "obras-docs", na pasta do processo, e já
-- ficam cobertas pela política obras_docs_dono. Pode ser rodado mais de uma vez.
-- =====================================================================

-- Uma obra por processo: dados da edificação e honorário mensal
create table if not exists public.obras (
  id               text primary key,                    -- o mesmo id do processo
  processo_id      text not null unique references public.processos (id) on delete cascade,
  dono             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  inicio           date,
  termino          date,                                -- término previsto
  endereco         text,
  area             text,
  sistema          text,                                -- ex.: estrutura mista de concreto armado e alvenaria
  valor_mensal     numeric(14, 2),
  dia_vencimento   integer not null default 5,          -- dia do mês seguinte ao trabalhado
  criado_em        timestamptz not null default now()
);

-- Etapas do cronograma físico: peso no total da obra e % concluído
create table if not exists public.obra_etapas (
  id               text primary key,
  processo_id      text not null references public.processos (id) on delete cascade,
  dono             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nome             text not null,
  ordem            integer not null default 0,
  peso             numeric(6, 2) not null default 1,
  percentual       numeric(5, 2) not null default 0,
  inicio           date,                                -- previsto
  fim              date                                 -- previsto
);
create index if not exists obra_etapas_processo_idx on public.obra_etapas (processo_id);

-- Visitas técnicas: o que se viu, o que se orientou, avanço das etapas e fotos
create table if not exists public.obra_visitas (
  id               text primary key,
  processo_id      text not null references public.processos (id) on delete cascade,
  dono             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data             date not null,
  clima            text,
  efetivo          text,                                -- equipe presente
  atividades       text,
  orientacoes      text,
  observacoes      text,
  avancos          jsonb not null default '[]',         -- [{etapa_id, de, para}]
  fotos            jsonb not null default '[]',         -- [{caminho, legenda}]
  criado_em        timestamptz not null default now()
);
create index if not exists obra_visitas_processo_idx on public.obra_visitas (processo_id);

-- Pendências: falhas apontadas, até serem corrigidas (com foto do antes e do depois)
create table if not exists public.obra_pendencias (
  id               text primary key,
  processo_id      text not null references public.processos (id) on delete cascade,
  dono             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  descricao        text not null,
  local            text,
  gravidade        text not null default 'media',       -- baixa | media | alta
  aberta_em        date not null,
  prazo            date,
  visita_id        text,
  foto_antes       text,                                -- caminho no bucket
  corrigida_em     date,
  solucao          text,
  foto_depois      text
);
create index if not exists obra_pendencias_processo_idx on public.obra_pendencias (processo_id);

-- Honorários mensais: competência, vencimento e pagamento
create table if not exists public.obra_honorarios (
  id               text primary key,
  processo_id      text not null references public.processos (id) on delete cascade,
  dono             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  competencia      text not null,                       -- 'AAAA-MM' (mês trabalhado)
  valor            numeric(14, 2) not null,
  vencimento       date not null,
  pago_em          date,
  observacao       text
);
create index if not exists obra_honorarios_processo_idx on public.obra_honorarios (processo_id);

do $$
declare
  t text;
begin
  foreach t in array array['obras', 'obra_etapas', 'obra_visitas', 'obra_pendencias', 'obra_honorarios'] loop
    execute format('create index if not exists %I on public.%I (dono)', t || '_dono_idx', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists cada_um_o_seu on public.%I', t);
    execute format('create policy cada_um_o_seu on public.%I for all to authenticated
                      using (dono = (select auth.uid())) with check (dono = (select auth.uid()))', t);
  end loop;
end $$;

-- Conferência: deve mostrar as 5 tabelas com rls = true e a política cada_um_o_seu
select c.relname as tabela, c.relrowsecurity as rls, p.policyname as politica
from pg_class c
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where c.relnamespace = 'public'::regnamespace and c.relname in ('obras', 'obra_etapas', 'obra_visitas', 'obra_pendencias', 'obra_honorarios')
order by 1;
