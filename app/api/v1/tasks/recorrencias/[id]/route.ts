/**
 * UMA TAREFA RECORRENTE — pausar/retomar (PATCH `is_active`) e apagar.
 *
 * Apagar o molde NÃO apaga as tarefas que ele já gerou: elas são trabalho
 * combinado, com prazo e responsável (`crm_tasks.recurrence_id` é
 * `on delete set null`). Só param de nascer as próximas.
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
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const patchSchema = z.object({ is_active: z.boolean() }).strict();

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "tasks" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });

  const lido = patchSchema.safeParse(await req.json().catch(() => null));
  if (!lido.success) return fail("validation_failed", "Campos inválidos.", 422, { requestId });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_recurrences")
    .update({ is_active: lido.data.is_active })
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .select("id, is_active");
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data || data.length === 0) return fail("not_found", "Recorrência não encontrada.", 404, { requestId });

  void audit({
    action: "tarefas.recorrencia_alterada",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "task_recurrence",
    resourceId: id,
    requestId,
    metadata: { is_active: lido.data.is_active },
  });
  return ok(data[0], { requestId });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "tasks" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_recurrences")
    .delete()
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .select("id");
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data || data.length === 0) return fail("not_found", "Recorrência não encontrada.", 404, { requestId });

  void audit({
    action: "tarefas.recorrencia_removida",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "task_recurrence",
    resourceId: id,
    requestId,
  });
  return ok({ id, removed: true }, { requestId });
}
