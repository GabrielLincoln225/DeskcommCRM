/**
 * As contas do Caixa. Cada caso nomeia a confusão que ele impede — a regra
 * inteira está em `caixa.ts`, e é pura justamente para ser medida aqui.
 */
import { describe, expect, it } from "vitest";

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
} from "./caixa";
import { moldeValeNaCompetencia } from "./recorrencia";

function linha(p: Partial<LinhaDoCaixa> & Pick<LinhaDoCaixa, "direction" | "amount_cents">): LinhaDoCaixa {
  return {
    id: crypto.randomUUID(),
    currency: "BRL",
    description: "x",
    entry_date: "2026-10-10",
    status: "paid",
    origin: "manual",
    account_plan_id: null,
    contact_id: null,
    lead_id: null,
    recurring_entry_id: null,
    ...p,
  };
}

function molde(p: Partial<MoldeRecorrente> = {}): MoldeRecorrente {
  return {
    id: crypto.randomUUID(),
    name: "Hospedagem",
    direction: "out",
    amount_cents: 5_900,
    currency: "BRL",
    day_of_month: 8,
    account_plan_id: null,
    contact_id: null,
    starts_on: null,
    ...p,
  };
}

describe("periodoDoMes", () => {
  it("dá o primeiro e o último dia, inclusive em fevereiro bissexto", () => {
    expect(periodoDoMes("2026-10")).toEqual({ de: "2026-10-01", ate: "2026-10-31" });
    expect(periodoDoMes("2028-02")).toEqual({ de: "2028-02-01", ate: "2028-02-29" });
  });

  it("recusa o que não é mês — a rota devolve 422, não um período inventado", () => {
    expect(() => periodoDoMes("2026-13")).toThrow();
    expect(() => periodoDoMes("outubro")).toThrow();
  });
});

