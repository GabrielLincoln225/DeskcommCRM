"use client";
/**
 * Mês anterior · mês escolhido · próximo mês — e, no Caixa, a visão
 * consolidada ("Todos os meses"), que é o único recorte além do mês.
 */
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { CaretLeft, CaretRight } from "@/lib/ui/icons";

import { nomeDoMes, somarMes } from "./dados";

export function SeletorDeMes({
  mes,
  mesAtual,
  onMudar,
  permiteTodos = false,
}: {
  /** "2026-10" ou "todos". */
  mes: string;
  mesAtual: string;
  onMudar: (mes: string) => void;
  permiteTodos?: boolean;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const todos = mes === "todos";
  const base = todos ? mesAtual : mes;
  // Do mês atual, seis para trás e doze para frente: o passado que ainda se
  // confere e o futuro que as recorrências já preveem.
  const opcoes = Array.from({ length: 19 }, (_, i) => somarMes(mesAtual, 12 - i));
  if (!todos && !opcoes.includes(mes)) opcoes.push(mes);

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label={t("Mês anterior")}
        disabled={todos}
        onClick={() => onMudar(somarMes(base, -1))}
        className="rounded-md p-2 text-text-muted hover:bg-surface-elevated hover:text-text disabled:opacity-40"
      >
        <CaretLeft size={16} />
      </button>
      <select
        aria-label={t("Período")}
        value={mes}
        data-testid="seletor-de-mes"
        onChange={(e) => onMudar(e.target.value)}
        className="rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm font-medium text-text"
      >
        {permiteTodos ? <option value="todos">{t("Todos os meses (consolidado)")}</option> : null}
        {opcoes.map((m) => (
          <option key={m} value={m}>
            {nomeDoMes(m, tag)}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label={t("Próximo mês")}
        disabled={todos}
        onClick={() => onMudar(somarMes(base, 1))}
        className="rounded-md p-2 text-text-muted hover:bg-surface-elevated hover:text-text disabled:opacity-40"
      >
        <CaretRight size={16} />
      </button>
    </div>
  );
}
