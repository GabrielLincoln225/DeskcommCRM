/**
 * O que as rotas de Processos aceitam de fora. Nada aqui aceita
 * `organization_id`: a organização vem da sessão (`requireRole`), nunca do corpo.
 */
import { z } from "zod";

export const passoDoModeloSchema = z
  .object({
    title: z.string().trim().min(1, "Passo sem nome.").max(200),
    done_on_trigger: z.boolean().default(false),
  })
  .strict();

export const modeloSchema = z
  .object({
    name: z.string().trim().min(1, "Dê um nome ao modelo.").max(120),
    description: z.string().trim().max(1000).nullable().optional(),
    trigger_stage_id: z.string().uuid().nullable().optional(),
    is_active: z.boolean().optional(),
    steps: z.array(passoDoModeloSchema).min(1, "O modelo precisa de pelo menos um passo.").max(100),
  })
  .strict();

export const alterarModeloSchema = modeloSchema.partial().strict();

export const iniciarProcessoSchema = z
  .object({
    contact_id: z.string().uuid(),
    template_id: z.string().uuid(),
  })
  .strict();

export const alterarProcessoSchema = z
  .object({
    status: z.enum(["open", "done", "cancelled"]),
  })
  .strict();

export const alterarItemSchema = z
  .object({
    done: z.boolean().optional(),
    assignee_user_id: z.string().uuid().nullable().optional(),
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
      .nullable()
      .optional(),
    note: z.string().trim().max(4000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nada para alterar." });

export type ModeloDeProcesso = z.infer<typeof modeloSchema>;
