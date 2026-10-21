-- manifest: Módulo Processos — modelos de processo (passos editáveis), processo aberto por contato com checklist (responsável, prazo, observação, quem marcou), abertura automática quando o negócio chega na etapa do modelo, RLS por organização e redação da observação na anonimização.
-- 9002 — o processo de cada cliente, com o checklist do que falta fazer.
--
-- ═══ O PROBLEMA ═══
--
-- Depois que o negócio fecha, o trabalho com o cliente segue uma sequência que
-- a equipe repete toda vez (contrato, grupo, formulário, onboarding,
-- planejamento...). O CRM não tinha onde ela morasse: as tarefas são soltas e
-- os planos de tarefa (#1752) aplicam a sequência ao NEGÓCIO, sem uma tela do
-- processo do CLIENTE com o que já foi feito, por quem, e o que falta.
--
-- ═══ O QUE ENTRA ═══
--
-- 1. `process_templates` + `process_template_steps`: o MODELO, editável pela
--    tela (admin). `trigger_stage_id` opcional: quando um negócio chega nessa
--    etapa, o processo abre sozinho para o contato dele. `done_on_trigger`
--    marca o passo como feito nessa abertura automática (os passos da venda já
--    aconteceram quando o negócio fecha).
-- 2. `client_processes` + `client_process_items`: a INSTÂNCIA, por contato.
--    Os passos são COPIADOS do modelo (título e ordem) — editar o modelo depois
--    não reescreve o que já foi combinado com um cliente.
-- 3. `fn_processos_abrir_pelo_funil`: gatilho em `crm_leads` (insert e troca de
--    etapa). Só faz INSERT no próprio banco — nenhum HTTP (anti-pattern 9).
--    Idempotente pelo índice único (modelo, negócio). Uma falha aqui NUNCA
--    impede mover o negócio: vira WARNING no log do Postgres.
-- 4. `fn_processos_vinculo_da_mesma_org`: contato, negócio e modelo têm de ser
--    desta organização (a FK só diz que existem).
-- 5. RLS: ler é de quem é da organização; escrever processo e item, de agent+;
--    escrever modelo, de admin.
-- 6. LGPD: anonimizar o contato apaga as observações dos itens dele (texto
--    livre, onde mora dado pessoal). Título, prazo e quem marcou ficam: é
--    registro de operação, não dado da pessoa.
--
-- Idempotente: `if not exists`, `create or replace`, `drop ... if exists`.

-- ─── Modelos ────────────────────────────────────────────────────────────────

create table if not exists public.process_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  trigger_stage_id uuid references public.crm_stages(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint process_templates_nome_nao_vazio check (length(btrim(name)) > 0)
);

create unique index if not exists process_templates_nome_unico_idx
  on public.process_templates (organization_id, lower(btrim(name)));

create table if not exists public.process_template_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id uuid not null references public.process_templates(id) on delete cascade,
  title text not null,
  position integer not null,
  done_on_trigger boolean not null default false,
  created_at timestamptz not null default now(),
  constraint process_template_steps_titulo_nao_vazio check (length(btrim(title)) > 0)
);

create index if not exists process_template_steps_modelo_idx
  on public.process_template_steps (template_id, position);

-- ─── Processos de cada cliente ─────────────────────────────────────────────

create table if not exists public.client_processes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- cascade: o processo é DO contato. Apagar o contato (que já leva conversa e
  -- mensagens junto) leva o checklist dele.
  contact_id uuid not null references public.contacts(id) on delete cascade,
  template_id uuid references public.process_templates(id) on delete set null,
  lead_id uuid references public.crm_leads(id) on delete set null,
  name text not null,
  origin text not null default 'manual',
  status text not null default 'open',
  started_by uuid references auth.users(id) on delete set null,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_processes_nome_nao_vazio check (length(btrim(name)) > 0),
  constraint client_processes_origin_check check (origin in ('manual', 'funil')),
  constraint client_processes_status_check check (status in ('open', 'done', 'cancelled'))
);

create index if not exists client_processes_org_status_idx
  on public.client_processes (organization_id, status);
create index if not exists client_processes_contato_idx
  on public.client_processes (contact_id);
-- A trava da abertura automática: o mesmo negócio não abre o mesmo modelo
-- duas vezes, mesmo que volte e passe de novo pela etapa.
create unique index if not exists client_processes_modelo_negocio_unico_idx
  on public.client_processes (template_id, lead_id)
  where lead_id is not null and template_id is not null;

