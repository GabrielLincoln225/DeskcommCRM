import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * O LANÇAMENTO SÓ SE LIGA A CLIENTE E NEGÓCIO DA PRÓPRIA ORGANIZAÇÃO (0624).
 *
 * `financial_entries.contact_id`/`lead_id` e `recurring_entries.contact_id` têm
 * FK — e FK diz que a linha EXISTE, não que ela é DESTE tenant. Sem o gatilho
 * `fn_financeiro_vinculo_da_mesma_org`, quem conhece o UUID de um contato da
 * organização B o amarraria ao caixa da A, e a rota do Caixa passaria a buscar
 * (e mostrar) o nome dele.
 *
 * Três pontas medidas:
 *
 *   1. a SESSÃO (`authenticated`, admin da A) não liga contato nem negócio da B
 *      — nem no insert, nem num update que troca o vínculo;
 *   2. a SERVICE ROLE (cron, importação) também não: o gatilho compara
 *      `organization_id`, não depende da RLS para recusar;
 *   3. o negócio ganho vira UM lançamento (`financial_entries_lead_unico_idx`).
 *
 * E o caminho feliz, sem o qual os três acima seriam verdes por vacuidade: o
 * contato e o negócio DA PRÓPRIA organização passam.
 */

const ORG_A = "f2f2f2f2-0000-4000-8000-000000000001";
const ORG_B = "f2f2f2f2-0000-4000-8000-000000000002";
const ADMIN_A = "f2f2f2f2-1111-4000-8000-000000000001";

const CONTA_A = "f2f2f2f2-2222-4000-8000-000000000001";
const CONTATO_A = "f2f2f2f2-4444-4000-8000-000000000001";
const CONTATO_B = "f2f2f2f2-4444-4000-8000-000000000002";
const NEGOCIO_A = "f2f2f2f2-5555-4000-8000-000000000001";
const NEGOCIO_B = "f2f2f2f2-5555-4000-8000-000000000002";
const LANCAMENTO_A = "f2f2f2f2-6666-4000-8000-000000000001";

function comoAdminDaA(script: string): string {
  return sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${ADMIN_A}"}', false);
    ${script}
  `);
}

function lancamento(id: string, extra: string): string {
  return `insert into public.financial_entries
    (id, organization_id, account_id, direction, amount_cents, description, entry_date, status ${extra.split("|")[0]})
    values ('${id}', '${ORG_A}', '${CONTA_A}', 'in', 10000, 'invariante', '2026-10-10', 'pending' ${extra.split("|")[1]});`;
}

/** Erro do psql como texto, para casar a mensagem do gatilho ou do índice. */
function falha(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return String((err as { stderr?: string }).stderr ?? err);
  }
  return "";
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${ADMIN_A}', 'fin-vinculo-admin-a@invariant.test')
      on conflict (id) do nothing;

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'fin-vinculo-a', 'Financeiro Vinculo A', 'Fin Vinc A'),
      ('${ORG_B}', 'fin-vinculo-b', 'Financeiro Vinculo B', 'Fin Vinc B')
      on conflict (id) do nothing;

    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${ADMIN_A}', '${ORG_A}', 'admin', now())
      on conflict do nothing;

    insert into public.financial_accounts (id, organization_id, name) values
      ('${CONTA_A}', '${ORG_A}', 'Caixa invariante A')
      on conflict (id) do nothing;

    insert into public.contacts (id, organization_id, name) values
      ('${CONTATO_A}', '${ORG_A}', 'Cliente invariante A'),
      ('${CONTATO_B}', '${ORG_B}', 'Cliente invariante B')
      on conflict (id) do nothing;

    -- O funil e as etapas vêm do gatilho que semeia toda organização nova; o
    -- negócio entra na primeira etapa dele, como entraria pela tela.
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, value_cents)
      select '${NEGOCIO_A}', s.organization_id, s.pipeline_id, s.id, 'Negócio A', 10000
        from public.crm_stages s where s.organization_id = '${ORG_A}'
        order by s.position limit 1
      on conflict (id) do nothing;
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, value_cents)
      select '${NEGOCIO_B}', s.organization_id, s.pipeline_id, s.id, 'Negócio B', 10000
        from public.crm_stages s where s.organization_id = '${ORG_B}'
        order by s.position limit 1
      on conflict (id) do nothing;
  `);
});

