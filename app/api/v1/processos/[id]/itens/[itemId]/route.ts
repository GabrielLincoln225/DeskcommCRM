/**
 * UM ITEM DO CHECKLIST — marcar/desmarcar como feito, responsável, prazo e
 * observação.
 *
 * Marcar grava QUEM e QUANDO (`done_by`, `done_at`) a partir da sessão, nunca
 * do corpo. Desmarcar apaga os dois: o item volta a estar em aberto.
 *
 * O responsável tem de ser membro da organização: o banco só sabe que o
 * usuário existe, e um uuid de fora daria um "responsável" que ninguém vê.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { COLUNAS_DO_ITEM } from "@/lib/processos/leitura";
import { alterarItemSchema } from "@/lib/processos/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "processos" });
  if (!authz.ok) return authz.response;

  const { id, itemId } = await ctx.params;
  if (!UUID_RX.test(id) || !UUID_RX.test(itemId)) {
    return fail("invalid_request", "id inválido.", 400, { requestId });
  }

  const lido = alterarItemSchema.safeParse(await req.json().catch(() => null));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "Campos inválidos.", 422, { requestId });
  }
  const orgId = authz.org.orgId;
  const supabase = await createClient();

  const { done, ...resto } = lido.data;
  if (resto.assignee_user_id) {
    // A RLS de `user_organizations` só mostra a um agent o próprio vínculo: a
    // checagem usa o admin client com o filtro da organização da SESSÃO.
    const { data: membro } = await createAdminClient()
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("user_id", resto.assignee_user_id)
      .is("revoked_at", null)
      .maybeSingle();
    if (!membro) return fail("validation_failed", "Responsável não é da equipe.", 422, { requestId });
  }

  const mudanca: Record<string, unknown> = { ...resto };
  if (resto.note !== undefined) mudanca.note = resto.note || null;
  if (done === true) {
    mudanca.done_at = new Date().toISOString();
    mudanca.done_by = authz.user.id;
  } else if (done === false) {
    mudanca.done_at = null;
    mudanca.done_by = null;
  }

  const { data, error } = await supabase
    .from("client_process_items")
    .update(mudanca)
    .eq("id", itemId)
    .eq("process_id", id)
    .eq("organization_id", orgId)
    .select(COLUNAS_DO_ITEM);
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data || data.length === 0) return fail("not_found", "Item não encontrado.", 404, { requestId });

  void audit({
    action: "processos.item_alterado",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "client_process_item",
    resourceId: itemId,
    requestId,
    // Os NOMES dos campos, não a observação: é texto livre e o audit é append-only.
    metadata: { process_id: id, campos: Object.keys(lido.data), feito: done ?? null },
  });

  return ok(data[0], { requestId });
}
