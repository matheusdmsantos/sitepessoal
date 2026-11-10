-- =====================================================================
-- MOTOR DE ESTUDOS — colunas da interface (Painel de Estudos)
-- Execute no Supabase: SQL Editor → New query → cole tudo → Run.
-- SÓ ACRESCENTA colunas (todas opcionais ou com valor padrão). Não apaga nem altera nada que o
-- site publicado usa. Pode ser rodado mais de uma vez.
-- =====================================================================

-- Erros: cada resposta numa revisão [{ data, acertou, passo }] (estatísticas de "refeitos")
alter table public.erros add column if not exists revisoes_log jsonb not null default '[]'::jsonb;
-- Erros: o bloco de questões de onde o erro saiu (calibração por confiança)
alter table public.erros add column if not exists bloco_id text;

-- Blocos: quantas questões marcou com certeza e quantas chutou (opcional; dúvida = o resto)
alter table public.motor_blocos add column if not exists certeza integer;
alter table public.motor_blocos add column if not exists chute   integer;

-- PDF: última página lida (metas de leitura do motor)
alter table public.motor_pdfs add column if not exists lidas integer not null default 0;

-- Plano: parâmetros mudados na tela de configuração (por cima do js/estudos.config.js) e
-- o contador de semanas com revisões atrasadas
alter table public.plano_estudos add column if not exists motor jsonb not null default '{}'::jsonb;
