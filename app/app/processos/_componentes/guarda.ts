/**
 * Quem entra na aba Processos: toda a equipe da organização, e só onde a
 * organização ligou a aba (capacidade `processos_clientes`).
 *
 * A navegação declara a mesma capacidade (`lib/navigation/catalogo.ts`), então
 * o menu nunca mostra uma porta que morre num redirecionamento. Com a aba
 * desligada, o admin cai em Configurações › Modelos de processo, que é onde ela
 * se liga; os demais voltam para o início. Quem recusa o DADO são as rotas.
 */
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { capacidadesDaOrganizacao } from "@/lib/organizacao/capacidades";
import { createAdminClient } from "@/lib/supabase/admin";

export async function exigirAbaDeProcessos() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  const ehPlataforma = user.is_platform_admin && !user.support;
  const ligadas = await capacidadesDaOrganizacao(createAdminClient(), org.orgId);
  if (!ligadas.includes("processos_clientes")) {
    redirect(ehPlataforma || ROLE_RANK[org.role] >= ROLE_RANK.admin ? "/app/settings/tenant/processos" : "/app");
  }
  const t = (texto: string) => traduzir(texto, user.idioma);
  const podeEditar = ehPlataforma || ROLE_RANK[org.role] >= ROLE_RANK.agent;
  return { user, org, t, podeEditar };
}
