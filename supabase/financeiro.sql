-- =====================================================================
-- FINANCEIRO da Gestão de Contratos (apps/controle-obras/financeiro.js)
-- Execute no Supabase: SQL Editor → New query → cole tudo → Run.
-- Precisa das tabelas do supabase/obras.sql. Cria a tabela "recebimentos"
-- (mensalidades, parcelas de proposta e lançamentos avulsos, com os dados da
-- nota fiscal) já com a coluna "dono" e a política "cada_um_o_seu".
-- Se o supabase/acompanhamento.sql já foi rodado, copia as mensalidades da
-- tabela obra_honorarios para cá (ela deixa de ser usada pelo app).
-- Pode ser rodado mais de uma vez.
-- =====================================================================

create table if not exists public.recebimentos (
  id               text primary key,
  processo_id      text not null references public.processos (id) on delete cascade,
  dono             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  descricao        text not null,                       -- ex.: Honorário de outubro/2026; Entrada (50%)
  origem           text not null default 'avulso',      -- mensal | proposta | avulso
  competencia      text,                                -- 'AAAA-MM' (mês trabalhado), nas mensalidades
  valor            numeric(14, 2) not null,
  vencimento       date not null,
  recebido_em      date,
  valor_recebido   numeric(14, 2),                      -- vazio = o valor cheio
  forma            text,                                -- PIX, transferência, boleto…
  nf_numero        text,
  nf_emitida_em    date,
  nf_enviada_em    date,
  nf_documento_id  text,                                -- documento "Nota fiscal" do processo (PDF/XML)
  observacao       text,
  criado_em        timestamptz not null default now()
);
create index if not exists recebimentos_processo_idx on public.recebimentos (processo_id);
create index if not exists recebimentos_vencimento_idx on public.recebimentos (vencimento);
create index if not exists recebimentos_dono_idx on public.recebimentos (dono);

alter table public.recebimentos enable row level security;
drop policy if exists cada_um_o_seu on public.recebimentos;
create policy cada_um_o_seu on public.recebimentos
  for all to authenticated
  using (dono = (select auth.uid()))
  with check (dono = (select auth.uid()));

-- Mensalidades do acompanhamento de obra (versão anterior) passam para cá
do $$
begin
  if to_regclass('public.obra_honorarios') is not null then
    insert into public.recebimentos (id, processo_id, dono, descricao, origem, competencia, valor, vencimento, recebido_em, observacao)
    select h.id, h.processo_id, h.dono,
           'Honorário de ' || (array['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
             'setembro', 'outubro', 'novembro', 'dezembro'])[split_part(h.competencia, '-', 2)::int] || '/' || split_part(h.competencia, '-', 1),
           'mensal', h.competencia, h.valor, h.vencimento, h.pago_em, h.observacao
      from public.obra_honorarios h
    on conflict (id) do nothing;
  end if;
end $$;

-- Conferência: deve mostrar rls = true e a política cada_um_o_seu
select c.relname as tabela, c.relrowsecurity as rls, p.policyname as politica,
       (select count(*) from public.recebimentos) as recebimentos
from pg_class c
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where c.relnamespace = 'public'::regnamespace and c.relname = 'recebimentos';
