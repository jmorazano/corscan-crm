import { asc, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { newId } from "@/lib/db/ids";
import {
  closeWait,
  opensWaitOnInbound,
  type OutgoingForWait,
  type WaitReason,
} from "@/lib/team-attention";
import { isTeamBroadcastMessage } from "@/server/ai/events";

/**
 * 048: las esperas — un cliente en manos de una persona. Se ABREN en dos
 * ganchos (ingesta y derivación) y se CIERRAN conciliando los mensajes
 * posteriores: los del equipo salen por muchos caminos (texto, adjuntos,
 * plantillas, Instagram, reintentos) y mirando los mensajes ninguno se
 * escapa, con la hora real de la respuesta. Nada de acá tumba a quien llama:
 * los ganchos van con `.catch` y el barrido loguea y sigue.
 */

export type WaitRow = typeof schema.attentionWait.$inferSelect;

/** Salientes que se miran después del inicio: alcanza de sobra para encontrar el primero. */
const OUTGOING_LIMIT = 50;

/**
 * Cierra la espera si ya terminó (persona, celular, agente o ventana de
 * 24 h). Compare-and-set sobre `status = 'open'`: dos conciliaciones a la
 * vez escriben lo mismo una sola vez. Devuelve la fila actual.
 */
export async function reconcileWait(row: WaitRow, now: Date = new Date()): Promise<WaitRow> {
  if (row.status !== "open") return row;
  const db = getDb();
  const [conversation] = await db
    .select({ lastInboundAt: schema.conversation.lastInboundAt })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        row.organizationId,
        eq(schema.conversation.id, row.conversationId)
      )
    )
    .limit(1);
  if (!conversation) return row;

  const messages = await db
    .select({
      text: schema.message.text,
      createdAt: schema.message.createdAt,
      aiGenerated: schema.message.aiGenerated,
      sentByUserId: schema.message.sentByUserId,
      sentByName: schema.message.sentByName,
      source: schema.message.source,
      status: schema.message.status,
      details: schema.message.details,
    })
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        row.organizationId,
        eq(schema.message.conversationId, row.conversationId),
        eq(schema.message.direction, "out"),
        gte(schema.message.createdAt, row.startedAt)
      )
    )
    .orderBy(asc(schema.message.createdAt))
    .limit(OUTGOING_LIMIT);

  // 036: una difusión no es atención. Solo se evalúan los mensajes del
  // equipo hasta encontrar el primero que no lo es (los demás no importan).
  const outgoing: OutgoingForWait[] = [];
  let foundReply = false;
  for (const m of messages) {
    const teamCandidate =
      !m.aiGenerated && m.status !== "failed" && (m.sentByUserId !== null || m.source === "phone");
    let broadcast = Boolean(m.details?.broadcast);
    if (teamCandidate && !broadcast && !foundReply) {
      broadcast = await isTeamBroadcastMessage(row.organizationId, row.conversationId, m);
      if (!broadcast) foundReply = true;
    }
    outgoing.push({
      createdAt: m.createdAt,
      aiGenerated: m.aiGenerated,
      sentByUserId: m.sentByUserId,
      sentByName: m.sentByName,
      source: m.source,
      status: m.status,
      broadcast,
    });
  }

  const closure = closeWait(row, outgoing, conversation.lastInboundAt, now);
  if (closure.status === "open") return row;

  const set =
    closure.status === "answered"
      ? {
          status: closure.status,
          closedAt: closure.closedAt,
          responderUserId: closure.responderUserId,
          responderName: closure.responderName,
          responderVia: closure.responderVia,
          responseMs: Math.round(closure.responseMs),
        }
      : { status: closure.status, closedAt: closure.closedAt };
  const [updated] = await db
    .update(schema.attentionWait)
    .set({ ...set, updatedAt: new Date() })
    .where(
      scoped(
        schema.attentionWait.organizationId,
        row.organizationId,
        eq(schema.attentionWait.id, row.id),
        eq(schema.attentionWait.status, "open")
      )
    )
    .returning();
  if (updated) return updated;
  const [current] = await db
    .select()
    .from(schema.attentionWait)
    .where(eq(schema.attentionWait.id, row.id))
    .limit(1);
  return current ?? row;
}

