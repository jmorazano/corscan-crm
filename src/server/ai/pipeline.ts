import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { newId } from "@/lib/db/ids";
import { getEnv } from "@/lib/env";
import { chatJson, type ChatMessage } from "@/lib/ai";
import { getAiConfig } from "@/server/ai/credentials";
import { publish } from "@/server/events/bus";
import { isWindowOpen } from "@/server/inbox/window";
import { SendError, sendText } from "@/server/inbox/send";
import { AgentAction, degradeAction, resolveStage, type AgentActionType } from "@/server/ai/actions";
import { matchesHandoffIntent } from "@/server/ai/handoff";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import {
  executeBookAppointment,
  executeCheckAvailability,
  loadCalendarContext,
  renderCalendarSection,
  type CalendarContext,
} from "@/server/calendar/agent-tools";

/** Vueltas extra al modelo por resultados de herramienta (research D6). */
const MAX_TOOL_ROUNDS = 2;

/**
 * Turno del agente (FR-021..FR-025).
 *
 * Coalesce + lock in-process por conversación: ráfagas de mensajes → UNA
 * respuesta; nunca dos turnos simultáneos; lo que llega durante un turno
 * re-encola exactamente un turno más. Suficiente para el monolito de una
 * instancia (sin colas externas — Constitución II).
 */

type CoalesceEntry = {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  pending: boolean;
};

const globalForAgent = globalThis as unknown as {
  __agentCoalesce?: Map<string, CoalesceEntry>;
};

function coalesceMap(): Map<string, CoalesceEntry> {
  if (!globalForAgent.__agentCoalesce) {
    globalForAgent.__agentCoalesce = new Map();
  }
  return globalForAgent.__agentCoalesce;
}

/** Punto de entrada con debounce (mensajes entrantes reales). */
export function scheduleAgentTurn(conversationId: string): void {
  const map = coalesceMap();
  const entry = map.get(conversationId) ?? {
    timer: null,
    running: false,
    pending: false,
  };
  map.set(conversationId, entry);

  if (entry.running) {
    entry.pending = true; // se re-encola al terminar el turno actual
    return;
  }
  if (entry.timer) clearTimeout(entry.timer);
  const delay = getEnv().AGENT_COALESCE_MS;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void executeTurn(conversationId);
  }, delay);
}

async function executeTurn(conversationId: string): Promise<void> {
  const map = coalesceMap();
  const entry = map.get(conversationId);
  if (!entry || entry.running) return;
  entry.running = true;
  try {
    await runAgentTurn(conversationId);
  } catch (err) {
    console.error("[agente] turno falló:", err);
  } finally {
    entry.running = false;
    if (entry.pending) {
      entry.pending = false;
      // 011: el turno pendiente RE-DEBOUNCEA — llegó gente escribiendo
      // durante el turno anterior; esperar la ventana completa de nuevo da
      // tiempo a que termine la ráfaga y produce UNA respuesta con todo.
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        entry.timer = null;
        void executeTurn(conversationId);
      }, getEnv().AGENT_COALESCE_MS);
    } else {
      map.delete(conversationId);
    }
  }
}

/**
 * Ejecuta UN turno del agente ahora (el Laboratorio lo llama directo, con
 * debounce 0 y sin pasar por el coalesce).
 */
