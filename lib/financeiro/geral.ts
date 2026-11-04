/**
 * A VISÃO GERAL — o caixa de todos os tempos, sem HTTP.
 *
 * O Painel responde "como está este mês?"; esta responde "como está a empresa
 * desde o primeiro lançamento?". Mesmas palavras de `lib/financeiro/caixa.ts`
 * (REALIZADO = pago, PENDENTE = gravado e não pago, PREVISTO = o que um molde
 * ainda vai gerar), aplicadas ao histórico inteiro.
 *
 * ⚠️ ATRASADO é PENDENTE com data anterior a hoje. Não é um status do banco: é
 * a mesma linha pendente, olhada contra o calendário. Gravar "atrasado" no
 * banco exigiria um cron para virar a chave todo dia, e o dia em que ele
 * falhasse o painel mentiria.
 *
 * ⚠️ O SALDO EM CAIXA é recebido − pago de TODO o histórico lançado. Não é o
 * extrato do banco: dinheiro que entrou e ninguém lançou não está aqui. A tela
 * diz isso por extenso.
 */
import type { LinhaDoCaixa, MesDoFluxo } from "./caixa";

export interface ResumoGeral {
  saldo_em_caixa_cents: number;
  recebido_total_cents: number;
  pago_total_cents: number;
  /** Pendentes gravados, por direção (inclui os atrasados). */
  a_receber_cents: number;
  a_pagar_cents: number;
  atrasado_receber_cents: number;
  atrasado_pagar_cents: number;
  atrasados: number;
  /** "AAAA-MM" do primeiro lançamento, ou `null` sem nenhum. */
  primeiro_mes: string | null;
  /** Meses do primeiro lançamento até o mês de hoje, inclusive. */
  meses_de_historico: number;
  media_mensal_recebida_cents: number;
  media_mensal_resultado_cents: number;
  melhor_mes: { mes: string; entradas_cents: number } | null;
  lancamentos: number;
}

/** Pendente com data antes de hoje. Datas ISO comparam como texto. */
export function estaAtrasado(l: Pick<LinhaDoCaixa, "status" | "entry_date" | "id">, hoje: string): boolean {
  return l.id !== null && l.status === "pending" && l.entry_date < hoje;
}

/** "2026-08" e "2026-11" → 4. */
function mesesEntre(de: string, ate: string): number {
  const [a1, m1] = de.split("-").map(Number) as [number, number];
  const [a2, m2] = ate.split("-").map(Number) as [number, number];
  return (a2 - a1) * 12 + (m2 - m1) + 1;
}

/** Todos os meses de `de` a `ate`, inclusive, do mais antigo ao mais novo. */
export function mesesDoIntervalo(de: string, ate: string): string[] {
  const n = Math.max(0, mesesEntre(de, ate));
  const [ano, mes] = de.split("-").map(Number) as [number, number];
  const saida: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(ano, mes - 1 + i, 1));
    saida.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return saida;
}

export function resumoGeral(linhas: LinhaDoCaixa[], hoje: string): ResumoGeral {
  const r: ResumoGeral = {
    saldo_em_caixa_cents: 0,
    recebido_total_cents: 0,
    pago_total_cents: 0,
    a_receber_cents: 0,
    a_pagar_cents: 0,
    atrasado_receber_cents: 0,
    atrasado_pagar_cents: 0,
    atrasados: 0,
    primeiro_mes: null,
    meses_de_historico: 0,
    media_mensal_recebida_cents: 0,
    media_mensal_resultado_cents: 0,
    melhor_mes: null,
    lancamentos: 0,
  };
  const gravadas = linhas.filter((l) => l.id !== null);
  r.lancamentos = gravadas.length;
  for (const l of gravadas) {
    const entrada = l.direction === "in";
    if (l.status === "paid") {
      if (entrada) r.recebido_total_cents += l.amount_cents;
      else r.pago_total_cents += l.amount_cents;
      continue;
    }
    if (entrada) r.a_receber_cents += l.amount_cents;
    else r.a_pagar_cents += l.amount_cents;
    if (estaAtrasado(l, hoje)) {
      r.atrasados += 1;
      if (entrada) r.atrasado_receber_cents += l.amount_cents;
      else r.atrasado_pagar_cents += l.amount_cents;
    }
  }
  r.saldo_em_caixa_cents = r.recebido_total_cents - r.pago_total_cents;

  const primeira = gravadas.reduce<string | null>(
    (menor, l) => (menor === null || l.entry_date < menor ? l.entry_date : menor),
    null,
  );
  if (primeira) {
    const mesDeHoje = hoje.slice(0, 7);
    r.primeiro_mes = primeira.slice(0, 7) < mesDeHoje ? primeira.slice(0, 7) : mesDeHoje;
    r.meses_de_historico = mesesEntre(r.primeiro_mes, mesDeHoje);
    r.media_mensal_recebida_cents = Math.round(r.recebido_total_cents / r.meses_de_historico);
    r.media_mensal_resultado_cents = Math.round(r.saldo_em_caixa_cents / r.meses_de_historico);
  }

  const porMes = new Map<string, number>();
  for (const l of gravadas) {
    if (l.direction !== "in" || l.status !== "paid") continue;
    const m = l.entry_date.slice(0, 7);
    porMes.set(m, (porMes.get(m) ?? 0) + l.amount_cents);
  }
  for (const [mes, entradas_cents] of porMes) {
    if (!r.melhor_mes || entradas_cents > r.melhor_mes.entradas_cents) r.melhor_mes = { mes, entradas_cents };
  }
  return r;
}

