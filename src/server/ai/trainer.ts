import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { chatJson, type ChatMessage } from "@/lib/ai";
import { getAiConfig } from "@/server/ai/credentials";
import { publish } from "@/server/events/bus";
import { serializeMessage } from "@/server/inbox/ingest";
import { serializeConversation } from "@/server/inbox/queries";
import { kbSize, listEntries } from "@/server/kb/service";
import { getProfile } from "@/server/ai/profile";
import { TrainerAction, type TrainerActionType } from "@/server/ai/trainer-actions";
import { buildTrainerSystemPrompt } from "@/server/ai/trainer-prompts";
import { applyTrainerChanges, type ApplyOutcome } from "@/server/trainer/changes";

/**
 * Turno del entrenador (015, D4/D5): el dueño le escribe a su propio agente
 * y el agente traduce eso en cambios del conocimiento/perfil.
 *
 * Dirección (inversa al pipeline de clientes): el dueño es `out` (derecha,
 * `user` para el modelo); el agente es `in` + ai_generated (izquierda,
 * `assistant`, suma no leídos). Ejecución inmediata (sin el debounce de 20 s)
 * con lock por conversación: dos mensajes en ráfaga → UNA respuesta.
 * Un fallo del proveedor produce una respuesta amable; jamás handoff.
 */

const HISTORY_LIMIT = 30;
const TURN_TIMEOUT_MS = 45_000;
const TURN_MAX_TOKENS = 2048;

export const PROVIDER_DOWN_REPLY =
  "No pude procesar eso ahora: el proveedor de IA no respondió. Probá de nuevo en un momento.";

export class TrainerError extends Error {
  constructor(
    public readonly code: "ai_not_configured" | "not_found" | "not_trainer",
    message: string
  ) {
    super(message);
    this.name = "TrainerError";
  }
}

/**
 * Espera corta antes de responder: absorbe la ráfaga típica («cuando
 * pregunten por precio…» + «…y decí que cotizamos a medida») en UNA
 * respuesta sin que se note (el hilo muestra «está pensando…»).
 */
export const TRAINER_DEBOUNCE_MS = 2500;

type LockEntry = {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  pending: boolean;
};
const globalForTrainer = globalThis as unknown as {
  __trainerLocks?: Map<string, LockEntry>;
  /** Por conversación: createdAt (ms) del último mensaje del dueño que
   * cubrió el último turno. Un mensaje que llegó DURANTE un turno queda
   * después de esa marca → el turno pendiente sí responde. */
  __trainerCovered?: Map<string, number>;
};
function locks(): Map<string, LockEntry> {
  if (!globalForTrainer.__trainerLocks) globalForTrainer.__trainerLocks = new Map();
  return globalForTrainer.__trainerLocks;
}
function covered(): Map<string, number> {
  if (!globalForTrainer.__trainerCovered) globalForTrainer.__trainerCovered = new Map();
  return globalForTrainer.__trainerCovered;
}

/**
 * Inserta el mensaje del dueño y dispara el turno en segundo plano.
 * `type: "audio"` = nota de voz ya transcrita (US3): entra como texto.
 */
export async function postTrainerMessage(input: {
  organizationId: string;
  conversationId: string;
  text: string;
  type?: "text" | "audio";
}): Promise<{ messageId: string }> {
  const db = getDb();
  const rows = await db
    .select({ conversation: schema.conversation, contact: schema.contact })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
    .where(
      scoped(
        schema.conversation.organizationId,
        input.organizationId,
        eq(schema.conversation.id, input.conversationId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new TrainerError("not_found", "Conversación no encontrada");
  if (row.conversation.kind !== "trainer") {
    throw new TrainerError("not_trainer", "No es la conversación del entrenador");
  }
  if (!(await getAiConfig(input.organizationId))) {
    throw new TrainerError(
      "ai_not_configured",
      "La IA de la empresa está apagada: configurala en Ajustes → Inteligencia artificial"
    );
  }

  const now = new Date();
  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      direction: "out",
      type: input.type ?? "text",
      text: input.text,
      status: "sent",
      aiGenerated: false,
      waTimestamp: now,
    })
    .returning();
  const message = inserted[0]!;
  await db
    .update(schema.conversation)
    .set({ lastMessageAt: now, updatedAt: now })
    .where(eq(schema.conversation.id, input.conversationId));

  publish(input.organizationId, {
    type: "message.new",
    data: { conversationId: input.conversationId, message: serializeMessage(message) },
  });
  scheduleTrainerTurn(input.conversationId);
  return { messageId: message.id };
}

/**
 * Debounce corto + lock por conversación: una ráfaga → UNA respuesta; si
 * hay un turno corriendo, corre UNO más al terminar (re-esperando la
 * ventana, como el agente de clientes en 011).
 */
export function scheduleTrainerTurn(conversationId: string): void {
  const map = locks();
  const entry = map.get(conversationId) ?? { timer: null, running: false, pending: false };
  map.set(conversationId, entry);
  if (entry.running) {
    entry.pending = true;
    return;
  }
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void executeTrainerTurn(conversationId);
  }, TRAINER_DEBOUNCE_MS);
}

async function executeTrainerTurn(conversationId: string): Promise<void> {
  const map = locks();
  const entry = map.get(conversationId);
  if (!entry || entry.running) return;
  entry.running = true;
  try {
    await runTrainerTurn(conversationId);
  } catch (err) {
    console.error("[entrenador] turno falló:", err instanceof Error ? err.message : err);
  } finally {
    entry.running = false;
    if (entry.pending) {
      entry.pending = false;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        entry.timer = null;
        void executeTrainerTurn(conversationId);
      }, TRAINER_DEBOUNCE_MS);
    } else {
      map.delete(conversationId);
    }
  }
}

