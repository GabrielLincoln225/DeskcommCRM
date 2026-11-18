/**
 * Fork Konnexo — nó `notify_team` num fluxo de follow-up: "avisar a equipe no
 * WhatsApp" (o número de Avisos), pela MESMA ação `notify_team` das automações.
 *
 * O que este arquivo mede:
 *
 * 1. o grafo com `notify_team` parseia, AVANÇA pela aresta única e chama o
 *    aviso UMA vez, com o título da caixa e o fluxo da inscrição;
 * 2. no REPLAY (o evento do passo já existia) o aviso NÃO sai de novo — é a
 *    mesma trava dos nós `move_lead`/`edit_lead_tag`;
 * 3. falha do aviso não reverte o avanço (o card segue o fluxo, o warn fica);
 * 4. o nó está na paleta do follow-up e não conta como passo que fala com o cliente.
 */
import { describe, expect, it } from "vitest";

import {
  runFollowupTick,
  type AdminClient,
  type TickDeps,
} from "@/lib/followup/engine";
import type { EnrollmentRow } from "@/lib/followup/node-handlers";
import { flowGraphSchema } from "@/lib/followup/graph-schema";
import { NOS_DA_SUPERFICIE } from "@/lib/followup/validate-publish";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONTATO = "22222222-2222-4222-8222-222222222222";

function enrollment(currentNodeId: string): EnrollmentRow {
  return {
    id: "e1",
    organization_id: ORG,
    pointer_id: "p1",
    version_id: "v1",
    contact_id: CONTATO,
    conversation_id: null,
    current_node_id: currentNodeId,
    status: "active",
    next_eval_at: new Date().toISOString(),
    claimed_until: null,
    attempts: 0,
    max_attempts: 3,
    last_error: null,
    steps_taken: 0,
    outcome: null,
    cancel_reason: null,
    started_at: new Date().toISOString(),
    completed_at: null,
    updated_at: new Date().toISOString(),
  };
}

const GRAFO = {
  nodes: [
    { id: "n1", type: "trigger", label: "Início", position: { x: 0, y: 0 }, config: {} },
    { id: "n2", type: "notify_team", label: "Cliente respondeu", position: { x: 100, y: 0 }, config: {} },
    { id: "fim", type: "end", label: "Fim", position: { x: 200, y: 0 }, config: { outcome: "converted" } },
  ],
  edges: [
    { id: "a", source: "n1", target: "n2", condition: { type: "always" } },
    { id: "b", source: "n2", target: "fim", condition: { type: "always" } },
  ],
};

function cenario(opcoes: { replay?: boolean; falha?: boolean } = {}) {
  const avisos: unknown[] = [];
  const patches: Array<Record<string, unknown>> = [];
  const fila = [enrollment("n2")];
  const db: AdminClient = {
    async claimDueEnrollments() {
      return fila.splice(0, fila.length);
    },
    async loadFlowGraph() {
      return flowGraphSchema.parse(GRAFO);
    },
    async loadLeadFacts() {
      return { lead_stage: "x", tags: [], contact_name: "Cliente", custom_fields: {} };
    },
    async loadEnrollmentEvents() {
      return [];
    },
    async insertEnrollmentEvent() {
      return { inserted: !opcoes.replay };
    },
    async updateEnrollment(_id, _org, patch) {
      patches.push(patch as Record<string, unknown>);
    },
    async avisarEquipe(item) {
      avisos.push(item);
      if (opcoes.falha) throw new Error("canal_pausado");
    },
    async loadLastInboundBody() {
      return null;
    },
    async loadFlowPointerName() {
      return null;
    },
    async insertDeadInboxItem() {},
    async persistirRespostaFollowup() {},
  };
  const deps: TickDeps = {
    db,
    clock: () => new Date("2026-11-18T12:00:00.000Z"),
    enqueueJob: async () => {},
  };
  return { deps, avisos, patches };
}

describe("nó avisar a equipe (notify_team, fork Konnexo)", () => {
  it("avança e avisa UMA vez, com o título da caixa e o fluxo da inscrição", async () => {
    const c = cenario();
    const resumo = await runFollowupTick(c.deps);
    expect(resumo.failed).toBe(0);
    expect(c.avisos).toEqual([
      { organization_id: ORG, contact_id: CONTATO, enrollment_id: "e1", pointer_id: "p1", rotulo: "Cliente respondeu" },
    ]);
    expect(c.patches[0]).toMatchObject({ current_node_id: "fim", steps_taken: 1 });
  });

  it("no replay do passo o aviso não sai de novo", async () => {
    const c = cenario({ replay: true });
    await runFollowupTick(c.deps);
    expect(c.avisos).toHaveLength(0);
  });

  it("falha do aviso não reverte o avanço", async () => {
    const c = cenario({ falha: true });
    const resumo = await runFollowupTick(c.deps);
    expect(resumo.failed).toBe(0);
    expect(c.avisos).toHaveLength(1);
    expect(c.patches[0]).toMatchObject({ current_node_id: "fim" });
  });

  it("está na paleta do follow-up e da automação, e não no roteiro de atendimento", () => {
    expect(NOS_DA_SUPERFICIE.followup).toContain("notify_team");
    expect(NOS_DA_SUPERFICIE.crm_automation).toContain("notify_team");
    expect(NOS_DA_SUPERFICIE.atendimento).not.toContain("notify_team");
  });
});
