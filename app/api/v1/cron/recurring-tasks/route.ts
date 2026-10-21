/**
 * Gera as tarefas dos moldes mensais (migration 9003).
 *
 * Uma vez ao dia. Para cada molde ativo, as datas devidas hoje (no fuso da
 * organização) viram tarefa pendente — `lead_days` antes do dia, e mesmo que a
 * do mês anterior não tenha sido feita (decisão do dono: obrigação mensal não
 * some porque a anterior atrasou). A regra mora em
 * `lib/tarefas/recorrencia-mensal.ts`; a gravação, em `gerar-recorrentes.ts`.
 *
 * Rodada que não gerou nada não audita (CLAUDE.md §Audit log).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { logger } from "@/lib/logger";
import { hojeNoFuso } from "@/lib/processos/progresso";
import { createAdminClient } from "@/lib/supabase/admin";
import { gerarTarefasDoMolde, type MoldeGravado } from "@/lib/tarefas/gerar-recorrentes";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();
  const { data: moldes, error } = await admin
    .from("task_recurrences")
    .select(
      "id, organization_id, title, description, priority, assigned_to, contact_id, lead_id, day_of_month, due_time, lead_days, starts_on, created_by",
    )
    .eq("is_active", true);
  if (error) {
    logger.error("[recurring-tasks] consulta falhou", { error: error.message, requestId });
    return fail("internal_error", "Falha ao buscar recorrências.", 500, { requestId });
  }

  const lista = (moldes ?? []) as MoldeGravado[];
  const orgIds = [...new Set(lista.map((m) => m.organization_id))];
  const fusos = new Map<string, string | null>();
  if (orgIds.length > 0) {
    const { data: orgs } = await admin.from("organizations").select("id, timezone").in("id", orgIds);
    for (const o of (orgs ?? []) as { id: string; timezone: string | null }[]) fusos.set(o.id, o.timezone);
  }

  let gerados = 0;
  let jaExistiam = 0;
  let falharam = 0;
  for (const molde of lista) {
    const fuso = fusos.get(molde.organization_id) ?? null;
    const r = await gerarTarefasDoMolde(admin, molde, hojeNoFuso(fuso), fuso);
    gerados += r.gerados;
    jaExistiam += r.jaExistiam;
    falharam += r.falharam;
    if (r.falharam > 0) {
      logger.error("[recurring-tasks] insert falhou", { recurrence_id: molde.id, requestId });
    }
  }

  if (gerados > 0) {
    await audit({
      action: "tarefas.recorrencia_gerada",
      resourceType: "crm_task",
      requestId,
      metadata: { gerados, ja_existiam: jaExistiam, falharam },
    });
  }

  return ok({ moldes: lista.length, gerados, ja_existiam: jaExistiam, falharam }, { requestId });
}

export const GET = handle;
export const POST = handle;
