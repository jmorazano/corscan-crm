/**
 * Reglas puras del entrenador del agente (015), compartidas entre servidor
 * y cliente.
 */

/**
 * Teléfono del contacto sintético que encarna al agente en la Bandeja. NO es
 * numérico a propósito: `normalizeToWaId` lo rechaza, así que ni el import,
 * ni el alta manual, ni la API pública, ni la ingesta (que solo trae dígitos)
 * pueden crearlo o alcanzarlo.
 */
export const TRAINER_CONTACT_PHONE = "trainer";

export type ConversationKind = "whatsapp" | "trainer";

/**
 * ¿La fila fija del entrenador se muestra con estos filtros de la Bandeja?
 * Se oculta bajo búsqueda o etiquetas (no es un contacto) y bajo «No leídas»
 * solo cuando no tiene pendientes.
 */
export function trainerVisible(input: {
  filter: "unread" | null | undefined;
  q: string | null | undefined;
  tags: readonly string[];
  unreadCount: number;
}): boolean {
  if (input.q?.trim()) return false;
  if (input.tags.length > 0) return false;
  if (input.filter === "unread" && input.unreadCount <= 0) return false;
  return true;
}

export type ComposerMode = "trainer" | "text" | "template";

/**
 * Modo del composer: el entrenador ignora la ventana de 24 h (no es
 * WhatsApp); las reales alternan texto libre / plantilla según la ventana.
 */
export function composerMode(conversation: {
  kind?: ConversationKind;
  windowOpen: boolean;
}): ComposerMode {
  if (conversation.kind === "trainer") return "trainer";
  return conversation.windowOpen ? "text" : "template";
}

/** Título de la fila fija y del header del hilo del entrenador. */
export function trainerTitle(agentName: string): string {
  return `Entrená a ${agentName}`;
}
