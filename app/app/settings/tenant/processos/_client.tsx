"use client";
/**
 * MODELOS DE PROCESSO — os passos que se repetem com cada cliente, editados
 * pela tela (admin).
 *
 * Editar um modelo não mexe nos processos já abertos: eles guardam a cópia dos
 * passos do dia em que abriram. A etapa do funil, quando escolhida, abre o
 * processo sozinho para o contato do negócio que chegar nela; os passos
 * marcados como "já feito ao abrir pelo funil" nascem marcados nessa abertura.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { CaretDown, CaretUp, Plus, Trash } from "@/lib/ui/icons";

import {
  useEtapas,
  useModelos,
  useRemoverModelo,
  useSalvarModelo,
  type ModeloDeProcesso,
  type RascunhoDeModelo,
} from "@/app/app/processos/_componentes/dados";

export function AbaProcessosNoMenu() {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const estado = useQuery({
    queryKey: ["settings", "processos-aba"],
    queryFn: async () =>
      (await apiClient.get<{ data: { aba_no_menu: boolean } }>("/api/v1/settings/processos-aba")).data,
  });
  const salvar = useMutation({
    mutationFn: (aba_no_menu: boolean) => apiClient.patch("/api/v1/settings/processos-aba", { aba_no_menu }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings", "processos-aba"] });
      router.refresh();
    },
    onError: showApiError,
  });
  const ligada = estado.data?.aba_no_menu ?? false;

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border p-3" data-testid="aba-processos-no-menu">
      <div className="flex items-center gap-3">
        <Switch
          id="processos_aba_no_menu"
          checked={ligada}
          disabled={estado.isLoading || salvar.isPending}
          onCheckedChange={(v) => salvar.mutate(v)}
        />
        <Label htmlFor="processos_aba_no_menu">{t("Mostrar a aba Processos no menu")}</Label>
      </div>
      <p className="text-xs text-text-muted">
        {t("A aba aparece no CRM para toda a equipe. Desligada, nada é apagado: os processos continuam guardados.")}
      </p>
      {ligada ? (
        <Link href="/app/processos" className="text-xs text-accent hover:underline">
          {t("Abrir Processos")}
        </Link>
      ) : null}
    </section>
  );
}

const vazio: RascunhoDeModelo = {
  name: "",
  description: null,
  trigger_stage_id: null,
  is_active: true,
  steps: [{ title: "", done_on_trigger: false }],
};

export function ModelosDeProcesso() {
  const t = useT();
  const modelos = useModelos();
  const etapas = useEtapas();
  const remover = useRemoverModelo();
  const [editando, setEditando] = useState<{ id: string | null; rascunho: RascunhoDeModelo } | null>(null);

  const nomeDaEtapa = (id: string | null) => {
    const e = (etapas.data ?? []).find((x) => x.id === id);
    return e ? `${e.funil} › ${e.name}` : null;
  };

  const editar = (m: ModeloDeProcesso) =>
    setEditando({
      id: m.id,
      rascunho: {
        name: m.name,
        description: m.description,
        trigger_stage_id: m.trigger_stage_id,
        is_active: m.is_active,
        steps: m.steps.map((s) => ({ title: s.title, done_on_trigger: s.done_on_trigger })),
      },
    });

  if (editando) {
    return <EditorDeModelo inicial={editando.rascunho} id={editando.id} onFechar={() => setEditando(null)} />;
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t("Modelos")}</h2>
        <Button onClick={() => setEditando({ id: null, rascunho: vazio })} data-testid="modelo-novo">
          <Plus size={16} aria-hidden />
          {t("Novo modelo")}
        </Button>
      </div>
      {modelos.isLoading ? (
        <p className="text-sm text-text-muted">{t("Carregando…")}</p>
      ) : (modelos.data ?? []).length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-text-muted">
          {t("Nenhum modelo ainda. Crie o primeiro com os passos que a equipe repete com cada cliente.")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(modelos.data ?? []).map((m) => (
            <li key={m.id} className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {m.name}
                  {!m.is_active ? <span className="ml-2 text-xs text-text-muted">({t("inativo")})</span> : null}
                </p>
                <p className="text-xs text-text-muted">
                  {m.steps.length} {t("passos")}
                  {m.trigger_stage_id
                    ? ` · ${t("abre sozinho em")} ${nomeDaEtapa(m.trigger_stage_id) ?? t("uma etapa do funil")}`
                    : ` · ${t("só abre à mão")}`}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => editar(m)}>
                  {t("Editar")}
                </Button>
                <Button
                  variant="outline"
                  disabled={remover.isPending}
                  onClick={() => {
                    if (window.confirm(t("Apagar este modelo? Os processos já abertos com ele continuam."))) {
                      remover.mutate(m.id);
                    }
                  }}
                  aria-label={t("Apagar modelo")}
                >
                  <Trash size={16} aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EditorDeModelo({
  inicial,
  id,
  onFechar,
}: {
  inicial: RascunhoDeModelo;
  id: string | null;
  onFechar: () => void;
}) {
  const t = useT();
  const etapas = useEtapas();
  const salvar = useSalvarModelo();
  const [r, setR] = useState<RascunhoDeModelo>(inicial);

  const mudarPasso = (i: number, mudanca: Partial<RascunhoDeModelo["steps"][number]>) =>
    setR((atual) => ({ ...atual, steps: atual.steps.map((s, j) => (j === i ? { ...s, ...mudanca } : s)) }));
  const mover = (i: number, d: -1 | 1) =>
    setR((atual) => {
      const steps = [...atual.steps];
      const j = i + d;
      if (j < 0 || j >= steps.length) return atual;
      [steps[i], steps[j]] = [steps[j]!, steps[i]!];
      return { ...atual, steps };
    });
  const removerPasso = (i: number) => setR((atual) => ({ ...atual, steps: atual.steps.filter((_, j) => j !== i) }));

  const passosValidos = r.steps.filter((s) => s.title.trim() !== "");
  const podeSalvar = r.name.trim() !== "" && passosValidos.length > 0 && !salvar.isPending;

  return (
    <section className="flex flex-col gap-4 rounded-md border border-border p-4" data-testid="modelo-editor">
      <h2 className="text-base font-semibold">{id ? t("Editar modelo") : t("Novo modelo")}</h2>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-text-muted">{t("Nome")}</span>
        <input
          value={r.name}
          onChange={(e) => setR({ ...r, name: e.target.value })}
          placeholder={t("Ex.: Entrada de cliente")}
          className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
          data-testid="modelo-nome"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-text-muted">{t("Abrir sozinho quando o negócio chegar na etapa")}</span>
        <select
          value={r.trigger_stage_id ?? ""}
          onChange={(e) => setR({ ...r, trigger_stage_id: e.target.value || null })}
          className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
          data-testid="modelo-etapa"
        >
          <option value="">{t("Nenhuma — só abre à mão")}</option>
          {(etapas.data ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.funil} › {e.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-3">
        <Switch id="modelo_ativo" checked={r.is_active} onCheckedChange={(v) => setR({ ...r, is_active: v })} />
        <Label htmlFor="modelo_ativo">{t("Modelo ativo")}</Label>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm text-text-muted">{t("Passos")}</span>
        <ol className="flex flex-col gap-2">
          {r.steps.map((s, i) => (
            <li key={i} className="flex flex-col gap-1 rounded-md border border-border p-2">
              <div className="flex items-center gap-2">
                <span className="w-6 text-right text-xs tabular-nums text-text-muted">{i + 1}.</span>
                <input
                  value={s.title}
                  onChange={(e) => mudarPasso(i, { title: e.target.value })}
                  placeholder={t("Nome do passo")}
                  className="flex-1 rounded-md border border-border bg-surface-elevated p-1.5 text-sm text-text"
                  data-testid="modelo-passo"
                />
                <button type="button" onClick={() => mover(i, -1)} aria-label={t("Subir")} className="text-text-muted hover:text-text">
                  <CaretUp size={16} aria-hidden />
                </button>
                <button type="button" onClick={() => mover(i, 1)} aria-label={t("Descer")} className="text-text-muted hover:text-text">
                  <CaretDown size={16} aria-hidden />
                </button>
                <button type="button" onClick={() => removerPasso(i)} aria-label={t("Remover passo")} className="text-text-muted hover:text-destructive">
                  <Trash size={16} aria-hidden />
                </button>
              </div>
              {r.trigger_stage_id ? (
                <label className="ml-8 flex items-center gap-2 text-xs text-text-muted">
                  <input
                    type="checkbox"
                    checked={s.done_on_trigger}
                    onChange={(e) => mudarPasso(i, { done_on_trigger: e.target.checked })}
                    className="h-3.5 w-3.5 accent-accent"
                  />
                  {t("Já vem marcado quando o processo abre pelo funil")}
                </label>
              ) : null}
            </li>
          ))}
        </ol>
        <Button
          variant="outline"
          className="self-start"
          onClick={() => setR({ ...r, steps: [...r.steps, { title: "", done_on_trigger: false }] })}
        >
          <Plus size={16} aria-hidden />
          {t("Adicionar passo")}
        </Button>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onFechar}>
          {t("Cancelar")}
        </Button>
        <Button
          disabled={!podeSalvar}
          onClick={() =>
            salvar.mutate(
              { id, modelo: { ...r, name: r.name.trim(), steps: passosValidos.map((s) => ({ ...s, title: s.title.trim() })) } },
              { onSuccess: onFechar },
            )
          }
          data-testid="modelo-salvar"
        >
          {salvar.isPending ? t("Salvando…") : t("Salvar modelo")}
        </Button>
      </div>
    </section>
  );
}
