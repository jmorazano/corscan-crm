import { and, asc, desc, eq, gt, gte, inArray, isNotNull, lt, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { newId } from "@/lib/db/ids";
import { publish } from "@/server/events/bus";
import { serializeMessage } from "@/server/inbox/ingest";
import {
  BROADCAST_SPAN_MS,
  PROACTIVE_GAP_MS,
  broadcastKey,
  isBroadcast,
} from "@/lib/agent-presence";
import {
  shouldSkipSilence,
  type ConversationEventDetails,
  type ConversationEventDto,
  type ConversationEventKind,
  type SilentReason,
} from "@/lib/conversation-events";

/**
 * Eventos de la conversación (031): lo que pasó con el agente, para verlo en
 * el hilo. Registrar un evento NUNCA tumba a quien lo llama — es la bitácora,
 * no el negocio: si la escritura falla, queda en el log y el turno sigue.
 */

type EventRow = typeof schema.conversationEvent.$inferSelect;

export function serializeEvent(row: EventRow): ConversationEventDto {
  return {
    id: row.id,
    kind: row.kind,
    reason: row.reason,
    actorName: row.actorName,
    details: row.details ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function recordConversationEvent(input: {
  organizationId: string;
  conversationId: string;
  kind: ConversationEventKind;
  reason?: string | null;
  actor?: { userId: string; name: string | null } | null;
  details?: ConversationEventDetails | null;
}): Promise<ConversationEventDto | null> {
  try {
    const inserted = await getDb()
      .insert(schema.conversationEvent)
      .values({
        id: newId("conversationEvent"),
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        kind: input.kind,
        reason: input.reason ?? null,
        actorUserId: input.actor?.userId ?? null,
        actorName: input.actor?.name ?? null,
        details: input.details ?? null,
      })
      .returning();
    const row = inserted[0];
    if (!row) return null;
    const event = serializeEvent(row);
    publish(input.organizationId, {
      type: "conversation.event",
      data: { conversationId: input.conversationId, event },
    });
    return event;
  } catch (err) {
    console.error(
      `[eventos] no se pudo registrar ${input.kind} en ${input.conversationId}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * «La IA no respondió: …». Un silencio igual al último registrado, sin que la
 * IA haya hablado en el medio, no suma otra línea.
 */
export async function recordSilence(input: {
  organizationId: string;
  conversationId: string;
  reason: SilentReason;
  details?: ConversationEventDetails;
}): Promise<void> {
  try {
    const db = getDb();
    const [lastEvent] = await db
      .select({
        kind: schema.conversationEvent.kind,
        reason: schema.conversationEvent.reason,
        createdAt: schema.conversationEvent.createdAt,
      })
      .from(schema.conversationEvent)
      .where(
        scoped(
          schema.conversationEvent.organizationId,
          input.organizationId,
          eq(schema.conversationEvent.conversationId, input.conversationId)
        )
      )
      .orderBy(desc(schema.conversationEvent.createdAt))
      .limit(1);
    const [lastAi] = await db
      .select({ createdAt: schema.message.createdAt })
      .from(schema.message)
      .where(
        scoped(
          schema.message.organizationId,
          input.organizationId,
          eq(schema.message.conversationId, input.conversationId),
          eq(schema.message.aiGenerated, true)
        )
      )
      .orderBy(desc(schema.message.createdAt))
      .limit(1);
    if (shouldSkipSilence(lastEvent ?? null, input.reason, lastAi?.createdAt ?? null)) return;
  } catch (err) {
    console.error("[eventos] no se pudo leer el último evento:", err instanceof Error ? err.message : err);
  }
  await recordConversationEvent({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    kind: "ai_silent",
    reason: input.reason,
    details: input.details ?? null,
  });
}

/** El último evento de la conversación (para saber si venía en silencio). */
export async function lastConversationEvent(
  organizationId: string,
  conversationId: string
): Promise<{ kind: string; reason: string | null } | null> {
  const rows = await getDb()
    .select({ kind: schema.conversationEvent.kind, reason: schema.conversationEvent.reason })
    .from(schema.conversationEvent)
    .where(
      scoped(
        schema.conversationEvent.organizationId,
        organizationId,
        eq(schema.conversationEvent.conversationId, conversationId)
      )
    )
    .orderBy(desc(schema.conversationEvent.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function listConversationEvents(
  organizationId: string,
  conversationId: string,
  since?: Date
): Promise<ConversationEventDto[]> {
  const rows = await getDb()
    .select()
    .from(schema.conversationEvent)
    .where(
      scoped(
        schema.conversationEvent.organizationId,
        organizationId,
        eq(schema.conversationEvent.conversationId, conversationId),
        since ? gt(schema.conversationEvent.createdAt, since) : undefined
      )
    )
    .orderBy(asc(schema.conversationEvent.createdAt))
    .limit(500);
  return rows.map(serializeEvent);
}

/** Condición «lo escribió una persona del equipo» (misma regla que `isTeamMessage`). */
function teamAuthored() {
  return and(
    eq(schema.message.direction, "out"),
    eq(schema.message.aiGenerated, false),
    or(inArray(schema.message.source, ["phone", "history"]), isNotNull(schema.message.sentByUserId))
  );
}

/** Mensajes del equipo que se miran hacia atrás buscando uno que no sea difusión. */
const TEAM_CANDIDATES = 10;

/**
 * Último mensaje del EQUIPO que cuenta como «alguien atendiendo» (031):
 * desde el CRM con autor, o desde el celular / la app.
 *
 * 036: las DIFUSIONES no cuentan (mismo texto a varios chats a gente que no
 * venía escribiendo — `isBroadcast`). Se recorren los últimos mensajes del
 * equipo hasta el primero que no lo sea; los detectados quedan marcados
 * (`details.broadcast`) para no volver a evaluarlos y para que el panel de
 * la bandeja tampoco los cuente. Lo común (el equipo respondiéndole a
 * alguien que escribió) cuesta una consulta extra.
 */
export async function lastTeamMessageAt(
  organizationId: string,
  conversationId: string
): Promise<Date | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.message)
    .where(
      and(
        scoped(
          schema.message.organizationId,
          organizationId,
          eq(schema.message.conversationId, conversationId)
        ),
        teamAuthored()
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(TEAM_CANDIDATES);

  const detected: (typeof rows)[number][] = [];
  let result: Date | null = null;
  for (const row of rows) {
    if (row.details?.broadcast) continue;
    let broadcast = false;
    try {
      broadcast = await isTeamBroadcast(organizationId, conversationId, row);
    } catch (err) {
      // Ante la duda, el mensaje cuenta (comportamiento de 031).
      console.error("[agente] no se pudo evaluar la difusión:", err instanceof Error ? err.message : err);
    }
    if (!broadcast) {
      result = row.createdAt;
      break;
    }
    detected.push(row);
  }
  if (detected.length > 0) await markBroadcast(organizationId, conversationId, detected);
  return result;
}

async function isTeamBroadcast(
  organizationId: string,
  conversationId: string,
  row: { text: string | null; createdAt: Date }
): Promise<boolean> {
  const key = broadcastKey(row.text);
  if (!key) return false;
  const db = getDb();
  const at = row.createdAt.getTime();
  const [wrote] = await db
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.conversationId, conversationId),
        eq(schema.message.direction, "in"),
        lt(schema.message.createdAt, row.createdAt),
        gte(schema.message.createdAt, new Date(at - PROACTIVE_GAP_MS))
      )
    )
    .limit(1);
  if (wrote) return false;
  const [counted] = await db
    .select({ n: sql<number>`count(distinct ${schema.message.conversationId})::int` })
    .from(schema.message)
    .where(
      and(
        scoped(
          schema.message.organizationId,
          organizationId,
          eq(schema.message.text, row.text ?? ""),
          gte(schema.message.createdAt, new Date(at - BROADCAST_SPAN_MS)),
          lte(schema.message.createdAt, new Date(at + BROADCAST_SPAN_MS))
        ),
        teamAuthored()
      )
    );
  return isBroadcast({
    text: row.text,
    customerWroteBefore: false,
    sameTextConversations: Number(counted?.n ?? 0),
  });
}

async function markBroadcast(
  organizationId: string,
  conversationId: string,
  rows: (typeof schema.message.$inferSelect)[]
): Promise<void> {
  try {
    await getDb()
      .update(schema.message)
      .set({
        details: sql`coalesce(${schema.message.details}, '{}'::jsonb) || '{"broadcast":true}'::jsonb`,
      })
      .where(
        scoped(
          schema.message.organizationId,
          organizationId,
          inArray(
            schema.message.id,
            rows.map((r) => r.id)
          )
        )
      );
    for (const row of rows) {
      // Solo texto: el DTO de un adjunto lleva su media, que acá no está.
      if (row.type !== "text") continue;
      publish(organizationId, {
        type: "message.updated",
        data: {
          conversationId,
          message: serializeMessage({ ...row, details: { ...(row.details ?? {}), broadcast: true } }),
        },
      });
    }
  } catch (err) {
    console.error("[agente] no se pudo marcar la difusión:", err instanceof Error ? err.message : err);
  }
}
