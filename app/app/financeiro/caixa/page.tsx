import { CabecalhoDoFinanceiro } from "../_componentes/Cabecalho";
import { Caixa } from "../_componentes/Caixa";
import { exigirAdminDoFinanceiro } from "../_componentes/guarda";

export const dynamic = "force-dynamic";

/**
 * Financeiro › Caixa. O livro-caixa do mês: lançar, confirmar o que foi pago,
 * corrigir, e ver o fluxo e as despesas por categoria.
 *
 * `?mes=AAAA-MM` abre direto num mês (ou `?mes=todos`, a visão consolidada):
 * é o que faz um link do Painel ou de uma conversa cair no período certo.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { t, mesAtual } = await exigirAdminDoFinanceiro();
  const pedido = (await searchParams).mes;
  const mesInicial = pedido === "todos" || /^\d{4}-(0[1-9]|1[0-2])$/.test(pedido ?? "") ? pedido! : mesAtual;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <CabecalhoDoFinanceiro
        ativa="caixa"
        titulo={t("Caixa")}
        frase={t("Livro-caixa: receitas, despesas e o que ainda falta receber ou pagar.")}
        rotulos={{ painel: t("Painel"), caixa: t("Caixa"), navegacao: t("Telas do financeiro") }}
      />
      <Caixa mesInicial={mesInicial} mesAtual={mesAtual} />
    </div>
  );
}
