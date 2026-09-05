import { scheduleAgentTurn } from "@/server/ai/pipeline";
import { isAiConfigured } from "@/server/ai/credentials";

/**
 * Punto de enganche del turno del agente tras la ingesta de un mensaje
 * entrante REAL (las conversaciones del Laboratorio invocan el pipeline
 * directamente, sin debounce).
 *
 * Gate por empresa (US3/FR-010): sin config de IA de la organización, el
 * turno se corta acá — ANTES del debounce y del proveedor — sin publicar
 * error alguno (la bandeja manual sigue normal; Ajustes muestra el estado).
 */
export async function maybeRunAgentTurn(
  organizationId: string,
  conversationId: string
): Promise<void> {
  if (!(await isAiConfigured(organizationId))) return;
  scheduleAgentTurn(conversationId);
}
