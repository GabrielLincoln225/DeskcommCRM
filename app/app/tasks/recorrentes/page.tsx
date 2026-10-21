import type { Metadata } from "next";

import { TarefasRecorrentes } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tarefas recorrentes" };

export default function PaginaDeTarefasRecorrentes() {
  return <TarefasRecorrentes />;
}
