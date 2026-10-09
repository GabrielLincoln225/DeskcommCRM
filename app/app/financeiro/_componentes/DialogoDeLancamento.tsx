"use client";
/**
 * Novo lançamento no caixa — e a correção de um que já existe.
 *
 * Os campos são os do livro-caixa que a Konnexo usava antes desta aba: fluxo
 * (entrada/saída), categoria, descrição, valor, data, situação (já recebido /
 * a receber) e repetição (único / mensal). Dois a mais, que o produto já tinha
 * e o livro-caixa não: o CLIENTE (contato do CRM) e a CONTA onde o dinheiro
 * cai — esta só aparece quando há mais de uma, porque escolher entre uma opção
 * não é escolha.
 *
 * ⚠️ PAGO NÃO MUDA DE VALOR, DATA NEM TIPO. Na correção de um lançamento pago
 * esses três campos ficam travados, com a frase do porquê. O banco recusaria
 * (`fn_lancamento_pago_e_imutavel`); deixar a pessoa preencher para ouvir "não"
 * depois seria ensinar a tentar o que nunca funciona.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SeletorDeContato } from "@/components/kanban/SeletorDeContato";
import { useT } from "@/hooks/i18n/useT";
import type { Direcao } from "@/lib/financeiro/caixa";
import { formatCents, parseReaisToCents } from "@/lib/money";
import type { Contact } from "@/lib/types/contacts";
import { cn } from "@/lib/utils";

import {
  useCorrigirLancamento,
  useCriarContaCaixa,
  useCriarLancamento,
  type Categoria,
  type ContatoDoCaixa,
  type Conta,
} from "./dados";

export interface RascunhoDeLancamento {
  /** Presente = correção de um lançamento existente. */
  id?: string;
  direction: Direcao;
  account_plan_id: string | null;
  description: string;
  amount_cents: number | null;
  entry_date: string;
  status: "pending" | "paid";
  contato: ContatoDoCaixa | null;
  /** O negócio ganho que este lançamento cobra (sugestão do Painel). */
  lead_id?: string | null;
}

const hojeISO = () => new Date().toISOString().slice(0, 10);
const ontemISO = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

export function rascunhoVazio(): RascunhoDeLancamento {
  return {
    direction: "in",
    account_plan_id: null,
    description: "",
    amount_cents: null,
    entry_date: hojeISO(),
    status: "paid",
    contato: null,
  };
}

