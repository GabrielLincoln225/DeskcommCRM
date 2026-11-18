-- manifest: Lançamento com VALOR VARIÁVEL no caixa (`financial_entries.amount_is_estimate`) e molde mensal variável (`recurring_entries.is_variable`) — anúncio, comissão e outras contas que ficam em aberto com uma estimativa e recebem o valor de verdade na hora de confirmar.
-- 9004 — o valor que só se sabe no fim do mês.
--
-- ═══ O PROBLEMA ═══
--
-- O caixa só conhecia valor certo. Tráfego pago, comissão de indicação e outras
-- contas variáveis custam R$ 15 num mês e R$ 1.000 no outro, e só se sabe o
-- número quando a conta fecha. Lançar "mensal" fixava um valor que nunca
-- batia; não lançar deixava o mês sem a despesa até o dia do pagamento.
--
-- ═══ O QUE ENTRA ═══
--
-- 1. `financial_entries.amount_is_estimate`: o valor da linha é uma ESTIMATIVA.
--    Ela fica aberta (pendente) contando a estimativa na previsão, e o
--    confirmar pede o valor real antes de pagar. Ao confirmar com o valor real,
--    a coluna volta a `false`: um lançamento pago é dinheiro que passou, nunca
--    estimativa.
-- 2. `recurring_entries.is_variable`: o molde mensal é variável. O cron e o
--    lançamento do previsto copiam a marca para a linha de cada competência.
--
-- ⚠️ O CHECK `amount_cents > 0` FICA. Valor variável não é valor nulo: a
-- estimativa é o número que a previsão do mês precisa para fechar, e o CHECK
-- protege toda soma do produto de uma linha sem valor.
--
-- Idempotente: `add column if not exists` com default — banco existente recebe
-- `false` em todas as linhas, que é exatamente o comportamento de antes.

alter table public.financial_entries
  add column if not exists amount_is_estimate boolean not null default false;

alter table public.recurring_entries
  add column if not exists is_variable boolean not null default false;

comment on column public.financial_entries.amount_is_estimate is
  'true = amount_cents é uma estimativa (conta variável: anúncio, comissão); o confirmar pede o valor real. Volta a false ao pagar. Migration 9004 (fork Konnexo).';
comment on column public.recurring_entries.is_variable is
  'true = molde mensal de valor variável; a linha de cada competência nasce com amount_is_estimate = true. Migration 9004 (fork Konnexo).';
