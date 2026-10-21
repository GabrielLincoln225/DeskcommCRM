/**
 * Como as rotas de Processos leem o banco — as colunas e a ordem dos passos num
 * lugar só, para a lista, o detalhe e os modelos devolverem a mesma forma.
 */
export const COLUNAS_DO_MODELO =
  "id, name, description, trigger_stage_id, is_active, created_at, updated_at, process_template_steps(id, title, position, done_on_trigger)";

export const COLUNAS_DO_PROCESSO =
  "id, name, status, origin, contact_id, template_id, lead_id, started_by, finished_at, created_at, updated_at, contacts(id, name, display_name, phone_number)";

export const COLUNAS_DO_ITEM =
  "id, process_id, title, position, assignee_user_id, due_date, note, done_at, done_by, updated_at";

type PassoLido = { id: string; title: string; position: number; done_on_trigger: boolean };

/** A linha de `process_templates` como o select de `COLUNAS_DO_MODELO` a devolve. */
export interface ModeloLido {
  id: string;
  name: string;
  description: string | null;
  trigger_stage_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  process_template_steps?: PassoLido[] | null;
}

/** Troca o embed `process_template_steps` por `steps`, em ordem. */
export function modeloComPassos(m: ModeloLido) {
  const { process_template_steps, ...resto } = m;
  return { ...resto, steps: [...(process_template_steps ?? [])].sort((a, b) => a.position - b.position) };
}
