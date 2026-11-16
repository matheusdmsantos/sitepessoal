-- Resumo aberto no PC e no tablet ao mesmo tempo (Painel de Estudos, js/estudos.sessao.js e js/estudos.tinta.js).
-- Rode no SQL Editor do Supabase. Pode rodar de novo.
--
-- 1) resumo_partes: devolve só as páginas do resumo que o aparelho ainda não tem (comparando o
--    SHA-256 de cada página), e troca as fotos que ele já tem por "ref:<hash>". Assim o outro
--    aparelho não baixa o resumo inteiro (com as fotos) a cada alteração.
-- 2) resumo_tinta: a tinta da caneta por cima do texto, um traço por linha, presa a um trecho do texto.
-- 3) cronometros: o cronômetro da meta nos dois aparelhos (iniciar no PC, ver rodando no tablet).

create or replace function public.resumo_partes(p_id text, p_hashes text[], p_imagens text[])
returns jsonb
language plpgsql
stable
security invoker          -- o RLS de public.resumos continua valendo
set search_path = public
as $$
declare
  r record;
  parte text;
  h text;
  img text;
  partes jsonb := '[]'::jsonb;
begin
  select conteudo, updated_at into r from public.resumos where id = p_id;
  if not found then return null; end if;
  -- Mesma divisão do navegador: conteudo.split(/(?=<h1 class="est-pagina">)/)
  foreach parte in array regexp_split_to_array(coalesce(r.conteudo, ''), '(?=<h1 class="est-pagina">)') loop
    h := encode(sha256(convert_to(parte, 'UTF8')), 'hex');
    if h = any(coalesce(p_hashes, '{}')) then
      partes := partes || jsonb_build_array(jsonb_build_object('h', h));
    else
      for img in select distinct m[1] from regexp_matches(parte, '"(data:image/[^"]+)"', 'g') as t(m) loop
        if encode(sha256(convert_to(img, 'UTF8')), 'hex') = any(coalesce(p_imagens, '{}')) then
          parte := replace(parte, img, 'ref:' || encode(sha256(convert_to(img, 'UTF8')), 'hex'));
        end if;
      end loop;
      partes := partes || jsonb_build_array(jsonb_build_object('h', h, 'html', parte));
    end if;
  end loop;
  return jsonb_build_object('updated_at', r.updated_at, 'partes', partes);
end $$;

grant execute on function public.resumo_partes(text, text[], text[]) to authenticated;

create table if not exists public.resumo_tinta (
  id text primary key,
  resumo_id text not null,           -- resumos.id
  pagina text not null,              -- id do assunto (subtopicos.id), '_geral' ou 't:<título>'
  ancora jsonb not null,             -- { i, pre, pos }: posição no texto da página e o texto em volta
  traco jsonb not null,              -- { f: caneta|marca, c, l, p: [dx, dy, pressão, …] } a partir da âncora
  apagado boolean not null default false,
  atualizado_em timestamptz not null default now(),
  dono uuid default auth.uid()
);
create index if not exists resumo_tinta_resumo_idx on public.resumo_tinta (resumo_id, atualizado_em);

-- A hora vem do servidor: os aparelhos buscam "o que mudou desde" e os relógios deles podem diferir
create or replace function public.resumo_tinta_hora() returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists resumo_tinta_hora on public.resumo_tinta;
create trigger resumo_tinta_hora before insert or update on public.resumo_tinta
  for each row execute function public.resumo_tinta_hora();

alter table public.resumo_tinta enable row level security;
drop policy if exists cada_um_o_seu on public.resumo_tinta;
create policy cada_um_o_seu on public.resumo_tinta
  for all to authenticated
  using (dono = (select auth.uid()))
  with check (dono = (select auth.uid()));

-- 3) cronometros: o cronômetro da meta/revisão nos dois aparelhos (js/estudos.sessao.js).
--    estado = { acum, rodando, desde, pomodoro, fase, faseMs, porAssunto, assunto, mudado } ou
--    { apagado, mudado } depois de concluir/zerar. Vale o de "mudado" mais recente.
create table if not exists public.cronometros (
  id text primary key,                -- id da meta ou da revisão
  estado jsonb not null,
  atualizado_em timestamptz not null default now(),
  dono uuid default auth.uid()
);
create index if not exists cronometros_atualizado_idx on public.cronometros (atualizado_em);
drop trigger if exists cronometros_hora on public.cronometros;
create trigger cronometros_hora before insert or update on public.cronometros
  for each row execute function public.resumo_tinta_hora();

alter table public.cronometros enable row level security;
drop policy if exists cada_um_o_seu on public.cronometros;
create policy cada_um_o_seu on public.cronometros
  for all to authenticated
  using (dono = (select auth.uid()))
  with check (dono = (select auth.uid()));

-- Conferência: deve mostrar rls = true e a política cada_um_o_seu, e a função
select c.relname as tabela, c.relrowsecurity as rls, p.policyname as politica
from pg_class c
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where c.relnamespace = 'public'::regnamespace and c.relname in ('resumo_tinta', 'cronometros');
select proname from pg_proc where proname = 'resumo_partes';
