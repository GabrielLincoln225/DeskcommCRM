/**
 * MODELOS DE PROCESSO — a sequência de passos que a equipe repete com cada
 * cliente (migration 9002).
 *
 * GET  — os modelos da organização, com os passos em ordem (toda a equipe lê:
 *        é o que aparece no "Iniciar processo").
 * POST — cria um modelo (admin).
 *
 * ⚠️ `organization_id` à mão mesmo com a RLS ligada (regra do CLAUDE.md): vem
 * da sessão, nunca do corpo.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { COLUNAS_DO_MODELO, modeloComPassos, type ModeloLido } from "@/lib/processos/leitura";
import { modeloSchema } from "@/lib/processos/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "processos" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("process_templates")
    .select(COLUNAS_DO_MODELO)
    .eq("organization_id", authz.org.orgId)
    .order("name", { ascending: true });
  if (error) return fail("internal_error", error.message, 500, { requestId });

  return ok(((data ?? []) as unknown as ModeloLido[]).map(modeloComPassos), { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "processos" });
  if (!authz.ok) return authz.response;

  const lido = modeloSchema.safeParse(await req.json().catch(() => null));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "Campos inválidos.", 422, { requestId });
  }
  const orgId = authz.org.orgId;
  const supabase = await createClient();

  const { data: modelo, error } = await supabase
    .from("process_templates")
    .insert({
      organization_id: orgId,
      name: lido.data.name,
      description: lido.data.description ?? null,
      trigger_stage_id: lido.data.trigger_stage_id ?? null,
      is_active: lido.data.is_active ?? true,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      return fail("state_conflict", "Já existe um modelo com esse nome.", 409, { requestId });
    }
    if (error.code === "23503") {
      return fail("validation_failed", "A etapa escolhida não é desta organização.", 422, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  const { error: erroPassos } = await supabase.from("process_template_steps").insert(
    lido.data.steps.map((s, i) => ({
      organization_id: orgId,
      template_id: modelo.id,
      title: s.title,
      position: i + 1,
      done_on_trigger: s.done_on_trigger,
    })),
  );
  if (erroPassos) {
    // Modelo sem passo não serve para nada: desfaz em vez de deixar meio gravado.
    await supabase.from("process_templates").delete().eq("id", modelo.id).eq("organization_id", orgId);
    return fail("internal_error", erroPassos.message, 500, { requestId });
  }

  void audit({
    action: "processos.modelo_criado",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "process_template",
    resourceId: modelo.id,
    requestId,
    metadata: { passos: lido.data.steps.length, abre_pelo_funil: Boolean(lido.data.trigger_stage_id) },
  });

  return ok({ id: modelo.id }, { requestId, status: 201 });
}
