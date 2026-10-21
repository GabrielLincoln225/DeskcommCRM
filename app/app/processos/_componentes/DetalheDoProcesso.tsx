"use client";
/**
 * O CHECKLIST DE UM CLIENTE.
 *
 * Cada passo: marcar como feito (a rota grava quem e quando), responsável,
 * prazo e observação. A observação salva ao sair do campo, não a cada tecla —
 * cada gravação é uma linha de auditoria.
 *
 * Concluir ou cancelar o processo é decisão separada dos itens: um passo que
 * não se aplicou a este cliente não precisa ser marcado para encerrar.
 */
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { CaretLeft } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import {
  dataCurta,
  useAlterarItem,
  useAlterarProcesso,
  useMembros,
  useProcesso,
  type ItemDoProcesso,
  type Membro,
  type MudancaDoItem,
} from "./dados";

export function DetalheDoProcesso({ id, podeEditar }: { id: string; podeEditar: boolean }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const consulta = useProcesso(id);
  const membros = useMembros();
  const alterarProcesso = useAlterarProcesso(id);
  const alterarItem = useAlterarItem(id);

  if (consulta.isLoading) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;
  if (consulta.isError || !consulta.data) {
    return <p className="text-sm text-destructive">{t("Não foi possível carregar o processo.")}</p>;
  }
  const { processo, itens, hoje } = consulta.data;
  const { feitos, total, percentual, atrasados } = processo.progresso;
  const aberto = processo.status === "open";
  const situacao =
    processo.status === "done" ? t("Concluído") : processo.status === "cancelled" ? t("Cancelado") : t("Em andamento");

  const salvar = (itemId: string, mudanca: MudancaDoItem) => alterarItem.mutate({ itemId, mudanca });

  return (
    <div className="flex flex-col gap-4">
      <Link href="/app/processos" className="flex items-center gap-1 text-sm text-text-muted hover:text-text">
        <CaretLeft size={14} aria-hidden />
        {t("Processos")}
      </Link>

      <header className="flex flex-col gap-3 rounded-md border border-border p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{rotuloDoContato(processo.contacts, t)}</h1>
          <p className="text-sm text-text-muted">
            {processo.name} · {situacao}
            {processo.origin === "funil" ? ` · ${t("aberto pelo funil")}` : ""} · {t("desde")}{" "}
            {dataCurta(processo.created_at, tag)}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-elevated">
              <div className="h-full bg-accent" style={{ width: `${percentual}%` }} />
            </div>
            <span className="text-sm tabular-nums text-text-muted" data-testid="processo-progresso">
              {feitos}/{total} · {percentual}%
            </span>
          </div>
          {atrasados > 0 ? (
            <p className="mt-1 text-xs text-destructive">
              {atrasados} {atrasados === 1 ? t("passo atrasado") : t("passos atrasados")}
            </p>
          ) : null}
        </div>
        {podeEditar ? (
          <div className="flex flex-wrap gap-2">
            {processo.contacts ? (
              <Button variant="outline" asChild>
                <Link href={`/app/contacts/${processo.contact_id}`}>{t("Ver contato")}</Link>
              </Button>
            ) : null}
            {aberto ? (
              <>
                <Button
                  variant="outline"
                  disabled={alterarProcesso.isPending}
                  onClick={() => alterarProcesso.mutate("cancelled")}
                >
                  {t("Cancelar processo")}
                </Button>
                <Button disabled={alterarProcesso.isPending} onClick={() => alterarProcesso.mutate("done")}>
                  {t("Concluir processo")}
                </Button>
              </>
            ) : (
              <Button variant="outline" disabled={alterarProcesso.isPending} onClick={() => alterarProcesso.mutate("open")}>
                {t("Reabrir processo")}
              </Button>
            )}
          </div>
        ) : null}
      </header>

      <ol className="flex flex-col gap-2" data-testid="processo-itens">
        {itens.map((item, i) => (
          <LinhaDoItem
            key={item.id}
            numero={i + 1}
            item={item}
            hoje={hoje}
            tag={tag}
            membros={membros.data ?? []}
            podeEditar={podeEditar}
            onSalvar={(m) => salvar(item.id, m)}
          />
        ))}
      </ol>
    </div>
  );
}

function LinhaDoItem({
  numero,
  item,
  hoje,
  tag,
  membros,
  podeEditar,
  onSalvar,
}: {
  numero: number;
  item: ItemDoProcesso;
  hoje: string;
  tag: string;
  membros: Membro[];
  podeEditar: boolean;
  onSalvar: (m: MudancaDoItem) => void;
}) {
  const t = useT();
  const feito = item.done_at !== null;
  const atrasado = !feito && item.due_date !== null && item.due_date < hoje;
  const [nota, setNota] = useState(item.note ?? "");
  const [abrirNota, setAbrirNota] = useState(Boolean(item.note));
  const nomeDe = (userId: string | null) =>
    membros.find((m) => m.user_id === userId)?.full_name ?? (userId ? t("Alguém da equipe") : null);

  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-md border p-3",
        atrasado ? "border-destructive/50" : "border-border",
        feito ? "bg-surface-elevated/50" : "",
      )}
      data-testid="processo-item"
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={feito}
          disabled={!podeEditar}
          onChange={(e) => onSalvar({ done: e.target.checked })}
          className="mt-1 h-4 w-4 shrink-0 accent-accent"
          aria-label={item.title}
        />
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm", feito ? "text-text-muted line-through" : "font-medium")}>
            <span className="tabular-nums text-text-muted">{numero}.</span> {item.title}
          </p>
          {feito ? (
            <p className="text-xs text-text-muted">
              {t("Feito em")} {dataCurta(item.done_at!, tag)}
              {item.done_by ? ` ${t("por")} ${nomeDe(item.done_by)}` : ` · ${t("marcado ao abrir pelo funil")}`}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pl-7 text-xs">
        <label className="flex items-center gap-1">
          <span className="text-text-muted">{t("Responsável")}</span>
          <select
            value={item.assignee_user_id ?? ""}
            disabled={!podeEditar}
            onChange={(e) => onSalvar({ assignee_user_id: e.target.value || null })}
            className="rounded-md border border-border bg-surface-elevated px-1 py-0.5 text-xs text-text"
          >
            <option value="">{t("Ninguém")}</option>
            {membros.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name ?? t("Sem nome")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className={cn(atrasado ? "text-destructive" : "text-text-muted")}>
            {atrasado ? t("Atrasado desde") : t("Prazo")}
          </span>
          <input
            type="date"
            value={item.due_date ?? ""}
            disabled={!podeEditar}
            onChange={(e) => onSalvar({ due_date: e.target.value || null })}
            className="rounded-md border border-border bg-surface-elevated px-1 py-0.5 text-xs text-text"
          />
        </label>
        {!abrirNota && podeEditar ? (
          <button type="button" className="text-accent hover:underline" onClick={() => setAbrirNota(true)}>
            {t("Adicionar observação")}
          </button>
        ) : null}
      </div>

      {abrirNota ? (
        <textarea
          value={nota}
          disabled={!podeEditar}
          onChange={(e) => setNota(e.target.value)}
          onBlur={() => {
            if ((item.note ?? "") !== nota.trim()) onSalvar({ note: nota.trim() || null });
          }}
          rows={2}
          placeholder={t("Observação (ex.: link do grupo, resumo da reunião)")}
          className="ml-7 rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
        />
      ) : null}
    </li>
  );
}
