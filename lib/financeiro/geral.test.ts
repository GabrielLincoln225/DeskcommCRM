import { describe, expect, it } from "vitest";

import type { LinhaDoCaixa } from "./caixa";
import {
  atrasados,
  estaAtrasado,
  historicoMensal,
  mesesDoIntervalo,
  proximosVencimentos,
  receitasPorCliente,
  resumoGeral,
} from "./geral";

function linha(p: Partial<LinhaDoCaixa>): LinhaDoCaixa {
  return {
    id: "x",
    direction: "in",
    amount_cents: 1000,
    currency: "BRL",
    description: null,
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

const HOJE = "2026-11-04";

describe("estaAtrasado — pendente gravado com data antes de hoje", () => {
  it("pendente de ontem é atrasado; de hoje não", () => {
    expect(estaAtrasado(linha({ status: "pending", entry_date: "2026-11-03" }), HOJE)).toBe(true);
    expect(estaAtrasado(linha({ status: "pending", entry_date: HOJE }), HOJE)).toBe(false);
  });
  it("pago nunca é atrasado, e o previsto (id nulo) também não", () => {
    expect(estaAtrasado(linha({ status: "paid", entry_date: "2026-01-01" }), HOJE)).toBe(false);
    expect(estaAtrasado(linha({ id: null, status: "pending", entry_date: "2026-01-01" }), HOJE)).toBe(false);
  });
});

describe("resumoGeral — o histórico inteiro", () => {
  const linhas = [
    linha({ id: "1", direction: "in", amount_cents: 100_000, entry_date: "2026-08-25" }),
    linha({ id: "2", direction: "out", amount_cents: 30_000, entry_date: "2026-09-10" }),
    linha({ id: "3", direction: "in", amount_cents: 180_000, entry_date: "2026-10-29" }),
    linha({ id: "4", direction: "in", amount_cents: 165_000, status: "pending", entry_date: "2026-10-20" }),
    linha({ id: "5", direction: "out", amount_cents: 5_000, status: "pending", entry_date: "2026-11-20" }),
    // O previsto não é dinheiro lançado: fica fora do resumo.
    linha({ id: null, direction: "in", amount_cents: 999_999, status: "pending", entry_date: "2026-11-15" }),
  ];
  const r = resumoGeral(linhas, HOJE);

  it("saldo = recebido − pago de todo o histórico", () => {
    expect(r.recebido_total_cents).toBe(280_000);
    expect(r.pago_total_cents).toBe(30_000);
    expect(r.saldo_em_caixa_cents).toBe(250_000);
  });
  it("em aberto separa o atrasado", () => {
    expect(r.a_receber_cents).toBe(165_000);
    expect(r.atrasado_receber_cents).toBe(165_000);
    expect(r.a_pagar_cents).toBe(5_000);
    expect(r.atrasado_pagar_cents).toBe(0);
    expect(r.atrasados).toBe(1);
  });
  it("histórico do primeiro mês até hoje, média e melhor mês", () => {
    expect(r.primeiro_mes).toBe("2026-08");
    expect(r.meses_de_historico).toBe(4);
    expect(r.media_mensal_recebida_cents).toBe(70_000);
    expect(r.melhor_mes).toEqual({ mes: "2026-10", entradas_cents: 180_000 });
    expect(r.lancamentos).toBe(5);
  });
  it("sem lançamento nenhum: zeros e nulos, sem dividir por zero", () => {
    const vazio = resumoGeral([], HOJE);
    expect(vazio.primeiro_mes).toBeNull();
    expect(vazio.media_mensal_recebida_cents).toBe(0);
    expect(vazio.melhor_mes).toBeNull();
  });
});

describe("historicoMensal — saldo acumulado, mês vazio incluído", () => {
  it("acumula mês a mês e não pula o mês sem movimento", () => {
    const h = historicoMensal(
      [
        linha({ direction: "in", amount_cents: 100, entry_date: "2026-08-01" }),
        linha({ direction: "out", amount_cents: 30, entry_date: "2026-10-01" }),
        linha({ direction: "in", amount_cents: 999, status: "pending", entry_date: "2026-10-01" }),
      ],
      mesesDoIntervalo("2026-08", "2026-10"),
    );
    expect(h.map((m) => [m.mes, m.saldo_acumulado_cents])).toEqual([
      ["2026-08", 100],
      ["2026-09", 100],
      ["2026-10", 70],
    ]);
  });
});

describe("mesesDoIntervalo", () => {
  it("atravessa a virada do ano", () => {
    expect(mesesDoIntervalo("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
});

describe("receitasPorCliente — só receita paga, da maior para a menor", () => {
  it("soma por contato e deixa o sem-cliente como linha própria", () => {
    const r = receitasPorCliente([
      linha({ contact_id: "a", amount_cents: 100 }),
      linha({ contact_id: "b", amount_cents: 500 }),
      linha({ contact_id: "a", amount_cents: 100 }),
      linha({ contact_id: null, amount_cents: 50 }),
      linha({ contact_id: "a", amount_cents: 9_999, status: "pending" }),
      linha({ contact_id: "a", amount_cents: 9_999, direction: "out" }),
    ]);
    expect(r).toEqual([
      { contact_id: "b", total_cents: 500, lancamentos: 1 },
      { contact_id: "a", total_cents: 200, lancamentos: 2 },
      { contact_id: null, total_cents: 50, lancamentos: 1 },
    ]);
  });
});

describe("agenda e atrasados", () => {
  const linhas = [
    linha({ id: "velho", status: "pending", entry_date: "2026-10-20" }),
    linha({ id: "mais-velho", status: "pending", entry_date: "2026-09-01" }),
    linha({ id: "hoje", status: "pending", entry_date: HOJE }),
    linha({ id: null, status: "pending", entry_date: "2026-11-15" }),
    linha({ id: "longe", status: "pending", entry_date: "2026-12-30" }),
    linha({ id: "pago", status: "paid", entry_date: "2026-11-10" }),
  ];
  it("atrasados do mais antigo ao mais novo", () => {
    expect(atrasados(linhas, HOJE).map((l) => l.id)).toEqual(["mais-velho", "velho"]);
  });
  it("a agenda inclui o previsto e corta na janela", () => {
    expect(proximosVencimentos(linhas, HOJE, "2026-12-04").map((l) => l.id)).toEqual(["hoje", null]);
  });
});
