"use client";
/**
 * Ligar a aba Financeiro (Painel e Caixa) no menu desta organização.
 *
 * Mora aqui, em Configurações › Financeiro, porque é onde o dinheiro da
 * empresa se descreve — e é para cá que /app/financeiro manda o admin quando a
 * aba está desligada. Depois de salvar, `router.refresh()` refaz o layout de
 * `/app`, que é quem lê as capacidades e desenha o menu.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

export function AbaFinanceiroNoMenu() {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();

  const estado = useQuery({
    queryKey: ["settings", "financeiro-aba"],
    queryFn: async () =>
      (await apiClient.get<{ data: { aba_no_menu: boolean } }>("/api/v1/settings/financeiro-aba")).data,
  });

  const salvar = useMutation({
    mutationFn: (aba_no_menu: boolean) => apiClient.patch("/api/v1/settings/financeiro-aba", { aba_no_menu }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings", "financeiro-aba"] });
      router.refresh();
    },
    onError: showApiError,
  });

  const ligada = estado.data?.aba_no_menu ?? false;

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border p-3" data-testid="aba-financeiro-no-menu">
      <div className="flex items-center gap-3">
        <Switch
          id="financeiro_aba_no_menu"
          checked={ligada}
          disabled={estado.isLoading || salvar.isPending}
          onCheckedChange={(v) => salvar.mutate(v)}
        />
        <Label htmlFor="financeiro_aba_no_menu">{t("Mostrar a aba Financeiro no menu")}</Label>
      </div>
      <p className="text-xs text-text-muted">
        {t(
          "Painel do mês e Caixa para lançar receitas e despesas, só para quem administra a empresa. Desligada, nada é apagado: os lançamentos continuam aqui e em Análise › Faturamento.",
        )}
      </p>
      {ligada ? (
        <Link href="/app/financeiro" className="text-xs text-accent hover:underline">
          {t("Abrir o Financeiro")}
        </Link>
      ) : null}
    </section>
  );
}