/**
 * Un turno: contexto → UNA llamada al modelo → aplicar cambios y responder en
 * una transacción → SSE. Nunca lanza hacia afuera (el lock lo captura).
 */
export async function runTrainerTurn(conversationId: string): Promise<void> {
  const db = getDb();
  const convRows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const conversation = convRows[0];
  if (!conversation || conversation.kind !== "trainer") return;
  const organizationId = conversation.organizationId;

  const aiConfig = await getAiConfig(organizationId);
  if (!aiConfig) return;

  const history = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.conversationId, conversationId))
    .orderBy(desc(schema.message.createdAt))
    .limit(HISTORY_LIMIT);
  history.reverse();
  const last = history[history.length - 1];
  const lastOwner = [...history].reverse().find((m) => m.direction === "out");
  if (!last || !lastOwner) return;
  // ¿Ya cubrimos lo último que escribió el dueño? Con marca del turno
  // anterior se compara contra ella (un mensaje llegado DURANTE ese turno
  // queda después y sí se responde); sin marca (proceso recién arrancado),
  // si lo último es del agente no hay nada pendiente.
  const coveredUpTo = covered().get(conversationId);
  if (coveredUpTo !== undefined) {
    if (lastOwner.createdAt.getTime() <= coveredUpTo) return;
  } else if (last.direction === "in") {
    return;
  }

  const profile = await getProfile(organizationId);
  if (!profile) return;
  const kb = await listEntries(organizationId);
  const size = kbSize(kb);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildTrainerSystemPrompt({
        profile,
        kb,
        kbChars: size.chars,
        warnAt: size.warnAt,
      }),
    },
    ...history
      .filter((m) => m.text)
      .map((m) => ({
        role: m.direction === "out" ? ("user" as const) : ("assistant" as const),
        content: m.text!,
      })),
  ];

  const result = await chatJson(aiConfig, TrainerAction, messages, {
    timeoutMs: TURN_TIMEOUT_MS,
    maxTokens: TURN_MAX_TOKENS,
  });

  if (!result.ok) {
    if (result.error === "not_configured") return;
    console.error(`[entrenador] fallo del proveedor: ${result.detail}`);
    await persistAgentReply(conversation, PROVIDER_DOWN_REPLY, null);
    covered().set(conversationId, lastOwner.createdAt.getTime());
    return;
  }

  await persistAgentReply(conversation, replyTextOf(result.data), result.data);
  covered().set(conversationId, lastOwner.createdAt.getTime());
}

function replyTextOf(action: TrainerActionType): string {
  return action.action === "reply" ? action.text : action.reply;
}

/**
 * Inserta la respuesta del agente y aplica los cambios en UNA transacción
 * (la respuesta primero, para que la auditoría apunte a su id). Publica SSE
 * después del commit.
 */
async function persistAgentReply(
  conversation: typeof schema.conversation.$inferSelect,
  text: string,
  action: TrainerActionType | null
): Promise<void> {
  const db = getDb();
  const organizationId = conversation.organizationId;
  const now = new Date();

  const { message, outcome } = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.message)
      .values({
        id: newId("message"),
        organizationId,
        conversationId: conversation.id,
        direction: "in",
        type: "text",
        text,
        status: "delivered",
        aiGenerated: true,
        waTimestamp: now,
      })
      .returning();
    let message = inserted[0]!;

    let outcome: ApplyOutcome | null = null;
    if (action?.action === "apply") {
      outcome = await applyTrainerChanges(
        tx,
        { organizationId, conversationId: conversation.id, messageId: message.id },
        action.changes
      );
      if (outcome.rejected.length > 0) {
        const reasons = Array.from(new Set(outcome.rejected.map((r) => r.reason))).join("; ");
        const suffix = `\n\n(No pude guardar ${outcome.rejected.length} cambio${outcome.rejected.length === 1 ? "" : "s"}: ${reasons}.)`;
        const fixed = await tx
          .update(schema.message)
          .set({ text: `${text}${suffix}` })
          .where(eq(schema.message.id, message.id))
          .returning();
        message = fixed[0] ?? message;
      }
    }

    await tx
      .update(schema.conversation)
      .set({
        lastInboundAt: now,
        lastMessageAt: now,
        unreadCount: sql`${schema.conversation.unreadCount} + 1`,
        updatedAt: now,
      })
      .where(eq(schema.conversation.id, conversation.id));
    return { message, outcome };
  });

  publish(organizationId, {
    type: "message.new",
    data: { conversationId: conversation.id, message: serializeMessage(message) },
  });
  const fresh = await db
    .select({ conversation: schema.conversation, contact: schema.contact })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
    .where(eq(schema.conversation.id, conversation.id))
    .limit(1);
  if (fresh[0]) {
    publish(organizationId, {
      type: "conversation.updated",
      data: {
        conversation: serializeConversation(fresh[0].conversation, fresh[0].contact, text),
      },
    });
  }
  if (outcome && outcome.applied.length > 0) {
    console.info(
      `[entrenador] ${outcome.applied.length} cambio(s) aplicados en ${organizationId}`
    );
  }
}

/** Vacía el hilo del entrenador (conserva la auditoría). */
export async function clearTrainerConversation(
  organizationId: string,
  conversationId: string
): Promise<number> {
  const db = getDb();
  const deleted = await db
    .delete(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.conversationId, conversationId)
      )
    )
    .returning({ id: schema.message.id });
  await db
    .update(schema.conversation)
    .set({ unreadCount: 0, lastMessageAt: null, lastInboundAt: null, updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversationId));
  return deleted.length;
}