export async function runAgentTurn(conversationId: string): Promise<void> {
  const db = getDb();
  const convRows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const conversation = convRows[0];
  if (!conversation) return;
  const organizationId = conversation.organizationId;

  // Config de IA DE LA EMPRESA dueña de la conversación (US3): sin config,
  // el turno corta acá — antes de cualquier llamada al proveedor.
  const aiConfig = await getAiConfig(organizationId);
  if (!aiConfig) return;

  // Condiciones de silencio: handoff activo o IA apagada en la conversación.
  if (conversation.handoffAt || !conversation.aiEnabled) return;

  // 011 (FR-007): a un contacto dado de baja no se le responde nada —
  // defensa en profundidad además del corte en la ingesta.
  if (!conversation.isTest) {
    const contactRow = await loadContact(organizationId, conversation.contactId);
    if (contactRow?.optedOutAt) return;
  }

  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profileRows[0];
  if (!profile) return;
  // El toggle global aplica a conversaciones reales; el Laboratorio evalúa el
  // comportamiento configurado aunque el agente aún no esté encendido.
  if (!conversation.isTest && !profile.enabled) return;

  const history = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.conversationId, conversationId))
    .orderBy(desc(schema.message.createdAt))
    .limit(20);
  history.reverse();
  const lastInbound = [...history].reverse().find((m) => m.direction === "in");
  if (!lastInbound) return;

  // Ventana cerrada: el agente JAMÁS envía texto libre → handoff 'ventana'.
  if (!conversation.isTest && !isWindowOpen(conversation.lastInboundAt)) {
    await applyHandoff(conversationId, organizationId, "ventana");
    return;
  }

  // Patrón de respaldo ANTES del LLM (FR-022).
  if (lastInbound.text && matchesHandoffIntent(lastInbound.text)) {
    await applyHandoff(conversationId, organizationId, "cliente");
    return;
  }

  const kb = await db
    .select()
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId))
    .orderBy(asc(schema.kbEntry.createdAt));
  const stages = await db
    .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  // Agenda (005): la sección solo existe si la empresa conectó calendario.
  // Un fallo al cargarla NO tumba el turno: el agente opera sin agenda.
  let calendar: CalendarContext | null = null;
  try {
    calendar = await loadCalendarContext(organizationId, conversation.contactId);
  } catch (err) {
    console.error("[agente] no se pudo cargar la agenda:", err instanceof Error ? err.message : err);
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildAgentSystemPrompt({
        profile,
        kb,
        stages,
        calendarSection: calendar ? renderCalendarSection(calendar) : null,
        calendarBookingEnabled: calendar?.integration.rules.agentBookingEnabled ?? false,
      }),
    },
    ...history
      .filter((m) => m.text)
      .map((m) => ({
        role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
        content: m.text!,
      })),
  ];

  const result = await chatJson(aiConfig, AgentAction, messages);
  if (!result.ok) {
    if (result.error === "not_configured") return;
    // Fallo persistente del proveedor o salida imposible → escalar (FR-022).
    console.error(`[agente] fallo del proveedor (raw): ${result.detail}`);
    await applyHandoff(conversationId, organizationId, "error");
    return;
  }

  let action: AgentActionType = result.data;

  // Loop de herramienta de la agenda (D6): el servidor ejecuta, el modelo
  // vuelve a decidir con el resultado; acotado a MAX_TOOL_ROUNDS.
  let lastAvailabilityText: string | null = null;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (action.action !== "check_availability" && action.action !== "book_appointment") break;

    // Sin agenda (o agendado deshabilitado para reservas): el modelo no
    // debió elegir esto — degradar a derivación amable.
    if (!calendar || calendar.integration.status === "reconnect_required") {
      await deliverReply(conversation, "Te confirmo el turno con el equipo en un momento.");
      await applyHandoff(conversationId, organizationId, "modelo");
      return;
    }
    if (action.action === "book_appointment" && !calendar.integration.rules.agentBookingEnabled) {
      await deliverReply(conversation, "Perfecto, un compañero del equipo te confirma ese turno enseguida.");
      await applyHandoff(conversationId, organizationId, "modelo");
      return;
    }

    let toolText: string;
    if (action.action === "check_availability") {
      const out = await executeCheckAvailability(calendar, action.date, conversation.isTest);
      toolText = out.text;
      lastAvailabilityText = out.slots.length > 0 ? out.slots.map((s) => s.label).join(", ") : null;
    } else {
      const contact = await loadContact(organizationId, conversation.contactId);
      if (!contact) return;
      const out = await executeBookAppointment(calendar, {
        organizationId,
        contactId: contact.id,
        contactName: contact.name,
        contactPhone: contact.phone,
        conversationId,
        start: action.start,
        note: action.note,
        sandbox: conversation.isTest,
      });
      if (out.kind === "booked") {
        const reply = action.reply?.trim()
          ? action.reply
          : `¡Listo! Tu turno quedó confirmado para el ${out.appointment.whenText}.`;
        await deliverReply(conversation, reply);
        if (!conversation.isTest) {
          await appendLeadNote(
            organizationId,
            conversation.contactId,
            `Turno agendado: ${out.appointment.whenText}${action.note ? ` — ${action.note}` : ""}`
          );
          publish(organizationId, {
            type: "conversation.updated",
            data: { conversation: { id: conversationId } },
          });
        }
        return;
      }
      if (out.kind === "escalate") {
        await deliverReply(conversation, out.text);
        await applyHandoff(conversationId, organizationId, "error");
        return;
      }
      toolText = out.text;
    }

    messages.push({ role: "system", content: toolText });
    const next = await chatJson(aiConfig, AgentAction, messages);
    if (!next.ok) {
      console.error(`[agente] fallo del proveedor tras herramienta (raw): ${next.detail}`);
      await applyHandoff(conversationId, organizationId, "error");
      return;
    }
    action = next.data;
  }

  // Agotadas las vueltas y el modelo sigue pidiendo herramienta: degradar
  // a una respuesta útil con lo último que se supo, sin colgarse.
  if (action.action === "check_availability" || action.action === "book_appointment") {
    if (lastAvailabilityText) {
      await deliverReply(
        conversation,
        `Tengo estos horarios disponibles: ${lastAvailabilityText}. ¿Cuál te queda mejor?`
      );
      return;
    }
    await deliverReply(conversation, "Te confirmo el turno con el equipo en un momento.");
    await applyHandoff(conversationId, organizationId, "modelo");
    return;
  }

  if (action.action === "move_stage") {
    const stage = resolveStage(action.stage, stages);
    if (!stage) {
      action = degradeAction(action);
    } else {
      await moveLeadToStage(organizationId, conversation.contactId, stage.id);
      publish(organizationId, {
        type: "conversation.updated",
        data: { conversation: { id: conversationId } },
      });
      if (action.reply) {
        await deliverConversationalReply(conversation, action.reply, lastInbound.id);
      }
      return;
    }
  }

  switch (action.action) {
    case "none":
      return;
    case "reply":
      await deliverConversationalReply(conversation, action.text, lastInbound.id);
      return;
    case "update_lead": {
      await appendLeadNote(organizationId, conversation.contactId, action.note);
      if (action.reply) {
        await deliverConversationalReply(conversation, action.reply, lastInbound.id);
      }
      return;
    }
    case "handoff": {
      if (action.farewell) {
        await deliverConversationalReply(conversation, action.farewell, lastInbound.id);
      }
      await applyHandoff(conversationId, organizationId, "modelo");
      return;
    }
  }
}

