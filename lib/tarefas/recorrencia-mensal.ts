/**
 * TAREFA MENSAL — quando a tarefa de cada mês nasce (migration 9003).
 *
 * Regra pura, usada pelo cron (`cron/recurring-tasks`) e pela criação na tela,
 * que gera a primeira na hora: as duas pontas precisam da MESMA conta, senão a
 * tela criaria uma tarefa que o cron, no dia seguinte, criaria de novo para
 * outra data.
 *
 * A data do mês é a do Financeiro (`competenciaDoMes`): dia 31 em fevereiro
 * cai no último dia, nunca é pulado nem empurrado para março.
 */
import { competenciaDoMes } from "@/lib/financeiro/recorrencia";

export interface MoldeMensal {
  day_of_month: number;
  lead_days: number;
  /** AAAA-MM-DD — nenhuma data antes desta. */
  starts_on: string;
}

function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * As datas do molde que já devem existir como tarefa em `hoje` (AAAA-MM-DD, no
 * fuso da organização): a do mês corrente e a do seguinte, cada uma só quando
 * `hoje` chegou a `lead_days` dias antes dela e ela não é anterior ao início.
 *
 * Só o mês corrente e o próximo, nunca os anteriores: um molde criado hoje não
 * cobra os meses que passaram, e um cron que ficou dias parado gera o mês em
 * curso, não um acúmulo.
 */
export function datasDevidas(molde: MoldeMensal, hoje: string): string[] {
  const [ano, mes] = hoje.split("-").map(Number) as [number, number];
  const candidatas = [
    competenciaDoMes(ano, mes, molde.day_of_month),
    mes === 12 ? competenciaDoMes(ano + 1, 1, molde.day_of_month) : competenciaDoMes(ano, mes + 1, molde.day_of_month),
  ];
  return candidatas.filter((data) => data >= molde.starts_on && somarDias(data, -molde.lead_days) <= hoje);
}

/**
 * O instante (ISO, UTC) de uma data e hora de parede num fuso IANA.
 * "2026-11-05" "09:00" em America/Cuiaba → "2026-11-05T13:00:00.000Z".
 * Fuso inválido cai em UTC. Nunca lança.
 */
export function instanteNoFuso(data: string, hora: string, fuso: string | null | undefined): string {
  const [a, m, d] = data.split("-").map(Number) as [number, number, number];
  const [h, min] = hora.split(":").map(Number) as [number, number];
  const comoUtc = Date.UTC(a, m - 1, d, h, min);
  try {
    const partes = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso || "UTC",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(comoUtc));
    const v = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
    const lidoNoFuso = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"));
    return new Date(comoUtc - (lidoNoFuso - comoUtc)).toISOString();
  } catch {
    return new Date(comoUtc).toISOString();
  }
}
