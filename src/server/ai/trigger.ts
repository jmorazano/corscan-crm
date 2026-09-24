import { scheduleAgentTurn } from "@/server/ai/pipeline";
import { isAiConfigured } from "@/server/ai/credentials";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getEnv } from "@/lib/env";
import { resolveReplyDelayMs } from "@/lib/agent-timing";

/**
 * Punto de enganche del turno del agente tras la ingesta de un mensaje
 * entrante REAL (las conversaciones del Laboratorio invocan el pipeline
 * directamente, sin debounce).
 *
 * Gate por empresa (US3/FR-010): sin config de IA de la organización, el
 * turno se corta acá — ANTES del debounce y del proveedor — sin publicar
 * error alguno (la bandeja manual sigue normal; Ajustes muestra el estado).
 *
 * 022: la espera antes de responder es POR EMPRESA (`agent_profile.
 * reply_delay_ms`); sin valor rige `AGENT_COALESCE_MS` de la instancia.
 */
export async function maybeRunAgentTurn(
  organizationId: string,
  conversationId: string
): Promise<void> {
  if (!(await isAiConfigured(organizationId))) return;
  scheduleAgentTurn(conversationId, await replyDelayFor(organizationId));
}

/**
 * Espera efectiva de la empresa en ms (tolerante: sin perfil o con error →
 * default). Consulta mínima a propósito: este módulo cuelga de la ingesta y
 * no debe arrastrar el servicio del perfil (que a su vez trae el Entrenador).
 */
export async function replyDelayFor(organizationId: string): Promise<number> {
  const fallback = getEnv().AGENT_COALESCE_MS;
  try {
    const rows = await getDb()
      .select({ replyDelayMs: schema.agentProfile.replyDelayMs })
      .from(schema.agentProfile)
      .where(scoped(schema.agentProfile.organizationId, organizationId))
      .limit(1);
    return resolveReplyDelayMs(rows[0]?.replyDelayMs, fallback);
  } catch {
    return resolveReplyDelayMs(null, fallback);
  }
}
