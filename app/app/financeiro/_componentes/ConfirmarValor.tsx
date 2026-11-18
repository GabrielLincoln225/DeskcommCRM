"use client";
/**
 * O CONFIRMAR DE UMA LINHA — com a pergunta "quanto foi?" quando o valor é
 * estimado (9004, fork Konnexo).
 *
 * Conta variável (anúncio, comissão) fica aberta com uma estimativa. Confirmá-la
 * com um clique gravaria a estimativa como dinheiro que passou — exatamente o
 * número errado. Então, só nessa linha, o ✓ abre um diálogo com o valor
 * estimado já preenchido; a pessoa digita o real e confirma. Linha de valor
 * certo continua com o clique direto, como sempre foi.
 *
 * Mora num hook porque o Caixa e a visão Geral confirmam a MESMA linha, e duas
 * cópias desta regra seriam uma das telas gravando estimativa como pago.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/hooks/i18n/useT";
import type { LinhaDoCaixa } from "@/lib/financeiro/caixa";
import { formatCents, parseReaisToCents } from "@/lib/money";

import { useConfirmarLancamento, useLancarPrevisto } from "./dados";

function centsParaCampo(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function useConfirmarLinha() {
  const confirmar = useConfirmarLancamento();
  const lancarPrevisto = useLancarPrevisto();
  const [pedindoValor, setPedindoValor] = useState<LinhaDoCaixa | null>(null);

  function gravar(l: LinhaDoCaixa, valorReal?: number, aoTerminar?: () => void) {
    const fim = { onSuccess: () => aoTerminar?.() };
    if (l.id) {
      confirmar.mutate(valorReal === undefined ? { id: l.id } : { id: l.id, amount_cents: valorReal }, fim);
      return;
    }
    if (!l.recurring_entry_id) return;
    lancarPrevisto.mutate(
      {
        recurring_entry_id: l.recurring_entry_id,
        entry_date: l.entry_date,
        pagar: true,
        ...(valorReal === undefined ? {} : { amount_cents: valorReal }),
      },
      fim,
    );
  }

  function confirmarLinha(l: LinhaDoCaixa) {
    if (l.amount_is_estimate) {
      setPedindoValor(l);
      return;
    }
    gravar(l);
  }

  const ocupado = confirmar.isPending || lancarPrevisto.isPending;

  const dialogo = pedindoValor ? (
    <DialogoDoValorReal
      linha={pedindoValor}
      ocupado={ocupado}
      onFechar={() => setPedindoValor(null)}
      onConfirmar={(valor) => gravar(pedindoValor, valor, () => setPedindoValor(null))}
    />
  ) : null;

  return { confirmarLinha, ocupado, dialogo, lancarPrevisto };
}

function DialogoDoValorReal({
  linha,
  ocupado,
  onFechar,
  onConfirmar,
}: {
  linha: LinhaDoCaixa;
  ocupado: boolean;
  onFechar: () => void;
  onConfirmar: (cents: number) => void;
}) {
  const t = useT();
  const [valor, setValor] = useState(centsParaCampo(linha.amount_cents));
  const cents = parseReaisToCents(valor);
  const pode = cents !== null && cents > 0 && !ocupado;
  const entrada = linha.direction === "in";

  return (
    <Dialog open onOpenChange={(v) => (!v ? onFechar() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{entrada ? t("Quanto foi recebido?") : t("Quanto foi pago?")}</DialogTitle>
          <DialogDescription>
            «{linha.description ?? "—"}» {t("estava em aberto com a estimativa de")}{" "}
            {formatCents(linha.amount_cents, linha.currency)}.{" "}
            {t("Digite o valor de verdade; é ele que entra no caixa.")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (pode && cents !== null) onConfirmar(cents);
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text-muted">
              {t("Valor real")} ({linha.currency})
            </span>
            <input
              autoFocus
              value={valor}
              inputMode="decimal"
              data-testid="valor-real"
              onChange={(e) => setValor(e.target.value)}
              className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text tabular-nums"
            />
            {cents !== null && cents > 0 ? (
              <span className="text-xs text-text-muted">{formatCents(cents, linha.currency)}</span>
            ) : null}
          </label>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onFechar}>
              {t("Cancelar")}
            </Button>
            <Button type="submit" disabled={!pode} data-testid="confirmar-valor-real">
              {entrada ? t("Confirmar recebimento") : t("Confirmar pagamento")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