type Conversation = typeof schema.conversation.$inferSelect;

async function loadContact(
  organizationId: string,
  contactId: string
): Promise<{
  id: string;
  name: string;
  phone: string;
  optedOutAt: Date | null;
} | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.contact.id,
      name: schema.contact.name,
      phone: schema.contact.phone,
      optedOutAt: schema.contact.optedOutAt,
    })
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, contactId)))
    .limit(1);
  return rows[0] ?? null;
}

export type ReplyDecision = "send" | "stale" | "duplicate";

/**
 * Decisión PURA de entrega conversacional (011, unit-testeable):
 * - "stale": llegó un inbound nuevo mientras el modelo pensaba — la
 *   respuesta se descarta y el turno se regenera con el contexto completo.
 * - "duplicate": el texto es idéntico al último saliente — jamás repetir.
 */
export function conversationalReplyDecision(input: {
  turnInboundId: string;
  latestInboundId: string | null;
  lastOutboundText: string | null;
  text: string;
}): ReplyDecision {
  if (input.latestInboundId && input.latestInboundId !== input.turnInboundId) {
    return "stale";
  }
  if (
    input.lastOutboundText !== null &&
    input.lastOutboundText.trim() === input.text.trim()
  ) {
    return "duplicate";
  }
  return "send";
}

