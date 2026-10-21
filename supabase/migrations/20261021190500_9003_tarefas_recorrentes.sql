-- manifest: Tarefas recorrentes mensais — `task_recurrences` (o molde: título, responsável, cliente, dia do mês, horário, antecedência) e `crm_tasks.recurrence_id`/`recurrence_due` com índice único que impede gerar duas vezes a tarefa do mesmo mês; RLS por organização e redação na anonimização.
-- 9003 — a tarefa que volta todo mês.
--
-- ═══ O PROBLEMA ═══
--
-- O trabalho com cada cliente tem obrigação que se repete (relatório do mês,
-- reunião de acompanhamento, fechamento de campanha). A tarefa do CRM nasce uma
-- vez; repetir dependia de alguém lembrar de criar a do mês seguinte.
--
-- ═══ O QUE ENTRA ═══
--
-- 1. `task_recurrences`: o MOLDE. Dia do mês (1–31; em mês mais curto cai no
--    último dia), horário, e com quantos dias de antecedência a tarefa aparece.
-- 2. `crm_tasks.recurrence_id` + `recurrence_due` (a data do mês que aquela
--    tarefa cumpre). Índice ÚNICO no par: o cron diário e a criação pela tela
--    podem tentar a mesma competência, e só uma linha nasce — é o mesmo desenho
--    de `financial_entries` (recurring_entry_id, entry_date).
-- 3. A tarefa do mês NASCE mesmo que a do mês anterior não tenha sido feita
--    (decisão do dono): obrigação mensal não some porque a anterior atrasou.
-- 4. LGPD: anonimizar o contato redige o título e a descrição dos moldes dele,
--    como o gatilho da 0680 já faz com as tarefas.
--
-- Idempotente: `if not exists`, `create or replace`, `drop ... if exists`.

create table if not exists public.task_recurrences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  description text,
  priority text not null default 'medium',
  assigned_to uuid references auth.users(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete cascade,
  lead_id uuid references public.crm_leads(id) on delete set null,
  day_of_month integer not null,
  due_time text not null default '09:00',
  lead_days integer not null default 3,
  starts_on date not null default current_date,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_recurrences_titulo_nao_vazio check (length(btrim(title)) > 0),
  constraint task_recurrences_priority_check check (priority in ('low','medium','high','urgent')),
  constraint task_recurrences_dia_check check (day_of_month between 1 and 31),
  constraint task_recurrences_hora_check check (due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint task_recurrences_antecedencia_check check (lead_days between 0 and 28)
);

create index if not exists task_recurrences_org_ativas_idx
  on public.task_recurrences (organization_id) where is_active;

alter table public.crm_tasks
  add column if not exists recurrence_id uuid references public.task_recurrences(id) on delete set null;
alter table public.crm_tasks
  add column if not exists recurrence_due date;

create unique index if not exists crm_tasks_recorrencia_mes_unico_idx
  on public.crm_tasks (recurrence_id, recurrence_due)
  where recurrence_id is not null;

drop trigger if exists trg_task_recurrences_updated_at on public.task_recurrences;
create trigger trg_task_recurrences_updated_at
  before update on public.task_recurrences
  for each row execute function public.fn_set_updated_at();

-- ─── Vínculos da mesma organização ─────────────────────────────────────────

create or replace function public.fn_tarefas_recorrentes_vinculo_da_mesma_org()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.contact_id is not null and not exists (
    select 1 from public.contacts c
     where c.id = new.contact_id and c.organization_id = new.organization_id
  ) then
    raise exception 'vinculo_de_outra_organizacao' using errcode = '23503',
      hint = 'O contato informado não existe nesta organização.';
  end if;
  if new.lead_id is not null and not exists (
    select 1 from public.crm_leads l
     where l.id = new.lead_id and l.organization_id = new.organization_id
  ) then
    raise exception 'vinculo_de_outra_organizacao' using errcode = '23503',
      hint = 'O negócio informado não existe nesta organização.';
  end if;
  return new;
end $$;

revoke execute on function public.fn_tarefas_recorrentes_vinculo_da_mesma_org() from public, anon, authenticated;
grant execute on function public.fn_tarefas_recorrentes_vinculo_da_mesma_org() to service_role;

drop trigger if exists trg_task_recurrences_vinculo on public.task_recurrences;
create trigger trg_task_recurrences_vinculo
  before insert or update of contact_id, lead_id, organization_id on public.task_recurrences
  for each row execute function public.fn_tarefas_recorrentes_vinculo_da_mesma_org();

-- ─── LGPD ──────────────────────────────────────────────────────────────────

create or replace function public.fn_redigir_recorrencias_do_contato_anonimizado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.task_recurrences
     set title = 'Tarefa recorrente anonimizada',
         description = null
   where organization_id = new.organization_id
     and contact_id = new.id;
  return new;
end $$;

revoke execute on function public.fn_redigir_recorrencias_do_contato_anonimizado() from public, anon, authenticated;
grant execute on function public.fn_redigir_recorrencias_do_contato_anonimizado() to service_role;

drop trigger if exists trg_redigir_recorrencias_ao_anonimizar on public.contacts;
create trigger trg_redigir_recorrencias_ao_anonimizar
  after update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized is true and old.is_anonymized is distinct from true)
  execute function public.fn_redigir_recorrencias_do_contato_anonimizado();

-- ─── RLS e grants ──────────────────────────────────────────────────────────

alter table public.task_recurrences enable row level security;

drop policy if exists tenant_isolation_task_recurrences_select on public.task_recurrences;
create policy tenant_isolation_task_recurrences_select on public.task_recurrences
  for select using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists tenant_isolation_task_recurrences_write on public.task_recurrences;
create policy tenant_isolation_task_recurrences_write on public.task_recurrences
  for all using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
  );

revoke all on public.task_recurrences from anon;
grant select, insert, update, delete on public.task_recurrences to authenticated;
grant all on public.task_recurrences to service_role;

comment on table public.task_recurrences is
  'Molde de tarefa mensal. O cron recurring-tasks cria a crm_tasks de cada mês lead_days antes do dia; o índice único (recurrence_id, recurrence_due) impede duplicar.';
comment on column public.crm_tasks.recurrence_due is
  'A data do mês que esta tarefa cumpre, quando ela nasceu de uma task_recurrences.';
