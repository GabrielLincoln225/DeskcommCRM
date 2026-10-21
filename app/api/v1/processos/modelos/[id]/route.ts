/**
 * UM MODELO DE PROCESSO — editar (nome, etapa que abre, ativo, passos) e apagar.
 *
 * ⚠️ PASSOS SÃO SUBSTITUÍDOS INTEIROS quando vêm no corpo: a tela edita a lista
 * toda (renomear, reordenar, remover), e mandar a lista final é mais simples e
 * à prova de corrida do que diffs por passo. Processos JÁ ABERTOS não mudam —
 * eles guardam a cópia dos passos do dia em que abriram.
 *
 * ⚠️ APAGAR O MODELO não apaga processo nenhum: `client_processes.template_id`
 * é `on delete set null`, e o nome do processo é cópia.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { alterarModeloSchema } from "@/lib/processos/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "processos" });
  if (!authz.ok) return authz.response;

  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });

  const lido = alterarModeloSchema.safeParse(await req.json().catch(() => null));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "Campos inválidos.", 422, { requestId });
  }
  const orgId = authz.org.orgId;
  const supabase = await createClient();

  const { data: atual } = await supabase
    .from("process_templates")
    .select("id")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!atual) return fail("not_found", "Modelo não encontrado.", 404, { requestId });

  const { steps, ...campos } = lido.data;
  if (Object.keys(campos).length > 0) {
    const { error } = await supabase
      .from("process_templates")
      .update({
        ...campos,
        ...(campos.description !== undefined ? { description: campos.description ?? null } : {}),
      })
      .eq("id", id)
      .eq("organization_id", orgId);
    if (error) {
      if (error.code === "23505") {
        return fail("state_conflict", "Já existe um modelo com esse nome.", 409, { requestId });
      }
      if (error.code === "23503") {
        return fail("validation_failed", "A etapa escolhida não é desta organização.", 422, { requestId });
      }
      return fail("internal_error", error.message, 500, { requestId });
    }
  }

  if (steps) {
    const { error: erroApagar } = await supabase
      .from("process_template_steps")
      .delete()
      .eq("template_id", id)
      .eq("organization_id", orgId);
    if (erroApagar) return fail("internal_error", erroApagar.message, 500, { requestId });

    const { error: erroInserir } = await supabase.from("process_template_steps").insert(
      steps.map((s, i) => ({
        organization_id: orgId,
        template_id: id,
        title: s.title,
        position: i + 1,
        done_on_trigger: s.done_on_trigger,
      })),
    );
    if (erroInserir) return fail("internal_error", erroInserir.message, 500, { requestId });
  }

  void audit({
    action: "processos.modelo_alterado",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "process_template",
    resourceId: id,
    requestId,
    metadata: { campos: Object.keys(lido.data), passos: steps?.length ?? null },
  });

  return ok({ id }, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "processos" });
  if (!authz.ok) return authz.response;

  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("process_templates")
    .delete()
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .select("id");
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data || data.length === 0) return fail("not_found", "Modelo não encontrado.", 404, { requestId });

  void audit({
    action: "processos.modelo_removido",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "process_template",
    resourceId: id,
    requestId,
  });

  return ok({ id, removed: true }, { requestId });
}