create table if not exists public.client_process_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  process_id uuid not null references public.client_processes(id) on delete cascade,
  title text not null,
  position integer not null,
  assignee_user_id uuid references auth.users(id) on delete set null,
  due_date date,
  note text,
  done_at timestamptz,
  done_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_process_items_titulo_nao_vazio check (length(btrim(title)) > 0)
);

create index if not exists client_process_items_processo_idx
  on public.client_process_items (process_id, position);
create index if not exists client_process_items_prazo_idx
  on public.client_process_items (organization_id, due_date)
  where done_at is null and due_date is not null;

-- ─── updated_at ────────────────────────────────────────────────────────────

drop trigger if exists trg_process_templates_updated_at on public.process_templates;
create trigger trg_process_templates_updated_at
  before update on public.process_templates
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_client_processes_updated_at on public.client_processes;
create trigger trg_client_processes_updated_at
  before update on public.client_processes
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_client_process_items_updated_at on public.client_process_items;
create trigger trg_client_process_items_updated_at
  before update on public.client_process_items
  for each row execute function public.fn_set_updated_at();

-- ─── Vínculos da mesma organização ─────────────────────────────────────────

create or replace function public.fn_processos_vinculo_da_mesma_org()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'process_template_steps' then
    if not exists (
      select 1 from public.process_templates t
       where t.id = new.template_id and t.organization_id = new.organization_id
    ) then
      raise exception 'vinculo_de_outra_organizacao' using errcode = '23503';
    end if;
  elsif tg_table_name = 'process_templates' then
    if new.trigger_stage_id is not null and not exists (
      select 1 from public.crm_stages s
       where s.id = new.trigger_stage_id and s.organization_id = new.organization_id
    ) then
      raise exception 'vinculo_de_outra_organizacao' using errcode = '23503',
        hint = 'A etapa informada não é desta organização.';
    end if;
  elsif tg_table_name = 'client_processes' then
    if not exists (
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
    if new.template_id is not null and not exists (
      select 1 from public.process_templates t
       where t.id = new.template_id and t.organization_id = new.organization_id
    ) then
      raise exception 'vinculo_de_outra_organizacao' using errcode = '23503',
        hint = 'O modelo informado não é desta organização.';
    end if;
  elsif tg_table_name = 'client_process_items' then
    if not exists (
      select 1 from public.client_processes p
       where p.id = new.process_id and p.organization_id = new.organization_id
    ) then
      raise exception 'vinculo_de_outra_organizacao' using errcode = '23503';
    end if;
  end if;
  return new;
end $$;

revoke execute on function public.fn_processos_vinculo_da_mesma_org() from public, anon, authenticated;
grant execute on function public.fn_processos_vinculo_da_mesma_org() to service_role;

drop trigger if exists trg_process_templates_vinculo on public.process_templates;
create trigger trg_process_templates_vinculo
  before insert or update of trigger_stage_id, organization_id on public.process_templates
  for each row execute function public.fn_processos_vinculo_da_mesma_org();

drop trigger if exists trg_process_template_steps_vinculo on public.process_template_steps;
create trigger trg_process_template_steps_vinculo
  before insert or update of template_id, organization_id on public.process_template_steps
  for each row execute function public.fn_processos_vinculo_da_mesma_org();

drop trigger if exists trg_client_processes_vinculo on public.client_processes;
create trigger trg_client_processes_vinculo
  before insert or update of contact_id, lead_id, template_id, organization_id on public.client_processes
  for each row execute function public.fn_processos_vinculo_da_mesma_org();

drop trigger if exists trg_client_process_items_vinculo on public.client_process_items;
create trigger trg_client_process_items_vinculo
  before insert or update of process_id, organization_id on public.client_process_items
  for each row execute function public.fn_processos_vinculo_da_mesma_org();

-- ─── Abertura automática pelo funil ────────────────────────────────────────

create or replace function public.fn_processos_abrir_pelo_funil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
  v_processo uuid;
begin
  if new.contact_id is null or new.stage_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then
    return new;
  end if;

  for m in
    select t.id, t.name
      from public.process_templates t
     where t.organization_id = new.organization_id
       and t.is_active
       and t.trigger_stage_id = new.stage_id
  loop
    begin
      insert into public.client_processes
        (organization_id, contact_id, template_id, lead_id, name, origin)
      values
        (new.organization_id, new.contact_id, m.id, new.id, m.name, 'funil')
      on conflict (template_id, lead_id) where lead_id is not null and template_id is not null
      do nothing
      returning id into v_processo;

      if v_processo is not null then
        insert into public.client_process_items
          (organization_id, process_id, title, position, done_at)
        select new.organization_id, v_processo, s.title, s.position,
               case when s.done_on_trigger then now() else null end
          from public.process_template_steps s
         where s.template_id = m.id
         order by s.position;
      end if;
    exception when others then
      -- Mover o negócio é o que a pessoa pediu; o processo é consequência.
      raise warning 'processos: abertura automática falhou (lead %, modelo %): %',
        new.id, m.id, sqlerrm;
    end;
  end loop;

  return new;
end $$;

revoke execute on function public.fn_processos_abrir_pelo_funil() from public, anon, authenticated;
grant execute on function public.fn_processos_abrir_pelo_funil() to service_role;

drop trigger if exists trg_crm_leads_abre_processo on public.crm_leads;
create trigger trg_crm_leads_abre_processo
  after insert or update of stage_id on public.crm_leads
  for each row execute function public.fn_processos_abrir_pelo_funil();

-- ─── LGPD: a anonimização apaga as observações ─────────────────────────────

create or replace function public.fn_redigir_processos_do_contato_anonimizado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.client_process_items i
     set note = null
    from public.client_processes p
   where p.id = i.process_id
     and p.organization_id = new.organization_id
     and p.contact_id = new.id
     and i.note is not null;
  return new;
end $$;

revoke execute on function public.fn_redigir_processos_do_contato_anonimizado() from public, anon, authenticated;
grant execute on function public.fn_redigir_processos_do_contato_anonimizado() to service_role;

drop trigger if exists trg_redigir_processos_ao_anonimizar on public.contacts;
create trigger trg_redigir_processos_ao_anonimizar
  after update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized is true and old.is_anonymized is distinct from true)
  execute function public.fn_redigir_processos_do_contato_anonimizado();

