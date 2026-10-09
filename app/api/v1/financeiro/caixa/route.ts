/**
 * O CAIXA DO PERÍODO — tudo que a aba Financeiro desenha, já somado.
 *
 * `GET /api/v1/financeiro/caixa?mes=2026-10` (ou `mes=todos`, a visão
 * consolidada). Devolve o extrato, os previstos dos moldes recorrentes, o
 * resumo dos cartões, o fluxo dos últimos meses e as despesas por categoria —
 * e os nomes que a tela precisa para mostrar tudo isso sem uma segunda ida.
 *
 * ⚠️ LÊ O PERÍODO INTEIRO, em páginas, antes de somar. A rota irmã
 * `/financeiro/lancamentos` corta em 500 linhas; somar sobre um recorte é o
 * cartão "Saldo" mentindo no mês em que o movimento passa do limite. Aqui há um
 * teto de segurança (`TETO_DE_LINHAS`), e quando ele é atingido a resposta diz
 * `truncado: true` em vez de devolver um total falso calado.
 *
 * ⚠️ ADMIN. A aba Financeiro é a visão de dinheiro da empresa inteira, e a
 * decisão de quem a vê é de produto (só quem administra a organização). A RLS
 * continua sendo a cerca do tenant: o client é o de sessão, nunca o admin.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { moedaDaOrganizacao } from "@/lib/catalogo/moeda-da-org";
import {
  despesasPorCategoria,
  fluxoMensal,
  mesesAte,
  ordenarExtrato,
  periodoDoMes,
  previstosDoMes,
  resumoDoCaixa,
  type LinhaDoCaixa,
  type MoldeRecorrente,
} from "@/lib/financeiro/caixa";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PAGINA = 1000;
const TETO_DE_LINHAS = 20_000;
/** Quantos meses o gráfico "Fluxo Mensal" mostra, terminando no mês escolhido. */
const MESES_NO_FLUXO = 6;
/** A visão consolidada projeta os moldes por este número de meses à frente. */
const MESES_PROJETADOS = 12;

const COLUNAS =
  "id, direction, amount_cents, currency, description, entry_date, status, origin, account_plan_id, contact_id, lead_id, recurring_entry_id";

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function lerLancamentos(
  supabase: Supabase,
  orgId: string,
  colunas: string,
  filtro: { de?: string; ate?: string; soPagos?: boolean },
): Promise<{ linhas: LinhaDoCaixa[]; truncado: boolean } | { erro: string }> {
  const linhas: LinhaDoCaixa[] = [];
  for (let inicio = 0; inicio < TETO_DE_LINHAS; inicio += PAGINA) {
    let q = supabase
      .from("financial_entries")
      .select(colunas)
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

function mesDeHoje(hoje: string): string {
  return hoje.slice(0, 7);
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "financeiro" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const pedido = new URL(req.url).searchParams.get("mes") ?? "";
  // UTC, como o cron de recorrências: a competência é data civil, e as duas
  // pontas precisam concordar sobre qual dia é "hoje".
  const hoje = new Date().toISOString().slice(0, 10);
  const consolidado = pedido === "todos";
  const mes = consolidado ? mesDeHoje(hoje) : pedido || mesDeHoje(hoje);

  let periodo: { de: string; ate: string } | null = null;
  if (!consolidado) {
    try {
      periodo = periodoDoMes(mes);
    } catch {
      return fail("validation_failed", "Mês inválido. Use AAAA-MM ou 'todos'.", 422, { requestId });
    }
  }

  const supabase = await createClient();
  const moeda = await moedaDaOrganizacao(supabase, orgId);

  const lidos = await lerLancamentos(supabase, orgId, COLUNAS, periodo ?? {});
  if ("erro" in lidos) return fail("internal_error", lidos.erro, 500, { requestId });

  const mesesDoFluxo = mesesAte(mes, MESES_NO_FLUXO);
  const pagosDoFluxo = await lerLancamentos(supabase, orgId, COLUNAS, {
    de: periodoDoMes(mesesDoFluxo[0]!).de,
    ate: periodoDoMes(mes).ate,
    soPagos: true,
  });
  if ("erro" in pagosDoFluxo) return fail("internal_error", pagosDoFluxo.erro, 500, { requestId });

  const { data: moldesBrutos, error: erroMoldes } = await supabase
    .from("recurring_entries")
    .select("id, name, direction, amount_cents, currency, day_of_month, account_plan_id, contact_id, starts_on")
    .eq("organization_id", orgId)
    .eq("is_active", true);
  if (erroMoldes) return fail("internal_error", erroMoldes.message, 500, { requestId });
  const moldes = ((moldesBrutos ?? []) as MoldeRecorrente[]).filter((m) => m.currency === moeda);

  // Moedas diferentes não se somam (#1531): o que não é da moeda da
  // organização sai das contas e volta contado.
  const daMoeda = lidos.linhas.filter((l) => l.currency === moeda);
  const outrasMoedas = lidos.linhas.length - daMoeda.length;

  const mesesComPrevisao = consolidado
    ? mesesAte(
        (() => {
          const [a, m] = mes.split("-").map(Number) as [number, number];
          const d = new Date(Date.UTC(a, m - 1 + MESES_PROJETADOS - 1, 1));
          return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        })(),
        MESES_PROJETADOS,
      )
    : [mes];
  const previstos = mesesComPrevisao.flatMap((m) => previstosDoMes(moldes, daMoeda, m, hoje));

  const linhas = ordenarExtrato([...daMoeda, ...previstos]);

  const { data: categorias, error: erroCategorias } = await supabase
    .from("account_plans")
    .select("id, name, direction, is_active")
    .eq("organization_id", orgId)
    .order("name", { ascending: true });
  if (erroCategorias) return fail("internal_error", erroCategorias.message, 500, { requestId });

  const { data: contas, error: erroContas } = await supabase
    .from("financial_accounts")
    .select("id, name")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (erroContas) return fail("internal_error", erroContas.message, 500, { requestId });

  // Só os contatos que aparecem no extrato — a tela mostra o nome, e buscar a
  // agenda inteira para isso seria ler dado pessoal sem motivo.
  const idsDeContato = [...new Set(linhas.map((l) => l.contact_id).filter((x): x is string => !!x))];
  const contatos: Array<{ id: string; name: string | null; display_name: string | null; phone_number: string | null }> =
    [];
  for (let i = 0; i < idsDeContato.length; i += 200) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, name, display_name, phone_number")
      .eq("organization_id", orgId)
      .in("id", idsDeContato.slice(i, i + 200));
    if (error) return fail("internal_error", error.message, 500, { requestId });
    contatos.push(...((data ?? []) as typeof contatos));
  }

  return ok(
    {
      mes: consolidado ? "todos" : mes,
      hoje,
      moeda,
      linhas,
      resumo: resumoDoCaixa(linhas),
      fluxo: fluxoMensal(
        pagosDoFluxo.linhas.filter((l) => l.currency === moeda),
        mesesDoFluxo,
      ),
      por_categoria: despesasPorCategoria(linhas),
      categorias: categorias ?? [],
      contas: contas ?? [],
      contatos,
      outras_moedas: outrasMoedas,
      truncado: lidos.truncado || pagosDoFluxo.truncado,
    },
    { requestId },
  );
}
