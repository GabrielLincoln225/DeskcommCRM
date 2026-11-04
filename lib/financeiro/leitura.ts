/**
 * A leitura do período INTEIRO de `financial_entries`, em páginas.
 *
 * Mora aqui porque duas rotas a usam — o Caixa (`/financeiro/caixa`) e a
 * visão Geral (`/financeiro/geral`) — e as duas precisam somar sobre TODAS as
 * linhas, nunca sobre um recorte. A rota irmã `/financeiro/lancamentos` corta
 * em 500; somar sobre um recorte é o cartão mentindo no mês em que o movimento
 * passa do limite. O teto de segurança devolve `truncado: true` em vez de um
 * total falso calado.
 */
import type { createClient } from "@/lib/supabase/server";

import type { LinhaDoCaixa } from "./caixa";

const PAGINA = 1000;
const TETO_DE_LINHAS = 20_000;

export const COLUNAS_DO_CAIXA =
  "id, direction, amount_cents, currency, description, entry_date, status, origin, account_plan_id, contact_id, lead_id, recurring_entry_id";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export async function lerLancamentos(
  supabase: Supabase,
  orgId: string,
  filtro: { de?: string; ate?: string; soPagos?: boolean },
): Promise<{ linhas: LinhaDoCaixa[]; truncado: boolean } | { erro: string }> {
  const linhas: LinhaDoCaixa[] = [];
  for (let inicio = 0; inicio < TETO_DE_LINHAS; inicio += PAGINA) {
    let q = supabase
      .from("financial_entries")
      .select(COLUNAS_DO_CAIXA)
      .eq("organization_id", orgId)
      .order("entry_date", { ascending: true })
      .order("id", { ascending: true })
      .range(inicio, inicio + PAGINA - 1);
    if (filtro.de) q = q.gte("entry_date", filtro.de);
    if (filtro.ate) q = q.lte("entry_date", filtro.ate);
    if (filtro.soPagos) q = q.eq("status", "paid");
    const { data, error } = await q;
    if (error) return { erro: error.message };
    const pagina = (data ?? []) as unknown as LinhaDoCaixa[];
    linhas.push(...pagina);
    if (pagina.length < PAGINA) return { linhas, truncado: false };
  }
  return { linhas, truncado: true };
}
