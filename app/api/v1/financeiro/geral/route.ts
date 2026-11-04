/**
 * A VISÃO GERAL — o caixa de todos os tempos, já somado.
 *
 * `GET /api/v1/financeiro/geral`. Devolve o resumo do histórico inteiro
 * (saldo, recebido, pago, em aberto, atrasado), o histórico mês a mês com o
 * saldo acumulado, quem mais pagou, para onde o dinheiro foi, os atrasados e
 * o que vence nos próximos 30 dias — pendentes gravados e previstos dos
 * moldes juntos, porque para quem cobra os dois são "conta que vence".
 *
 * ⚠️ MESMA LEITURA E MESMA RÉGUA DO CAIXA: `lerLancamentos` lê o histórico
 * inteiro em páginas, e as somas são funções puras de `lib/financeiro/`. Somar
 * aqui com regra própria faria o Geral e o Caixa discordarem sobre o mesmo
 * dinheiro.
 *
 * ⚠️ ADMIN, como o Caixa: é o dinheiro da empresa inteira. A RLS continua sendo
 * a cerca do tenant — o client é o de sessão, nunca o admin.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { moedaDaOrganizacao } from "@/lib/catalogo/moeda-da-org";
import { despesasPorCategoria, previstosDoMes, type MoldeRecorrente } from "@/lib/financeiro/caixa";
import {
  atrasados,
  historicoMensal,
  mesesDoIntervalo,
  proximosVencimentos,
  receitasPorCliente,
  resumoGeral,
} from "@/lib/financeiro/geral";
import { lerLancamentos } from "@/lib/financeiro/leitura";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** A agenda olha este número de dias à frente. */
const DIAS_DA_AGENDA = 30;

function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "financeiro" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  // UTC, como o Caixa e o cron de recorrências: as pontas concordam sobre "hoje".
  const hoje = new Date().toISOString().slice(0, 10);
  const ateAgenda = somarDias(hoje, DIAS_DA_AGENDA);

  const supabase = await createClient();
  const moeda = await moedaDaOrganizacao(supabase, orgId);

  const lidos = await lerLancamentos(supabase, orgId, {});
  if ("erro" in lidos) return fail("internal_error", lidos.erro, 500, { requestId });

  const daMoeda = lidos.linhas.filter((l) => l.currency === moeda);
  const outrasMoedas = lidos.linhas.length - daMoeda.length;

  const { data: moldesBrutos, error: erroMoldes } = await supabase
    .from("recurring_entries")
    .select("id, name, direction, amount_cents, currency, day_of_month, account_plan_id, contact_id, starts_on")
    .eq("organization_id", orgId)
    .eq("is_active", true);
  if (erroMoldes) return fail("internal_error", erroMoldes.message, 500, { requestId });
  const moldes = ((moldesBrutos ?? []) as MoldeRecorrente[]).filter((m) => m.currency === moeda);

  // Os previstos da agenda: os meses que a janela de 30 dias toca.
  const mesesDaAgenda = mesesDoIntervalo(hoje.slice(0, 7), ateAgenda.slice(0, 7));
  const previstos = mesesDaAgenda.flatMap((m) => previstosDoMes(moldes, daMoeda, m, hoje));

  const resumo = resumoGeral(daMoeda, hoje);
  const meses = resumo.primeiro_mes ? mesesDoIntervalo(resumo.primeiro_mes, hoje.slice(0, 7)) : [];
  const vencidos = atrasados(daMoeda, hoje);
  const agenda = proximosVencimentos([...daMoeda, ...previstos], hoje, ateAgenda);
  const clientes = receitasPorCliente(daMoeda);

  const { data: categorias, error: erroCategorias } = await supabase
    .from("account_plans")
    .select("id, name, direction, is_active")
    .eq("organization_id", orgId)
    .order("name", { ascending: true });
  if (erroCategorias) return fail("internal_error", erroCategorias.message, 500, { requestId });

  // Só os contatos que a tela mostra: os do ranking, dos atrasados e da agenda.
  const idsDeContato = [
    ...new Set(
      [...clientes.map((c) => c.contact_id), ...vencidos.map((l) => l.contact_id), ...agenda.map((l) => l.contact_id)]
        .filter((x): x is string => !!x),
    ),
  ];
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
      hoje,
      moeda,
      resumo,
      historico: historicoMensal(daMoeda, meses),
      clientes,
      por_categoria: despesasPorCategoria(daMoeda),
      atrasados: vencidos,
      agenda,
      dias_da_agenda: DIAS_DA_AGENDA,
      categorias: categorias ?? [],
      contatos,
      outras_moedas: outrasMoedas,
      truncado: lidos.truncado,
    },
    { requestId },
  );
}
