"use client";
/**
 * O que o módulo Processos lê e escreve — as chaves de cache num lugar só.
 *
 * Toda escrita invalida `["processos"]` inteiro: a lista mostra o progresso que
 * o detalhe acabou de mudar, e invalidar só um dos dois deixaria a lista com o
 * "3 de 15" de antes do item marcado.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import type { ContatoNomeavel } from "@/lib/contacts/rotulo-do-contato";
import type { ProgressoDoProcesso } from "@/lib/processos/progresso";

export type SituacaoDoProcesso = "open" | "done" | "cancelled";

export interface Processo {
  id: string;
  name: string;
  status: SituacaoDoProcesso;
  origin: "manual" | "funil";
  contact_id: string;
  template_id: string | null;
  lead_id: string | null;
  finished_at: string | null;
  created_at: string;
  contacts: (ContatoNomeavel & { id: string }) | null;
  progresso: ProgressoDoProcesso;
}

export interface ItemDoProcesso {
  id: string;
  process_id: string;
  title: string;
  position: number;
  assignee_user_id: string | null;
  due_date: string | null;
  note: string | null;
  done_at: string | null;
  done_by: string | null;
}

export interface PassoDoModelo {
  id?: string;
  title: string;
  done_on_trigger: boolean;
}

export interface ModeloDeProcesso {
  id: string;
  name: string;
  description: string | null;
  trigger_stage_id: string | null;
  is_active: boolean;
  steps: PassoDoModelo[];
}

export interface Membro {
  user_id: string;
  role: string;
  full_name: string | null;
}

export interface EtapaDoFunil {
  id: string;
  name: string;
  funil: string;
}

const CHAVE = ["processos"] as const;

export function useProcessos(status: SituacaoDoProcesso | "all") {
  return useQuery({
    queryKey: [...CHAVE, "lista", status],
    queryFn: async () =>
      (
        await apiClient.get<{ data: { hoje: string; processos: Processo[] } }>(
          `/api/v1/processos?status=${encodeURIComponent(status)}`,
        )
      ).data,
  });
}

export function useProcesso(id: string) {
  return useQuery({
    queryKey: [...CHAVE, "detalhe", id],
    queryFn: async () =>
      (
        await apiClient.get<{ data: { hoje: string; processo: Processo; itens: ItemDoProcesso[] } }>(
          `/api/v1/processos/${id}`,
        )
      ).data,
  });
}

export function useModelos() {
  return useQuery({
    queryKey: [...CHAVE, "modelos"],
    queryFn: async () =>
      (await apiClient.get<{ data: ModeloDeProcesso[] }>("/api/v1/processos/modelos")).data,
  });
}

/** Quem pode ser responsável. Quem só lê (viewer) recebe 403 da rota: lista vazia. */
export function useMembros() {
  return useQuery({
    queryKey: [...CHAVE, "membros"],
    queryFn: async () => (await apiClient.get<{ data: Membro[] }>("/api/v1/team/assignable")).data,
    retry: false,
  });
}

/** Todas as etapas de todos os funis, para escolher a que abre o processo sozinho. */
export function useEtapas() {
  return useQuery({
    queryKey: [...CHAVE, "etapas"],
    queryFn: async () => {
      const funis = (await apiClient.get<{ data: { id: string; name: string }[] }>("/api/v1/pipelines")).data;
      const listas = await Promise.all(
        funis.map(async (f) => {
          const etapas = (
            await apiClient.get<{ data: { id: string; name: string }[] }>(`/api/v1/pipelines/${f.id}/stages`)
          ).data;
          return etapas.map((e) => ({ id: e.id, name: e.name, funil: f.name }));
        }),
      );
      return listas.flat() as EtapaDoFunil[];
    },
  });
}

function useInvalidar() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: CHAVE });
}

export function useIniciarProcesso() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (corpo: { contact_id: string; template_id: string }) =>
      (await apiClient.post<{ data: { id: string } }>("/api/v1/processos", corpo)).data,
    onSuccess: () => void invalidar(),
    onError: showApiError,
  });
}

export function useAlterarProcesso(id: string) {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (status: SituacaoDoProcesso) => apiClient.patch(`/api/v1/processos/${id}`, { status }),
    onSuccess: () => void invalidar(),
    onError: showApiError,
  });
}

export function useApagarProcesso(id: string) {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: () => apiClient.delete(`/api/v1/processos/${id}`),
    onSuccess: () => void invalidar(),
    onError: showApiError,
  });
}

export type MudancaDoItem = Partial<{
  done: boolean;
  assignee_user_id: string | null;
  due_date: string | null;
  note: string | null;
}>;

export function useAlterarItem(processoId: string) {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ itemId, mudanca }: { itemId: string; mudanca: MudancaDoItem }) =>
      apiClient.patch(`/api/v1/processos/${processoId}/itens/${itemId}`, mudanca),
    onSuccess: () => void invalidar(),
    onError: showApiError,
  });
}

export type RascunhoDeModelo = {
  name: string;
  description: string | null;
  trigger_stage_id: string | null;
  is_active: boolean;
  steps: { title: string; done_on_trigger: boolean }[];
};

export function useSalvarModelo() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, modelo }: { id: string | null; modelo: RascunhoDeModelo }) =>
      id ? apiClient.patch(`/api/v1/processos/modelos/${id}`, modelo) : apiClient.post("/api/v1/processos/modelos", modelo),
    onSuccess: () => void invalidar(),
    onError: showApiError,
  });
}

export function useRemoverModelo() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/processos/modelos/${id}`),
    onSuccess: () => void invalidar(),
    onError: showApiError,
  });
}

export function dataCurta(iso: string, tag: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(tag, { timeZone: "UTC" });
}
