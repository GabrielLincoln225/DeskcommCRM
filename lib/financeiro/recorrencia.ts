/**
 * A competência de um molde recorrente, e quando ele vale.
 *
 * Mora aqui, e não na rota do cron, porque duas pontas precisam da MESMA regra:
 * o cron, que grava a linha quando a data chega, e o Caixa, que mostra como
 * "previsto" o que ainda vai chegar. Duas cópias da regra seriam o Caixa
 * prevendo uma cobrança que o cron nunca gera.
 */

/**
 * A data da competência deste mês para um molde.
 *
 * ⚠️ ONZE MESES DO ANO NÃO TÊM TODOS OS DIAS. Um molde de dia 31 em fevereiro
 * não pode ser pulado (deixaria de cobrar o aluguel) nem empurrado para março
 * (mudaria a competência): ele cai no último dia do mês.
 */
export function competenciaDoMes(ano: number, mes: number, diaDoMes: number): string {
  // Dia 0 do mês seguinte é o último dia deste. `Date.UTC` porque a competência
  // é uma data civil, não um instante: usar o fuso local do servidor faria a
  // mesma instalação gerar dias diferentes conforme onde ela roda.
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const dia = Math.min(diaDoMes, ultimoDia);
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * O molde vale nesta competência? Só depois do início (migration 0626).
 *
 * `startsOn` nulo é o molde de antes da coluna existir: vale desde sempre, que
 * era o comportamento dele. Datas ISO comparam como texto.
 */
export function moldeValeNaCompetencia(startsOn: string | null | undefined, competencia: string): boolean {
  return !startsOn || competencia >= startsOn;
}
