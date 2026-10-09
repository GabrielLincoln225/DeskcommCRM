/**
 * LIGAR A ABA FINANCEIRO desta organização (capacidade `financeiro_caixa`).
 *
 * Grava `organizations.settings.financeiro.aba_no_menu`. É a única escrita da
 * capacidade; quem lê é `capacidadesLigadas()` (lib/organizacao/capacidades.ts),
 * e o layout de `/app` a consulta a cada navegação — por isso a tela que liga
 * só precisa de um `router.refresh()` para o menu mudar.
 *
 * ⚠️ ADMIN, como a aba: quem não pode abrir o Painel não decide se ele aparece.
 * ⚠️ ADMIN CLIENT: a RLS de `organizations` só deixa platform admin fazer
 * UPDATE (issue #144, o mesmo motivo de `settings/proposals`). O gate de papel
 * acima é a proteção real, e o `organization_id` vem da sessão, nunca do corpo.
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

function lerFinanceiro(settings: unknown): Record<string, unknown> {
  const s = settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
  const f = s.financeiro;
  return f && typeof f === "object" && !Array.isArray(f) ? (f as Record<string, unknown>) : {};
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

  return ok({ aba_no_menu: lerFinanceiro(data?.settings).aba_no_menu === true }, { requestId });
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
  // Merge raso: `settings.financeiro` pode ganhar outras chaves depois, e
  // substituir o objeto inteiro apagaria as que esta tela não conhece.
  const settings = {
    ...settingsAtual,
    financeiro: { ...lerFinanceiro(settingsAtual), aba_no_menu: lido.data.aba_no_menu },
  };

  const { error } = await admin.from("organizations").update({ settings }).eq("id", authz.org.orgId);
  if (error) return fail("internal_error", "Falha ao salvar.", 500, { requestId });

  void audit({
    action: "financeiro.aba_alterada",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "organization",
    resourceId: authz.org.orgId,
    requestId,
    metadata: { aba_no_menu: lido.data.aba_no_menu },
  });

  return ok({ aba_no_menu: lido.data.aba_no_menu }, { requestId });
}
