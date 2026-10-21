"use client";
/**
 * A LISTA DE PROCESSOS — um cliente por linha, com o quanto falta.
 *
 * O progresso vem pronto da rota (`progressoDoProcesso`, a mesma conta do
 * detalhe). A tela só filtra pelo que a pessoa digitou e escolhe a situação.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SeletorDeContato } from "@/components/kanban/SeletorDeContato";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import type { Contact } from "@/lib/types/contacts";
import { MagnifyingGlass, Plus } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import {
  dataCurta,
  useIniciarProcesso,
  useModelos,
  useProcessos,
  type Processo,
  type SituacaoDoProcesso,
} from "./dados";

type Filtro = SituacaoDoProcesso | "all";

export function ListaDeProcessos({ podeEditar }: { podeEditar: boolean }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const [filtro, setFiltro] = useState<Filtro>("open");
  const [busca, setBusca] = useState("");
  const [iniciando, setIniciando] = useState(false);
  const consulta = useProcessos(filtro);

  const filtros: { id: Filtro; rotulo: string }[] = [
    { id: "open", rotulo: t("Em andamento") },
    { id: "done", rotulo: t("Concluídos") },
    { id: "cancelled", rotulo: t("Cancelados") },
    { id: "all", rotulo: t("Todos") },
  ];

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const todos = consulta.data?.processos ?? [];
    if (!termo) return todos;
    return todos.filter(
      (p) =>
        rotuloDoContato(p.contacts, t).toLowerCase().includes(termo) || p.name.toLowerCase().includes(termo),
    );
  }, [busca, consulta.data, t]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-md border border-border p-1" role="tablist" aria-label={t("Situação")}>
          {filtros.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filtro === f.id}
              onClick={() => setFiltro(f.id)}
              className={cn(
                "rounded-sm px-3 py-1 text-sm",
                filtro === f.id ? "bg-accent text-accent-fg" : "text-text-muted hover:text-text",
              )}
            >
              {f.rotulo}
            </button>
          ))}
        </div>
        <label className="flex flex-1 items-center gap-2 rounded-md border border-border px-2 py-1 sm:max-w-xs">
          <MagnifyingGlass size={16} className="text-text-muted" aria-hidden />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={t("Buscar cliente ou processo")}
            className="w-full bg-transparent text-sm outline-hidden"
            data-testid="processos-busca"
          />
        </label>
        {podeEditar ? (
          <Button className="ml-auto" onClick={() => setIniciando(true)} data-testid="processos-iniciar">
            <Plus size={16} aria-hidden />
            {t("Iniciar processo")}
          </Button>
        ) : null}
      </div>

      {consulta.isLoading ? (
        <p className="text-sm text-text-muted">{t("Carregando…")}</p>
      ) : consulta.isError ? (
        <p className="text-sm text-destructive">{t("Não foi possível carregar os processos.")}</p>
      ) : lista.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-text-muted">
          {filtro === "open"
            ? t("Nenhum processo em andamento. Inicie um para um cliente ou deixe o funil abrir sozinho quando o negócio fechar.")
            : t("Nada por aqui.")}
        </div>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="processos-lista">
          {lista.map((p) => (
            <LinhaDoProcesso key={p.id} processo={p} tag={tag} />
          ))}
        </ul>
      )}

      {iniciando ? <DialogoIniciar onFechar={() => setIniciando(false)} /> : null}
    </div>
  );
}

function LinhaDoProcesso({ processo: p, tag }: { processo: Processo; tag: string }) {
  const t = useT();
  const { feitos, total, percentual, atrasados, proximo } = p.progresso;
  return (
    <li>
      <Link
        href={`/app/processos/${p.id}`}
        className="flex flex-col gap-2 rounded-md border border-border p-3 hover:border-accent sm:flex-row sm:items-center sm:gap-4"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{rotuloDoContato(p.contacts, t)}</p>
          <p className="truncate text-xs text-text-muted">
            {p.name}
            {p.origin === "funil" ? ` · ${t("aberto pelo funil")}` : ""}
            {" · "}
            {t("desde")} {dataCurta(p.created_at, tag)}
          </p>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-elevated">
              <div className="h-full bg-accent" style={{ width: `${percentual}%` }} />
            </div>
            <span className="text-xs tabular-nums text-text-muted">
              {feitos}/{total}
            </span>
          </div>
          <p className="truncate text-xs text-text-muted">
            {proximo ? `${t("Próximo")}: ${proximo.title}` : t("Todos os passos feitos")}
          </p>
        </div>
        {atrasados > 0 ? (
          <span className="self-start rounded-md bg-destructive/15 px-2 py-0.5 text-xs text-destructive sm:self-center">
            {atrasados} {atrasados === 1 ? t("atrasado") : t("atrasados")}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function DialogoIniciar({ onFechar }: { onFechar: () => void }) {
  const t = useT();
  const modelos = useModelos();
  const iniciar = useIniciarProcesso();
  const router = useRouter();
  const ativos = (modelos.data ?? []).filter((m) => m.is_active && m.steps.length > 0);
  const [contato, setContato] = useState<Contact | null>(null);
  const [modeloId, setModeloId] = useState<string>("");
  const escolhido = modeloId || ativos[0]?.id || "";

  return (
    <Dialog open onOpenChange={(aberto) => (aberto ? null : onFechar())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Iniciar processo")}</DialogTitle>
          <DialogDescription>{t("Escolha o cliente e o modelo. Os passos do modelo viram o checklist dele.")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <SeletorDeContato escolhido={contato} onEscolher={setContato} />
          {ativos.length === 0 ? (
            <p className="text-sm text-text-muted">
              {t("Nenhum modelo de processo ativo. Crie um em Configurações › Modelos de processo.")}
            </p>
          ) : (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-text-muted">{t("Modelo")}</span>
              <select
                value={escolhido}
                onChange={(e) => setModeloId(e.target.value)}
                className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
                data-testid="processos-modelo"
              >
                {ativos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.steps.length} {t("passos")})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            {t("Cancelar")}
          </Button>
          <Button
            disabled={!contato || !escolhido || iniciar.isPending}
            onClick={() =>
              contato &&
              iniciar.mutate(
                { contact_id: contato.id, template_id: escolhido },
                { onSuccess: (r) => router.push(`/app/processos/${r.id}`) },
              )
            }
            data-testid="processos-confirmar-inicio"
          >
            {iniciar.isPending ? t("Iniciando…") : t("Iniciar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
