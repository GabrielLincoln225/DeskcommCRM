/**
 * O PROGRESSO DE UM PROCESSO — a conta que a lista e o detalhe mostram.
 *
 * Uma função pura, usada pela rota (que devolve o resumo de cada processo) e
 * pela tela do detalhe (que recalcula depois de marcar um item sem esperar a
 * lista). Duas apurações escritas à mão divergiriam no primeiro ajuste: a lista
 * diria "3 de 15" e o detalhe "4 de 15" para o mesmo cliente.
 *
 * "Atrasado" é item ABERTO com prazo ANTES de hoje. Prazo de hoje ainda não
 * venceu. `hoje` vem de fora (AAAA-MM-DD, no fuso da organização) para a função
 * continuar pura e testável.
 */

export interface ItemParaProgresso {
  title: string;
  position: number;
  done_at: string | null;
  due_date: string | null;
}

export interface ProgressoDoProcesso {
  total: number;
  feitos: number;
  /** 0 a 100, arredondado. Processo sem item = 0. */
  percentual: number;
  atrasados: number;
  /** O primeiro item ainda aberto, na ordem do processo. Nulo quando tudo foi feito. */
  proximo: { title: string; due_date: string | null } | null;
}

export function progressoDoProcesso(itens: readonly ItemParaProgresso[], hoje: string): ProgressoDoProcesso {
  const total = itens.length;
  const feitos = itens.filter((i) => i.done_at !== null).length;
  const atrasados = itens.filter((i) => i.done_at === null && i.due_date !== null && i.due_date < hoje).length;
  const aberto = [...itens].filter((i) => i.done_at === null).sort((a, b) => a.position - b.position)[0];
  return {
    total,
    feitos,
    percentual: total === 0 ? 0 : Math.round((feitos / total) * 100),
    atrasados,
    proximo: aberto ? { title: aberto.title, due_date: aberto.due_date } : null,
  };
}

/** AAAA-MM-DD de hoje num fuso IANA. Fuso inválido cai em UTC, nunca lança. */
export function hojeNoFuso(fuso: string | null | undefined, agora: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(agora);
  } catch {
    return agora.toISOString().slice(0, 10);
  }
}
