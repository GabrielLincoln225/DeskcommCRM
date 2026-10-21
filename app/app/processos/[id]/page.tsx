import { notFound } from "next/navigation";

import { DetalheDoProcesso } from "../_componentes/DetalheDoProcesso";
import { exigirAbaDeProcessos } from "../_componentes/guarda";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O checklist de um cliente. Chega-se aqui pela lista de Processos. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { podeEditar } = await exigirAbaDeProcessos();
  const { id } = await params;
  if (!UUID_RX.test(id)) notFound();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <DetalheDoProcesso id={id} podeEditar={podeEditar} />
    </div>
  );
}
