-- manifest: O lançamento do caixa ganha cliente e negócio (`financial_entries.contact_id`/`lead_id`) e o molde recorrente ganha cliente e início (`recurring_entries.contact_id`/`starts_on`), com gatilho que recusa vínculo de outra organização — base da aba Financeiro (Painel + Caixa).
-- 0626 — de quem é o dinheiro, e desde quando a recorrência vale.
--
-- ═══ O PROBLEMA ═══
--
-- `financial_entries` dizia QUANTO, QUANDO e EM QUE CONTA, e nunca DE QUEM. Um
-- "a receber" de R$ 1.000 era uma linha com descrição livre; para saber que
-- era do cliente X era preciso ler o texto, e o contato não tinha como mostrar
-- o que devia. O mesmo vale para o negócio ganho no funil: fechar um negócio
-- não deixava rastro nenhum no caixa, e nada impedia lançá-lo duas vezes.
--
-- E o molde recorrente (0357) não tinha começo: o cron gera a competência do
-- mês corrente para TODO molde ativo. Cadastrar hoje uma mensalidade que só
-- começa no mês que vem gerava a cobrança deste mês — dinheiro que ninguém deve.
--
-- ═══ O QUE ENTRA ═══
--
-- 1. `financial_entries.contact_id` e `lead_id`, opcionais, `on delete set
--    null`: apagar o contato não apaga o dinheiro que passou (cascata fantasma,
--    anti-pattern 7). A anonimização de LGPD não apaga o contato, então o
--    vínculo sobrevive a ela apontando para "Cliente Anonimizado #N".
-- 2. Índice ÚNICO parcial em `lead_id`: um negócio ganho vira UMA conta a
--    receber. É a trava do clique duplo na sugestão do Painel, e é também o que
--    a sugestão consulta para sumir depois de aceita. Coluna nova, sem dado
--    antigo — não há o que deduplicar antes do índice.
-- 3. `recurring_entries.contact_id` (o cron copia para a linha gerada) e
--    `starts_on` (nulo = vale desde sempre, o comportamento de antes).
-- 4. `fn_financeiro_vinculo_da_mesma_org`: a FK diz que o contato EXISTE, não
--    que ele é DESTA organização. Sem o gatilho, quem conhece o UUID de um
--    contato de outro tenant o amarraria ao próprio caixa. `security invoker`
--    de propósito: sob a sessão de quem escreve, a RLS de `contacts` já esconde
--    o contato alheio e o `exists` dá falso; sob a service role (cron,
--    importação) a comparação de `organization_id` é a mesma régua.
--
-- Idempotente: `add column if not exists`, `create index if not exists`,
-- `create or replace function`, `drop trigger if exists` + `create trigger`.

alter table public.financial_entries
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;
alter table public.financial_entries
  add column if not exists lead_id uuid references public.crm_leads(id) on delete set null;

create index if not exists financial_entries_contato_idx
  on public.financial_entries (organization_id, contact_id)
  where contact_id is not null;

create unique index if not exists financial_entries_lead_unico_idx
  on public.financial_entries (lead_id)
  where lead_id is not null;

alter table public.recurring_entries
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;
alter table public.recurring_entries
  add column if not exists starts_on date;

create or replace function public.fn_financeiro_vinculo_da_mesma_org()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.contact_id is not null and not exists (
    select 1 from public.contacts c
     where c.id = new.contact_id and c.organization_id = new.organization_id
  ) then
    raise exception 'vinculo_de_outra_organizacao'
      using errcode = '23503',
            hint = 'O contato informado não existe nesta organização.';
  end if;

  -- `if` ANINHADO e não `and`: `recurring_entries` não tem `lead_id`, e o
  -- plpgsql resolve `new.lead_id` ao preparar a expressão — num `and` ele
  -- falharia na tabela que não tem a coluna mesmo com o primeiro termo falso.
  if tg_table_name = 'financial_entries' then
    if new.lead_id is not null and not exists (
      select 1 from public.crm_leads l
       where l.id = new.lead_id and l.organization_id = new.organization_id
    ) then
      raise exception 'vinculo_de_outra_organizacao'
        using errcode = '23503',
              hint = 'O negócio informado não existe nesta organização.';
    end if;
  end if;

  return new;
end $$;

-- Gatilho dispara sem checar EXECUTE; ninguém precisa chamá-la direto.
revoke execute on function public.fn_financeiro_vinculo_da_mesma_org() from public, anon, authenticated;
grant execute on function public.fn_financeiro_vinculo_da_mesma_org() to service_role;

drop trigger if exists trg_financial_entries_vinculo on public.financial_entries;
create trigger trg_financial_entries_vinculo
  before insert or update of contact_id, lead_id, organization_id on public.financial_entries
  for each row execute function public.fn_financeiro_vinculo_da_mesma_org();

drop trigger if exists trg_recurring_entries_vinculo on public.recurring_entries;
create trigger trg_recurring_entries_vinculo
  before insert or update of contact_id, organization_id on public.recurring_entries
  for each row execute function public.fn_financeiro_vinculo_da_mesma_org();

comment on column public.financial_entries.contact_id is
  'De quem é o dinheiro (opcional). `on delete set null`: o lançamento sobrevive ao contato.';
comment on column public.financial_entries.lead_id is
  'O negócio ganho que originou esta conta a receber. Único: um ganho vira UM lançamento.';
comment on column public.recurring_entries.starts_on is
  'Primeira competência válida do molde. Nulo = sem início (o comportamento anterior à 0626).';
