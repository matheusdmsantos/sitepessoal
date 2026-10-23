-- =====================================================================
-- PROTEÇÃO DO BANCO (Row Level Security)
-- Execute no Supabase: SQL Editor → New query → cole tudo → Run.
--
-- O que faz, em todas as tabelas do schema "public":
--   1. liga o RLS;
--   2. remove as políticas existentes (inclusive as que liberam acesso
--      anônimo, que anulariam a proteção);
--   3. cria uma única política: só o seu usuário logado lê e grava.
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

    execute format(
      'create policy dono_acesso_total on public.%I
         for all to authenticated
         using ((auth.jwt() ->> ''email'') = %L)
         with check ((auth.jwt() ->> ''email'') = %L)',
      t.tablename, v_email, v_email);

    raise notice 'Protegida: %', t.tablename;
  end loop;
end $$;

-- Conferência: deve listar cada tabela com rls = true e a política criada.
select c.relname as tabela, c.relrowsecurity as rls, p.policyname as politica
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where c.relkind = 'r'
order by 1;

-- Tabelas criadas no futuro: rode este script de novo depois de criá-las.
