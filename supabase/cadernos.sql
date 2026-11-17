-- Cadernos do TEC resolvidos (Painel de Estudos, js/estudos.cadernos.js): um registro por caderno
-- terminado, ligado ao item do edital (e ao assunto, se escolhido). Cada registro também vira uma
-- sessão no histórico (sessao_id), então os números entram nos totais do item e no Desempenho.
-- Rode no SQL Editor do Supabase. Pode rodar de novo.

create table if not exists public.cadernos (
  id text primary key,
  edital_id text,
  disciplina_id text,
  topico_id text not null,         -- item do edital
  subtopico_id text,               -- assunto (opcional)
  tec_id text,                     -- número do caderno no link do TEC: liga as vezes em que foi refeito
  link text,
  nome text,
  data date not null,
  feitas integer not null check (feitas > 0),
  certas integer not null check (certas >= 0 and certas <= feitas),
  minutos integer not null default 0,
  meta integer,                    -- nº da meta do Sensei (o nome do caderno traz "DISCIPLINA - Assunto")
  sessao_id text,                  -- sessoes.id criada junto
  criado_em timestamptz not null default now(),
  dono uuid default auth.uid()
);
alter table public.cadernos add column if not exists meta integer;   -- para quem rodou a 1ª versão
create index if not exists cadernos_edital_idx on public.cadernos (edital_id, data);

alter table public.cadernos enable row level security;
drop policy if exists cada_um_o_seu on public.cadernos;
create policy cada_um_o_seu on public.cadernos
  for all to authenticated
  using (dono = (select auth.uid()))
  with check (dono = (select auth.uid()));

-- Conferência: deve mostrar rls = true e a política cada_um_o_seu
select c.relname as tabela, c.relrowsecurity as rls, p.policyname as politica
from pg_class c
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where c.relnamespace = 'public'::regnamespace and c.relname = 'cadernos';
