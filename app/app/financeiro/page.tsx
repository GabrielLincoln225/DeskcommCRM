import { CabecalhoDoFinanceiro } from "./_componentes/Cabecalho";
import { exigirAdminDoFinanceiro } from "./_componentes/guarda";
import { Painel } from "./_componentes/Painel";

export const dynamic = "force-dynamic";

/**
 * Financeiro › Painel. Os cartões do mês e os ganhos do funil que ainda não
 * estão no caixa. O lançamento em si mora no Caixa, a aba ao lado.
 */
export default async function Page() {
  const { t, mesAtual } = await exigirAdminDoFinanceiro();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <CabecalhoDoFinanceiro
        ativa="painel"
        titulo={t("Financeiro")}
        frase={t("Como o dinheiro da empresa está neste mês: o que entrou, o que saiu e o que ainda falta.")}
        rotulos={{ painel: t("Painel"), caixa: t("Caixa"), navegacao: t("Telas do financeiro") }}
      />
      <Painel mesAtual={mesAtual} />
    </div>
  );
}