describe("o caminho feliz — sem ele o resto seria verde por vacuidade", () => {
  it("o admin da A lança com contato e negócio da A", () => {
    comoAdminDaA(lancamento(LANCAMENTO_A, `, contact_id, lead_id|, '${CONTATO_A}', '${NEGOCIO_A}'`));
    const n = lastLine(
      sql(`select count(*) from public.financial_entries where id = '${LANCAMENTO_A}' and contact_id = '${CONTATO_A}';`),
    );
    expect(n).toBe("1");
  });
});

describe("a sessão não amarra o que é de outra organização", () => {
  it("contato da B num lançamento da A é recusado", () => {
    const erro = falha(() =>
      comoAdminDaA(lancamento("f2f2f2f2-6666-4000-8000-000000000002", `, contact_id|, '${CONTATO_B}'`)),
    );
    expect(erro).toContain("vinculo_de_outra_organizacao");
  });

  it("negócio da B num lançamento da A é recusado", () => {
    const erro = falha(() =>
      comoAdminDaA(lancamento("f2f2f2f2-6666-4000-8000-000000000003", `, lead_id|, '${NEGOCIO_B}'`)),
    );
    expect(erro).toContain("vinculo_de_outra_organizacao");
  });

  it("trocar o vínculo para um contato da B num update também é recusado", () => {
    const erro = falha(() =>
      comoAdminDaA(
        `update public.financial_entries set contact_id = '${CONTATO_B}' where id = '${LANCAMENTO_A}';`,
      ),
    );
    expect(erro).toContain("vinculo_de_outra_organizacao");
  });

  it("o molde recorrente da A não aceita contato da B", () => {
    const erro = falha(() =>
      comoAdminDaA(`insert into public.recurring_entries
        (organization_id, name, account_id, direction, amount_cents, day_of_month, contact_id)
        values ('${ORG_A}', 'Mensalidade', '${CONTA_A}', 'in', 5000, 15, '${CONTATO_B}');`),
    );
    expect(erro).toContain("vinculo_de_outra_organizacao");
  });
});

describe("a service role também não — o gatilho não depende da RLS", () => {
  it("como dono do banco, contato da B num lançamento da A é recusado", () => {
    const erro = falha(() => sql(lancamento("f2f2f2f2-6666-4000-8000-000000000004", `, contact_id|, '${CONTATO_B}'`)));
    expect(erro).toContain("vinculo_de_outra_organizacao");
  });
});

describe("um negócio ganho vira UM lançamento", () => {
  it("o segundo lançamento do mesmo negócio bate no índice único", () => {
    const erro = falha(() =>
      comoAdminDaA(lancamento("f2f2f2f2-6666-4000-8000-000000000005", `, lead_id|, '${NEGOCIO_A}'`)),
    );
    expect(erro).toContain("financial_entries_lead_unico_idx");
  });
});

describe("o molde recorrente tem início", () => {
  it("`starts_on` existe e nasce nulo — o molde de antes da 0624 vale desde sempre", () => {
    const out = sql(`
      insert into public.recurring_entries (organization_id, name, account_id, direction, amount_cents, day_of_month)
        values ('${ORG_A}', 'Molde antigo', '${CONTA_A}', 'out', 5900, 8);
      select coalesce(starts_on::text, 'nulo') from public.recurring_entries
       where organization_id = '${ORG_A}' and name = 'Molde antigo' limit 1;
    `);
    expect(lastLine(out)).toBe("nulo");
  });
});
