import { and, desc, eq, gt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { newId } from "@/lib/db/ids";
import { friendlySendError } from "@/lib/conversation-events";
import {
  fallbackText,
  FOLLOW_UP_WINDOW_MS,
  followUpDecision,
  greetingName,
  isCustomerTurn,
  type FollowUpRecord,
  type FollowUpSkipReason,
  type FollowUpStep,
} from "@/lib/follow-up";
import { withSendRetry } from "@/lib/send-retry";
import { getAiConfig } from "@/server/ai/credentials";
import { recordConversationEvent } from "@/server/ai/events";
import { draftFollowUp } from "@/server/ai/follow-up";
import { SendError, sendText } from "@/server/inbox/send";

/**
 * 042: el BARRIDO de seguimientos. Corre en el proceso cada minuto (como los
 * tickers de 004/023/040: sin colas externas) y decide, conversación por
 * conversación, con la regla pura de `src/lib/follow-up.ts`.
 *
 * At-most-once: la fila de `agent_follow_up` se RESERVA antes de redactar y
 * enviar (UNIQUE conversación + ciclo + paso). Si el proceso se cae en el
 * medio, la reserva queda y ese seguimiento no se repite: el error seguro es
 * no escribir.
 */

const TICK_MS = 60_000;
/** Mensajes que se miran por conversación (el ciclo casi siempre es corto). */
const HISTORY_LIMIT = 40;
/** Tope de conversaciones por empresa y barrido. */
const CANDIDATES_PER_ORG = 500;

/** Omisiones que se ven en el hilo; el resto queda solo en el registro. */
const VISIBLE_SKIPS: readonly FollowUpSkipReason[] = ["refusal", "no_slot", "agent_none"];

export type SweepResult = { evaluated: number; sent: number; skipped: number; failed: number };

const globalForSweep = globalThis as unknown as {
  __voceroFollowUpTicker?: ReturnType<typeof setInterval>;
  __voceroFollowUpRunning?: boolean;
};

export function startFollowUpTicker(): void {
  if (globalForSweep.__voceroFollowUpTicker) return;
  const run = () => {
    void runFollowUpSweep().catch((err) =>
      console.warn("[seguimiento] el barrido falló:", err instanceof Error ? err.message : err)
    );
  };
  globalForSweep.__voceroFollowUpTicker = setInterval(run, TICK_MS);
  globalForSweep.__voceroFollowUpTicker.unref?.();
}

/**
 * Un barrido completo. `now` se inyecta en las pruebas (ruta de dev); el
 * envío real sigue validando la ventana con la hora del servidor.
 */
export async function runFollowUpSweep(now: Date = new Date()): Promise<SweepResult> {
  const result: SweepResult = { evaluated: 0, sent: 0, skipped: 0, failed: 0 };
  if (globalForSweep.__voceroFollowUpRunning) return result;
  globalForSweep.__voceroFollowUpRunning = true;
  try {
    const db = getDb();
    const profiles = await db
      .select()
      .from(schema.agentProfile)
      .where(and(eq(schema.agentProfile.followUpEnabled, true), eq(schema.agentProfile.enabled, true)));
    for (const profile of profiles) {
      try {
        await sweepOrganization(profile, now, result);
      } catch (err) {
        console.error(
          `[seguimiento] falló el barrido de ${profile.organizationId}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
    return result;
  } finally {
    globalForSweep.__voceroFollowUpRunning = false;
  }
}

type Profile = typeof schema.agentProfile.$inferSelect;
type Conversation = typeof schema.conversation.$inferSelect;
type Message = typeof schema.message.$inferSelect;

async function sweepOrganization(profile: Profile, now: Date, result: SweepResult): Promise<void> {
  const db = getDb();
  const organizationId = profile.organizationId;
  const since = new Date(now.getTime() - FOLLOW_UP_WINDOW_MS);
  const conversations = await db
    .select()
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        and(
          eq(schema.conversation.kind, "whatsapp"),
          eq(schema.conversation.isTest, false),
          gt(schema.conversation.lastInboundAt, since)
        )
      )
    )
    .orderBy(desc(schema.conversation.lastInboundAt))
    .limit(CANDIDATES_PER_ORG);

  for (const conversation of conversations) {
    result.evaluated++;
    try {
      await evaluateConversation(profile, conversation, now, result);
    } catch (err) {
      console.error(
        `[seguimiento] falló la conversación ${conversation.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}

async function loadHistory(organizationId: string, conversationId: string): Promise<Message[]> {
  const rows = await getDb()
    .select()
    .from(schema.message)
    .where(scoped(schema.message.organizationId, organizationId, eq(schema.message.conversationId, conversationId)))
    .orderBy(desc(schema.message.createdAt))
    .limit(HISTORY_LIMIT);
  return rows.reverse();
}

async function evaluateConversation(
  profile: Profile,
  conversation: Conversation,
  now: Date,
  result: SweepResult
): Promise<void> {
  const db = getDb();
  const organizationId = conversation.organizationId;
  const history = await loadHistory(organizationId, conversation.id);
  const lastCustomer = [...history].reverse().find(isCustomerTurn);
  if (!lastCustomer) return;
  // Barato antes de las demás lecturas: si lo último es del cliente, el
  // turno del agente todavía decide.
  const last = history[history.length - 1];
  if (!last || last.direction !== "out") return;

  const [contactRows, stageRows, recordRows] = await Promise.all([
    db
      .select({
        name: schema.contact.name,
        phone: schema.contact.phone,
        optedOutAt: schema.contact.optedOutAt,
      })
      .from(schema.contact)
      .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, conversation.contactId)))
      .limit(1),
    db
      .select({ kind: schema.pipelineStage.kind })
      .from(schema.lead)
      .innerJoin(schema.pipelineStage, eq(schema.lead.stageId, schema.pipelineStage.id))
      .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.contactId, conversation.contactId)))
      .limit(1),
    db
      .select({
        step: schema.agentFollowUp.step,
        status: schema.agentFollowUp.status,
        sentAt: schema.agentFollowUp.sentAt,
      })
      .from(schema.agentFollowUp)
      .where(
        scoped(
          schema.agentFollowUp.organizationId,
          organizationId,
          and(
            eq(schema.agentFollowUp.conversationId, conversation.id),
            eq(schema.agentFollowUp.cycleMessageId, lastCustomer.id)
          )
        )
      ),
  ]);
  const contact = contactRows[0];
  if (!contact) return;
  const stageKind = stageRows[0]?.kind ?? null;
  const records: FollowUpRecord[] = recordRows;

  const decision = followUpDecision({
    now,
    config: {
      timezone: profile.followUpTimezone,
      startHour: profile.followUpStartHour,
      endHour: profile.followUpEndHour,
    },
    messages: history,
    records,
    stageKind,
    optedOut: contact.optedOutAt !== null,
    aiActive: conversation.aiEnabled && conversation.handoffAt === null,
  });

  const base = {
    organizationId,
    conversationId: conversation.id,
    contactId: conversation.contactId,
    stageKind,
  };

  if (decision.kind === "skip") {
    const inserted = await db
      .insert(schema.agentFollowUp)
      .values({
        id: newId("agentFollowUp"),
        ...base,
        cycleMessageId: decision.cycleMessageId,
        step: decision.step,
        status: "skipped",
        reason: decision.reason,
      })
      .onConflictDoNothing()
      .returning({ id: schema.agentFollowUp.id });
    if (inserted[0]) {
      result.skipped++;
      if (VISIBLE_SKIPS.includes(decision.reason)) {
        await recordConversationEvent({
          organizationId,
          conversationId: conversation.id,
          kind: "ai_follow_up",
          reason: decision.reason,
          details: { step: decision.step },
        });
      }
    }
    return;
  }
  if (decision.kind !== "send") return;

  // RESERVA: si otra réplica (o un barrido anterior) ya la tomó, no se toca.
  const reserved = await db
    .insert(schema.agentFollowUp)
    .values({
      id: newId("agentFollowUp"),
      ...base,
      cycleMessageId: decision.cycleMessageId,
      step: decision.step,
      status: "reserved",
    })
    .onConflictDoNothing()
    .returning({ id: schema.agentFollowUp.id });
  const recordId = reserved[0]?.id;
  if (!recordId) return;

  const outcome = await sendFollowUp({
    profile,
    conversation,
    contact,
    history,
    step: decision.step,
    cycleMessageId: decision.cycleMessageId,
    lastMessageId: last.id,
  });
  await db
    .update(schema.agentFollowUp)
    .set({
      status: outcome.status,
      reason: outcome.reason ?? null,
      text: outcome.text ?? null,
      source: outcome.source ?? null,
      messageId: outcome.messageId ?? null,
      sentAt: outcome.status === "sent" ? now : null,
    })
    .where(eq(schema.agentFollowUp.id, recordId));
  if (outcome.status === "sent") result.sent++;
  else if (outcome.status === "failed") result.failed++;
  else result.skipped++;
  if (outcome.event) {
    await recordConversationEvent({
      organizationId,
      conversationId: conversation.id,
      kind: "ai_follow_up",
      reason: outcome.event.reason,
      details: { step: decision.step, ...(outcome.event.detail ? { detail: outcome.event.detail } : {}) },
    });
  }
}

