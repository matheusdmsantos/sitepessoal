-- =====================================================================
-- AGENDA (iCal) da Gestão de Contratos: link secreto para assinar no Google Agenda
-- Execute no Supabase: SQL Editor → New query → cole tudo → Run.
-- Cada usuário tem no máximo um link. A função netlify/functions/agenda.mjs
-- procura o token com a chave service_role e monta a agenda só com os dados
-- do dono do link. Pode ser rodado mais de uma vez.
-- =====================================================================

create table if not exists public.agenda_links (
  dono             uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  token            text not null unique,                -- parte secreta do link (48 caracteres)
  itens            jsonb not null default '["prazos", "recebimentos", "pendencias"]',
  criado_em        timestamptz not null default now()
);

alter table public.agenda_links enable row level security;
drop policy if exists cada_um_o_seu on public.agenda_links;
create policy cada_um_o_seu on public.agenda_links
  for all to authenticated
  using (dono = (select auth.uid()))
  with check (dono = (select auth.uid()));

-- Conferência: deve mostrar rls = true e a política cada_um_o_seu
select c.relname as tabela, c.relrowsecurity as rls, p.policyname as politica
from pg_class c
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where c.relnamespace = 'public'::regnamespace and c.relname = 'agenda_links';