/** La espera abierta de una conversación, ya conciliada (null si no queda ninguna). */
export async function reconcileOpenWaitFor(
  organizationId: string,
  conversationId: string,
  now: Date = new Date()
): Promise<WaitRow | null> {
  const [open] = await getDb()
    .select()
    .from(schema.attentionWait)
    .where(
      scoped(
        schema.attentionWait.organizationId,
        organizationId,
        eq(schema.attentionWait.conversationId, conversationId),
        eq(schema.attentionWait.status, "open")
      )
    )
    .limit(1);
  if (!open) return null;
  const current = await reconcileWait(open, now);
  return current.status === "open" ? current : null;
}

/** Inserta una espera; el índice único parcial deja una sola abierta por conversación. */
async function insertWait(input: {
  organizationId: string;
  conversationId: string;
  startedAt: Date;
  reason: WaitReason;
  startMessageId: string | null;
}): Promise<void> {
  await getDb()
    .insert(schema.attentionWait)
    .values({
      id: newId("attentionWait"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      startedAt: input.startedAt,
      startReason: input.reason,
      startMessageId: input.startMessageId,
    })
    .onConflictDoNothing();
}

async function agentEnabledFor(organizationId: string): Promise<boolean> {
  const [profile] = await getDb()
    .select({ enabled: schema.agentProfile.enabled })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  return profile?.enabled ?? false;
}

/**
 * Gancho de la ingesta: un mensaje del cliente en una conversación derivada
 * o con la IA apagada abre una espera, salvo que ya haya una abierta (se
 * concilia antes: una respuesta reciente que el barrido no vio todavía no
 * debe tapar la espera nueva).
 */
export async function openWaitForInbound(input: {
  organizationId: string;
  conversationId: string;
  message: { id: string; direction: string; type: string; createdAt: Date };
}): Promise<void> {
  const { organizationId, conversationId, message } = input;
  const db = getDb();
  const [row] = await db
    .select({
      isTest: schema.conversation.isTest,
      kind: schema.conversation.kind,
      handoffAt: schema.conversation.handoffAt,
      handoffReason: schema.conversation.handoffReason,
      aiEnabled: schema.conversation.aiEnabled,
      optedOutAt: schema.contact.optedOutAt,
      optedOutSource: schema.contact.optedOutSource,
    })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  if (!row || row.isTest) return;

  // La consulta del perfil solo corre si la conversación no alcanza sola.
  const conversationAlone = row.handoffAt !== null || !row.aiEnabled;
  const reason = opensWaitOnInbound({
    conversation: row,
    message,
    optedOut: row.optedOutAt ? { source: row.optedOutSource } : null,
    agentEnabled: conversationAlone ? true : await agentEnabledFor(organizationId),
  });
  if (!reason) return;

  const open = await reconcileOpenWaitFor(organizationId, conversationId, message.createdAt);
  if (open) return;
  await insertWait({
    organizationId,
    conversationId,
    startedAt: message.createdAt,
    reason,
    startMessageId: message.id,
  });
}

/** Gancho de la derivación: la espera empieza cuando el agente deriva. */
export async function openWaitForHandoff(input: {
  organizationId: string;
  conversationId: string;
  at: Date;
  reason: string;
  isTest: boolean;
}): Promise<void> {
  // Por `ventana` nadie puede responder texto libre: no es una espera.
  if (input.isTest || input.reason === "ventana") return;
  const open = await reconcileOpenWaitFor(input.organizationId, input.conversationId, input.at);
  if (open) return;
  await insertWait({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    startedAt: input.at,
    reason: "handoff",
    startMessageId: null,
  });
}

/** Lo que la ingesta y el pipeline usan: nunca lanza ni demora al llamador. */
export function inBackground(label: string, work: () => Promise<unknown>): void {
  void work().catch((err) => {
    console.error(`[atención] ${label}:`, err instanceof Error ? err.message : err);
  });
}

/** Esperas abiertas para el barrido, las más viejas primero. */
export async function listOpenWaits(limit: number): Promise<WaitRow[]> {
  return getDb()
    .select()
    .from(schema.attentionWait)
    // Barrido de instancia (como 042/044): cada fila lleva su empresa y todo
    // lo que se hace con ella después pasa por `scoped()`.
    .where(eq(schema.attentionWait.status, "open"))
    .orderBy(asc(schema.attentionWait.startedAt))
    .limit(limit);
}
