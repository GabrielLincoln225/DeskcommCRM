"use client";
/**
 * TAREFAS POR CLIENTE — o checklist de cada cliente dentro da aba Tarefas.
 *
 * À esquerda, os clientes que têm tarefa ou tarefa recorrente (mais os que a
 * pessoa acabou de "adicionar", ainda sem nada). À direita, o cliente escolhido:
 * as tarefas dele como checklist, a Nova tarefa já presa a ele (com "Repetir
 * todo mês") e as recorrentes dele, com pausar e apagar.
 *
 * Não é tabela nova: é a MESMA `crm_tasks` filtrada por `contact_id`, e as
 * MESMAS recorrências (9003). Uma tarefa criada aqui aparece na Lista e no
 * Calendário, e vice-versa.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { SeletorDeContato } from "@/components/kanban/SeletorDeContato";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useTasks } from "@/hooks/tasks/useTasks";
import { apiClient } from "@/lib/api/client";
import { rotuloDoContato, type ContatoNomeavel } from "@/lib/contacts/rotulo-do-contato";
import type { NovaTarefa, Tarefa } from "@/lib/tarefas/tipos";
import type { Contact } from "@/lib/types/contacts";
import { Plus, Trash } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import { FormularioDeTarefa } from "./FormularioDeTarefa";
import { ListaDeTarefas } from "./ListaDeTarefas";

type Cliente = ContatoNomeavel & { id: string };

interface Recorrencia {
  id: string;
  title: string;
  day_of_month: number;
  due_time: string;
  is_active: boolean;
  contact_id: string | null;
  contact: Cliente | null;
}

const CHAVE_RECORRENTES = ["tarefas-recorrentes"] as const;

export function TarefasPorCliente({ podeEditar }: { podeEditar: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const todas = useTasks({});
  const recorrentes = useQuery({
    queryKey: CHAVE_RECORRENTES,
    queryFn: async () => (await apiClient.get<{ data: Recorrencia[] }>("/api/v1/tasks/recorrencias")).data,
  });
  const [anexados, setAnexados] = useState<Cliente[]>([]);
  const [escolhido, setEscolhido] = useState<Cliente | null>(null);
  const [adicionando, setAdicionando] = useState(false);

  const clientes = useMemo(() => {
    const mapa = new Map<string, { cliente: Cliente; abertas: number; total: number; recorrentes: number }>();
    const garantir = (c: Cliente) => {
      if (!mapa.has(c.id)) mapa.set(c.id, { cliente: c, abertas: 0, total: 0, recorrentes: 0 });
      return mapa.get(c.id)!;
    };
    for (const tarefa of todas.tarefas) {
      if (!tarefa.contact_id || tarefa.status === "cancelled") continue;
      const linha = garantir(tarefa.contact ?? { id: tarefa.contact_id });
      linha.total += 1;
      if (tarefa.status !== "done") linha.abertas += 1;
    }
    for (const r of recorrentes.data ?? []) {
      if (!r.contact_id) continue;
      garantir(r.contact ?? { id: r.contact_id }).recorrentes += 1;
    }
    for (const c of anexados) garantir(c);
    return [...mapa.values()].sort((a, b) =>
      rotuloDoContato(a.cliente, t).localeCompare(rotuloDoContato(b.cliente, t)),
    );
  }, [todas.tarefas, recorrentes.data, anexados, t]);

  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]" data-testid="tarefas-por-cliente">
      <aside className="flex flex-col gap-2">
        {podeEditar ? (
          adicionando ? (
            <div className="rounded-md border border-border p-2">
              <SeletorDeContato
                escolhido={null}
                onEscolher={(c: Contact | null) => {
                  if (c) {
                    const cliente = { id: c.id, name: c.name, display_name: c.display_name, phone_number: c.phone_number };
                    setAnexados((atual) => (atual.some((x) => x.id === c.id) ? atual : [...atual, cliente]));
                    setEscolhido(cliente);
                  }
                  setAdicionando(false);
                }}
              />
            </div>
          ) : (
            <Button variant="outline" size="sm" className="justify-start gap-1.5" onClick={() => setAdicionando(true)}>
              <Plus size={14} aria-hidden />
              {t("Adicionar cliente")}
            </Button>
          )
        ) : null}

        {todas.carregando ? (
          <p className="text-sm text-text-muted">{t("Carregando…")}</p>
        ) : clientes.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-3 text-xs text-text-muted">
            {t("Nenhum cliente com tarefas ainda. Adicione um cliente para montar o checklist dele.")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {clientes.map(({ cliente, abertas, total, recorrentes: rec }) => (
              <li key={cliente.id}>
                <button
                  type="button"
                  onClick={() => setEscolhido(cliente)}
                  className={cn(
                    "flex w-full flex-col rounded-md border px-3 py-2 text-left",
                    escolhido?.id === cliente.id ? "border-accent bg-accent/10" : "border-border hover:border-accent",
                  )}
                >
                  <span className="truncate text-sm font-medium">{rotuloDoContato(cliente, t)}</span>
                  <span className="text-xs text-text-muted">
                    {abertas} {t("em aberto")} · {total - abertas} {t("feitas")}
                    {rec > 0 ? ` · ${rec} ${t("recorrentes")}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="min-w-0">
        {escolhido ? (
          <ChecklistDoCliente
            key={escolhido.id}
            cliente={escolhido}
            podeEditar={podeEditar}
            recorrentes={(recorrentes.data ?? []).filter((r) => r.contact_id === escolhido.id)}
            aoMudarRecorrentes={() => void qc.invalidateQueries({ queryKey: CHAVE_RECORRENTES })}
          />
        ) : (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-text-muted">
            {t("Escolha um cliente à esquerda para ver e montar o checklist dele.")}
          </div>
        )}
      </section>
    </div>
  );
}

function ChecklistDoCliente({
  cliente,
  podeEditar,
  recorrentes,
  aoMudarRecorrentes,
}: {
  cliente: Cliente;
  podeEditar: boolean;
  recorrentes: Recorrencia[];
  aoMudarRecorrentes: () => void;
}) {
  const t = useT();
  const { tarefas, carregando, criarTarefa, editarTarefa, apagarTarefa, alternarConcluida } = useTasks({
    contact_id: cliente.id,
  });
  const [formAberto, setFormAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<Tarefa | null>(null);
  const [aberturas, setAberturas] = useState(0);

  const visiveis = tarefas.filter((x) => x.status !== "cancelled");
  const feitas = visiveis.filter((x) => x.status === "done").length;
  const percentual = visiveis.length === 0 ? 0 : Math.round((feitas / visiveis.length) * 100);

  const alternar = useMutation({
    mutationFn: (r: Recorrencia) => apiClient.patch(`/api/v1/tasks/recorrencias/${r.id}`, { is_active: !r.is_active }),
    onSuccess: aoMudarRecorrentes,
    onError: showApiError,
  });
  const apagar = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/tasks/recorrencias/${id}`),
    onSuccess: aoMudarRecorrentes,
    onError: showApiError,
  });

  const abrir = (tarefa: Tarefa | null) => {
    setEmEdicao(tarefa);
    setAberturas((n) => n + 1);
    setFormAberto(true);
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3 rounded-md border border-border p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{rotuloDoContato(cliente, t)}</h2>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-elevated">
              <div className="h-full bg-accent" style={{ width: `${percentual}%` }} />
            </div>
            <span className="text-xs tabular-nums text-text-muted" data-testid="cliente-progresso">
              {feitas}/{visiveis.length}
            </span>
          </div>
        </div>
        {podeEditar ? (
          <Button size="sm" className="gap-1.5" onClick={() => abrir(null)} data-testid="cliente-nova-tarefa">
            <Plus size={14} aria-hidden />
            {t("Nova tarefa")}
          </Button>
        ) : null}
      </header>

      {carregando ? (
        <p className="text-sm text-text-muted">{t("Carregando…")}</p>
      ) : visiveis.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-text-muted">
          {t("Nenhuma tarefa para este cliente ainda. Use Nova tarefa — marque Repetir todo mês para as mensais.")}
        </p>
      ) : (
        <ListaDeTarefas
          tarefas={visiveis}
          podeEditar={podeEditar}
          aoAlternarConcluida={alternarConcluida}
          aoEditar={(tarefa) => abrir(tarefa)}
          aoApagar={(tarefa) => apagarTarefa(tarefa.id)}
        />
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t("Recorrentes deste cliente")}</h3>
        {recorrentes.length === 0 ? (
          <p className="text-xs text-text-muted">{t("Nenhuma. Na Nova tarefa, marque Repetir todo mês.")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {recorrentes.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {r.title}
                    {!r.is_active ? <span className="ml-2 text-xs text-text-muted">({t("pausada")})</span> : null}
                  </p>
                  <p className="text-xs text-text-muted">
                    {t("Todo dia")} {r.day_of_month} {t("às")} {r.due_time}
                  </p>
                </div>
                {podeEditar ? (
                  <>
                    <Button variant="outline" size="sm" disabled={alternar.isPending} onClick={() => alternar.mutate(r)}>
                      {r.is_active ? t("Pausar") : t("Retomar")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={t("Apagar recorrência")}
                      disabled={apagar.isPending}
                      onClick={() => {
                        if (window.confirm(t("Apagar esta recorrência? As tarefas já criadas continuam; só param de nascer as próximas."))) {
                          apagar.mutate(r.id);
                        }
                      }}
                    >
                      <Trash size={14} aria-hidden />
                    </Button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <FormularioDeTarefa
        key={aberturas}
        aberto={formAberto}
        aoMudarAbertura={(v) => {
          setFormAberto(v);
          if (!v) aoMudarRecorrentes();
        }}
        tarefa={emEdicao}
        contactId={cliente.id}
        aoSalvar={async (entrada: NovaTarefa) => {
          if (emEdicao) await editarTarefa(emEdicao.id, entrada);
          else await criarTarefa({ ...entrada, contact_id: cliente.id });
        }}
      />
    </div>
  );
}