-- ─── RLS e grants ──────────────────────────────────────────────────────────

alter table public.process_templates enable row level security;
alter table public.process_template_steps enable row level security;
alter table public.client_processes enable row level security;
alter table public.client_process_items enable row level security;

drop policy if exists tenant_isolation_process_templates_select on public.process_templates;
create policy tenant_isolation_process_templates_select on public.process_templates
  for select using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists tenant_isolation_process_templates_write on public.process_templates;
create policy tenant_isolation_process_templates_write on public.process_templates
  for all using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );

drop policy if exists tenant_isolation_process_template_steps_select on public.process_template_steps;
create policy tenant_isolation_process_template_steps_select on public.process_template_steps
  for select using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists tenant_isolation_process_template_steps_write on public.process_template_steps;
create policy tenant_isolation_process_template_steps_write on public.process_template_steps
  for all using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );

drop policy if exists tenant_isolation_client_processes_select on public.client_processes;
create policy tenant_isolation_client_processes_select on public.client_processes
  for select using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists tenant_isolation_client_processes_write on public.client_processes;
create policy tenant_isolation_client_processes_write on public.client_processes
  for all using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
  );

drop policy if exists tenant_isolation_client_process_items_select on public.client_process_items;
create policy tenant_isolation_client_process_items_select on public.client_process_items
  for select using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists tenant_isolation_client_process_items_write on public.client_process_items;
create policy tenant_isolation_client_process_items_write on public.client_process_items
  for all using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
  );

-- O default ACL do Supabase concede tudo a anon em toda tabela nova de public.
revoke all on public.process_templates from anon;
revoke all on public.process_template_steps from anon;
revoke all on public.client_processes from anon;
revoke all on public.client_process_items from anon;
grant select, insert, update, delete on public.process_templates to authenticated;
grant select, insert, update, delete on public.process_template_steps to authenticated;
grant select, insert, update, delete on public.client_processes to authenticated;
grant select, insert, update, delete on public.client_process_items to authenticated;
grant all on public.process_templates to service_role;
grant all on public.process_template_steps to service_role;
grant all on public.client_processes to service_role;
grant all on public.client_process_items to service_role;

comment on table public.process_templates is
  'Modelo de processo (ex.: Entrada de cliente). trigger_stage_id: a etapa do funil que abre o processo sozinho para o contato do negócio.';
comment on table public.client_processes is
  'Processo aberto para um contato. Os passos são cópia do modelo no momento da abertura — editar o modelo não reescreve processos já abertos.';
comment on column public.client_process_items.note is
  'Observação livre do item. Apagada quando o contato é anonimizado (trg_redigir_processos_ao_anonimizar).';