type SendOutcome = {
  status: "sent" | "skipped" | "failed";
  reason?: string;
  text?: string;
  source?: "agent" | "fallback";
  messageId?: string;
  event?: { reason: string; detail?: string };
};

async function sendFollowUp(input: {
  profile: Profile;
  conversation: Conversation;
  contact: { name: string; phone: string };
  history: Message[];
  step: FollowUpStep;
  cycleMessageId: string;
  lastMessageId: string;
}): Promise<SendOutcome> {
  const { profile, conversation, step } = input;
  const name = greetingName(input.contact.name);
  const fallback = fallbackText(step, name, step === 1 ? profile.followUpText1 : profile.followUpText2);
  const aiConfig = await getAiConfig(conversation.organizationId);
  const draft = await draftFollowUp({
    aiConfig,
    profile,
    step,
    greetingName: name,
    fallback,
    history: input.history,
    contactPhone: input.contact.phone,
  });
  if (draft.kind === "none") {
    return {
      status: "skipped",
      reason: "agent_none",
      event: { reason: "agent_none", ...(draft.reason ? { detail: draft.reason } : {}) },
    };
  }
  if (draft.source === "fallback" && draft.note) {
    console.warn(`[seguimiento] respaldo en ${conversation.id}: ${draft.note}`);
  }

  // Mientras el modelo redactaba pudo escribir el cliente o alguien del
  // equipo: con la conversación movida, no se manda.
  const fresh = await loadHistory(conversation.organizationId, conversation.id);
  const freshLast = fresh[fresh.length - 1];
  if (freshLast && freshLast.id !== input.lastMessageId) {
    return { status: "skipped", reason: freshLast.direction === "in" ? "customer_replied" : "team" };
  }

  try {
    const sent = await withSendRetry(
      () =>
        sendText({
          conversationId: conversation.id,
          organizationId: conversation.organizationId,
          text: draft.text,
          aiGenerated: true,
          details: { followUp: { step } },
        }),
      {
        codeOf: (err) => (err instanceof SendError ? err.code : null),
        onRetry: (attempt, code) =>
          console.warn(`[seguimiento] reintento ${attempt} del envío en ${conversation.id}: ${code}`),
      }
    );
    return { status: "sent", text: draft.text, source: draft.source, messageId: sent.messageId };
  } catch (err) {
    const detail =
      err instanceof SendError ? friendlySendError(err.code, err.message) : "falló el envío por un error inesperado";
    console.error(`[seguimiento] no salió el ${step} en ${conversation.id}:`, err instanceof Error ? err.message : err);
    return { status: "failed", reason: detail, text: draft.text, source: draft.source, event: { reason: "failed", detail } };
  }
}
