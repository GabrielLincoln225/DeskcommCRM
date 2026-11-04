/**
 * LANÇAR UM PREVISTO — a linha que um molde mensal ainda ia gerar, gravada agora.
 *
 * `POST /api/v1/financeiro/previstos` `{ recurring_entry_id, entry_date, pagar }`.
 *
 * O Caixa mostra como "previsto" a competência que o cron só grava no dia. Sem
 * esta rota a linha não tinha ação nenhuma: o cliente pagava a mensalidade
 * antes do vencimento e não havia como marcar o recebimento até o cron rodar.
 * Aqui a competência nasce gravada — paga (`pagar: true`, o "confirmar") ou
 * pendente (para corrigir o valor antes de confirmar).
 *
 * ⚠️ A MESMA LINHA QUE O CRON GRAVARIA, nunca uma a mais. Os campos vêm do
 * MOLDE, não do corpo (o corpo só aponta qual molde e qual competência), e a
 * data tem de ser exatamente a competência que `competenciaDoMes` calcula para
 * aquele mês — a mesma regra do cron. O índice único
 * `(recurring_entry_id, entry_date)` faz o resto: quando o cron chegar, o
 * insert dele bate no índice e vira "já existia".
 *
 * ⚠️ IDEMPOTENTE PELO ÍNDICE. Se a linha já existe (o cron rodou, ou a pessoa
 * clicou duas vezes), não é erro: com `pagar` a linha pendente é paga; paga já
 * estava, devolve o mesmo desfecho.
 *
 * ⚠️ CLIENT DE SESSÃO. A RLS diz que escrever lançamento exige `agent` e ler
 * molde exige ser da organização; a rota cobra o mesmo degrau do PATCH de pagar.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { competenciaDoMes, moldeValeNaCompetencia } from "@/lib/financeiro/recorrencia";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const lancarSchema = z.object({
  recurring_entry_id: z.string().uuid(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  /** `true` = já foi recebido/pago (confirmar); `false` = grava pendente. */
  pagar: z.boolean(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("agent", { requestId, resource: "financeiro" });
  if (!authz.ok) return authz.response;

  const lido = lancarSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, { requestId });
  }
  const { recurring_entry_id, entry_date, pagar } = lido.data;

  const supabase = await createClient();
  const { data: molde } = await supabase
    .from("recurring_entries")
    .select(
      "id, account_id, account_plan_id, contact_id, direction, amount_cents, currency, name, day_of_month, starts_on, is_active",
    )
    .eq("id", recurring_entry_id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (!molde) return fail("not_found", "Recorrência não encontrada.", 404, { requestId });
  if (!molde.is_active) {
    return fail("state_conflict", "Esta recorrência está desativada.", 409, { requestId });
  }

  const [ano, mes] = entry_date.split("-").map(Number) as [number, number];
  const competencia = competenciaDoMes(ano, mes, molde.day_of_month as number);
  if (competencia !== entry_date || !moldeValeNaCompetencia(molde.starts_on as string | null, competencia)) {
    return fail("validation_failed", "Esta data não é uma competência desta recorrência.", 422, { requestId });
  }

  const agora = new Date().toISOString();
  const { data: criada, error } = await supabase
    .from("financial_entries")
    .insert({
      organization_id: authz.org.orgId,
      account_id: molde.account_id,
      account_plan_id: molde.account_plan_id,
      contact_id: molde.contact_id ?? null,
      direction: molde.direction,
      amount_cents: molde.amount_cents,
      currency: molde.currency,
      description: molde.name,
      entry_date: competencia,
      status: pagar ? "paid" : "pending",
      paid_at: pagar ? agora : null,
      origin: "recurring",
      recurring_entry_id: molde.id,
      created_by_user_id: authz.user.id,
    })
    .select("id, status")
    .single();

  if (!error) {
    await audit({
      action: pagar ? "financeiro.lancamento_pago" : "financeiro.lancamento_criado",
      resourceType: "financial_entry",
      resourceId: criada.id,
      requestId,
      metadata: {
        origem: "previsto",
        recurring_entry_id: molde.id,
        direction: molde.direction,
        amount_cents: molde.amount_cents,
        status: criada.status,
      },
    });
    return ok({ id: criada.id, status: criada.status, criado: true }, { requestId });
  }

  if (error.code !== "23505") {
    if (error.code === "23503") {
      return fail("validation_failed", "A conta ou a categoria da recorrência não existe mais.", 422, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  // 23505: a competência já foi gravada (o cron rodou, ou foi um clique duplo).
  const { data: existente } = await supabase
    .from("financial_entries")
    .select("id, status, amount_cents, direction")
    .eq("organization_id", authz.org.orgId)
    .eq("recurring_entry_id", molde.id)
    .eq("entry_date", competencia)
    .maybeSingle();
  if (!existente) return fail("internal_error", "Lançamento da competência não encontrado.", 500, { requestId });

  if (!pagar || existente.status === "paid") {
    return ok({ id: existente.id, status: existente.status, criado: false }, { requestId });
  }

  const { error: erroPagar } = await supabase
    .from("financial_entries")
    .update({ status: "paid", paid_at: agora, updated_at: agora })
    .eq("id", existente.id);
  if (erroPagar) return fail("internal_error", erroPagar.message, 500, { requestId });

  await audit({
    action: "financeiro.lancamento_pago",
    resourceType: "financial_entry",
    resourceId: existente.id,
    requestId,
    metadata: { origem: "previsto", amount_cents: existente.amount_cents, direction: existente.direction },
  });
  return ok({ id: existente.id, status: "paid", criado: false }, { requestId });
}
