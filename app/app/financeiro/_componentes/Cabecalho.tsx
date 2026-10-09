/**
 * O cabeçalho das duas telas do Financeiro: título, frase e as abas
 * Painel | Caixa. Server Component — a aba ativa é a rota, não estado.
 */
import Link from "next/link";

import { cn } from "@/lib/utils";

export function CabecalhoDoFinanceiro({
  ativa,
  titulo,
  frase,
  rotulos,
}: {
  ativa: "painel" | "caixa";
  titulo: string;
  frase: string;
  /** Já traduzidos por quem chama: Server Component não tem `useT`. */
  rotulos: { painel: string; caixa: string; navegacao: string };
}) {
  const abas = [
    { id: "painel", href: "/app/financeiro", rotulo: rotulos.painel },
    { id: "caixa", href: "/app/financeiro/caixa", rotulo: rotulos.caixa },
  ] as const;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-xl font-semibold">{titulo}</h1>
        <p className="text-sm text-text-muted">{frase}</p>
      </div>
      <nav aria-label={rotulos.navegacao} className="flex gap-1 border-b border-border">
        {abas.map((a) => (
          <Link
            key={a.id}
            href={a.href}
            aria-current={ativa === a.id ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              ativa === a.id
                ? "border-accent font-medium text-text"
                : "border-transparent text-text-muted hover:text-text",
            )}
          >
            {a.rotulo}
          </Link>
        ))}
      </nav>
    </div>
  );
}
