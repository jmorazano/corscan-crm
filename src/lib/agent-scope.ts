import { z } from "zod";

/**
 * En qué conversaciones responde el agente (modo de prueba por empresa).
 *
 * - `all`: en todas. Las conversaciones nuevas nacen con la IA prendida
 *   (lo de siempre; el default de toda empresa).
 * - `selected`: solo en las que el equipo prende a mano. Las nuevas nacen
 *   con la IA apagada.
 *
 * Pasar a `selected` APAGA la IA de todas las conversaciones reales de la
 * empresa (no se puede distinguir una prendida «por defecto» de una prendida
 * a propósito: las dos son `ai_enabled = true`). Volver a `all` puede prender
 * las apagadas o dejarlas como están (las que alguien pausó a propósito
 * siguen pausadas). Puro: lo comparten la ruta, el servicio y la UI.
 */

export const AGENT_SCOPES = ["all", "selected"] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

export const agentScopeChangeSchema = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("selected"),
    /** Prender el agente de la empresa DESPUÉS de apagar las conversaciones. */
    enableAgent: z.boolean().optional(),
  }),
  z.object({
    scope: z.literal("all"),
    /** true = prender también las conversaciones que hoy tienen la IA apagada. */
    enableExisting: z.boolean(),
    enableAgent: z.boolean().optional(),
  }),
]);
export type AgentScopeChange = z.infer<typeof agentScopeChangeSchema>;

/** Conteo de las conversaciones reales (WhatsApp e Instagram, sin pruebas). */
export type AgentScopeSummary = {
  scope: AgentScope;
  total: number;
  /** Con la IA prendida en la conversación (derivadas incluidas). */
  aiOn: number;
  aiOff: number;
};

export function isAgentScope(value: unknown): value is AgentScope {
  return value === "all" || value === "selected";
}

/**
 * Qué le pasa a `conversation.ai_enabled` de las conversaciones que YA
 * existen: `false` = se apagan todas, `true` = se prenden todas, `null` =
 * quedan como están. Repetir `selected` estando ya en modo de prueba NO
 * vuelve a apagar: borraría las que el equipo prendió para probar.
 */
export function existingConversationsUpdate(
  change: AgentScopeChange,
  previous: AgentScope | null | undefined
): boolean | null {
  if (change.scope === "selected") return previous === "selected" ? null : false;
  return change.enableExisting ? true : null;
}

/** El valor con que nace una conversación nueva. */
export function newConversationAiEnabled(scope: AgentScope | null | undefined): boolean {
  return scope !== "selected";
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("es-AR")} ${n === 1 ? one : many}`;
}

/** Línea de estado de la tarjeta «En qué conversaciones responde». */
export function agentScopeStateText(summary: AgentScopeSummary): string {
  if (summary.scope === "all") {
    if (summary.aiOff === 0) return "Responde en todas las conversaciones.";
    return `Responde en todas, salvo ${plural(summary.aiOff, "conversación pausada", "conversaciones pausadas")}.`;
  }
  if (summary.aiOn === 0) {
    return "Modo de prueba: todavía no prendiste la IA en ninguna conversación.";
  }
  return `Modo de prueba: responde solo en ${plural(summary.aiOn, "conversación", "conversaciones")} de ${summary.total.toLocaleString("es-AR")}.`;
}
