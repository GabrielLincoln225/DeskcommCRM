/**
 * O CAIXA — as contas da aba Financeiro, num lugar só e sem HTTP.
 *
 * A tela do Caixa e a do Painel não somam nada: recebem os números prontos da
 * rota `GET /api/v1/financeiro/caixa`, que lê o período INTEIRO e chama estas
 * funções. Somar no navegador o que uma API devolve paginado é como um extrato
 * passa a mentir sem ninguém perceber (o mesmo princípio de
 * `app/app/faturamento/_client.tsx`).
 *
 * As palavras, e o que cada uma conta:
 *
 *   - REALIZADO: lançamento pago (`status = 'paid'`). É o dinheiro que passou.
 *   - PENDENTE: lançamento gravado que ainda não foi pago (a receber / a pagar).
 *   - PREVISTO: o que um molde recorrente AINDA vai gerar no período e o cron
 *     não gravou porque a data não chegou. Não existe no banco; é calculado aqui
 *     com a mesma regra que o cron usa (`lib/financeiro/recorrencia.ts`).
 *   - RESULTADO PREVISTO DO PERÍODO: tudo que entra menos tudo que sai,
 *     realizado, pendente e previsto juntos — "como o mês fecha se tudo se
 *     confirmar". Era o cartão "Previsão pendente" do sistema de onde a tela
 *     veio, e a conta é a mesma dele.
 *
 * ⚠️ MOEDAS DIFERENTES NÃO SE SOMAM (#1531). Quem chama filtra pela moeda da
 * organização antes; o que ficou de fora volta contado em `outras_moedas`, para
 * a tela dizer que existe em vez de esconder.
 */
import { competenciaDoMes, moldeValeNaCompetencia } from "./recorrencia";

export type Direcao = "in" | "out";

/** Uma linha do extrato: gravada no banco ou prevista por um molde. */
export interface LinhaDoCaixa {
  /** `null` na linha prevista — ela ainda não existe no banco. */
  id: string | null;
  direction: Direcao;
  amount_cents: number;
  currency: string;
  description: string | null;
  entry_date: string;
  status: "pending" | "paid";
  /** `manual` | `sale` | `reversal` | `recurring`; `previsto` na linha calculada. */
  origin: string;
  account_plan_id: string | null;
  contact_id: string | null;
  lead_id: string | null;
  recurring_entry_id: string | null;
}

export interface MoldeRecorrente {
  id: string;
  name: string;
  direction: Direcao;
  amount_cents: number;
  currency: string;
  day_of_month: number;
  account_plan_id: string | null;
  contact_id: string | null;
  starts_on: string | null;
}

