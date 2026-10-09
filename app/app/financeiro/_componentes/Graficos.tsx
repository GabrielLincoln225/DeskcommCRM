"use client";
/**
 * Os dois gráficos do Caixa: o fluxo mês a mês e as despesas por categoria.
 *
 * Barras em CSS, sem biblioteca de gráfico: são duas séries e uma lista de
 * proporções, e cada valor também está escrito por extenso — o gráfico é
 * leitura rápida, nunca o único lugar onde o número aparece (quem usa leitor de
 * tela recebe a tabela, não um desenho).
 */
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import type { FatiaDeCategoria, MesDoFluxo } from "@/lib/financeiro/caixa";
import { formatCents } from "@/lib/money";

import type { Categoria } from "./dados";

export function FluxoMensal({ fluxo, moeda }: { fluxo: MesDoFluxo[]; moeda: string }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const maior = Math.max(1, ...fluxo.flatMap((m) => [m.entradas_cents, m.saidas_cents]));
  const rotulo = (mes: string) => {
    const [a, n] = mes.split("-").map(Number) as [number, number];
    return new Date(Date.UTC(a, n - 1, 1)).toLocaleDateString(tag, { month: "short", timeZone: "UTC" });
  };

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="fluxo-mensal">
      <h2 className="text-sm font-semibold">{t("Fluxo mês a mês")}</h2>
      <p className="mb-4 text-xs text-text-muted">{t("Entradas recebidas e saídas pagas em cada mês.")}</p>

      <div className="flex h-48 items-end gap-3" aria-hidden="true">
        {fluxo.map((m) => (
          <div key={m.mes} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-40 w-full items-end justify-center gap-1">
              <div
                className="w-1/3 max-w-6 rounded-t bg-success"
                style={{ height: `${(m.entradas_cents / maior) * 100}%` }}
                title={`${t("Entradas")}: ${formatCents(m.entradas_cents, moeda)}`}
              />
              <div
                className="w-1/3 max-w-6 rounded-t bg-error"
                style={{ height: `${(m.saidas_cents / maior) * 100}%` }}
                title={`${t("Saídas")}: ${formatCents(m.saidas_cents, moeda)}`}
              />
            </div>
            <span className="text-xs text-text-muted">{rotulo(m.mes)}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-4 text-xs text-text-muted">
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-success" />
          {t("Entradas")}
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-error" />
          {t("Saídas")}
        </span>
      </div>

      <table className="mt-4 w-full text-sm">
        <caption className="sr-only">{t("Fluxo mês a mês")}</caption>
        <thead>
          <tr className="text-left text-xs text-text-muted">
            <th className="py-1 font-medium">{t("Mês")}</th>
            <th className="py-1 text-right font-medium">{t("Entradas")}</th>
            <th className="py-1 text-right font-medium">{t("Saídas")}</th>
            <th className="py-1 text-right font-medium">{t("Resultado")}</th>
          </tr>
        </thead>
        <tbody>
          {fluxo.map((m) => {
            const resultado = m.entradas_cents - m.saidas_cents;
            return (
              <tr key={m.mes} className="border-t border-border/60">
                <td className="py-1 capitalize">{rotulo(m.mes)}</td>
                <td className="py-1 text-right text-success tabular-nums">
                  +{formatCents(m.entradas_cents, moeda)}
                </td>
                <td className="py-1 text-right tabular-nums">−{formatCents(m.saidas_cents, moeda)}</td>
                <td className={`py-1 text-right font-medium tabular-nums ${resultado < 0 ? "text-error" : ""}`}>
                  {formatCents(resultado, moeda)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function DespesasPorCategoria({
  fatias,
  categorias,
  moeda,
  rotuloDoPeriodo,
}: {
  fatias: FatiaDeCategoria[];
  categorias: Categoria[];
  moeda: string;
  rotuloDoPeriodo: string;
}) {
  const t = useT();
  const nome = (id: string | null) =>
    id ? (categorias.find((c) => c.id === id)?.name ?? t("Categoria removida")) : t("Sem categoria");

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="despesas-por-categoria">
      <h2 className="text-sm font-semibold">
        {t("Para onde o dinheiro foi")} · {rotuloDoPeriodo}
      </h2>
      <p className="mb-4 text-xs text-text-muted">{t("Despesas pagas no período, por categoria.")}</p>

      {fatias.length === 0 ? (
        <p className="text-sm text-text-muted">{t("Nenhuma despesa paga no período.")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {fatias.map((f) => (
            <li key={f.account_plan_id ?? "sem"} className="flex flex-col gap-1">
              <div className="flex justify-between text-sm">
                <span>{nome(f.account_plan_id)}</span>
                <span className="text-text-muted tabular-nums">
                  {formatCents(f.total_cents, moeda)} · {f.percentual}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-surface-elevated">
                <div className="h-2 rounded-full bg-accent" style={{ width: `${f.percentual}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
