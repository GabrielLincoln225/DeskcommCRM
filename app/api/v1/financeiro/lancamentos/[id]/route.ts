/**
 * Um lançamento: pagar, corrigir, ou apagar enquanto ainda não é dinheiro.
 *
 * ⚠️ CORRIGIR TEM DOIS DEGRAUS, e o segundo é do banco. Pendente aceita tudo
 * (descrição, categoria, cliente, valor, data, direção). Pago aceita só o que
 * não muda o dinheiro — descrição, categoria e cliente —, porque valor, data e
 * direção de um pago são barrados pelo gatilho abaixo. A rota recusa antes, com
 * a frase certa.
 *
 * ⚠️ PAGO É IMUTÁVEL, e quem garante isso é o TRIGGER
 * `fn_lancamento_pago_e_imutavel`, não esta rota. As checagens aqui existem para
 * a recusa chegar com nome e em português; se alguém contornar a rota, o banco
 * continua recusando.
 *
 * ⚠️ DELETE SÓ DE PENDENTE, e é o mesmo raciocínio do item de comanda aberta: um
 * lançamento pendente ainda não é dinheiro que passou. Depois de pago ele é
 * história, e o caminho de desfazer é um contra-lançamento — nunca o delete.
 *
 * ⚠️ LANÇAMENTO DE COMANDA NÃO SE MEXE POR AQUI. `origin <> 'manual'` é recusado
 * mesmo quando pendente: quem o criou foi a finalização, e apagá-lo deixaria a
 * comanda finalizada sem a entrada correspondente — os dois números divergindo
 * em silêncio, que é exatamente o que o módulo inteiro existe para impedir.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const pagarSchema = z.object({
  /** Pendente vira pago. Nunca o contrário. */
  pay: z.literal(true),
});

const corrigirSchema = z
  .object({
    description: z.string().trim().min(1).max(300).optional(),
    account_plan_id: z.string().uuid().nullable().optional(),
    contact_id: z.string().uuid().nullable().optional(),
    amount_cents: z.number().int().min(1).max(1_000_000_000).optional(),
    entry_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
      .optional(),
    direction: z.enum(["in", "out"]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nada para alterar." });

/** O que muda o dinheiro — e por isso não muda depois de pago. */
const CAMPOS_DO_DINHEIRO = ["amount_cents", "entry_date", "direction"] as const;

const alterarSchema = z.union([pagarSchema, corrigirSchema]);

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("agent", { requestId, resource: "financeiro" });
  if (!authz.ok) return authz.response;

  const lido = alterarSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }

  const { id } = await ctx.params;
  const supabase = await createClient();

  const { data: atual } = await supabase
    .from("financial_entries")
    .select("id, status, origin, amount_cents, direction")
    .eq("id", id)
    .maybeSingle();
  if (!atual) return fail("not_found", "Lançamento não encontrado.", 404, { requestId });

  if (!("pay" in lido.data)) {
    return corrigir(id, atual, lido.data, requestId);
  }

  if (atual.status === "paid") {
    // Não é erro do usuário: ele clicou duas vezes. Devolver o mesmo desfecho é
    // melhor que um 409 que a tela teria de explicar.
    return ok({ id, status: "paid", ja_pago: true }, { requestId });
  }

  const { error } = await supabase
    .from("financial_entries")
    .update({ status: "paid", paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  await audit({
    action: "financeiro.lancamento_pago",
    resourceType: "financial_entry",
    resourceId: id,
    requestId,
    metadata: { amount_cents: atual.amount_cents, direction: atual.direction },
  });

  return ok({ id, status: "paid" }, { requestId });
}

async function corrigir(
  id: string,
  atual: { status: string; origin: string; amount_cents: number; direction: string },
  campos: z.infer<typeof corrigirSchema>,
  requestId: string,
): Promise<Response> {
  if (atual.origin === "sale" || atual.origin === "reversal") {
    return fail(
      "state_conflict",
      "Este lançamento veio de uma comanda. Para corrigir, estorne a comanda.",
      409,
      { requestId },
    );
  }
  if (atual.status === "paid" && CAMPOS_DO_DINHEIRO.some((c) => c in campos)) {
    return fail(
      "state_conflict",
      "Lançamento pago não muda de valor, data ou tipo. Para desfazer, registre um lançamento contrário.",
      409,
      { requestId },
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("financial_entries")
    .update({ ...campos, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    if (error.code === "23503") {
      return fail("validation_failed", "Categoria ou contato inválido.", 422, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  await audit({
    action: "financeiro.lancamento_corrigido",
    resourceType: "financial_entry",
    resourceId: id,
    requestId,
    // Os NOMES dos campos, não os valores: a descrição é texto livre e pode ter
    // nome de pessoa, e o audit é append-only — não há como apagar depois.
    metadata: { campos: Object.keys(campos), status: atual.status },
  });

  return ok({ id, corrigido: true }, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("agent", { requestId, resource: "financeiro" });
  if (!authz.ok) return authz.response;

  const { id } = await ctx.params;
  const supabase = await createClient();

  const { data: atual } = await supabase
    .from("financial_entries")
    .select("id, status, origin, amount_cents")
    .eq("id", id)
    .maybeSingle();
  if (!atual) return fail("not_found", "Lançamento não encontrado.", 404, { requestId });

  if (atual.status === "paid") {
    return fail(
      "conflict",
      "Lançamento pago não se apaga. Para desfazer, registre um lançamento contrário.",
      409,
      { requestId },
    );
  }
  if (atual.origin === "recurring") {
    return fail(
      "conflict",
      "Este lançamento é de uma recorrência. Para parar de gerá-lo, desative a recorrência em Configurações › Financeiro.",
      409,
      { requestId },
    );
  }
  if (atual.origin !== "manual") {
    return fail(
      "conflict",
      "Este lançamento veio de uma comanda. Para desfazer, estorne a comanda.",
      409,
      { requestId },
    );
  }

  const { error } = await supabase.from("financial_entries").delete().eq("id", id);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  await audit({
    action: "financeiro.lancamento_removido",
    resourceType: "financial_entry",
    resourceId: id,
    requestId,
    metadata: { amount_cents: atual.amount_cents },
  });

  return ok({ id, removed: true }, { requestId });
}
