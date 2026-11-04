import { CabecalhoDoFinanceiro } from "../_componentes/Cabecalho";
import { Geral } from "../_componentes/Geral";
import { exigirAdminDoFinanceiro } from "../_componentes/guarda";

export const dynamic = "force-dynamic";

/**
 * Financeiro › Geral. O caixa de todos os tempos: saldo, em aberto,
 * atrasados, o que vence nos próximos dias, o mês a mês desde o começo, quem
 * mais pagou e para onde o dinheiro foi.
 */
export default async function Page() {
  const { t } = await exigirAdminDoFinanceiro();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <CabecalhoDoFinanceiro
        ativa="geral"
        titulo={t("Financeiro geral")}
        frase={t("O caixa de todos os tempos: o que entrou, o que saiu, o que está em aberto e o que atrasou.")}
        rotulos={{ geral: t("Geral"), painel: t("Painel do mês"), caixa: t("Caixa"), navegacao: t("Telas do financeiro") }}
      />
      <Geral />
    </div>
  );
}
