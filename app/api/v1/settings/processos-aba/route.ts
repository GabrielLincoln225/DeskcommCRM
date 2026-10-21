/**
 * LIGAR A ABA PROCESSOS desta organização (capacidade `processos_clientes`).
 *
 * Grava `organizations.settings.processos.aba_no_menu`. Mesmo desenho da aba
 * Financeiro (`settings/financeiro-aba`): o menu lateral está no teto da dobra,
 * então a porta nasce desligada e quem liga escolhe pagar a linha.
 *
 * ⚠️ ADMIN CLIENT: a RLS de `organizations` só deixa platform admin fazer
 * UPDATE. O gate de papel acima é a proteção real, e o `organization_id` vem da
 * sessão, nunca do corpo.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const patchSchema = z.object({ aba_no_menu: z.boolean() }).strict();

function lerProcessos(settings: unknown): Record<string, unknown> {
  const s = settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
  const p = s.processos;
  return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "organizations" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", authz.org.orgId)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });

  return ok({ aba_no_menu: lerProcessos(data?.settings).aba_no_menu === true }, { requestId });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "organizations" });
  if (!authz.ok) return authz.response;

  const lido = patchSchema.safeParse(await req.json().catch(() => null));
  if (!lido.success) return fail("validation_failed", "Campos inválidos.", 422, { requestId });

  const admin = createAdminClient();
  const { data: atual, error: erroLeitura } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", authz.org.orgId)
    .single();
  if (erroLeitura) return fail("internal_error", erroLeitura.message, 500, { requestId });

  const settingsAtual = (atual?.settings as Record<string, unknown> | null) ?? {};
  const settings = {
    ...settingsAtual,
    processos: { ...lerProcessos(settingsAtual), aba_no_menu: lido.data.aba_no_menu },
  };

  const { error } = await admin.from("organizations").update({ settings }).eq("id", authz.org.orgId);
  if (error) return fail("internal_error", "Falha ao salvar.", 500, { requestId });

  void audit({
    action: "processos.aba_alterada",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "organization",
    resourceId: authz.org.orgId,
    requestId,
    metadata: { aba_no_menu: lido.data.aba_no_menu },
  });

  return ok({ aba_no_menu: lido.data.aba_no_menu }, { requestId });
}
