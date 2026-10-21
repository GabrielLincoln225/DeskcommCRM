/**
 * TAREFAS RECORRENTES (mensais) — migration 9003.
 *
 * GET  — os moldes da organização, ativos e pausados.
 * POST — cria o molde e já grava a tarefa devida agora (a do mês escolhido),
 *        com o mesmo executor do cron (`gerar-recorrentes.ts`): a tela não
 *        espera até o dia seguinte para mostrar a primeira, e o cron, quando
 *        rodar, encontra a mesma linha pelo índice único e não duplica.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { hojeNoFuso } from "@/lib/processos/progresso";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { gerarTarefasDoMolde, type MoldeGravado } from "@/lib/tarefas/gerar-recorrentes";
import { conferirResponsavel } from "@/lib/tarefas/responsavel";

export const dynamic = "force-dynamic";

const COLUNAS =
  "id, organization_id, title, description, priority, assigned_to, contact_id, lead_id, day_of_month, due_time, lead_days, starts_on, is_active, created_by, created_at, contact:contacts(id, name, display_name, phone_number)";

const criarSchema = z
  .object({
    title: z.string().trim().min(1, "Escreva um título para a tarefa.").max(300),
    description: z.string().trim().max(4000).nullable().optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
    assigned_to: z.string().uuid().nullable().optional(),
    contact_id: z.string().uuid().nullable().optional(),
    lead_id: z.string().uuid().nullable().optional(),
    /** A primeira data. O dia dela vira o dia de todo mês. */
    starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
    due_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido.")
      .default("09:00"),
    lead_days: z.number().int().min(0).max(28).default(3),
  })
  .strict();

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "tasks" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_recurrences")
    .select(COLUNAS)
    .eq("organization_id", authz.org.orgId)
    .order("created_at", { ascending: false });
  if (error) return fail("internal_error", error.message, 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "tasks" });
  if (!authz.ok) return authz.response;

  const lido = criarSchema.safeParse(await req.json().catch(() => null));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "Campos inválidos.", 422, { requestId });
  }
  const orgId = authz.org.orgId;
  const admin = createAdminClient();

  if (lido.data.assigned_to) {
    const veredito = await conferirResponsavel(admin, orgId, lido.data.assigned_to);
    if (veredito === "falha_na_consulta") return fail("internal_error", "Erro ao salvar.", 500, { requestId });
    if (veredito === "fora_da_equipe") {
      return fail("validation_failed", "O responsável escolhido não faz parte da equipe.", 422, { requestId });
    }
  }

  const supabase = await createClient();
  const { data: molde, error } = await supabase
    .from("task_recurrences")
    .insert({
      organization_id: orgId,
      title: lido.data.title,
      description: lido.data.description || null,
      priority: lido.data.priority,
      assigned_to: lido.data.assigned_to ?? null,
      contact_id: lido.data.contact_id ?? null,
      lead_id: lido.data.lead_id ?? null,
      day_of_month: Number(lido.data.starts_on.slice(8, 10)),
      due_time: lido.data.due_time,
      lead_days: lido.data.lead_days,
      starts_on: lido.data.starts_on,
      created_by: authz.user.id,
    })
    .select(COLUNAS)
    .single();
  if (error) {
    if (error.code === "23503") {
      return fail("validation_failed", "Contato ou negócio não encontrado nesta organização.", 422, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  const { data: org } = await supabase.from("organizations").select("timezone").eq("id", orgId).maybeSingle();
  const fuso = (org as { timezone?: string | null } | null)?.timezone ?? null;
  // A primeira tarefa nasce AGORA na data escolhida, mesmo que ela esteja além
  // da antecedência: quem acabou de criar quer ver a tarefa na lista. As
  // seguintes seguem a regra do cron.
  const hoje = hojeNoFuso(fuso);
  const referencia = lido.data.starts_on > hoje ? lido.data.starts_on : hoje;
  const geracao = await gerarTarefasDoMolde(admin, molde as unknown as MoldeGravado, referencia, fuso);

  void audit({
    action: "tarefas.recorrencia_criada",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "task_recurrence",
    resourceId: (molde as { id: string }).id,
    requestId,
    metadata: { dia: Number(lido.data.starts_on.slice(8, 10)), tarefas_geradas: geracao.gerados },
  });

  return ok({ ...(molde as object), tarefas_geradas: geracao.gerados }, { requestId, status: 201 });
}
