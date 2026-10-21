/**
 * Grava as tarefas devidas de um molde mensal (migration 9003).
 *
 * Um executor só, chamado pelo cron diário e pela criação na tela (que gera a
 * primeira tarefa na hora). A IDEMPOTÊNCIA é do índice único
 * `(recurrence_id, recurrence_due)`: o `23505` é "já existia", o desfecho certo
 * de toda rodada depois da primeira.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { datasDevidas, instanteNoFuso } from "@/lib/tarefas/recorrencia-mensal";

export interface MoldeGravado {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  priority: string;
  assigned_to: string | null;
  contact_id: string | null;
  lead_id: string | null;
  day_of_month: number;
  due_time: string;
  lead_days: number;
  starts_on: string;
  created_by: string | null;
}

export interface ResultadoDaGeracao {
  gerados: number;
  jaExistiam: number;
  falharam: number;
}

export async function gerarTarefasDoMolde(
  db: SupabaseClient,
  molde: MoldeGravado,
  hoje: string,
  fuso: string | null | undefined,
): Promise<ResultadoDaGeracao> {
  const r: ResultadoDaGeracao = { gerados: 0, jaExistiam: 0, falharam: 0 };
  for (const data of datasDevidas(molde, hoje)) {
    const { error } = await db.from("crm_tasks").insert({
      organization_id: molde.organization_id,
      title: molde.title,
      description: molde.description,
      priority: molde.priority,
      status: "pending",
      due_date: instanteNoFuso(data, molde.due_time, fuso),
      assigned_to: molde.assigned_to,
      contact_id: molde.contact_id,
      lead_id: molde.lead_id,
      created_by: molde.created_by,
      recurrence_id: molde.id,
      recurrence_due: data,
    });
    if (!error) r.gerados += 1;
    else if (error.code === "23505") r.jaExistiam += 1;
    else r.falharam += 1;
  }
  return r;
}
