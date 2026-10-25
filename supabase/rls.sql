-- =====================================================================
-- PROTEÇÃO DO BANCO (Row Level Security)
-- Execute no Supabase: SQL Editor → New query → cole tudo → Run.
--
-- O que faz, em todas as tabelas do schema "public":
--   1. liga o RLS;
--   2. remove as políticas existentes (inclusive as que liberam acesso
--      anônimo, que anulariam a proteção);
--   3. cria uma única política:
--      - tabela com a coluna "dono" (Painel de Estudos, ver multiusuario.sql):
--        cada usuário logado lê e grava só as próprias linhas;
--      - as demais (Controle de Obras etc.): só o seu usuário.
--
-- ANTES DE RODAR: confira se o e-mail abaixo é o mesmo do usuário que
-- você criou em Authentication → Users.
-- =====================================================================

do $$
declare
  v_email text := 'ecivilmatheus@gmail.com';   -- ← seu e-mail de login
  t record;
  p record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);

    for p in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t.tablename
    loop
      execute format('drop policy %I on public.%I', p.policyname, t.tablename);
    end loop;

    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = t.tablename and column_name = 'dono') then
      execute format(
        'create policy cada_um_o_seu on public.%I
           for all to authenticated
           using (dono = (select auth.uid()))
           with check (dono = (select auth.uid()))',
        t.tablename);
      raise notice 'Por usuário: %', t.tablename;
    else
      execute format(
        'create policy dono_acesso_total on public.%I
           for all to authenticated
           using ((auth.jwt() ->> ''email'') = %L)
           with check ((auth.jwt() ->> ''email'') = %L)',
        t.tablename, v_email, v_email);
      raise notice 'Só o dono: %', t.tablename;
    end if;
  end loop;
end $$;

-- Conferência: deve listar cada tabela com rls = true e a política criada
-- (cada_um_o_seu nas do Painel de Estudos, dono_acesso_total nas demais).
select c.relname as tabela, c.relrowsecurity as rls, p.policyname as politica
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where c.relkind = 'r'
order by 1;

-- Tabelas criadas no futuro: rode este script de novo depois de criá-las.
