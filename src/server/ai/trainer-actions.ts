import { z } from "zod";
import { KB_LIMITS } from "@/server/kb/service";
import { visibleMax } from "@/lib/text-length";
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
export const PROFILE_APPEND_MAX = 2000;

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
    value: visibleMax(z.string(), PROFILE_LIMITS.instructions).nullable(),
  }),
  z.object({
    op: z.literal("profile_append"),
    field: z.enum(APPENDABLE_FIELDS),
    /**
     * Una regla suele ser una o dos frases, pero el modelo a veces reescribe
     * la instrucción completa del dueño (en producción, ~500 caracteres).
     * El tope real lo pone el campo del perfil al aplicar.
     */
    text: z.string().trim().min(1).max(PROFILE_APPEND_MAX),
  }),
]);
export type TrainerChangeType = z.infer<typeof TrainerChange>;

const OPS = ["kb_add", "kb_update", "kb_delete", "profile_set", "profile_append"] as const;

/**
 * Normaliza salidas "casi correctas" del modelo ANTES de validar (puro):
 * - `{"action":"kb_add",…}` o `{"op":"kb_add",…}` (el cambio suelto, sin el
 *   sobre `apply`) → `{"action":"apply","changes":[…]}`.
 * - `[{"op":…}, …]` (la lista de cambios pelada) → `apply` con esa lista.
 * - `{"changes":[…]}` sin `action` → `apply`.
 * - `reply`/`text` intercambiados en `reply` y `apply`.
 * En producción el modelo devolvió el primer caso tres veces seguidas y el
 * turno degradaba a «proveedor no respondió» por un detalle de forma.
 *
 * OJO con `text` en el cambio suelto: en `profile_append` ES el contenido
 * de la regla (obligatorio), no la respuesta al dueño. Sacarlo del cambio
 * para usarlo como `reply` dejaba `changes.0.text Required` y el turno
 * volvía a caer tres veces seguidas (13 y 14-oct-2026, «Ari»).
 */
export function normalizeTrainerOutput(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  if (Array.isArray(raw)) {
    return raw.length > 0 && raw.every((c) => c && typeof c === "object" && "op" in c)
      ? { action: "apply", changes: raw }
      : raw;
  }
  const o = raw as Record<string, unknown>;
  const isOp = (v: unknown): v is (typeof OPS)[number] =>
    typeof v === "string" && (OPS as readonly string[]).includes(v);
  if (isOp(o.op) || isOp(o.action)) {
    const op = isOp(o.op) ? o.op : (o.action as (typeof OPS)[number]);
    const { action: _action, op: _op, reply, ...rest } = o;
    void _action;
    void _op;
    let message = typeof reply === "string" ? reply : undefined;
    if (op !== "profile_append" && message === undefined && typeof rest.text === "string") {
      message = rest.text;
      delete rest.text;
    }
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
