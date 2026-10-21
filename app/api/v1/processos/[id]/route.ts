/**
 * UM PROCESSO — o checklist inteiro (GET) e a situação dele (PATCH:
 * concluir, cancelar ou reabrir).
 *
 * Concluir não marca os itens: "concluído" é a decisão de que o processo
 * acabou, mesmo com algum passo que não se aplicou a este cliente. O checklist
 * continua mostrando o que foi e o que não foi feito.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { COLUNAS_DO_ITEM, COLUNAS_DO_PROCESSO } from "@/lib/processos/leitura";
import { hojeNoFuso, progressoDoProcesso } from "@/lib/processos/progresso";
import { alterarProcessoSchema } from "@/lib/processos/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "processos" });
  if (!authz.ok) return authz.response;

  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });
  const orgId = authz.org.orgId;
  const supabase = await createClient();

  const [{ data: processo, error }, { data: itens, error: erroItens }, { data: org }] = await Promise.all([
    supabase.from("client_processes").select(COLUNAS_DO_PROCESSO).eq("id", id).eq("organization_id", orgId).maybeSingle(),
    supabase
      .from("client_process_items")
      .select(COLUNAS_DO_ITEM)
      .eq("process_id", id)
      .eq("organization_id", orgId)
      .order("position", { ascending: true }),
    supabase.from("organizations").select("timezone").eq("id", orgId).maybeSingle(),
  ]);
  if (error || erroItens) return fail("internal_error", (error ?? erroItens)!.message, 500, { requestId });
  if (!processo) return fail("not_found", "Processo não encontrado.", 404, { requestId });

  const hoje = hojeNoFuso((org as { timezone?: string | null } | null)?.timezone);
  const lista = (itens ?? []) as Array<{ title: string; position: number; done_at: string | null; due_date: string | null }>;
  return ok(
    { hoje, processo: { ...(processo as object), progresso: progressoDoProcesso(lista, hoje) }, itens: lista },
    { requestId },
  );
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "processos" });
  if (!authz.ok) return authz.response;

  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });

  const lido = alterarProcessoSchema.safeParse(await req.json().catch(() => null));
  if (!lido.success) return fail("validation_failed", "Situação inválida.", 422, { requestId });

  const supabase = await createClient();
  const status = lido.data.status;
  const { data, error } = await supabase
    .from("client_processes")
    .update({ status, finished_at: status === "open" ? null : new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .select("id");
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data || data.length === 0) return fail("not_found", "Processo não encontrado.", 404, { requestId });

  void audit({
    action: "processos.processo_alterado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "client_process",
    resourceId: id,
    requestId,
    metadata: { status },
  });

  return ok({ id, status }, { requestId });
}
