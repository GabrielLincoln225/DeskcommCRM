"use client";
/**
 * TAREFAS RECORRENTES — os moldes mensais (migration 9003).
 *
 * Cria-se pela "Nova tarefa" (Repetir todo mês); aqui se vê, pausa, retoma e
 * apaga. Apagar não leva as tarefas já geradas: só param de nascer as próximas.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { apiClient } from "@/lib/api/client";
import { rotuloDoContato, type ContatoNomeavel } from "@/lib/contacts/rotulo-do-contato";
import { CaretLeft, Trash } from "@/lib/ui/icons";

interface Recorrencia {
  id: string;
  title: string;
  description: string | null;
  assigned_to: string | null;
  day_of_month: number;
  due_time: string;
  lead_days: number;
  is_active: boolean;
  contact: (ContatoNomeavel & { id: string }) | null;
}

const CHAVE = ["tarefas-recorrentes"] as const;

export function TarefasRecorrentes() {
  const t = useT();
  const qc = useQueryClient();
  const membros = useAssignableMembers(true);
  const lista = useQuery({
    queryKey: CHAVE,
    queryFn: async () => (await apiClient.get<{ data: Recorrencia[] }>("/api/v1/tasks/recorrencias")).data,
  });
  const invalidar = () => void qc.invalidateQueries({ queryKey: CHAVE });
  const alternar = useMutation({
    mutationFn: (r: Recorrencia) => apiClient.patch(`/api/v1/tasks/recorrencias/${r.id}`, { is_active: !r.is_active }),
    onSuccess: invalidar,
    onError: showApiError,
  });
  const apagar = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/tasks/recorrencias/${id}`),
    onSuccess: invalidar,
    onError: showApiError,
  });
  const nomeDe = (id: string | null) =>
    id ? ((membros.data ?? []).find((m) => m.user_id === id)?.full_name ?? t("Alguém da equipe")) : t("Ninguém");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
      <Link href="/app/tasks" className="flex items-center gap-1 text-sm text-text-muted hover:text-text">
        <CaretLeft size={14} aria-hidden />
        {t("Tarefas")}
      </Link>
      <div>
        <h1 className="text-xl font-semibold">{t("Tarefas recorrentes")}</h1>
        <p className="text-sm text-text-muted">
          {t("Tarefas que voltam todo mês no mesmo dia. Para criar, use Nova tarefa e marque Repetir todo mês.")}
        </p>
      </div>

      {lista.isLoading ? (
        <p className="text-sm text-text-muted">{t("Carregando…")}</p>
      ) : (lista.data ?? []).length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-text-muted">
          {t("Nenhuma tarefa recorrente ainda.")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="recorrentes-lista">
          {(lista.data ?? []).map((r) => (
            <li key={r.id} className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {r.title}
                  {!r.is_active ? <span className="ml-2 text-xs text-text-muted">({t("pausada")})</span> : null}
                </p>
                <p className="text-xs text-text-muted">
                  {t("Todo dia")} {r.day_of_month} {t("às")} {r.due_time} · {t("aparece")} {r.lead_days}{" "}
                  {t("dias antes")} · {nomeDe(r.assigned_to)}
                  {r.contact ? ` · ${rotuloDoContato(r.contact, t)}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" disabled={alternar.isPending} onClick={() => alternar.mutate(r)}>
                  {r.is_active ? t("Pausar") : t("Retomar")}
                </Button>
                <Button
                  variant="outline"
                  aria-label={t("Apagar recorrência")}
                  disabled={apagar.isPending}
                  onClick={() => {
                    if (window.confirm(t("Apagar esta recorrência? As tarefas já criadas continuam; só param de nascer as próximas."))) {
                      apagar.mutate(r.id);
                    }
                  }}
                >
                  <Trash size={16} aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
