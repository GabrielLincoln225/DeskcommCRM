"use client";
/**
 * O CAIXA — o extrato do período, com o que se faz nele.
 *
 * Três vistas sobre o MESMO período: o extrato (lançar, confirmar, corrigir,
 * apagar), o fluxo mês a mês e as despesas por categoria. Os cartões ficam por
 * cima das três, porque a pergunta "como está o mês?" vale em qualquer uma.
 *
 * ⚠️ O TOTAL DO FILTRO usa a MESMA função dos cartões (`resumoDoCaixa`), sobre
 * as linhas que a rota devolveu inteiras para o período — não é uma segunda
 * apuração com regra própria, é a mesma régua aplicada ao recorte que a pessoa
 * escolheu.
 *
 * ⚠️ LINHA PREVISTA NÃO TEM AÇÃO. Ela é o que um molde mensal ainda vai gerar;
 * no dia, o cron a grava pendente e aí ela se confirma como qualquer outra.
 */
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { resumoDoCaixa, type LinhaDoCaixa } from "@/lib/financeiro/caixa";
import { formatCents } from "@/lib/money";
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Repeat,
  Trash,
} from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import { CartoesDoMes } from "./CartoesDoMes";
import {
  dataCurta,
  nomeDoMes,
  useCaixa,
  useConfirmarLancamento,
  useRemoverLancamento,
  type ContatoDoCaixa,
} from "./dados";
import { DialogoDeLancamento, rascunhoVazio, type RascunhoDeLancamento } from "./DialogoDeLancamento";
import { DespesasPorCategoria, FluxoMensal } from "./Graficos";
import { SeletorDeMes } from "./SeletorDeMes";

type Vista = "extrato" | "fluxo" | "categorias";
type Filtro = "all" | "in" | "out" | "pending" | "paid";

