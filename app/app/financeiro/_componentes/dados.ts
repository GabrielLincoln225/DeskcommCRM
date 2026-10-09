"use client";
/**
 * O que a aba Financeiro lê e escreve — um lugar só para as chaves de cache.
 *
 * Toda escrita invalida `["financeiro"]` inteiro: o Painel, o Caixa e os ganhos
 * pendentes leem do mesmo dinheiro, e invalidar só uma das três deixaria o
 * cartão do Painel com o saldo de antes do lançamento que acabou de entrar.
 * Também invalida o relatório de Análise › Faturamento, que soma as mesmas
 * linhas.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import type { ContatoNomeavel } from "@/lib/contacts/rotulo-do-contato";
import type { FatiaDeCategoria, LinhaDoCaixa, MesDoFluxo, ResumoDoCaixa } from "@/lib/financeiro/caixa";

export type Categoria = { id: string; name: string; direction: "in" | "out"; is_active: boolean };
export type Conta = { id: string; name: string };
export type ContatoDoCaixa = ContatoNomeavel & { id: string };

export interface CaixaDoPeriodo {
  mes: string;
  hoje: string;
  moeda: string;
  linhas: LinhaDoCaixa[];
  resumo: ResumoDoCaixa;
  fluxo: MesDoFluxo[];
  por_categoria: FatiaDeCategoria[];
  categorias: Categoria[];
  contas: Conta[];
  contatos: ContatoDoCaixa[];
  outras_moedas: number;
  truncado: boolean;
}

export interface GanhoSemLancamento {
  id: string;
  title: string;
  value_cents: number;
  currency: string | null;
  contact_id: string | null;
  closed_at: string;
}

export function useCaixa(mes: string) {
  return useQuery({
    queryKey: ["financeiro", "caixa", mes],
    queryFn: async () =>
      (await apiClient.get<{ data: CaixaDoPeriodo }>(`/api/v1/financeiro/caixa?mes=${encodeURIComponent(mes)}`))
        .data,
  });
}

export function useGanhosSemLancamento() {
  return useQuery({
    queryKey: ["financeiro", "ganhos-sem-lancamento"],
    queryFn: async () =>
      (
        await apiClient.get<{ data: { ganhos: GanhoSemLancamento[]; contatos: ContatoDoCaixa[] } }>(
          "/api/v1/financeiro/ganhos-sem-lancamento",
        )
      ).data,
  });
}

function useInvalidarFinanceiro() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["financeiro"] });
    void qc.invalidateQueries({ queryKey: ["relatorio", "financeiro"] });
    void qc.invalidateQueries({ queryKey: ["lancamentos"] });
  };
}

export function useCriarLancamento() {
  const invalidar = useInvalidarFinanceiro();
  return useMutation({
    mutationFn: (corpo: Record<string, unknown>) => apiClient.post("/api/v1/financeiro/lancamentos", corpo),
    onSuccess: invalidar,
    onError: showApiError,
  });
}

export function useCorrigirLancamento() {
  const invalidar = useInvalidarFinanceiro();
  return useMutation({
    mutationFn: ({ id, corpo }: { id: string; corpo: Record<string, unknown> }) =>
      apiClient.patch(`/api/v1/financeiro/lancamentos/${id}`, corpo),
    onSuccess: invalidar,
    onError: showApiError,
  });
}

export function useConfirmarLancamento() {
  const invalidar = useInvalidarFinanceiro();
  return useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/financeiro/lancamentos/${id}`, { pay: true }),
    onSuccess: invalidar,
    onError: showApiError,
  });
}

export function useRemoverLancamento() {
  const invalidar = useInvalidarFinanceiro();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/financeiro/lancamentos/${id}`),
    onSuccess: invalidar,
    onError: showApiError,
  });
}

/** A primeira conta, quando a organização ainda não tem nenhuma: o caixa físico. */
export function useCriarContaCaixa() {
  const invalidar = useInvalidarFinanceiro();
  return useMutation({
    mutationFn: (nome: string) =>
      apiClient.post("/api/v1/financeiro/catalogo/contas", { name: nome, kind: "cash" }),
    onSuccess: invalidar,
    onError: showApiError,
  });
}

/** "2026-10" → "2026-11" (ou o anterior, com `passo` negativo). */
export function somarMes(mes: string, passo: number): string {
  const [ano, numero] = mes.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(ano, numero - 1 + passo, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "2026-10" → "outubro de 2026", no idioma de quem lê. */
export function nomeDoMes(mes: string, tag: string): string {
  const [ano, numero] = mes.split("-").map(Number) as [number, number];
  const texto = new Date(Date.UTC(ano, numero - 1, 1)).toLocaleDateString(tag, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** "2026-10-08" → "08/10/2026" (ou a ordem do idioma). UTC: é data civil, não instante. */
export function dataCurta(iso: string, tag: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(tag, { timeZone: "UTC" });
}
