"use client";
/**
 * O PAINEL FINANCEIRO — a pergunta de quem abre: "como está o caixa este mês?".
 *
 * Os quatro cartões do mês e, embaixo, os negócios ganhos no funil que ainda
 * não viraram lançamento. Esta segunda parte é a ponte com o CRM: fechar um
 * negócio não lança nada sozinho (o valor do negócio nem sempre é dinheiro a
 * receber), então o Painel SUGERE — com valor, cliente e descrição já
 * preenchidos — e quem decide é a pessoa, num clique.
 */
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { formatCents } from "@/lib/money";
import { CashRegister } from "@/lib/ui/icons";

import { CartoesDoMes } from "./CartoesDoMes";
import {
  dataCurta,
  nomeDoMes,
  useCaixa,
  useGanhosSemLancamento,
  type ContatoDoCaixa,
  type GanhoSemLancamento,
} from "./dados";
import { DialogoDeLancamento, type RascunhoDeLancamento } from "./DialogoDeLancamento";
import { SeletorDeMes } from "./SeletorDeMes";

export function Painel({ mesAtual }: { mesAtual: string }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const [mes, setMes] = useState(mesAtual);
  const caixa = useCaixa(mes);
  const ganhos = useGanhosSemLancamento();
  const [rascunho, setRascunho] = useState<RascunhoDeLancamento | null>(null);

  const contatos = new Map<string, ContatoDoCaixa>((ganhos.data?.contatos ?? []).map((c) => [c.id, c]));

  function lancar(g: GanhoSemLancamento) {
    setRascunho({
      direction: "in",
      account_plan_id: null,
      description: g.title,
      amount_cents: g.value_cents,
      entry_date: new Date().toISOString().slice(0, 10),
      status: "pending",
      contato: g.contact_id ? (contatos.get(g.contact_id) ?? { id: g.contact_id }) : null,
      lead_id: g.id,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SeletorDeMes mes={mes} mesAtual={mesAtual} onMudar={setMes} />
        <Button asChild variant="secondary">
          <Link href="/app/financeiro/caixa">
            <CashRegister size={16} />
            {t("Abrir o caixa")}
          </Link>
        </Button>
      </div>

      {caixa.isLoading ? <p className="text-sm text-text-muted">{t("Carregando…")}</p> : null}
      {caixa.isError ? (
        <p className="text-sm text-error">{t("Não foi possível carregar o caixa. Tente de novo.")}</p>
      ) : null}
      {caixa.data ? (
        <CartoesDoMes resumo={caixa.data.resumo} moeda={caixa.data.moeda} rotuloDoPeriodo={nomeDoMes(mes, tag)} />
      ) : null}

      <section className="rounded-lg border border-border bg-surface p-4" data-testid="ganhos-sem-lancamento">
        <h2 className="text-sm font-semibold">{t("Negócios ganhos aguardando lançamento")}</h2>
        <p className="mb-3 text-xs text-text-muted">
          {t("Ganhos dos últimos 60 dias que ainda não estão no caixa. Lançar cria uma conta a receber ligada ao negócio.")}
        </p>

        {ganhos.isLoading ? <p className="text-sm text-text-muted">{t("Carregando…")}</p> : null}
        {ganhos.data && ganhos.data.ganhos.length === 0 ? (
          <p className="text-sm text-text-muted">{t("Nenhum negócio ganho esperando lançamento.")}</p>
        ) : null}

        <ul className="flex flex-col divide-y divide-border/60">
          {(ganhos.data?.ganhos ?? []).map((g) => {
            const contato = g.contact_id ? contatos.get(g.contact_id) : undefined;
            return (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{g.title}</p>
                  <p className="text-xs text-text-muted">
                    {contato ? `${rotuloDoContato(contato, t)} · ` : ""}
                    {t("ganho em")} {dataCurta(g.closed_at, tag)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-success tabular-nums">
                    {formatCents(g.value_cents, g.currency ?? caixa.data?.moeda ?? "BRL")}
                  </span>
                  <Button size="sm" onClick={() => lancar(g)} data-testid="lancar-ganho">
                    {t("Lançar a receber")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {rascunho && caixa.data ? (
        <DialogoDeLancamento
          aberto
          onFechar={() => setRascunho(null)}
          inicial={rascunho}
          categorias={caixa.data.categorias}
          contas={caixa.data.contas}
          moeda={caixa.data.moeda}
        />
      ) : null}
    </div>
  );
}