describe("mesesAte", () => {
  it("atravessa a virada do ano em ordem cronológica", () => {
    expect(mesesAte("2027-02", 4)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
});

describe("resumoDoCaixa", () => {
  // Um mês com 3 saídas pagas, 1 saída pendente e 3 entradas pendentes: o mesmo
  // formato do mês que a tela de origem mostrava, com números neutros.
  const mes = [
    linha({ direction: "out", amount_cents: 5_900 }),
    linha({ direction: "out", amount_cents: 12_500 }),
    linha({ direction: "out", amount_cents: 10_000 }),
    linha({ direction: "out", amount_cents: 10_000, status: "pending" }),
    linha({ direction: "in", amount_cents: 100_000, status: "pending" }),
    linha({ direction: "in", amount_cents: 100_000, status: "pending" }),
    linha({ direction: "in", amount_cents: 51_700, status: "pending" }),
  ];

  it("o saldo realizado só conta o que foi pago — pendente não é dinheiro em caixa", () => {
    const r = resumoDoCaixa(mes);
    expect(r.receitas_realizadas_cents).toBe(0);
    expect(r.despesas_realizadas_cents).toBe(28_400);
    expect(r.saldo_realizado_cents).toBe(-28_400);
    expect(r.saidas_confirmadas).toBe(3);
  });

  it("o resultado previsto é tudo que entra menos tudo que sai, pago ou não", () => {
    const r = resumoDoCaixa(mes);
    expect(r.resultado_previsto_cents).toBe(251_700 - 38_400);
    expect(r.a_receber_cents).toBe(251_700);
    expect(r.a_pagar_cents).toBe(10_000);
    expect(r.a_confirmar).toBe(4);
  });

  it("período vazio é zero em tudo, não NaN", () => {
    expect(Object.values(resumoDoCaixa([])).every((v) => v === 0)).toBe(true);
  });
});

describe("previstosDoMes", () => {
  it("prevê a competência que ainda vai chegar", () => {
    const m = molde({ day_of_month: 20 });
    const p = previstosDoMes([m], [], "2026-10", "2026-10-09");
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ id: null, origin: "previsto", entry_date: "2026-10-20", status: "pending" });
  });

  it("não prevê o passado: competência que já venceu e não está no banco não é previsão", () => {
    const m = molde({ day_of_month: 8 });
    expect(previstosDoMes([m], [], "2026-10", "2026-10-09")).toEqual([]);
  });

  it("não duplica o que o cron já gravou — a chave é a do índice único do banco", () => {
    const m = molde({ day_of_month: 20 });
    const gravada = { recurring_entry_id: m.id, entry_date: "2026-11-20" };
    expect(previstosDoMes([m], [gravada], "2026-11", "2026-10-09")).toEqual([]);
  });

  it("respeita o início do molde: a mensalidade que começa em novembro não aparece em outubro", () => {
    const m = molde({ day_of_month: 15, starts_on: "2026-11-15" });
    expect(previstosDoMes([m], [], "2026-10", "2026-10-01")).toEqual([]);
    expect(previstosDoMes([m], [], "2026-11", "2026-10-01")).toHaveLength(1);
  });

  it("dia 31 em mês de 30 cai no dia 30, como no cron", () => {
    const m = molde({ day_of_month: 31 });
    expect(previstosDoMes([m], [], "2026-11", "2026-10-09")[0]?.entry_date).toBe("2026-11-30");
  });
});

describe("moldeValeNaCompetencia", () => {
  it("molde sem início vale sempre — é o molde de antes da coluna existir", () => {
    expect(moldeValeNaCompetencia(null, "2020-01-01")).toBe(true);
  });

  it("vale a partir do próprio dia de início, inclusive", () => {
    expect(moldeValeNaCompetencia("2026-11-15", "2026-11-15")).toBe(true);
    expect(moldeValeNaCompetencia("2026-11-15", "2026-11-14")).toBe(false);
  });
});

describe("fluxoMensal", () => {
  it("todo mês pedido aparece, inclusive o vazio, e só conta o pago", () => {
    const f = fluxoMensal(
      [
        linha({ direction: "in", amount_cents: 51_700, entry_date: "2026-08-25" }),
        linha({ direction: "out", amount_cents: 10_000, entry_date: "2026-10-10" }),
        linha({ direction: "in", amount_cents: 99_999, entry_date: "2026-10-15", status: "pending" }),
      ],
      ["2026-08", "2026-09", "2026-10"],
    );
    expect(f).toEqual([
      { mes: "2026-08", entradas_cents: 51_700, saidas_cents: 0 },
      { mes: "2026-09", entradas_cents: 0, saidas_cents: 0 },
      { mes: "2026-10", entradas_cents: 0, saidas_cents: 10_000 },
    ]);
  });
});

describe("despesasPorCategoria", () => {
  it("só saída paga, da maior para a menor, com a fatia sem categoria visível", () => {
    const fatias = despesasPorCategoria([
      linha({ direction: "out", amount_cents: 18_400, account_plan_id: "apis" }),
      linha({ direction: "out", amount_cents: 10_000, account_plan_id: null }),
      linha({ direction: "out", amount_cents: 7_000, account_plan_id: "apis", status: "pending" }),
      linha({ direction: "in", amount_cents: 50_000, account_plan_id: "servicos" }),
    ]);
    expect(fatias).toEqual([
      { account_plan_id: "apis", total_cents: 18_400, percentual: 65 },
      { account_plan_id: null, total_cents: 10_000, percentual: 35 },
    ]);
  });
});

describe("ordenarExtrato", () => {
  it("mais recente primeiro; no mesmo dia, a entrada antes da saída", () => {
    const a = linha({ direction: "out", amount_cents: 1, entry_date: "2026-10-10" });
    const b = linha({ direction: "in", amount_cents: 1, entry_date: "2026-10-10" });
    const c = linha({ direction: "out", amount_cents: 1, entry_date: "2026-10-20" });
    expect(ordenarExtrato([a, b, c]).map((l) => l.id)).toEqual([c.id, b.id, a.id]);
  });
});