export function Caixa({ mesInicial, mesAtual }: { mesInicial: string; mesAtual: string }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const [mes, setMes] = useState(mesInicial);
  const [vista, setVista] = useState<Vista>("extrato");
  const [filtro, setFiltro] = useState<Filtro>("all");
  const [busca, setBusca] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [rascunho, setRascunho] = useState<RascunhoDeLancamento | null>(null);

  const caixa = useCaixa(mes);
  const confirmar = useConfirmarLancamento();
  const remover = useRemoverLancamento();

  const dados = caixa.data;
  const rotuloDoPeriodo = mes === "todos" ? t("todos os meses") : nomeDoMes(mes, tag);

  const nomeDaCategoria = useMemo(() => {
    const m = new Map((dados?.categorias ?? []).map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? (m.get(id) ?? t("Categoria removida")) : t("Sem categoria"));
  }, [dados?.categorias, t]);

  const contatoPorId = useMemo(
    () => new Map<string, ContatoDoCaixa>((dados?.contatos ?? []).map((c) => [c.id, c])),
    [dados?.contatos],
  );

  const linhas = dados?.linhas ?? [];
  const contagem = {
    all: linhas.length,
    in: linhas.filter((l) => l.direction === "in").length,
    out: linhas.filter((l) => l.direction === "out").length,
    pending: linhas.filter((l) => l.status === "pending").length,
    paid: linhas.filter((l) => l.status === "paid").length,
  };

  const termo = busca.trim().toLowerCase();
  const visiveis = linhas.filter((l) => {
    if (filtro === "in" && l.direction !== "in") return false;
    if (filtro === "out" && l.direction !== "out") return false;
    if (filtro === "pending" && l.status !== "pending") return false;
    if (filtro === "paid" && l.status !== "paid") return false;
    if (categoriaFiltro && (l.account_plan_id ?? "sem") !== categoriaFiltro) return false;
    if (!termo) return true;
    const contato = l.contact_id ? contatoPorId.get(l.contact_id) : undefined;
    const alvo = [
      l.description ?? "",
      nomeDaCategoria(l.account_plan_id),
      contato ? rotuloDoContato(contato, t) : "",
      (l.amount_cents / 100).toFixed(2).replace(".", ","),
    ]
      .join(" ")
      .toLowerCase();
    return alvo.includes(termo);
  });
  const totalDoFiltro = resumoDoCaixa(visiveis);

  function corrigir(l: LinhaDoCaixa) {
    if (!l.id) return;
    setRascunho({
      id: l.id,
      direction: l.direction,
      account_plan_id: l.account_plan_id,
      description: l.description ?? "",
      amount_cents: l.amount_cents,
      entry_date: l.entry_date,
      status: l.status,
      contato: l.contact_id ? (contatoPorId.get(l.contact_id) ?? { id: l.contact_id }) : null,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-2">
        <SeletorDeMes mes={mes} mesAtual={mesAtual} onMudar={setMes} permiteTodos />
        <div role="tablist" aria-label={t("Vista do caixa")} className="flex gap-1">
          {(
            [
              ["extrato", `${t("Extrato")} (${contagem.all})`],
              ["fluxo", t("Fluxo mensal")],
              ["categorias", t("Despesas por categoria")],
            ] as const
          ).map(([id, rotulo]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={vista === id}
              data-testid={`vista-${id}`}
              onClick={() => setVista(id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm",
                vista === id ? "bg-accent-soft font-medium text-accent" : "text-text-muted hover:text-text",
              )}
            >
              {rotulo}
            </button>
          ))}
        </div>
      </div>

      {caixa.isLoading ? <p className="text-sm text-text-muted">{t("Carregando…")}</p> : null}
      {caixa.isError ? (
        <p className="text-sm text-error">{t("Não foi possível carregar o caixa. Tente de novo.")}</p>
      ) : null}

      {dados ? (
        <>
          <CartoesDoMes resumo={dados.resumo} moeda={dados.moeda} rotuloDoPeriodo={rotuloDoPeriodo} />

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

          {vista === "fluxo" ? <FluxoMensal fluxo={dados.fluxo} moeda={dados.moeda} /> : null}
          {vista === "categorias" ? (
            <DespesasPorCategoria
              fatias={dados.por_categoria}
              categorias={dados.categorias}
              moeda={dados.moeda}
              rotuloDoPeriodo={rotuloDoPeriodo}
            />
          ) : null}

          {vista === "extrato" ? (
            <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex min-w-56 flex-1 items-center gap-2 rounded-md border border-border bg-surface-elevated px-2">
                  <MagnifyingGlass size={16} className="text-text-muted" />
                  <input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder={t("Buscar por descrição, categoria, cliente ou valor…")}
                    aria-label={t("Buscar lançamento")}
                    data-testid="busca-no-caixa"
                    className="w-full bg-transparent py-2 text-sm outline-none"
                  />
                </label>
                <select
                  value={categoriaFiltro}
                  aria-label={t("Filtrar por categoria")}
                  onChange={(e) => setCategoriaFiltro(e.target.value)}
                  className="rounded-md border border-border bg-surface-elevated p-2 text-sm"
                >
                  <option value="">{t("Todas as categorias")}</option>
                  <option value="sem">{t("Sem categoria")}</option>
                  {dados.categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Button onClick={() => setRascunho(rascunhoVazio())} data-testid="novo-lancamento">
                  <Plus size={16} />
                  {t("Novo lançamento")}
                </Button>
              </div>

              <div className="flex flex-wrap gap-1" role="group" aria-label={t("Filtrar o extrato")}>
                {(
                  [
                    ["all", t("Todos"), contagem.all],
                    ["in", t("Receitas"), contagem.in],
                    ["out", t("Despesas"), contagem.out],
                    ["pending", t("A confirmar"), contagem.pending],
                    ["paid", t("Confirmados"), contagem.paid],
                  ] as const
                ).map(([id, rotulo, n]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={filtro === id}
                    data-testid={`filtro-${id}`}
                    onClick={() => setFiltro(id)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs",
                      filtro === id
                        ? "border-accent bg-accent-soft font-medium text-accent"
                        : "border-border text-text-muted hover:text-text",
                    )}
                  >
                    {rotulo} ({n})
                  </button>
                ))}
              </div>

              {visiveis.length === 0 ? (
                <p className="py-6 text-center text-sm text-text-muted">
                  {linhas.length === 0
                    ? t("Nenhum lançamento neste período. Comece pelo botão “Novo lançamento”.")
                    : t("Nenhum lançamento com este filtro.")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm" data-testid="extrato">
                    <thead>
                      <tr className="text-left text-xs tracking-wide text-text-muted uppercase">
                        <th className="py-2 font-medium">{t("Data")}</th>
                        <th className="py-2 font-medium">{t("Fluxo")}</th>
                        <th className="py-2 font-medium">{t("Categoria")}</th>
                        <th className="py-2 font-medium">{t("Descrição")}</th>
                        <th className="py-2 font-medium">{t("Situação")}</th>
                        <th className="py-2 text-right font-medium">{t("Valor")}</th>
                        <th className="py-2 text-right font-medium">{t("Ações")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiveis.map((l) => {
                        const contato = l.contact_id ? contatoPorId.get(l.contact_id) : undefined;
                        const entrada = l.direction === "in";
                        const previsto = l.id === null;
                        return (
                          <tr
                            key={l.id ?? `previsto-${l.recurring_entry_id}-${l.entry_date}`}
                            className={cn("border-t border-border/60", previsto && "text-text-muted")}
                            data-testid="linha-do-extrato"
                          >
                            <td className="py-2 tabular-nums">{dataCurta(l.entry_date, tag)}</td>
                            <td className="py-2">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1",
                                  entrada ? "text-success" : "text-error",
                                )}
                              >
                                {entrada ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                                {entrada ? t("Entrada") : t("Saída")}
                              </span>
                            </td>
                            <td className="py-2">
                              <span className="rounded bg-surface-elevated px-2 py-0.5 text-xs">
                                {nomeDaCategoria(l.account_plan_id)}
                              </span>
                            </td>
                            <td className="py-2">
                              <span className="font-medium">{l.description ?? "—"}</span>
                              {l.recurring_entry_id ? (
                                <Repeat
                                  size={12}
                                  className="ml-1 inline text-text-muted"
                                  aria-label={t("Mensal")}
                                />
                              ) : null}
                              {contato ? (
                                <span className="block text-xs text-text-muted">{rotuloDoContato(contato, t)}</span>
                              ) : null}
                            </td>
                            <td className="py-2">
                              <Situacao linha={l} />
                            </td>
                            <td
                              className={cn(
                                "py-2 text-right font-medium tabular-nums",
                                entrada ? "text-success" : "text-text",
                              )}
                            >
                              {entrada ? "+ " : "− "}
                              {formatCents(l.amount_cents, l.currency)}
                            </td>
                            <td className="py-2 text-right whitespace-nowrap">
                              {!previsto && l.status === "pending" ? (
                                <IconeDeAcao
                                  rotulo={entrada ? t("Confirmar recebimento") : t("Confirmar pagamento")}
                                  onClick={() => confirmar.mutate(l.id!)}
                                  testId="confirmar-lancamento"
                                >
                                  <Check size={16} />
                                </IconeDeAcao>
                              ) : null}
                              {!previsto && (l.origin === "manual" || l.origin === "recurring") ? (
                                <IconeDeAcao rotulo={t("Corrigir")} onClick={() => corrigir(l)} testId="corrigir-lancamento">
                                  <PencilSimple size={16} />
                                </IconeDeAcao>
                              ) : null}
                              {!previsto && l.status === "pending" && l.origin === "manual" ? (
                                <IconeDeAcao
                                  rotulo={t("Apagar lançamento")}
                                  testId="apagar-lancamento"
                                  onClick={() => {
                                    if (window.confirm(t("Apagar este lançamento pendente?"))) remover.mutate(l.id!);
                                  }}
                                >
                                  <Trash size={16} />
                                </IconeDeAcao>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-border text-xs text-text-muted">
                        <td colSpan={4} className="py-2">
                          {t("Total no filtro")}: {visiveis.length} {t("lançamentos")}
                        </td>
                        <td colSpan={3} className="py-2 text-right tabular-nums" data-testid="total-do-filtro">
                          <span className="text-success">
                            +{formatCents(totalDoFiltro.receitas_realizadas_cents + totalDoFiltro.a_receber_cents, dados.moeda)}
                          </span>
                          {"  "}
                          <span>
                            −{formatCents(totalDoFiltro.despesas_realizadas_cents + totalDoFiltro.a_pagar_cents, dados.moeda)}
                          </span>
                          {"  ·  "}
                          <span className="font-medium text-text">
                            {t("Líquido")}: {formatCents(totalDoFiltro.resultado_previsto_cents, dados.moeda)}
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </section>
          ) : null}

          {rascunho ? (
            <DialogoDeLancamento
              aberto
              onFechar={() => setRascunho(null)}
              inicial={rascunho}
              categorias={dados.categorias}
              contas={dados.contas}
              moeda={dados.moeda}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Situacao({ linha }: { linha: LinhaDoCaixa }) {
  const t = useT();
  if (linha.id === null) {
    return <span className="text-xs text-text-muted">{t("Previsto")}</span>;
  }
  if (linha.status === "paid") {
    return (
      <span className="text-xs text-success">{linha.direction === "in" ? t("Recebido") : t("Pago")}</span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-warning">
      <span className="size-1.5 rounded-full bg-warning" />
      {linha.direction === "in" ? t("A receber") : t("A pagar")}
    </span>
  );
}

function IconeDeAcao({
  rotulo,
  onClick,
  testId,
  children,
}: {
  rotulo: string;
  onClick: () => void;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      data-testid={testId}
      onClick={onClick}
      className="ml-1 inline-flex rounded p-1.5 text-text-muted hover:bg-surface-elevated hover:text-text"
    >
      {children}
    </button>
  );
}
