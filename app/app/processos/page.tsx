import { exigirAbaDeProcessos } from "./_componentes/guarda";
import { ListaDeProcessos } from "./_componentes/ListaDeProcessos";

export const dynamic = "force-dynamic";

/**
 * Processos — o checklist de cada cliente (migration 9002): quem está em que
 * passo, o que atrasou e o que falta.
 */
export default async function Page() {
  const { t, podeEditar } = await exigirAbaDeProcessos();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("Processos")}</h1>
        <p className="text-sm text-text-muted">
          {t("O checklist de cada cliente: o que já foi feito, por quem, e o que falta.")}
        </p>
      </div>
      <ListaDeProcessos podeEditar={podeEditar} />
    </div>
  );
}