/** "2026-10" → primeiro e último dia do mês, como datas ISO. */
export function periodoDoMes(mes: string): { de: string; ate: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(mes);
  if (!m) throw new Error(`mês inválido: ${mes}`);
  const ano = Number(m[1]);
  const numero = Number(m[2]);
  if (numero < 1 || numero > 12) throw new Error(`mês inválido: ${mes}`);
  const ultimo = new Date(Date.UTC(ano, numero, 0)).getUTCDate();
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

/** Os `quantos` meses que terminam em `mes`, do mais antigo ao mais novo. */
export function mesesAte(mes: string, quantos: number): string[] {
  const [ano, numero] = mes.split("-").map(Number) as [number, number];
  const saida: string[] = [];
  for (let i = quantos - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(ano, numero - 1 - i, 1));
    saida.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return saida;
}

/**
 * As linhas que os moldes ainda vão gerar no mês, e que o banco não tem.
 *
 * Só da competência de HOJE em diante: o que já venceu e não está no banco é
 * cobrança que o cron não gerou (molde criado depois, rodada perdida), e
 * mostrá-la como "prevista" seria prever o passado. A chave de "já existe" é a
 * mesma do índice único do banco: `(recurring_entry_id, entry_date)`.
 */
export function previstosDoMes(
  moldes: MoldeRecorrente[],
  gravadas: Pick<LinhaDoCaixa, "recurring_entry_id" | "entry_date">[],
  mes: string,
  hoje: string,
): LinhaDoCaixa[] {
  const [ano, numero] = mes.split("-").map(Number) as [number, number];
  const existentes = new Set(
    gravadas.filter((g) => g.recurring_entry_id).map((g) => `${g.recurring_entry_id}|${g.entry_date}`),
  );

  const saida: LinhaDoCaixa[] = [];
  for (const molde of moldes) {
    const competencia = competenciaDoMes(ano, numero, molde.day_of_month);
    if (competencia < hoje) continue;
    if (!moldeValeNaCompetencia(molde.starts_on, competencia)) continue;
    if (existentes.has(`${molde.id}|${competencia}`)) continue;
    saida.push({
      id: null,
      direction: molde.direction,
      amount_cents: molde.amount_cents,
      currency: molde.currency,
      description: molde.name,
      entry_date: competencia,
      status: "pending",
      origin: "previsto",
      account_plan_id: molde.account_plan_id,
      contact_id: molde.contact_id,
      lead_id: null,
      recurring_entry_id: molde.id,
    });
  }
  return saida;
}

export interface ResumoDoCaixa {
  /** Recebido − pago: o dinheiro que de fato passou no período. */
  saldo_realizado_cents: number;
  receitas_realizadas_cents: number;
  despesas_realizadas_cents: number;
  entradas_confirmadas: number;
  saidas_confirmadas: number;
  /** Pendente + previsto, por direção. */
  a_receber_cents: number;
  a_pagar_cents: number;
  /** Quantas linhas ainda esperam confirmação (pendentes + previstas). */
  a_confirmar: number;
  /** Tudo que entra − tudo que sai, se o que está pendente se confirmar. */
  resultado_previsto_cents: number;
}

export function resumoDoCaixa(linhas: LinhaDoCaixa[]): ResumoDoCaixa {
  const r: ResumoDoCaixa = {
    saldo_realizado_cents: 0,
    receitas_realizadas_cents: 0,
    despesas_realizadas_cents: 0,
    entradas_confirmadas: 0,
    saidas_confirmadas: 0,
    a_receber_cents: 0,
    a_pagar_cents: 0,
    a_confirmar: 0,
    resultado_previsto_cents: 0,
  };
  for (const l of linhas) {
    const pago = l.status === "paid";
    if (l.direction === "in") {
      r.resultado_previsto_cents += l.amount_cents;
      if (pago) {
        r.receitas_realizadas_cents += l.amount_cents;
        r.entradas_confirmadas += 1;
      } else {
        r.a_receber_cents += l.amount_cents;
      }
    } else {
      r.resultado_previsto_cents -= l.amount_cents;
      if (pago) {
        r.despesas_realizadas_cents += l.amount_cents;
        r.saidas_confirmadas += 1;
      } else {
        r.a_pagar_cents += l.amount_cents;
      }
    }
    if (!pago) r.a_confirmar += 1;
  }
  r.saldo_realizado_cents = r.receitas_realizadas_cents - r.despesas_realizadas_cents;
  return r;
}

export interface MesDoFluxo {
  mes: string;
  entradas_cents: number;
  saidas_cents: number;
}

/**
 * Entradas e saídas REALIZADAS por mês, para o gráfico "Fluxo Mensal".
 *
 * Só o pago: o gráfico responde "quanto passou", e pendente nele faria um mês
 * futuro parecer movimentado. Todo mês pedido aparece, inclusive o vazio —
 * um buraco no eixo seria lido como "mês que não existe".
 */
export function fluxoMensal(linhas: LinhaDoCaixa[], meses: string[]): MesDoFluxo[] {
  const por = new Map(meses.map((m) => [m, { mes: m, entradas_cents: 0, saidas_cents: 0 }]));
  for (const l of linhas) {
    if (l.status !== "paid") continue;
    const alvo = por.get(l.entry_date.slice(0, 7));
    if (!alvo) continue;
    if (l.direction === "in") alvo.entradas_cents += l.amount_cents;
    else alvo.saidas_cents += l.amount_cents;
  }
  return meses.map((m) => por.get(m)!);
}

export interface FatiaDeCategoria {
  account_plan_id: string | null;
  total_cents: number;
  /** Inteiro de 0 a 100, sobre o total pago de saídas do período. */
  percentual: number;
}

/**
 * As despesas PAGAS do período por categoria, da maior para a menor.
 *
 * `account_plan_id` nulo é uma fatia própria ("Sem categoria"): sumir com ela
 * faria as porcentagens somarem menos de 100 sem explicação.
 */
export function despesasPorCategoria(linhas: LinhaDoCaixa[]): FatiaDeCategoria[] {
  const por = new Map<string | null, number>();
  let total = 0;
  for (const l of linhas) {
    if (l.direction !== "out" || l.status !== "paid") continue;
    por.set(l.account_plan_id, (por.get(l.account_plan_id) ?? 0) + l.amount_cents);
    total += l.amount_cents;
  }
  return [...por.entries()]
    .map(([account_plan_id, total_cents]) => ({
      account_plan_id,
      total_cents,
      percentual: total > 0 ? Math.round((total_cents / total) * 100) : 0,
    }))
    .sort((a, b) => b.total_cents - a.total_cents);
}

/** Extrato em ordem de data, o mais recente primeiro; empate por direção (entrada antes). */
export function ordenarExtrato(linhas: LinhaDoCaixa[]): LinhaDoCaixa[] {
  return [...linhas].sort((a, b) =>
    a.entry_date === b.entry_date
      ? a.direction === b.direction
        ? 0
        : a.direction === "in"
          ? -1
          : 1
      : a.entry_date < b.entry_date
        ? 1
        : -1,
  );
}
