-- =====================================================================
-- MOTOR DE ESTUDOS (PDF como espinha do plano) — Painel de Estudos
-- Etapa 1: schema. Execute no Supabase: SQL Editor → New query → cole tudo → Run.
--
-- SÓ ACRESCENTA: cria duas tabelas novas e colunas novas (todas opcionais ou com valor padrão).
-- Não apaga, não renomeia e não altera nenhuma coluna ou tabela que o site publicado usa.
-- Pode ser rodado mais de uma vez.
--
-- As tabelas "memoria" e "blocos" (do memoria.sql, modelo por assunto que não foi publicado)
-- não são usadas pelo motor e ficam como estão; podem ser apagadas quando o motor for publicado.
-- =====================================================================

-- ---------- PDF: dados do motor (uma linha por PDF; id = id do PDF em "materiais") ----------
-- Fica numa tabela à parte porque o site publicado regrava as linhas de "materiais" ao salvar a
-- lista de PDFs de uma disciplina, e isso apagaria colunas novas colocadas lá.
create table if not exists public.motor_pdfs (
  id              text primary key,
  dono            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  edital_id       text,
  disciplina_id   text,
  ordem           integer not null default 0,          -- ordem de leitura dentro da disciplina
  tec_link        text,                                -- caderno do TEC do PDF (o subtópico sem caderno herda)
  peso            numeric,                             -- peso opcional do PDF
  itens_edital    jsonb not null default '[]'::jsonb,  -- itens do edital, só para o PDF sem subtópicos
  concluido_em    date,                                -- leitura do PDF concluída
  meia_vida       double precision,                    -- dias; vazio até o primeiro bloco de questões
  ultimo_contato  date,
  proxima_data    date,                                -- vale quando o PDF está concluído
  blocos          integer not null default 0,
  graduado        boolean not null default false,      -- saiu da fila própria e foi para a manutenção
  criado_em       timestamptz not null default now()
);
create index if not exists motor_pdfs_edital_idx on public.motor_pdfs (edital_id);
create index if not exists motor_pdfs_dono_idx on public.motor_pdfs (dono);

alter table public.motor_pdfs enable row level security;
drop policy if exists cada_um_o_seu on public.motor_pdfs;
create policy cada_um_o_seu on public.motor_pdfs
  for all to authenticated
  using (dono = (select auth.uid()))
  with check (dono = (select auth.uid()));

-- ---------- Blocos de questões (histórico; uma linha por PDF de cada bloco) ----------
create table if not exists public.motor_blocos (
  id              text primary key,
  dono            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  edital_id       text,
  disciplina_id   text,
  material_id     text not null,                       -- PDF
  meta_id         text,                                -- meta que gerou o bloco (a manutenção tem vários PDFs)
  data            date not null,
  tipo_bloco      text not null,                       -- primeiro | revisao | manutencao | fixacao
  tipo_questao    text not null default 'ce',          -- ce = certo/errado; me = múltipla escolha
  itens           jsonb not null default '[]'::jsonb,  -- [{ subtopico_id, total, acertos }]
  total           integer not null default 0,
  acertos         integer not null default 0,
  dias            integer not null default 0,          -- desde o último contato com o PDF
  previsto        double precision,                    -- acerto previsto antes do bloco (0 a 1)
  mv_antes        double precision,
  mv_depois       double precision,
  intervalo       integer,
  criado_em       timestamptz not null default now()
);
create index if not exists motor_blocos_material_idx on public.motor_blocos (material_id);
create index if not exists motor_blocos_dono_idx on public.motor_blocos (dono);

alter table public.motor_blocos enable row level security;
drop policy if exists cada_um_o_seu on public.motor_blocos;
create policy cada_um_o_seu on public.motor_blocos
  for all to authenticated
  using (dono = (select auth.uid()))
  with check (dono = (select auth.uid()));

-- ---------- Subtópico: PDF dono, páginas, peso, "não cai" e itens do edital ----------
alter table public.subtopicos add column if not exists material_id  text;      -- PDF dono
alter table public.subtopicos add column if not exists pag_ini      integer;
alter table public.subtopicos add column if not exists pag_fim      integer;
alter table public.subtopicos add column if not exists peso         numeric;   -- incidência, opcional
alter table public.subtopicos add column if not exists nao_cai      boolean not null default false;
alter table public.subtopicos add column if not exists itens_edital jsonb not null default '[]'::jsonb;
alter table public.subtopicos add column if not exists estudado_em  date;

-- ---------- Erro: PDF, confiança e recorrências ----------
-- O passo da agenda, a próxima revisão e o estado já existem (etapa, proxima, dominado_em).
alter table public.erros add column if not exists material_id  text;
alter table public.erros add column if not exists confianca    text;                     -- certeza | duvida | chute
alter table public.erros add column if not exists recorrencias integer not null default 0;

-- ---------- Meta: PDF, faixa de páginas, tipo de bloco e alvos ----------
alter table public.metas add column if not exists material_id  text;
alter table public.metas add column if not exists pag_ini      integer;
alter table public.metas add column if not exists pag_fim      integer;
alter table public.metas add column if not exists tipo_bloco   text;
alter table public.metas add column if not exists alvos        jsonb;
alter table public.metas add column if not exists subtopico_id text;

-- ---------- Plano: data da prova ----------
alter table public.plano_estudos add column if not exists data_prova date;

-- Conferência: deve mostrar as duas tabelas com rls = true
select c.relname as tabela, c.relrowsecurity as rls
from pg_class c where c.relname in ('motor_pdfs', 'motor_blocos');
