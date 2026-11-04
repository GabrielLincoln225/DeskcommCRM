"use client";
/**
 * A VISÃO GERAL — "como está o caixa desde o começo?".
 *
 * O Painel olha um mês; esta tela olha o histórico inteiro: o saldo de todos
 * os tempos, o que está em aberto, o que ATRASOU, o que vence nos próximos
 * dias, o mês a mês com o saldo acumulado, quem mais pagou e para onde o
 * dinheiro foi. As contas vêm prontas da rota (`/api/v1/financeiro/geral`,
 * sobre `lib/financeiro/geral.ts`); aqui só se escolhe cor e frase.
 *
 * As listas de atrasados e da agenda têm o botão de confirmar: é a pergunta
 * que esta tela levanta ("isto já entrou?"), e mandar a pessoa ao Caixa para
 * responder seria um passo a mais por linha.
 */
import Link from "next/link";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import type { LinhaDoCaixa } from "@/lib/financeiro/caixa";
import type { MesDoHistorico } from "@/lib/financeiro/geral";
import { formatCents } from "@/lib/money";
import { ArrowDownRight, ArrowUpRight, CashRegister, Check } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import { IconeDeAcao, Situacao } from "./Caixa";
import {
  dataCurta,
  nomeDoMes,
  useConfirmarLancamento,
  useGeral,
  useLancarPrevisto,
  type ContatoDoCaixa,
} from "./dados";
import { DespesasPorCategoria } from "./Graficos";

/** O gráfico mostra no máximo este número de meses; a tabela mostra todos. */
const MESES_NO_GRAFICO = 12;

