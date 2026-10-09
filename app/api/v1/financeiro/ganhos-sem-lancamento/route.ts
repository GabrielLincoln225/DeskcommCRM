/**
 * OS GANHOS QUE AINDA NÃO VIRARAM DINHEIRO NO CAIXA.
 *
 * Fechar um negócio no funil não lança nada sozinho — e não deve: em loja com
 * checkout ou infoproduto o valor do negócio não é conta a receber, e lançar
 * por conta própria encheria o caixa de dinheiro que talvez nunca venha. A aba
 * Financeiro SUGERE, e quem confirma é a pessoa: esta rota é a lista do que
 * sugerir. Aceitar é um `POST /financeiro/lancamentos` com `lead_id`, e o índice
 * único de `financial_entries.lead_id` (9001) garante que o mesmo ganho não vira
 * dois lançamentos.
 *
 * ⚠️ JANELA DE 60 DIAS, e é o mecanismo que impede a lista de morrer de
 * velhice: um ganho que ninguém quis lançar em dois meses deixa de ser
 * sugerido, em vez de ficar para sempre no topo do Painel ensinando a ignorá-lo.
 *
 * Calculado na hora, sem tabela de sugestão: a sugestão é "ganho com valor e
 * sem lançamento", e as duas metades já estão no banco (DIRC — Calcular).
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const JANELA_EM_DIAS = 60;
const LIMITE = 50;

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "financeiro" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const desde = new Date(Date.now() - JANELA_EM_DIAS * 86_400_000).toISOString();
  const supabase = await createClient();

  const { data: ganhos, error } = await supabase
    .from("crm_leads")
    .select("id, title, value_cents, currency, contact_id, closed_at")
    .eq("organization_id", orgId)
    .eq("status", "won")
    .gt("value_cents", 0)
    .gte("closed_at", desde)
    .order("closed_at", { ascending: false })
    .limit(LIMITE);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const ids = (ganhos ?? []).map((g) => g.id);
  if (ids.length === 0) return ok({ ganhos: [], contatos: [] }, { requestId });

  const { data: lancados, error: erroLancados } = await supabase
    .from("financial_entries")
    .select("lead_id")
    .eq("organization_id", orgId)
    .in("lead_id", ids);
  if (erroLancados) return fail("internal_error", erroLancados.message, 500, { requestId });

  const jaLancados = new Set((lancados ?? []).map((l) => l.lead_id));
  const pendentes = (ganhos ?? []).filter((g) => !jaLancados.has(g.id));

  const idsDeContato = [...new Set(pendentes.map((g) => g.contact_id).filter((x): x is string => !!x))];
  let contatos: Array<{ id: string; name: string | null; display_name: string | null; phone_number: string | null }> =
    [];
  if (idsDeContato.length > 0) {
    const { data, error: erroContatos } = await supabase
      .from("contacts")
      .select("id, name, display_name, phone_number")
      .eq("organization_id", orgId)
      .in("id", idsDeContato);
    if (erroContatos) return fail("internal_error", erroContatos.message, 500, { requestId });
    contatos = (data ?? []) as typeof contatos;
  }

  return ok({ ganhos: pendentes, contatos }, { requestId });
}
