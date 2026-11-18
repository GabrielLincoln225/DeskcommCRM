/**
 * Valor variável no caixa (9004, fork Konnexo) — o que as rotas GRAVAM.
 *
 * O anúncio e a comissão ficam em aberto com uma estimativa; o confirmar manda
 * o valor real. As três garantias medidas aqui:
 *
 *   1. criar com `valor_variavel` grava a linha PENDENTE e marcada como
 *      estimativa, mesmo que o corpo diga "já pago" — estimativa paga não existe;
 *   2. pagar com `amount_cents` troca o valor NA MESMA escrita que paga, e tira
 *      a marca de estimativa;
 *   3. lançar o previsto de um molde variável com o valor real grava esse valor,
 *      pago e sem marca.
 *
 * O Supabase é dublado: cada `from(tabela)` devolve um construtor que anota o
 * que foi inserido ou atualizado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/catalogo/moeda-da-org", () => ({ moedaDaOrganizacao: async () => "BRL" }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({
    ok: true,
    org: { orgId: "org-1", role: "admin" },
    user: { id: "user-1" },
  }),
}));

type Escrita = { tabela: string; tipo: "insert" | "update"; valores: Record<string, unknown> };
const estado: { escritas: Escrita[]; linha: Record<string, unknown> | null; molde: Record<string, unknown> | null } = {
  escritas: [],
  linha: null,
  molde: null,
};

function construtor(tabela: string) {
  let pendente: Escrita | null = null;
  const q: Record<string, unknown> = {};
  const devolve = () => q;
  Object.assign(q, {
    select: devolve,
    eq: devolve,
    order: devolve,
    limit: devolve,
    insert: (valores: Record<string, unknown>) => {
      pendente = { tabela, tipo: "insert", valores };
      estado.escritas.push(pendente);
      return q;
    },
    update: (valores: Record<string, unknown>) => {
      pendente = { tabela, tipo: "update", valores };
      estado.escritas.push(pendente);
      return q;
    },
    single: async () => ({
      data: { id: tabela === "recurring_entries" ? "molde-1" : "linha-1", ...(pendente?.valores ?? {}) },
      error: null,
    }),
    maybeSingle: async () => ({
      data: tabela === "recurring_entries" ? estado.molde : estado.linha,
      error: null,
    }),
    // `await supabase.from(...).update(...).eq(...)` sem `.single()`.
    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
  });
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (tabela: string) => construtor(tabela) }),
}));

function pedido(corpo: unknown) {
  return { json: async () => corpo, nextUrl: new URL("http://x/"), url: "http://x/" } as never;
}

const escritaEm = (tabela: string, tipo: Escrita["tipo"]) =>
  estado.escritas.find((e) => e.tabela === tabela && e.tipo === tipo)?.valores;

describe("valor variável no caixa", () => {
  beforeEach(() => {
    estado.escritas = [];
    estado.linha = null;
    estado.molde = null;
  });

  it("criar com valor variável grava pendente e marcado como estimativa, mesmo pedindo 'pago'", async () => {
    const { POST } = await import("./lancamentos/route");
    const r = await POST(
      pedido({
        account_id: crypto.randomUUID(),
        direction: "out",
        amount_cents: 30_000,
        description: "Tráfego pago",
        entry_date: "2026-11-30",
        status: "paid",
        repetir: "mensal",
        valor_variavel: true,
      }),
    );
    expect(r.status).toBe(200);
    expect(escritaEm("recurring_entries", "insert")).toMatchObject({ is_variable: true, amount_cents: 30_000 });
    expect(escritaEm("financial_entries", "insert")).toMatchObject({
      status: "pending",
      paid_at: null,
      amount_is_estimate: true,
    });
  });

  it("lançamento de valor certo segue como antes: sem marca de estimativa", async () => {
    const { POST } = await import("./lancamentos/route");
    await POST(
      pedido({
        account_id: crypto.randomUUID(),
        direction: "out",
        amount_cents: 5_000,
        description: "Internet",
        entry_date: "2026-11-20",
        status: "paid",
      }),
    );
    expect(escritaEm("financial_entries", "insert")).toMatchObject({ status: "paid", amount_is_estimate: false });
  });

  it("pagar com o valor real troca o valor na mesma escrita e tira a marca", async () => {
    estado.linha = { id: "linha-1", status: "pending", origin: "recurring", amount_cents: 30_000, direction: "out" };
    const { PATCH } = await import("./lancamentos/[id]/route");
    const r = await PATCH(pedido({ pay: true, amount_cents: 35_600 }), {
      params: Promise.resolve({ id: "linha-1" }),
    });
    expect(r.status).toBe(200);
    const update = escritaEm("financial_entries", "update");
    expect(update).toMatchObject({ status: "paid", amount_cents: 35_600, amount_is_estimate: false });
    expect(update?.paid_at).toBeTruthy();
  });

  it("valor real não vale para lançamento de comanda", async () => {
    estado.linha = { id: "linha-1", status: "pending", origin: "sale", amount_cents: 10_000, direction: "in" };
    const { PATCH } = await import("./lancamentos/[id]/route");
    const r = await PATCH(pedido({ pay: true, amount_cents: 1 }), { params: Promise.resolve({ id: "linha-1" }) });
    expect(r.status).toBe(409);
    expect(escritaEm("financial_entries", "update")).toBeUndefined();
  });

  it("previsto de molde variável confirmado com o valor real grava o valor, pago e sem marca", async () => {
    estado.molde = {
      id: "molde-1",
      account_id: "conta-1",
      account_plan_id: null,
      contact_id: null,
      direction: "out",
      amount_cents: 30_000,
      currency: "BRL",
      name: "Tráfego pago",
      day_of_month: 30,
      starts_on: "2026-10-30",
      is_active: true,
      is_variable: true,
    };
    const { POST } = await import("./previstos/route");
    const r = await POST(
      pedido({ recurring_entry_id: crypto.randomUUID(), entry_date: "2026-11-30", pagar: true, amount_cents: 35_600 }),
    );
    expect(r.status).toBe(200);
    expect(escritaEm("financial_entries", "insert")).toMatchObject({
      amount_cents: 35_600,
      status: "paid",
      amount_is_estimate: false,
    });
  });

  it("previsto variável gravado pendente, sem valor informado, nasce como estimativa", async () => {
    estado.molde = {
      id: "molde-1",
      account_id: "conta-1",
      account_plan_id: null,
      contact_id: null,
      direction: "out",
      amount_cents: 30_000,
      currency: "BRL",
      name: "Tráfego pago",
      day_of_month: 30,
      starts_on: null,
      is_active: true,
      is_variable: true,
    };
    const { POST } = await import("./previstos/route");
    await POST(pedido({ recurring_entry_id: crypto.randomUUID(), entry_date: "2026-11-30", pagar: false }));
    expect(escritaEm("financial_entries", "insert")).toMatchObject({
      amount_cents: 30_000,
      status: "pending",
      amount_is_estimate: true,
    });
  });
});
