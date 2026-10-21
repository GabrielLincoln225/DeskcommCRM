import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { AbaProcessosNoMenu, ModelosDeProcesso } from "./_client";

export const dynamic = "force-dynamic";

/**
 * CONFIGURAÇÕES › MODELOS DE PROCESSO (migration 9002).
 *
 * Onde a empresa descreve os processos que repete com cada cliente e liga a
 * aba Processos no menu. Só admin: quem decide a sequência de trabalho é quem
 * administra a empresa; quem executa marca os itens na aba Processos.
 */
export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[org.role] < ROLE_RANK.admin) redirect("/403");
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("Modelos de processo")}</h1>
        <p className="text-sm text-text-muted">
          {t("Os passos que a equipe repete com cada cliente. Cada processo aberto vira um checklist com responsável, prazo e observação.")}
        </p>
      </div>
      <AbaProcessosNoMenu />
      <ModelosDeProcesso />
    </div>
  );
}
