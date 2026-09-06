import { z } from "zod";

/**
 * Acción tipada del agente: exactamente UNA por turno (FR-021).
 * El servidor valida cada acción contra sus allowlists (etapas de la org);
 * lo que no valida se degrada, nunca se ejecuta a ciegas.
 */
export const AgentAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("none") }),
  z.object({ action: z.literal("reply"), text: z.string().min(1) }),
  z.object({
    action: z.literal("update_lead"),
    note: z.string().min(1),
    reply: z.string().optional(),
  }),
  z.object({
    action: z.literal("move_stage"),
    stage: z.string().min(1),
    reply: z.string().optional(),
  }),
  z.object({
    action: z.literal("handoff"),
    reason: z.string().optional(),
    farewell: z.string().optional(),
  }),
  /**
   * Acciones "herramienta" de la agenda (005, research D6): el servidor las
   * ejecuta y vuelve a llamar al modelo con el resultado (máx. 2 vueltas).
   * Solo se ofrecen en el prompt cuando la empresa tiene calendario.
   */
  z.object({
    action: z.literal("check_availability"),
    /** "YYYY-MM-DD" local del negocio; sin fecha: próximos días. */
    date: z.string().trim().optional(),
  }),
  z.object({
    action: z.literal("book_appointment"),
    /** "YYYY-MM-DDTHH:MM" local del negocio (un hueco ofrecido). */
    start: z.string().trim().min(1),
    note: z.string().trim().max(500).optional(),
    reply: z.string().optional(),
  }),
]);

export type AgentActionType = z.infer<typeof AgentAction>;

/**
 * Resuelve el nombre de etapa devuelto por el modelo contra las etapas reales
 * de la organización (exacto → lower-case). Sin match: degradar a reply/none.
 */
export function resolveStage(
  requested: string,
  stages: { id: string; name: string }[]
): { id: string; name: string } | null {
  const exact = stages.find((s) => s.name === requested.trim());
  if (exact) return exact;
  const lower = requested.trim().toLowerCase();
  return stages.find((s) => s.name.toLowerCase() === lower) ?? null;
}

/** Degrada una move_stage sin etapa válida (FR-021 / contrato ai.md). */
export function degradeAction(action: AgentActionType): AgentActionType {
  if (action.action === "move_stage") {
    return action.reply
      ? { action: "reply", text: action.reply }
      : { action: "none" };
  }
  return action;
}
