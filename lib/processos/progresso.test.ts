import { describe, expect, it } from "vitest";

import { hojeNoFuso, progressoDoProcesso, type ItemParaProgresso } from "./progresso";

const item = (p: Partial<ItemParaProgresso> & { position: number }): ItemParaProgresso => ({
  title: `Passo ${p.position}`,
  done_at: null,
  due_date: null,
  ...p,
});

describe("progressoDoProcesso", () => {
  it("conta feitos, percentual e o próximo item aberto na ordem do processo", () => {
    const r = progressoDoProcesso(
      [item({ position: 3 }), item({ position: 1, done_at: "2026-10-01T10:00:00Z" }), item({ position: 2 })],
      "2026-10-21",
    );
    expect(r).toMatchObject({ total: 3, feitos: 1, percentual: 33 });
    expect(r.proximo?.title).toBe("Passo 2");
  });

  it("atrasado é item aberto com prazo antes de hoje; prazo de hoje ainda não venceu", () => {
    const r = progressoDoProcesso(
      [
        item({ position: 1, due_date: "2026-10-20" }),
        item({ position: 2, due_date: "2026-10-21" }),
        item({ position: 3, due_date: "2026-10-19", done_at: "2026-10-19T12:00:00Z" }),
      ],
      "2026-10-21",
    );
    expect(r.atrasados).toBe(1);
  });

  it("tudo feito: 100% e sem próximo; sem item: 0%", () => {
    expect(progressoDoProcesso([item({ position: 1, done_at: "x" })], "2026-10-21")).toMatchObject({
      percentual: 100,
      proximo: null,
    });
    expect(progressoDoProcesso([], "2026-10-21")).toMatchObject({ total: 0, percentual: 0, proximo: null });
  });
});

describe("hojeNoFuso", () => {
  it("usa o fuso da organização, não o do servidor", () => {
    // 02:00 UTC do dia 21 ainda é dia 20 em Cuiabá (UTC-4).
    expect(hojeNoFuso("America/Cuiaba", new Date("2026-10-21T02:00:00Z"))).toBe("2026-10-20");
  });
  it("fuso inválido cai em UTC sem lançar", () => {
    expect(hojeNoFuso("Nada/Disso", new Date("2026-10-21T02:00:00Z"))).toBe("2026-10-21");
  });
});
