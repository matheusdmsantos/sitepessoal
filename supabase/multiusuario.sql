-- =====================================================================
-- VÁRIOS USUÁRIOS: cada um com os próprios dados
-- Execute no Supabase: SQL Editor → New query → cole tudo → Run.
-- Depois, rode o supabase/rls.sql de novo (é ele que cria as políticas).
--
-- O que faz:
--   1. marca o seu usuário como dono do site (app_metadata.papel = 'dono'):
--      o hub mostra todos os apps só para ele; para os outros, só os apps
--      escolhidos no app Usuários (app_metadata.apps);
--   2. acrescenta a coluna "dono" nas tabelas do Painel de Estudos e do
--      Controle de Obras, preenchida sozinha com o usuário logado em cada gravação;
--   3. marca todos os dados que já existem como seus;
--   4. inclui o dono nas regras de "valor único" (ex.: número do processo,
--      um resumo por disciplina e assunto), para dois usuários não se chocarem;
--   5. arquivos do Controle de Obras (bucket obras-docs): cada um abre só os
--      dos próprios processos.
-- Pode ser rodado mais de uma vez.
-- =====================================================================

do $$
declare
  v_email  text := 'ecivilmatheus@gmail.com';   -- ← seu e-mail de login
  v_dono   uuid;
  tabelas  text[] := array[
    -- Painel de Estudos
    'editais', 'disciplinas', 'topicos', 'resumos', 'sessoes',
    'metas', 'revisoes', 'plano_estudos', 'incidencias', 'materiais', 'erros',
    -- Controle de Obras
    'processos', 'documentos', 'andamentos', 'prazos', 'modelos_mensagem',
    'obras', 'obra_etapas', 'obra_visitas', 'obra_pendencias', 'obra_honorarios'];
  t        text;
  c        record;
begin
  select id into v_dono from auth.users where email = v_email;
  if v_dono is null then
    raise exception 'Usuário % não encontrado em Authentication → Users.', v_email;
  end if;

  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"papel": "dono"}'::jsonb
   where id = v_dono;

  foreach t in array tabelas loop
    if to_regclass('public.' || t) is null then
      raise notice 'Não existe, pulada: %', t;
      continue;
    end if;

    execute format('alter table public.%I add column if not exists dono uuid
                      default auth.uid() references auth.users (id) on delete cascade', t);
    execute format('update public.%I set dono = %L where dono is null', t, v_dono);
    execute format('alter table public.%I alter column dono set not null', t);
    execute format('create index if not exists %I on public.%I (dono)', t || '_dono_idx', t);

    -- Regras de valor único sem o dono passam a valer por usuário
    for c in
      select con.conname,
             string_agg(quote_ident(a.attname), ', ' order by k.ord) as colunas,
             bool_or(a.attname = 'dono') as tem_dono
        from pg_constraint con
        cross join unnest(con.conkey) with ordinality as k(attnum, ord)
        join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
       where con.conrelid = ('public.' || t)::regclass and con.contype = 'u'
       group by con.conname
    loop
      if not c.tem_dono then
        execute format('alter table public.%I drop constraint %I', t, c.conname);
        execute format('alter table public.%I add constraint %I unique (dono, %s)', t, c.conname, c.colunas);
        raise notice 'Valor único agora por usuário: %.% (%)', t, c.conname, c.colunas;
      end if;
    end loop;

    -- Índices únicos avulsos (ex.: processos_numero_idx), só de colunas simples
    for c in
      select ic.relname as indice,
             string_agg(quote_ident(a.attname), ', ' order by k.ord) as colunas,
             bool_or(a.attname = 'dono') as tem_dono,
             bool_or(k.attnum = 0) as tem_expressao
        from pg_index i
        join pg_class ic on ic.oid = i.indexrelid
        cross join unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
        left join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
       where i.indrelid = ('public.' || t)::regclass
         and i.indisunique and not i.indisprimary
         and not exists (select 1 from pg_constraint con where con.conindid = i.indexrelid)
       group by ic.relname
    loop
      if c.tem_expressao then
        raise notice 'Índice único com expressão, confira à mão: %.%', t, c.indice;
      elsif not c.tem_dono then
        execute format('drop index public.%I', c.indice);
        execute format('create unique index %I on public.%I (dono, %s)', c.indice, t, c.colunas);
        raise notice 'Índice único agora por usuário: %.% (%)', t, c.indice, c.colunas;
      end if;
    end loop;

    raise notice 'Pronta: %', t;
  end loop;
end $$;

-- Arquivos do Controle de Obras: o caminho começa pelo id do processo
-- ("<processo>/<documento>/<arquivo>"); cada um abre só os dos próprios processos.
drop policy if exists obras_docs_dono on storage.objects;
create policy obras_docs_dono on storage.objects
  for all to authenticated
  using (bucket_id = 'obras-docs' and exists (
    select 1 from public.processos p
     where p.id = (storage.foldername(name))[1] and p.dono = (select auth.uid())))
  with check (bucket_id = 'obras-docs' and exists (
    select 1 from public.processos p
     where p.id = (storage.foldername(name))[1] and p.dono = (select auth.uid())));

-- Conferência 1: cada tabela com a coluna dono e nenhuma linha sem dono.
select c.table_name as tabela, c.is_nullable as aceita_vazio
from information_schema.columns c
where c.table_schema = 'public' and c.column_name = 'dono'
order by 1;

-- Conferência 2: índices únicos (fora a chave primária) que não incluem o dono.
-- O esperado é não aparecer nada. Se aparecer, me mande o resultado.
select i.tablename as tabela, i.indexname as indice, i.indexdef as definicao
from pg_indexes i
where i.schemaname = 'public'
  and i.indexdef ilike 'create unique index%'
  and i.indexname not like '%_pkey'
  and i.indexdef not ilike '%dono%';