/**
 * Entrega conversacional con guardas (011). SOLO para respuestas de
 * conversación (reply/farewell/notas): las confirmaciones de acciones ya
 * ejecutadas (turno reservado) usan deliverReply directo — la acción
 * ocurrió y el cliente debe enterarse igual (FR-004).
 */
async function deliverConversationalReply(
  conversation: Conversation,
  text: string,
  turnInboundId: string
): Promise<void> {
  if (!conversation.isTest) {
    const db = getDb();
    const recent = await db
      .select({
        id: schema.message.id,
        direction: schema.message.direction,
        text: schema.message.text,
      })
      .from(schema.message)
      .where(eq(schema.message.conversationId, conversation.id))
      .orderBy(desc(schema.message.createdAt))
      .limit(6);
    const decision = conversationalReplyDecision({
      turnInboundId,
      latestInboundId: recent.find((m) => m.direction === "in")?.id ?? null,
      lastOutboundText: recent.find((m) => m.direction === "out")?.text ?? null,
      text,
    });
    if (decision === "stale") {
      // Regenerar con todo lo nuevo; el debounce vuelve a esperar la ráfaga.
      scheduleAgentTurn(conversation.id);
      return;
    }
    if (decision === "duplicate") {
      console.warn(
        `[agente] respuesta idéntica suprimida en ${conversation.id}`
      );
      return;
    }
  }
  await deliverReply(conversation, text);
}

/** Entrega la respuesta: envío real o persistencia sandbox (is_test). */
async function deliverReply(
  conversation: Conversation,
  text: string
): Promise<void> {
  if (conversation.isTest) {
    await persistTestOutbound(conversation, text);
    return;
  }
  try {
    await sendText({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      text,
      aiGenerated: true,
    });
  } catch (err) {
    if (err instanceof SendError && err.code === "window_closed") {
      await applyHandoff(conversation.id, conversation.organizationId, "ventana");
      return;
    }
    throw err;
  }
}

/** Mensaje saliente del sandbox: se persiste, JAMÁS toca la API (FR-031). */
async function persistTestOutbound(
  conversation: Conversation,
  text: string
): Promise<void> {
  const db = getDb();
  await db.insert(schema.message).values({
    id: newId("message"),
    organizationId: conversation.organizationId,
    conversationId: conversation.id,
    direction: "out",
    type: "text",
    text,
    status: "sent",
    aiGenerated: true,
  });
  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversation.id));
}

export async function applyHandoff(
  conversationId: string,
  organizationId: string,
  reason: "cliente" | "modelo" | "error" | "ventana"
): Promise<void> {
  const db = getDb();
  const updated = await db
    .update(schema.conversation)
    .set({ handoffAt: new Date(), handoffReason: reason, updatedAt: new Date() })
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId)
      )
    )
    .returning();
  if (!updated[0]) return;
  publish(organizationId, {
    type: "conversation.updated",
    data: {
      conversation: { id: conversationId, handoffReason: reason },
    },
  });
}

/**
 * Escrituras del turno del agente SIEMPRE con scope de tenant (Constitución
 * III): el contactId viene de la fila de conversation (misma org), pero si
 * cualquier confusión aguas arriba entregara un id ajeno, el WHERE org+id
 * garantiza que la escritura jamás aterrice en datos de otra organización.
 * Exportadas para el unit test de scoping.
 */
export async function moveLeadToStage(
  organizationId: string,
  contactId: string,
  stageId: string
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.lead)
    .set({ stageId, updatedAt: new Date(), lastActivityAt: new Date() })
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.lead.contactId, contactId)
      )
    );
}

export async function appendLeadNote(
  organizationId: string,
  contactId: string,
  note: string
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.contact.id, notes: schema.contact.notes })
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        eq(schema.contact.id, contactId)
      )
    )
    .limit(1);
  const contact = rows[0];
  if (!contact) return;
  const stamped = `[IA] ${note}`;
  await db
    .update(schema.contact)
    .set({
      notes: contact.notes ? `${contact.notes}\n${stamped}` : stamped,
      updatedAt: new Date(),
    })
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        eq(schema.contact.id, contact.id)
      )
    );
}
