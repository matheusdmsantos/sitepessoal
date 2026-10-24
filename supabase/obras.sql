-- =====================================================================
-- CONTROLE DE OBRAS: processos no estilo SEI (documentos, andamentos e prazos)
-- Execute no Supabase: SQL Editor → Create a new snippet → cole tudo → Run.
-- Depois rode supabase/rls.sql de novo para proteger as tabelas novas.
--
-- Os ids são texto, gerados no navegador (mesmo padrão do Painel de Estudos).
-- Pode rodar mais de uma vez: só cria o que ainda não existe.
-- =====================================================================

-- Processo: um serviço para um cliente, da prospecção ao encerramento
create table if not exists public.processos (
  id               text primary key,
  numero           text not null,                       -- 2026.0001 (ano + sequência)
  assunto          text not null,
  servico          text not null default 'execucao',    -- projeto | execucao | fiscalizacao | laudo | consultoria | outro
  cliente          text,
  contato          text,                                -- telefone / e-mail do cliente
  local            text,
  valor_proposta   numeric,
  valor_contrato   numeric,
  fase             text not null default 'prospeccao',  -- ver FASES em apps/controle-obras/app.js
  descricao        text,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  concluido_em     date
);
create unique index if not exists processos_numero_idx on public.processos (numero);

-- Documentos do processo, numerados em sequência (como a árvore do SEI)
create table if not exists public.documentos (
  id               text primary key,
  processo_id      text not null references public.processos (id) on delete cascade,
  numero           integer not null,                    -- 1, 2, 3… dentro do processo
  tipo             text not null,                       -- Proposta, Contrato, ART/RRT, Projeto…
  titulo           text not null,
  data             date not null default current_date,  -- data do documento
  origem           text not null default 'externo',     -- externo (arquivo) | interno (escrito no app)
  conteudo         text,                                -- interno: HTML do editor
  arquivo_caminho  text,                                -- externo: caminho no bucket "obras-docs"
  arquivo_nome     text,
  arquivo_tipo     text,
  arquivo_tamanho  integer,
  criado_em        timestamptz not null default now()
);
create index if not exists documentos_processo_idx on public.documentos (processo_id);

-- Andamento: histórico do processo (automático e anotações)
create table if not exists public.andamentos (
  id               text primary key,
  processo_id      text not null references public.processos (id) on delete cascade,
  data             timestamptz not null default now(),
  tipo             text not null default 'anotacao',    -- criacao | fase | documento | prazo | anotacao
  descricao        text not null
);
create index if not exists andamentos_processo_idx on public.andamentos (processo_id);

-- Prazos: retorno do cliente, entrega, vencimento da proposta…
create table if not exists public.prazos (
  id               text primary key,
  processo_id      text not null references public.processos (id) on delete cascade,
  descricao        text not null,
  data             date not null,
  concluido_em     date
);
create index if not exists prazos_processo_idx on public.prazos (processo_id);

-- Arquivos: bucket privado (só abre com link assinado), até 25 MB por arquivo
insert into storage.buckets (id, name, public, file_size_limit)
values ('obras-docs', 'obras-docs', false, 26214400)
on conflict (id) do nothing;

-- Só o dono lê e grava os arquivos (o rls.sql cuida só das tabelas de "public")
drop policy if exists obras_docs_dono on storage.objects;
create policy obras_docs_dono on storage.objects
  for all to authenticated
  using (bucket_id = 'obras-docs' and (auth.jwt() ->> 'email') = 'ecivilmatheus@gmail.com')
  with check (bucket_id = 'obras-docs' and (auth.jwt() ->> 'email') = 'ecivilmatheus@gmail.com');