/** Centavos → "1.234,56", para o campo de valor voltar preenchido na correção. */
function centsParaCampo(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function DialogoDeLancamento({
  aberto,
  onFechar,
  inicial,
  categorias,
  contas,
  moeda,
}: {
  aberto: boolean;
  onFechar: () => void;
  inicial: RascunhoDeLancamento;
  categorias: Categoria[];
  contas: Conta[];
  moeda: string;
}) {
  const t = useT();
  const criar = useCriarLancamento();
  const corrigir = useCorrigirLancamento();
  const criarConta = useCriarContaCaixa();

  const editando = Boolean(inicial.id);
  const pagoTravado = editando && inicial.status === "paid";

  const [direcao, setDirecao] = useState<Direcao>(inicial.direction);
  const [categoriaId, setCategoriaId] = useState(inicial.account_plan_id ?? "");
  const [descricao, setDescricao] = useState(inicial.description);
  const [valor, setValor] = useState(centsParaCampo(inicial.amount_cents));
  const [data, setData] = useState(inicial.entry_date);
  const [situacao, setSituacao] = useState(inicial.status);
  const [repetir, setRepetir] = useState<"unico" | "mensal">("unico");
  const [contato, setContato] = useState<ContatoDoCaixa | null>(inicial.contato);
  // O diálogo nasce a cada abertura (quem chama o desmonta ao fechar), então o
  // estado inicial É o rascunho — não há o que ressincronizar depois.
  const [contaId, setContaId] = useState("");

  // Sem conta escolhida, a primeira: com uma só conta não há o que escolher, e
  // é por isso que o seletor nem aparece nesse caso.
  const contaEscolhida = contaId || contas[0]?.id || "";

  const daDirecao = categorias.filter(
    (c) => c.direction === direcao && (c.is_active || c.id === inicial.account_plan_id),
  );
  const cents = parseReaisToCents(valor);
  const semConta = !editando && contas.length === 0;
  const pode =
    descricao.trim().length > 0 && cents !== null && cents > 0 && /^\d{4}-\d{2}-\d{2}$/.test(data) && !semConta;
  const salvando = criar.isPending || corrigir.isPending;

  function salvar() {
    if (!pode || cents === null) return;
    if (editando && inicial.id) {
      const corpo: Record<string, unknown> = {};
      if (descricao.trim() !== inicial.description) corpo.description = descricao.trim();
      if ((categoriaId || null) !== inicial.account_plan_id) corpo.account_plan_id = categoriaId || null;
      if ((contato?.id ?? null) !== (inicial.contato?.id ?? null)) corpo.contact_id = contato?.id ?? null;
      if (!pagoTravado) {
        if (cents !== inicial.amount_cents) corpo.amount_cents = cents;
        if (data !== inicial.entry_date) corpo.entry_date = data;
        if (direcao !== inicial.direction) corpo.direction = direcao;
      }
      if (Object.keys(corpo).length === 0) return onFechar();
      corrigir.mutate({ id: inicial.id, corpo }, { onSuccess: onFechar });
      return;
    }
    criar.mutate(
      {
        account_id: contaEscolhida,
        account_plan_id: categoriaId || null,
        direction: direcao,
        amount_cents: cents,
        description: descricao.trim(),
        entry_date: data,
        status: situacao,
        contact_id: contato?.id ?? null,
        lead_id: inicial.lead_id ?? null,
        repetir,
      },
      { onSuccess: onFechar },
    );
  }

  const rotuloPago = direcao === "in" ? t("Já recebido") : t("Já pago");
  const rotuloPendente = direcao === "in" ? t("A receber") : t("A pagar");

  return (
    <Dialog open={aberto} onOpenChange={(v) => (!v ? onFechar() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editando ? t("Corrigir lançamento") : t("Novo lançamento no caixa")}</DialogTitle>
          <DialogDescription>
            {editando
              ? t("Ajuste o que foi lançado. Depois de pago, valor, data e tipo não mudam.")
              : t("Registre uma receita recebida ou um custo da operação.")}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            salvar();
          }}
        >
          <Campo rotulo={t("Fluxo da operação")}>
            <Alternador
              valor={direcao}
              desabilitado={pagoTravado}
              opcoes={[
                { valor: "in", rotulo: t("Entrada (receita)"), testId: "lancamento-entrada" },
                { valor: "out", rotulo: t("Saída (custo)"), testId: "lancamento-saida" },
              ]}
              onMudar={(v) => {
                setDirecao(v as Direcao);
                setCategoriaId("");
              }}
            />
          </Campo>

          <Campo rotulo={t("Categoria")}>
            <select
              value={categoriaId}
              data-testid="lancamento-categoria"
              onChange={(e) => setCategoriaId(e.target.value)}
              className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
            >
              <option value="">{t("Sem categoria")}</option>
              {daDirecao.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <a href="/app/settings/tenant/financeiro" className="text-xs text-accent hover:underline">
              {t("Criar ou renomear categorias")}
            </a>
          </Campo>

          <Campo rotulo={t("Descrição do lançamento")}>
            <input
              value={descricao}
              data-testid="lancamento-descricao"
              maxLength={300}
              placeholder={t("Ex.: Site institucional — Cliente X")}
              onChange={(e) => setDescricao(e.target.value)}
              className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
            />
          </Campo>

          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo={`${t("Valor")} (${moeda})`}>
              <input
                value={valor}
                inputMode="decimal"
                placeholder="0,00"
                disabled={pagoTravado}
                data-testid="lancamento-valor"
                onChange={(e) => setValor(e.target.value)}
                className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text tabular-nums disabled:opacity-60"
              />
              {cents !== null && cents > 0 ? (
                <span className="text-xs text-text-muted">{formatCents(cents, moeda)}</span>
              ) : null}
            </Campo>
            <Campo
              rotulo={t("Data")}
              extra={
                pagoTravado ? null : (
                  <span className="flex gap-2 text-xs">
                    <button type="button" className="text-accent" onClick={() => setData(hojeISO())}>
                      {t("Hoje")}
                    </button>
                    <button type="button" className="text-accent" onClick={() => setData(ontemISO())}>
                      {t("Ontem")}
                    </button>
                  </span>
                )
              }
            >
              <input
                type="date"
                value={data}
                disabled={pagoTravado}
                data-testid="lancamento-data"
                onChange={(e) => setData(e.target.value)}
                className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text disabled:opacity-60"
              />
            </Campo>
          </div>

          {!editando ? (
            <>
              <Campo rotulo={t("Situação")}>
                <Alternador
                  valor={situacao}
                  opcoes={[
                    { valor: "paid", rotulo: rotuloPago, testId: "lancamento-pago" },
                    { valor: "pending", rotulo: rotuloPendente, testId: "lancamento-pendente" },
                  ]}
                  onMudar={(v) => setSituacao(v as "paid" | "pending")}
                />
              </Campo>

              <Campo rotulo={t("Repetição")}>
                <Alternador
                  valor={repetir}
                  opcoes={[
                    { valor: "unico", rotulo: t("Único"), testId: "lancamento-unico" },
                    { valor: "mensal", rotulo: t("Todo mês"), testId: "lancamento-mensal" },
                  ]}
                  onMudar={(v) => setRepetir(v as "unico" | "mensal")}
                />
                {repetir === "mensal" ? (
                  <span className="text-xs text-text-muted">
                    {t("Repete todo dia")} {Number(data.slice(8, 10)) || "—"}
                    {". "}
                    {t("Cada mês nasce pendente, para você confirmar quando o dinheiro passar.")}
                  </span>
                ) : null}
              </Campo>
            </>
          ) : null}

          <SeletorDeContato
            escolhido={(contato as Contact | null) ?? null}
            onEscolher={(c) => setContato(c ? { ...c } : null)}
          />

          {contas.length > 1 && !editando ? (
            <Campo rotulo={t("Conta")}>
              <select
                value={contaEscolhida}
                data-testid="lancamento-conta"
                onChange={(e) => setContaId(e.target.value)}
                className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
              >
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Campo>
          ) : null}

          {semConta ? (
            <div className="flex flex-col gap-2 rounded-md border border-warning bg-warning-bg p-3 text-sm text-warning-fg">
              <p>{t("Para lançar, o caixa precisa de uma conta onde o dinheiro fica.")}</p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={criarConta.isPending}
                onClick={() => criarConta.mutate(t("Caixa"))}
                data-testid="criar-conta-caixa"
              >
                {t("Criar a conta “Caixa”")}
              </Button>
            </div>
          ) : null}

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onFechar}>
              {t("Cancelar")}
            </Button>
            <Button type="submit" disabled={!pode || salvando} data-testid="salvar-lancamento">
              {editando ? t("Salvar correção") : t("Salvar lançamento")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Campo({
  rotulo,
  extra,
  children,
}: {
  rotulo: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-muted">{rotulo}</span>
        {extra}
      </div>
      {children}
    </div>
  );
}

function Alternador({
  valor,
  opcoes,
  onMudar,
  desabilitado = false,
}: {
  valor: string;
  opcoes: Array<{ valor: string; rotulo: string; testId: string }>;
  onMudar: (v: string) => void;
  desabilitado?: boolean;
}) {
  return (
    <div role="radiogroup" className="grid grid-cols-2 gap-1 rounded-md border border-border bg-surface-elevated p-1">
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          role="radio"
          aria-checked={valor === o.valor}
          disabled={desabilitado}
          data-testid={o.testId}
          onClick={() => onMudar(o.valor)}
          className={cn(
            "rounded px-3 py-1.5 text-sm transition-colors disabled:opacity-60",
            valor === o.valor ? "bg-surface font-medium text-text shadow-xs" : "text-text-muted hover:text-text",
          )}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}
