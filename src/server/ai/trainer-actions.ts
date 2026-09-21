import { z } from "zod";
import { KB_LIMITS } from "@/server/kb/service";
import { PROFILE_LIMITS } from "@/server/ai/profile";

/**
 * Contrato de acciones del entrenador (015, D6). Vive SEPARADO de
 * `AgentAction`: jamás se expone a las conversaciones con clientes.
 */

export const PROFILE_FIELDS = [
  "name",
  "tone",
  "instructions",
  "escalationRules",
  "greeting",
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

/** Campos donde tiene sentido "agregar una línea" en vez de reescribir. */
export const APPENDABLE_FIELDS = ["tone", "instructions", "escalationRules"] as const;
export type AppendableField = (typeof APPENDABLE_FIELDS)[number];

export const MAX_CHANGES_PER_TURN = 10;

const kbId = z.string().trim().regex(/^kb_[0-9a-z]+$/);

export const TrainerChange = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("kb_add"),
    kind: z.enum(["qa", "block"]),
    question: z.string().trim().max(KB_LIMITS.question).optional(),
    answer: z.string().trim().max(KB_LIMITS.answer).optional(),
    content: z.string().trim().max(KB_LIMITS.content).optional(),
  }),
  z.object({
    op: z.literal("kb_update"),
    id: kbId,
    question: z.string().trim().max(KB_LIMITS.question).optional(),
    answer: z.string().trim().max(KB_LIMITS.answer).optional(),
    content: z.string().trim().max(KB_LIMITS.content).optional(),
  }),
  z.object({ op: z.literal("kb_delete"), id: kbId }),
  z.object({
    op: z.literal("profile_set"),
    field: z.enum(PROFILE_FIELDS),
    value: z.string().max(PROFILE_LIMITS.instructions).nullable(),
  }),
  z.object({
    op: z.literal("profile_append"),
    field: z.enum(APPENDABLE_FIELDS),
    text: z.string().trim().min(1).max(1000),
  }),
]);
export type TrainerChangeType = z.infer<typeof TrainerChange>;

const OPS = ["kb_add", "kb_update", "kb_delete", "profile_set", "profile_append"] as const;

/**
 * Normaliza salidas "casi correctas" del modelo ANTES de validar (puro):
 * - `{"action":"kb_add",…}` o `{"op":"kb_add",…}` (el cambio suelto, sin el
 *   sobre `apply`) → `{"action":"apply","changes":[…]}`.
 * - `{"changes":[…]}` sin `action` → `apply`.
 * - `reply`/`text` intercambiados en `reply` y `apply`.
 * En producción el modelo devolvió el primer caso tres veces seguidas y el
 * turno degradaba a «proveedor no respondió» por un detalle de forma.
 */
export function normalizeTrainerOutput(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const o = raw as Record<string, unknown>;
  const isOp = (v: unknown): v is (typeof OPS)[number] =>
    typeof v === "string" && (OPS as readonly string[]).includes(v);
  if (isOp(o.op) || isOp(o.action)) {
    const op = isOp(o.op) ? o.op : (o.action as (typeof OPS)[number]);
    const { action: _action, op: _op, reply, text, ...rest } = o;
    void _action;
    void _op;
    const message = typeof reply === "string" ? reply : typeof text === "string" ? text : undefined;
    return { action: "apply", changes: [{ ...rest, op }], ...(message ? { reply: message } : {}) };
  }
  if (Array.isArray(o.changes) && o.action !== "apply") {
    return { ...o, action: "apply" };
  }
  if (o.action === "reply" && typeof o.text !== "string" && typeof o.reply === "string") {
    return { ...o, text: o.reply };
  }
  if (o.action === "apply" && typeof o.reply !== "string" && typeof o.text === "string") {
    return { ...o, reply: o.text };
  }
  return raw;
}

const TrainerActionStrict = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reply"), text: z.string().trim().min(1).max(2000) }),
  z.object({
    action: z.literal("apply"),
    changes: z.array(TrainerChange).min(1).max(MAX_CHANGES_PER_TURN),
    /** Opcional: si falta, el servidor confirma con los resúmenes aplicados. */
    reply: z.string().trim().min(1).max(2000).optional(),
  }),
]);
export const TrainerAction = z.preprocess(normalizeTrainerOutput, TrainerActionStrict);
export type TrainerActionType = z.infer<typeof TrainerActionStrict>;

/**
 * Agrega una línea a un campo de texto (puro): "amable" + "No usar emojis."
 * → "amable\n- No usar emojis.". Sobre vacío, queda "- No usar emojis.".
 * No duplica si la línea ya está.
 */
export function appendToField(current: string | null | undefined, text: string): string {
  const line = text.trim().replace(/^[-•]\s*/, "");
  const base = (current ?? "").trimEnd();
  if (!line) return base;
  const already = base
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[-•]\s*/, "").toLowerCase());
  if (already.includes(line.toLowerCase())) return base;
  return base ? `${base}\n- ${line}` : `- ${line}`;
}