export function Geral() {
  const t = useT();
  const tag = useTagDeIdioma();
  const geral = useGeral();
  const confirmar = useConfirmarLancamento();
  const lancarPrevisto = useLancarPrevisto();
  const dados = geral.data;

  const contatoPorId = useMemo(
    () => new Map<string, ContatoDoCaixa>((dados?.contatos ?? []).map((c) => [c.id, c])),
    [dados?.contatos],
  );

  if (geral.isLoading) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;
  if (geral.isError || !dados) {
    return <p className="text-sm text-error">{t("Não foi possível carregar o caixa. Tente de novo.")}</p>;
  }

  const r = dados.resumo;
  const moeda = dados.moeda;
  const hoje = dados.hoje;
  const ocupado = confirmar.isPending || lancarPrevisto.isPending;

  function confirmarLinha(l: LinhaDoCaixa) {
    if (l.id) confirmar.mutate(l.id);
    else if (l.recurring_entry_id) {
      lancarPrevisto.mutate({ recurring_entry_id: l.recurring_entry_id, entry_date: l.entry_date, pagar: true });
    }
  }

  function lista(linhas: LinhaDoCaixa[], vazio: string, testId: string) {
    if (linhas.length === 0) return <p className="text-sm text-text-muted">{vazio}</p>;
    return (
      <ul className="flex flex-col divide-y divide-border/60" data-testid={testId}>
        {linhas.map((l) => {
          const entrada = l.direction === "in";
          const contato = l.contact_id ? contatoPorId.get(l.contact_id) : undefined;
          return (
            <li
              key={l.id ?? `previsto-${l.recurring_entry_id}-${l.entry_date}`}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {entrada ? (
                    <ArrowUpRight size={14} className="mr-1 inline text-success" />
                  ) : (
                    <ArrowDownRight size={14} className="mr-1 inline text-error" />
                  )}
                  {l.description ?? "—"}
                </p>
                <p className="text-xs text-text-muted">
                  {dataCurta(l.entry_date, tag)}
                  {contato ? ` · ${rotuloDoContato(contato, t)}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Situacao linha={l} hoje={hoje} />
                <span className={cn("text-sm font-medium tabular-nums", entrada ? "text-success" : "text-text")}>
                  {entrada ? "+ " : "− "}
                  {formatCents(l.amount_cents, l.currency)}
                </span>
                <IconeDeAcao
                  rotulo={entrada ? t("Confirmar recebimento") : t("Confirmar pagamento")}
                  onClick={() => confirmarLinha(l)}
                  desabilitado={ocupado}
                  testId="confirmar-lancamento"
                >
                  <Check size={16} />
                </IconeDeAcao>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  const desde = r.primeiro_mes ? nomeDoMes(r.primeiro_mes, tag) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-muted">
          {desde
            ? `${t("Tudo que foi lançado desde")} ${desde} · ${r.lancamentos} ${t("lançamentos")}`
            : t("Nenhum lançamento ainda. Comece pelo Caixa.")}
        </p>
        <Button asChild variant="secondary">
          <Link href="/app/financeiro/caixa">
            <CashRegister size={16} />
            {t("Abrir o caixa")}
          </Link>
        </Button>
      </div>

      {dados.truncado ? (
        <p className="rounded-md border border-warning bg-warning-bg p-2 text-xs text-warning-fg">
          {t("O período tem lançamentos demais para uma tela só; os totais podem estar incompletos.")}
        </p>
      ) : null}
      {dados.outras_moedas > 0 ? (
        <p className="rounded-md border border-border bg-surface-elevated p-2 text-xs text-text-muted">
          {dados.outras_moedas} {t("lançamentos em outra moeda ficaram fora destas somas.")}
        </p>
      ) : null}

      <section
        aria-label={t("Resumo de todos os tempos")}
        className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 xl:grid-cols-3"
      >
        <Cartao
          titulo={t("Saldo em caixa (todos os tempos)")}
          valor={formatCents(r.saldo_em_caixa_cents, moeda)}
          tom={r.saldo_em_caixa_cents < 0 ? "erro" : r.saldo_em_caixa_cents > 0 ? "sucesso" : "neutro"}
          destaque
          testId="geral-saldo"
          nota={t("Tudo que foi recebido menos tudo que foi pago")}
        />
        <Cartao
          titulo={t("Total recebido")}
          valor={`+${formatCents(r.recebido_total_cents, moeda)}`}
          tom="sucesso"
          testId="geral-recebido"
          nota={
            r.melhor_mes
              ? `${t("Melhor mês")}: ${nomeDoMes(r.melhor_mes.mes, tag)} (${formatCents(r.melhor_mes.entradas_cents, moeda)})`
              : t("Nenhuma entrada confirmada ainda")
          }
        />
        <Cartao
          titulo={t("Total pago")}
          valor={`−${formatCents(r.pago_total_cents, moeda)}`}
          tom="neutro"
          testId="geral-pago"
          nota={t("Custos e despesas confirmados")}
        />
        <Cartao
          titulo={t("A receber em aberto")}
          valor={formatCents(r.a_receber_cents, moeda)}
          tom={r.atrasado_receber_cents > 0 ? "erro" : "aviso"}
          testId="geral-a-receber"
          nota={
            r.atrasado_receber_cents > 0
              ? `${formatCents(r.atrasado_receber_cents, moeda)} ${t("já venceram")}`
              : t("Nada vencido")
          }
        />
        <Cartao
          titulo={t("A pagar em aberto")}
          valor={formatCents(r.a_pagar_cents, moeda)}
          tom={r.atrasado_pagar_cents > 0 ? "erro" : "neutro"}
          testId="geral-a-pagar"
          nota={
            r.atrasado_pagar_cents > 0
              ? `${formatCents(r.atrasado_pagar_cents, moeda)} ${t("já venceram")}`
              : t("Nada vencido")
          }
        />
        <Cartao
          titulo={t("Média por mês")}
          valor={formatCents(r.media_mensal_recebida_cents, moeda)}
          tom="neutro"
          testId="geral-media"
          nota={`${t("recebido por mês")} · ${t("resultado médio")} ${formatCents(r.media_mensal_resultado_cents, moeda)}`}
        />
      </section>

      <p className="text-xs text-text-muted">
        {t(
          "O saldo considera só o que foi lançado aqui. Dinheiro que entrou na conta e não foi lançado não aparece — confira com o extrato do banco.",
        )}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <section
          className={cn(
            "rounded-lg border bg-surface p-4",
            dados.atrasados.length > 0 ? "border-error" : "border-border",
          )}
        >
          <h2 className="text-sm font-semibold">
            {t("Atrasados")} ({dados.atrasados.length})
          </h2>
          <p className="mb-3 text-xs text-text-muted">
            {t("Pendentes com data que já passou. Se já entrou ou já foi pago, confirme no ✓.")}
          </p>
          {lista(dados.atrasados, t("Nenhum lançamento atrasado."), "lista-atrasados")}
        </section>

        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold">
            {t("Próximos")} {dados.dias_da_agenda} {t("dias")} ({dados.agenda.length})
          </h2>
          <p className="mb-3 text-xs text-text-muted">
            {t("O que vence a partir de hoje, incluindo as mensalidades previstas.")}
          </p>
          {lista(dados.agenda, t("Nada vencendo nos próximos dias."), "lista-agenda")}
        </section>
      </div>

      <Historico historico={dados.historico} moeda={moeda} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-4" data-testid="quem-mais-pagou">
          <h2 className="text-sm font-semibold">{t("Quem mais pagou")}</h2>
          <p className="mb-3 text-xs text-text-muted">{t("Receitas confirmadas por cliente, de todos os tempos.")}</p>
          {dados.clientes.length === 0 ? (
            <p className="text-sm text-text-muted">{t("Nenhuma entrada confirmada ainda.")}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {dados.clientes.map((c) => {
                const contato = c.contact_id ? contatoPorId.get(c.contact_id) : undefined;
                const pct = r.recebido_total_cents > 0 ? Math.round((c.total_cents / r.recebido_total_cents) * 100) : 0;
                return (
                  <li key={c.contact_id ?? "sem"} className="flex flex-col gap-1">
                    <div className="flex justify-between gap-2 text-sm">
                      <span className="truncate">
                        {contato ? rotuloDoContato(contato, t) : t("Sem cliente vinculado")}
                      </span>
                      <span className="shrink-0 text-text-muted tabular-nums">
                        {formatCents(c.total_cents, moeda)} · {pct}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-elevated">
                      <div className="h-2 rounded-full bg-success" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <DespesasPorCategoria
          fatias={dados.por_categoria}
          categorias={dados.categorias}
          moeda={moeda}
          rotuloDoPeriodo={t("todos os tempos")}
        />
      </div>
    </div>
  );
}

function Historico({ historico, moeda }: { historico: MesDoHistorico[]; moeda: string }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const noGrafico = historico.slice(-MESES_NO_GRAFICO);
  const maior = Math.max(1, ...noGrafico.flatMap((m) => [m.entradas_cents, m.saidas_cents]));
  const rotulo = (mes: string) => {
    const [a, n] = mes.split("-").map(Number) as [number, number];
    return new Date(Date.UTC(a, n - 1, 1)).toLocaleDateString(tag, { month: "short", year: "2-digit", timeZone: "UTC" });
  };

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="historico-mensal">
      <h2 className="text-sm font-semibold">{t("Mês a mês, desde o começo")}</h2>
      <p className="mb-4 text-xs text-text-muted">
        {t("Entradas recebidas e saídas pagas em cada mês, e o saldo acumulado até ali.")}
      </p>

      {historico.length === 0 ? (
        <p className="text-sm text-text-muted">{t("Nenhum lançamento ainda.")}</p>
      ) : (
        <>
          <div className="flex h-48 items-end gap-3" aria-hidden="true">
            {noGrafico.map((m) => (
              <div key={m.mes} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-40 w-full items-end justify-center gap-1">
                  <div
                    className="w-1/3 max-w-6 rounded-t bg-success"
                    style={{ height: `${(m.entradas_cents / maior) * 100}%` }}
                  />
                  <div
                    className="w-1/3 max-w-6 rounded-t bg-error"
                    style={{ height: `${(m.saidas_cents / maior) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-text-muted">{rotulo(m.mes)}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <caption className="sr-only">{t("Mês a mês, desde o começo")}</caption>
              <thead>
                <tr className="text-left text-xs text-text-muted">
                  <th className="py-1 font-medium">{t("Mês")}</th>
                  <th className="py-1 text-right font-medium">{t("Entradas")}</th>
                  <th className="py-1 text-right font-medium">{t("Saídas")}</th>
                  <th className="py-1 text-right font-medium">{t("Resultado")}</th>
                  <th className="py-1 text-right font-medium">{t("Saldo acumulado")}</th>
                </tr>
              </thead>
              <tbody>
                {[...historico].reverse().map((m) => {
                  const resultado = m.entradas_cents - m.saidas_cents;
                  return (
                    <tr key={m.mes} className="border-t border-border/60">
                      <td className="py-1">{rotulo(m.mes)}</td>
                      <td className="py-1 text-right text-success tabular-nums">+{formatCents(m.entradas_cents, moeda)}</td>
                      <td className="py-1 text-right tabular-nums">−{formatCents(m.saidas_cents, moeda)}</td>
                      <td className={cn("py-1 text-right tabular-nums", resultado < 0 && "text-error")}>
                        {formatCents(resultado, moeda)}
                      </td>
                      <td
                        className={cn(
                          "py-1 text-right font-medium tabular-nums",
                          m.saldo_acumulado_cents < 0 && "text-error",
                        )}
                      >
                        {formatCents(m.saldo_acumulado_cents, moeda)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
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
