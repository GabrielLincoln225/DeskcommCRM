"use client";
/**
 * Os quatro cartões do período — os mesmos no Painel e no topo do Caixa.
 *
 * Nenhum número é calculado aqui: o resumo vem pronto da rota
 * (`resumoDoCaixa`, em `lib/financeiro/caixa.ts`). Esta peça escolhe a cor e a
 * frase de cada número; a conta é de lá.
 */
import { useT } from "@/hooks/i18n/useT";
import type { ResumoDoCaixa } from "@/lib/financeiro/caixa";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

export function CartoesDoMes({
  resumo,
  moeda,
  rotuloDoPeriodo,
}: {
  resumo: ResumoDoCaixa;
  moeda: string;
  rotuloDoPeriodo: string;
}) {
  const t = useT();
  const saldo = resumo.saldo_realizado_cents;

  return (
    <section
      aria-label={t("Resumo do período")}
      className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 xl:grid-cols-4"
    >
      <Cartao
        titulo={t("Saldo líquido em caixa")}
        valor={formatCents(saldo, moeda)}
        tom={saldo < 0 ? "erro" : saldo > 0 ? "sucesso" : "neutro"}
        destaque
        testId="cartao-saldo"
        nota={
          saldo < 0
            ? `${t("Déficit de")} ${formatCents(-saldo, moeda)} ${t("em")} ${rotuloDoPeriodo}`
            : `${t("Recebido menos pago em")} ${rotuloDoPeriodo}`
        }
      />
      <Cartao
        titulo={t("Receitas realizadas")}
        valor={`+${formatCents(resumo.receitas_realizadas_cents, moeda)}`}
        tom="sucesso"
        testId="cartao-receitas"
        nota={`${resumo.entradas_confirmadas} ${t("entradas confirmadas")}`}
      />
      <Cartao
        titulo={t("Custos e despesas")}
        valor={`−${formatCents(resumo.despesas_realizadas_cents, moeda)}`}
        tom="neutro"
        testId="cartao-despesas"
        nota={`${resumo.saidas_confirmadas} ${t("saídas pagas")}`}
      />
      <Cartao
        titulo={t("Previsão do período")}
        valor={formatCents(resumo.resultado_previsto_cents, moeda)}
        tom={resumo.a_confirmar > 0 ? "aviso" : "neutro"}
        testId="cartao-previsao"
        nota={`${resumo.a_confirmar} ${t("a confirmar")} · ${formatCents(resumo.a_receber_cents, moeda)} ${t(
          "a receber",
        )} · ${formatCents(resumo.a_pagar_cents, moeda)} ${t("a pagar")}`}
      />
    </section>
  );
}

const TONS = {
  sucesso: "text-success",
  erro: "text-error",
  aviso: "text-warning",
  neutro: "text-text",
} as const;

function Cartao({
  titulo,
  valor,
  nota,
  tom,
  destaque = false,
  testId,
}: {
  titulo: string;
  valor: string;
  nota: string;
  tom: keyof typeof TONS;
  destaque?: boolean;
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-1 bg-surface p-4" data-testid={testId}>
      <p className="text-xs font-medium tracking-wide text-text-muted uppercase">{titulo}</p>
      <p className={cn("font-semibold tabular-nums", destaque ? "text-3xl" : "text-2xl", TONS[tom])}>{valor}</p>
      <p className="text-xs text-text-muted">{nota}</p>
    </div>
  );
}
