import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  existingConversationsUpdate,
  isAgentScope,
  type AgentScopeChange,
  type AgentScopeSummary,
} from "@/lib/agent-scope";
import { publish } from "@/server/events/bus";

/**
 * Modo de prueba del agente: en qué conversaciones responde (reglas en
 * `src/lib/agent-scope.ts`). La conversación nueva toma el valor en
 * `getOrCreateConversation`; acá se cambia el modo y, si corresponde, las
 * conversaciones que ya existen.
 */

/** Solo conversaciones reales: nunca el Entrenador ni el Laboratorio. */
function realConversations(organizationId: string) {
  return scoped(
    schema.conversation.organizationId,
    organizationId,
    eq(schema.conversation.isTest, false),
    inArray(schema.conversation.kind, ["whatsapp", "instagram"])
  );
}

export class AgentScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentScopeError";
  }
}

export async function getAgentScopeSummary(organizationId: string): Promise<AgentScopeSummary> {
  const db = getDb();
  const [profileRows, countRows] = await Promise.all([
    db
      .select({ scope: schema.agentProfile.agentScope })
      .from(schema.agentProfile)
      .where(scoped(schema.agentProfile.organizationId, organizationId))
      .limit(1),
    db
      .select({
        total: sql<number>`count(*)`,
        aiOn: sql<number>`count(*) filter (where ${schema.conversation.aiEnabled})`,
      })
      .from(schema.conversation)
      .where(realConversations(organizationId)),
  ]);
  const scope = profileRows[0]?.scope;
  const total = Number(countRows[0]?.total ?? 0);
  const aiOn = Number(countRows[0]?.aiOn ?? 0);
  return { scope: isAgentScope(scope) ? scope : "all", total, aiOn, aiOff: total - aiOn };
}

/**
 * Cambia el modo. El ORDEN importa: primero el modo (así una conversación
 * que nace mientras tanto ya toma el valor nuevo), después las existentes
 * y recién al final el agente de la empresa — nunca hay un instante con el
 * agente prendido y las conversaciones todavía sin apagar.
 */
export async function setAgentScope(
  organizationId: string,
  change: AgentScopeChange
): Promise<{ summary: AgentScopeSummary; changed: number }> {
  const db = getDb();
  const now = new Date();
  const [previous] = await db
    .select({ scope: schema.agentProfile.agentScope })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  if (!previous) throw new AgentScopeError("Perfil del agente no encontrado");
  const updatedProfile = await db
    .update(schema.agentProfile)
    .set({ agentScope: change.scope, updatedAt: now })
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .returning({ id: schema.agentProfile.id });
  if (!updatedProfile[0]) throw new AgentScopeError("Perfil del agente no encontrado");

  let changed = 0;
  const target = existingConversationsUpdate(change, previous.scope);
  if (target !== null) {
    const rows = await db
      .update(schema.conversation)
      .set({ aiEnabled: target, updatedAt: now })
      .where(and(realConversations(organizationId), eq(schema.conversation.aiEnabled, !target)))
      .returning({ id: schema.conversation.id });
    changed = rows.length;
  }

  if (change.enableAgent) {
    await db
      .update(schema.agentProfile)
      .set({ enabled: true, updatedAt: new Date() })
      .where(scoped(schema.agentProfile.organizationId, organizationId));
  }

  // Lista vacía = «refrescá todo» (como el historial de 017).
  if (changed > 0) {
    publish(organizationId, { type: "conversations.updated", data: { conversationIds: [] } });
  }
  return { summary: await getAgentScopeSummary(organizationId), changed };
}
