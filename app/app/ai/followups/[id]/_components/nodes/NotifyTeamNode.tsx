"use client";

import type { NodeProps } from "@xyflow/react";

import type { RFNode } from "@/lib/followup/graph-mappers";
import { useT } from "@/hooks/i18n/useT";
import { NODE_VISUALS, describeNodeConfig } from "./nodeVisuals";
import { NodeCard } from "./NodeCard";

/**
 * O nó `notify_team` no canvas (fork Konnexo) — avisa a equipe no WhatsApp
 * cadastrado em Avisos, sem mensagem ao cliente.
 */
export function NotifyTeamNode({ id, data, selected }: NodeProps<RFNode>) {
  const t = useT();
  return (
    <NodeCard
      id={id}
      visual={NODE_VISUALS.notify_team}
      label={data.label}
      subtitle={describeNodeConfig("notify_team", data.config, t)}
      selected={selected}
      errors={data.errors}
    />
  );
}
