/**
 * OS LANÇAMENTOS — o dinheiro que não veio de comanda.
 *
 * Até aqui `financial_entries` só nascia de `fn_finalizar_comanda`. Consequência
 * prática: o relatório de faturamento tinha uma linha "Saiu" que era zero para
 * sempre, porque não havia como registrar aluguel, material ou salário. Metade
 * do financeiro existia.
 *
 * ⚠️ SÓ ENTRADA MANUAL, nunca de comanda. `origin` é gravado como `'manual'` e
 * não vem do corpo: deixar quem chama escolher `'sale'` permitiria criar uma
 * entrada que o relatório conta como venda sem existir comanda nenhuma por trás.
 *
 * ⚠️ "MENSAL" CRIA O MOLDE E A PRIMEIRA LINHA, juntos. O molde (`recurring_entries`)
 * começa na data escolhida (`starts_on`, 0626) e a primeira competência já nasce
 * gravada, ligada a ele — o índice único `(recurring_entry_id, entry_date)` impede
 * o cron de gerá-la de novo. Escrever molde é `manager` pela RLS, e a rota cobra
 * o mesmo degrau só quando o pedido é mensal.
 *
 * ⚠️ CLIENT DE SESSÃO. A RLS já diz que escrever exige `agent`, e a rota cobra o
 * mesmo degrau de propósito — pedir `manager` aqui criaria uma segunda régua, e
 * quem chamasse com um token de servidor passaria pela RLS mesmo assim.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { ROLE_RANK } from "@/lib/auth/types";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const LIMITE_MAXIMO = 500;

const criarSchema = z.object({
  account_id: z.string().uuid(),
  account_plan_id: z.string().uuid().nullish(),
  direction: z.enum(["in", "out"]),
  // O CHECK do banco exige positivo, e quem dá o sinal é `direction`. Recusar
  // zero aqui é o mesmo motivo: um lançamento de R$ 0,00 não é dinheiro, é ruído
  // no extrato.
  amount_cents: z.number().int().min(1).max(1_000_000_000),
  description: z.string().min(1).max(300),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  status: z.enum(["pending", "paid"]).default("pending"),
  /** De quem é o dinheiro (0626). A organização é conferida pelo gatilho do banco. */
  contact_id: z.string().uuid().nullish(),
  /** O negócio ganho que este lançamento cobra. Único no banco: um ganho, um lançamento. */
  lead_id: z.string().uuid().nullish(),
  /** `mensal` cria também o molde recorrente que começa nesta data. */
  repetir: z.enum(["unico", "mensal"]).default("unico"),
});

/** O nome do molde é a descrição do lançamento, no limite que o catálogo aceita. */
const LIMITE_DO_NOME_DO_MOLDE = 80;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "financeiro" });
  if (!authz.ok) return authz.response;

  const url = new URL(req.url);
  const de = url.searchParams.get("de");
  const ate = url.searchParams.get("ate");
  const status = url.searchParams.get("status");

  const supabase = await createClient();
  let q = supabase
    .from("financial_entries")
    .select(
      "id, account_id, account_plan_id, sale_id, contact_id, lead_id, recurring_entry_id, direction, amount_cents, currency, description, entry_date, status, paid_at, origin, reverses_entry_id, created_at",
    )
    .order("entry_date", { ascending: false })
    .limit(LIMITE_MAXIMO);

  if (de) q = q.gte("entry_date", de);
  if (ate) q = q.lte("entry_date", ate);
  if (status === "pending" || status === "paid") q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return fail("internal_error", error.message, 500, { requestId });

  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("agent", { requestId, resource: "financeiro" });
  if (!authz.ok) return authz.response;

  const lido = criarSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }

  const mensal = lido.data.repetir === "mensal";
  if (mensal && ROLE_RANK[authz.org.role] < ROLE_RANK.manager) {
    return fail("forbidden_role", "Lançamento mensal cria uma recorrência, e isso exige gestor.", 403, {
      requestId,
    });
  }

  const supabase = await createClient();

  let moldeId: string | null = null;
  if (mensal) {
    const { data: molde, error: erroMolde } = await supabase
      .from("recurring_entries")
      .insert({
        organization_id: authz.org.orgId,
        name: lido.data.description.slice(0, LIMITE_DO_NOME_DO_MOLDE),
        account_id: lido.data.account_id,
        account_plan_id: lido.data.account_plan_id ?? null,
        contact_id: lido.data.contact_id ?? null,
        direction: lido.data.direction,
        amount_cents: lido.data.amount_cents,
        day_of_month: Number(lido.data.entry_date.slice(8, 10)),
        starts_on: lido.data.entry_date,
        created_by_user_id: authz.user.id,
      })
      .select("id")
      .single();
    if (erroMolde) {
      if (erroMolde.code === "23503") {
        return fail("validation_failed", "Conta, categoria ou contato inválido.", 422, { requestId });
      }
      return fail("internal_error", erroMolde.message, 500, { requestId });
    }
    moldeId = molde.id;
  }

  const { data, error } = await supabase
    .from("financial_entries")
    .insert({
      organization_id: authz.org.orgId,
      account_id: lido.data.account_id,
      account_plan_id: lido.data.account_plan_id ?? null,
      contact_id: lido.data.contact_id ?? null,
      lead_id: lido.data.lead_id ?? null,
      direction: lido.data.direction,
      amount_cents: lido.data.amount_cents,
      description: lido.data.description,
      entry_date: lido.data.entry_date,
      status: lido.data.status,
      // Nasce pago só se quem lançou disse que já pagou. `paid_at` acompanha o
      // status e não vem do corpo: uma data de pagamento que não corresponde ao
      // status é a linha que faz o relatório e o extrato contarem histórias
      // diferentes.
      paid_at: lido.data.status === "paid" ? new Date().toISOString() : null,
      // A primeira competência de um molde é `recurring` como as que o cron
      // gera depois: é a mesma série, e o extrato a mostra igual.
      origin: moldeId ? "recurring" : "manual",
      recurring_entry_id: moldeId,
      created_by_user_id: authz.user.id,
    })
    .select("id, direction, amount_cents, status, entry_date, recurring_entry_id")
    .single();

  if (error) {
    // Sem a linha, o molde recém-criado seria uma recorrência que ninguém pediu
    // sozinha. Não há transação no client; desfazer é a compensação possível.
    if (moldeId) await supabase.from("recurring_entries").delete().eq("id", moldeId);
    // 23505 = o índice único de `lead_id`: este negócio já foi lançado.
    if (error.code === "23505") {
      return fail("state_conflict", "Este negócio já foi lançado no caixa.", 409, { requestId });
    }
    // 23503 = a conta, a categoria, o contato ou o negócio não existe nesta
    // organização (a FK ou o gatilho da 0626). Sem a tradução, chegaria como 500
    // e a pessoa não saberia que basta escolher outro.
    if (error.code === "23503") {
      return fail("validation_failed", "Conta, categoria, contato ou negócio inválido.", 422, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  await audit({
    action: "financeiro.lancamento_criado",
    resourceType: "financial_entry",
    resourceId: data.id,
    requestId,
    metadata: {
      direction: data.direction,
      amount_cents: data.amount_cents,
      status: data.status,
      mensal,
      recurring_entry_id: data.recurring_entry_id,
      lead_id: lido.data.lead_id ?? null,
    },
  });

  return ok(data, { requestId });
}
