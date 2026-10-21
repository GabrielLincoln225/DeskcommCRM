import { describe, expect, it } from "vitest";

import { datasDevidas, instanteNoFuso } from "./recorrencia-mensal";

const molde = { day_of_month: 5, lead_days: 3, starts_on: "2026-10-01" };

describe("datasDevidas", () => {
  it("a do mês aparece lead_days antes do dia, e não antes", () => {
    expect(datasDevidas(molde, "2026-11-01")).toEqual([]);
    expect(datasDevidas(molde, "2026-11-02")).toEqual(["2026-11-05"]);
    expect(datasDevidas(molde, "2026-11-20")).toEqual(["2026-11-05"]);
  });

  it("perto da virada, a do mês seguinte também já é devida", () => {
    expect(datasDevidas({ ...molde, day_of_month: 1 }, "2026-11-29")).toEqual(["2026-11-01", "2026-12-01"]);
    expect(datasDevidas({ ...molde, day_of_month: 2, lead_days: 5 }, "2026-12-28")).toEqual([
      "2026-12-02",
      "2027-01-02",
    ]);
  });

  it("nada antes do início do molde", () => {
    expect(datasDevidas({ ...molde, starts_on: "2026-11-10" }, "2026-11-20")).toEqual([]);
  });

  it("dia 31 em mês curto cai no último dia", () => {
    expect(datasDevidas({ ...molde, day_of_month: 31, lead_days: 0 }, "2027-02-28")).toEqual(["2027-02-28"]);
  });
});

describe("instanteNoFuso", () => {
  it("hora de parede em Cuiabá (UTC-4) vira o instante certo", () => {
    expect(instanteNoFuso("2026-11-05", "09:00", "America/Cuiaba")).toBe("2026-11-05T13:00:00.000Z");
  });
  it("fuso inválido cai em UTC", () => {
    expect(instanteNoFuso("2026-11-05", "09:00", "Nada/Disso")).toBe("2026-11-05T09:00:00.000Z");
  });
});
