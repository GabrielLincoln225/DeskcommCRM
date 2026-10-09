/**
 * Quem entra na aba Financeiro: quem administra a organização, e só onde a
 * organização ligou a aba.
 *
 * A página redireciona, e a navegação declara o mesmo `minRole: "admin"` e a
 * mesma capacidade (`lib/navigation/catalogo.ts`) — assim o menu nunca mostra
 * uma porta que morre em /403. Com a aba desligada, o admin cai em
 * Configurações › Financeiro, que é onde ela se liga. Quem recusa o DADO é a
 * rota (`requireRole("admin")`); isto aqui só decide a tela.
 */
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { capacidadesDaOrganizacao } from "@/lib/organizacao/capacidades";
import { createAdminClient } from "@/lib/supabase/admin";

export async function exigirAdminDoFinanceiro() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[org.role] < ROLE_RANK.admin) {
    redirect("/403");
  }
  const ligadas = await capacidadesDaOrganizacao(createAdminClient(), org.orgId);
  if (!ligadas.includes("financeiro_caixa")) redirect("/app/settings/tenant/financeiro");

  const t = (texto: string) => traduzir(texto, user.idioma);
  // UTC, como a rota do caixa e o cron: as três pontas concordam sobre o mês.
  const mesAtual = new Date().toISOString().slice(0, 7);
  return { user, org, t, mesAtual };
}