export interface MesDoHistorico extends MesDoFluxo {
  /** Recebido − pago acumulado até o fim deste mês. */
  saldo_acumulado_cents: number;
}

/** Entradas e saídas PAGAS de cada mês do histórico, com o saldo acumulado. */
export function historicoMensal(linhas: LinhaDoCaixa[], meses: string[]): MesDoHistorico[] {
  const por = new Map(meses.map((m) => [m, { entradas: 0, saidas: 0 }]));
  for (const l of linhas) {
    if (l.id === null || l.status !== "paid") continue;
    const alvo = por.get(l.entry_date.slice(0, 7));
    if (!alvo) continue;
    if (l.direction === "in") alvo.entradas += l.amount_cents;
    else alvo.saidas += l.amount_cents;
  }
  let acumulado = 0;
  return meses.map((mes) => {
    const v = por.get(mes)!;
    acumulado += v.entradas - v.saidas;
    return { mes, entradas_cents: v.entradas, saidas_cents: v.saidas, saldo_acumulado_cents: acumulado };
  });
}

export interface ReceitaDoCliente {
  /** `null` = receitas lançadas sem cliente. */
  contact_id: string | null;
  total_cents: number;
  lancamentos: number;
}

/** Quem mais pagou, de todos os tempos: receitas PAGAS por cliente, da maior para a menor. */
export function receitasPorCliente(linhas: LinhaDoCaixa[], limite = 8): ReceitaDoCliente[] {
  const por = new Map<string | null, ReceitaDoCliente>();
  for (const l of linhas) {
    if (l.id === null || l.direction !== "in" || l.status !== "paid") continue;
    const atual = por.get(l.contact_id) ?? { contact_id: l.contact_id, total_cents: 0, lancamentos: 0 };
    atual.total_cents += l.amount_cents;
    atual.lancamentos += 1;
    por.set(l.contact_id, atual);
  }
  return [...por.values()].sort((a, b) => b.total_cents - a.total_cents).slice(0, limite);
}

/**
 * O que vence de hoje até `ate` (inclusive): pendentes gravados e previstos
 * dos moldes, em ordem de data. É a agenda de quem cuida do caixa — "o que eu
 * preciso cobrar ou pagar nos próximos dias".
 */
export function proximosVencimentos(linhas: LinhaDoCaixa[], hoje: string, ate: string): LinhaDoCaixa[] {
  return linhas
    .filter((l) => l.status === "pending" && l.entry_date >= hoje && l.entry_date <= ate)
    .sort((a, b) => (a.entry_date === b.entry_date ? 0 : a.entry_date < b.entry_date ? -1 : 1));
}

/** Os atrasados, do mais antigo ao mais novo — o primeiro da lista é o mais urgente. */
export function atrasados(linhas: LinhaDoCaixa[], hoje: string): LinhaDoCaixa[] {
  return linhas
    .filter((l) => estaAtrasado(l, hoje))
    .sort((a, b) => (a.entry_date === b.entry_date ? 0 : a.entry_date < b.entry_date ? -1 : 1));
}
