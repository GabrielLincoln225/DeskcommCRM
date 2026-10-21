/**
 * PROCESSOS DOS CLIENTES (migration 9002).
 *
 * GET  — os processos da organização com o progresso de cada um. Filtros:
 *        `?status=open|done|cancelled|all` (padrão `open`) e `?contact_id=`.
 * POST — inicia um processo para um contato a partir de um modelo (agent+).
 *
 * O progresso é apurado aqui com `progressoDoProcesso` — a mesma função que o
 * detalhe usa — sobre os itens lidos numa consulta só, e "hoje" é o dia no fuso
 * da organização: um item que vence hoje em Cuiabá não pode virar "atrasado"
 * às 21h porque o servidor já está no dia seguinte em UTC.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { COLUNAS_DO_PROCESSO } from "@/lib/processos/leitura";
import { hojeNoFuso, progressoDoProcesso, type ItemParaProgresso } from "@/lib/processos/progresso";
import { iniciarProcessoSchema } from "@/lib/processos/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const STATUS = ["open", "done", "cancelled"] as const;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "processos" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const params = req.nextUrl.searchParams;
  const status = params.get("status") ?? "open";
  const contato = params.get("contact_id");
  if (status !== "all" && !(STATUS as readonly string[]).includes(status)) {
    return fail("validation_failed", "Situação inválida.", 422, { requestId });
  }
  if (contato && !UUID_RX.test(contato)) {
    return fail("validation_failed", "Contato inválido.", 422, { requestId });
  }

  const supabase = await createClient();
  let query = supabase
    .from("client_processes")
    .select(COLUNAS_DO_PROCESSO)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (status !== "all") query = query.eq("status", status);
  if (contato) query = query.eq("contact_id", contato);

  const [{ data: processos, error }, { data: org }] = await Promise.all([
    query,
    supabase.from("organizations").select("timezone").eq("id", orgId).maybeSingle(),
  ]);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const lista = (processos ?? []) as unknown as Array<{ id: string } & Record<string, unknown>>;
  const ids = lista.map((p) => p.id);
  const itensPorProcesso = new Map<string, ItemParaProgresso[]>();
  if (ids.length > 0) {
    const { data: itens, error: erroItens } = await supabase
      .from("client_process_items")
      .select("process_id, title, position, done_at, due_date")
      .eq("organization_id", orgId)
      .in("process_id", ids);
    if (erroItens) return fail("internal_error", erroItens.message, 500, { requestId });
    for (const i of (itens ?? []) as Array<ItemParaProgresso & { process_id: string }>) {
      const doProcesso = itensPorProcesso.get(i.process_id) ?? [];
      doProcesso.push(i);
      itensPorProcesso.set(i.process_id, doProcesso);
    }
  }

  const hoje = hojeNoFuso((org as { timezone?: string | null } | null)?.timezone);
  return ok(
    {
      hoje,
      processos: lista.map((p) => ({
        ...p,
        progresso: progressoDoProcesso(itensPorProcesso.get(p.id) ?? [], hoje),
      })),
    },
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "processos" });
  if (!authz.ok) return authz.response;

  const lido = iniciarProcessoSchema.safeParse(await req.json().catch(() => null));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "Campos inválidos.", 422, { requestId });
  }
  const orgId = authz.org.orgId;
  const supabase = await createClient();

  const { data: modelo } = await supabase
    .from("process_templates")
    .select("id, name, process_template_steps(title, position)")
    .eq("id", lido.data.template_id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!modelo) return fail("not_found", "Modelo não encontrado.", 404, { requestId });

  const passos = [...((modelo as { process_template_steps?: { title: string; position: number }[] })
    .process_template_steps ?? [])].sort((a, b) => a.position - b.position);
  if (passos.length === 0) {
    return fail("validation_failed", "Este modelo não tem passos.", 422, { requestId });
  }

  const { data: processo, error } = await supabase
    .from("client_processes")
    .insert({
      organization_id: orgId,
      contact_id: lido.data.contact_id,
      template_id: modelo.id,
      name: (modelo as { name: string }).name,
      origin: "manual",
      started_by: authz.user.id,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23503") {
      return fail("validation_failed", "Contato não encontrado nesta organização.", 422, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  const { error: erroItens } = await supabase.from("client_process_items").insert(
    passos.map((p, i) => ({
      organization_id: orgId,
      process_id: processo.id,
      title: p.title,
      position: i + 1,
    })),
  );
  if (erroItens) {
    await supabase.from("client_processes").delete().eq("id", processo.id).eq("organization_id", orgId);
    return fail("internal_error", erroItens.message, 500, { requestId });
  }

  void audit({
    action: "processos.processo_iniciado",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "client_process",
    resourceId: processo.id,
    requestId,
    metadata: { template_id: modelo.id, contact_id: lido.data.contact_id, origem: "manual" },
  });

  return ok({ id: processo.id }, { requestId, status: 201 });
}
