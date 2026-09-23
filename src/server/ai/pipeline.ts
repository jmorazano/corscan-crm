import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { newId } from "@/lib/db/ids";
import { getEnv } from "@/lib/env";
import { chatJson, type ChatMessage } from "@/lib/ai";
import { getAiConfig } from "@/server/ai/credentials";
import { publish } from "@/server/events/bus";
import { notifyHandoff } from "@/server/push/events";
import { isWindowOpen } from "@/server/inbox/window";
import { SendError, sendText } from "@/server/inbox/send";
import {
  AgentAction,
  degradeAction,
  isCalendarAction,
  isMcpAction,
  resolveStage,
  type AgentActionType,
} from "@/server/ai/actions";
import { stripBookingPromise } from "@/lib/promise-guard";
import { agentTextFor } from "@/lib/inbound-media";
import { matchesHandoffIntent } from "@/server/ai/handoff";
import { isPlainAcknowledgment } from "@/server/ai/acknowledgment";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import {
  executeBookAppointment,
  executeCheckAvailability,
  loadCalendarContext,
  renderCalendarSection,
  type CalendarContext,
} from "@/server/calendar/agent-tools";
import {
  executeMcpAction,
  loadMcpContext,
  renderMcpSection,
  MCP_TOOL_TEXT_ROLE,
  type McpContext,
} from "@/server/mcp/agent-tools";

/** Vueltas extra al modelo por resultados de herramienta (research D6). */
const MAX_TOOL_ROUNDS = 2;

/**
 * 016: el presupuesto de herramientas es POR FAMILIA (agenda / conector) con
 * una cota TOTAL encima. Antes había un solo contador compartido: una empresa
 * con agenda Y conector podía quedarse sin vueltas a mitad de una consulta de
 * alojamientos porque las había gastado en la agenda — y peor, degradaba con
 * el texto cableado de turnos ("te confirmo el turno con el equipo") a alguien
 * que estaba preguntando por una cabaña.
 */
const MAX_TOOL_ROUNDS_TOTAL = 3;

/**
 * Reloj duro de TODO el tramo de herramientas del turno. El servidor del
 * cliente no lo operamos nosotros y su latencia no es nuestra: sin esta cota,
 * tres vueltas con timeout de 10 s cada una más el pensar del modelo pueden
 * dejar a una persona esperando en WhatsApp mucho más de lo tolerable.
 */
const TOOL_WALL_CLOCK_MS = 45_000;

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
  // 015: la conversación del entrenador tiene su propio turno
  // (src/server/ai/trainer.ts); el agente de clientes jamás la atiende.
  if (conversation.kind === "trainer") return;
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
  // 017: si lo último de la conversación ya es del negocio (el dueño
  // respondió desde el celular, o alguien mandó algo desde el CRM), el
  // agente no habla encima.
  const lastMessage = history[history.length - 1];
  if (lastMessage && lastMessage.direction === "out") return;

  // 014 (FR-011): si lo último que mandó la empresa fue una NOTIFICACIÓN
  // enviada por API (plantilla con api_key_id), un simple acuse de recibo
  // del cliente no merece respuesta — se corta ANTES del proveedor. Si
  // preguntó o pidió algo, el modelo atiende con la sección transaccional.
  const transactional = transactionalContext(history);
  if (transactional?.allAcknowledgments) return;

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

  // Constitución III: las dos lecturas pasan por scoped() como el resto del
  // repo (venían con eq() pelado desde 001; mismo resultado, una regla menos
  // que recordar a mano).
  const kb = await db
    .select()
    .from(schema.kbEntry)
    .where(scoped(schema.kbEntry.organizationId, organizationId))
    .orderBy(asc(schema.kbEntry.createdAt));
  const stages = await db
    .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  // Agenda (005): la sección solo existe si la empresa conectó calendario.
  // Un fallo al cargarla NO tumba el turno: el agente opera sin agenda.
  // 016: el último enlace seguro del conector, para que la frase de reemplazo
  // de la guarda de promesas pueda ofrecer dónde reservar de verdad.
  let lastStayLink: string | null = null;
  let calendar: CalendarContext | null = null;
  try {
    calendar = await loadCalendarContext(organizationId, conversation.contactId);
  } catch (err) {
    console.error("[agente] no se pudo cargar la agenda:", err instanceof Error ? err.message : err);
  }

  // Conector MCP (016): la sección solo existe si la empresa tiene conector
  // habilitado con un perfil que declara acciones. Igual que la agenda, un
  // fallo al cargarlo NO tumba el turno — el agente opera sin datos en vivo.
  // En sandbox jamás sale a la red (FR-013).
  let mcp: McpContext | null = null;
  try {
    mcp = await loadMcpContext(organizationId, conversationId, {
      sandbox: conversation.isTest,
    });
  } catch (err) {
    console.error(
      "[agente] no se pudo cargar el conector MCP:",
      err instanceof Error ? err.message : err
    );
  }
  const mcpSection = mcp
    ? renderMcpSection(mcp, { hasCalendar: calendar !== null })
    : null;

  /**
   * Entrega conversacional con la GUARDA DE PROMESAS (016, FR-009).
   *
   * El sistema del cliente es de SOLO LECTURA: la allowlist de herramientas
   * hace imposible que el agente EJECUTE una reserva, pero nada le impedía
   * PROMETERLA por WhatsApp ("listo, te la reservo para el finde"). Eso es
   * peor que un error técnico: la persona se queda tranquila, no reserva en
   * el sitio, y la cabaña se la lleva otro.
   *
   * La guarda se aplica SOLO con conector activo. Con agenda (005) y sin
   * conector, "te reservo el turno" es exactamente lo que el agente debe
   * decir — ahí sí puede agendar de verdad.
   */
  const say = async (text: string): Promise<void> => {
    if (!mcp) {
      await deliverConversationalReply(conversation, text, lastInbound.id);
      return;
    }
    const guarded = stripBookingPromise(text, { link: lastStayLink });
    if (guarded.replaced) {
      console.warn(
        `[agente] promesa de reserva suprimida en ${conversation.id}: ${guarded.match ?? "?"}`
      );
    }
    await deliverConversationalReply(conversation, guarded.text, lastInbound.id);
  };

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildAgentSystemPrompt({
        profile,
        kb,
        stages,
        calendarSection: calendar ? renderCalendarSection(calendar) : null,
        calendarBookingEnabled: calendar?.integration.rules.agentBookingEnabled ?? false,
        transactionalNotice: transactional?.notice ?? null,
        mcpSection,
        mcpOverridesKb: mcpSection !== null,
      }),
    },
    // 020: un entrante sin texto (una foto, un audio que no se pudo
    // transcribir) ya no desaparece del historial: `agentTextFor` le da una
    // línea con qué mandó el cliente. Sin esto el agente contestaba el
    // mensaje anterior o, peor, quedaba mudo.
    ...history
      .map((m) => ({
        role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
        content:
          m.direction === "in"
            ? agentTextFor({
                type: m.type,
                mediaState: m.mediaState,
                text: m.text,
                mediaSummary: m.mediaSummary,
              })
            : m.text,
      }))
      .filter((m): m is { role: "user" | "assistant"; content: string } => !!m.content),
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
  // 016: lo último SEGURO que se supo del conector — plantilla propia,
  // números y enlaces validados, sin un carácter de texto libre del tercero.
  let lastStaySummary: string | null = null;
  let calendarRounds = 0;
  let mcpRounds = 0;
  const toolDeadline = Date.now() + TOOL_WALL_CLOCK_MS;

  for (let round = 0; round < MAX_TOOL_ROUNDS_TOTAL; round++) {
    const wantsCalendar = isCalendarAction(action);
    const wantsMcp = isMcpAction(action);
    if (!wantsCalendar && !wantsMcp) break;
    // Presupuesto POR FAMILIA: que la agenda se haya agotado no le quita
    // vueltas al conector, ni al revés.
    if (wantsCalendar && calendarRounds >= MAX_TOOL_ROUNDS) break;
    if (wantsMcp && mcpRounds >= MAX_TOOL_ROUNDS) break;
    if (Date.now() >= toolDeadline) break;

    // ---- Conector MCP (016) -------------------------------------------
    if (isMcpAction(action)) {
      mcpRounds++;
      // El modelo pidió una herramienta que esta empresa no tiene: degradar
      // sin inventar y sin escalar a ciegas.
      if (!mcp) {
        await say("Dejame confirmar esa información con el equipo y te escribo en un ratito.");
        await applyHandoff(conversationId, organizationId, "modelo");
        return;
      }
      const out = await executeMcpAction(mcp, action, {
        conversationId,
        sandbox: conversation.isTest,
        budgetMs: Math.max(0, toolDeadline - Date.now()),
      });
      if (out.clientSummary) {
        lastStaySummary = out.clientSummary;
        // El enlace ya pasó por safeLink contra los dominios del perfil
        // cuando el perfil compuso el resumen: extraerlo de ahí es seguro y
        // evita que el pipeline conozca la forma de la respuesta del PMS.
        lastStayLink = out.clientSummary.match(/https:\/\/\S+/)?.[0] ?? lastStayLink;
      }
      // Corrección #7: el resultado entra como turno de USUARIO, no de
      // sistema — es un DATO que llegó de afuera, no una regla nuestra.
      messages.push({ role: MCP_TOOL_TEXT_ROLE, content: out.toolText });
      const next = await chatJson(aiConfig, AgentAction, messages);
      if (!next.ok) {
        console.error(`[agente] fallo del proveedor tras conector (raw): ${next.detail}`);
        if (lastStaySummary) {
          await say(lastStaySummary);
          return;
        }
        await applyHandoff(conversationId, organizationId, "error");
        return;
      }
      action = next.data;
      continue;
    }

    // ---- Agenda (005) --------------------------------------------------
    // El guard en línea estrecha `action` a la unión de la agenda (con la
    // variable booleana de arriba TypeScript no puede hacerlo).
    if (!isCalendarAction(action)) break;
    calendarRounds++;

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

  // 016: agotado el presupuesto del CONECTOR, el modelo sigue pidiendo datos.
  // Degradar con lo último seguro que se supo — que ya es una respuesta útil
  // de verdad (propiedades, precios y enlace) — y solo escalar si no hay nada.
  // Va por deliverConversationalReply y no por deliverReply: esto NO es la
  // confirmación de una acción ya ejecutada, es una respuesta de conversación.
  if (isMcpAction(action)) {
    if (lastStaySummary) {
      await say(lastStaySummary);
      return;
    }
    await say("Estoy consultando la disponibilidad y te confirmo en un ratito.");
    await applyHandoff(conversationId, organizationId, "modelo");
    return;
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
        await say(action.reply);
      }
      return;
    }
  }

  switch (action.action) {
    case "none":
      return;
    case "reply":
      await say(action.text);
      return;
    case "update_lead": {
      await appendLeadNote(organizationId, conversation.contactId, action.note);
      if (action.reply) {
        await say(action.reply);
      }
      return;
    }
    case "handoff": {
      if (action.farewell) {
        await say(action.farewell);
      }
      await applyHandoff(conversationId, organizationId, "modelo");
      return;
    }
  }
}

type Conversation = typeof schema.conversation.$inferSelect;

export type TransactionalContext = {
  /** Texto de la notificación (para el prompt). */
  notice: string;
  /** true si TODOS los entrantes desde esa notificación son acuses. */
  allAcknowledgments: boolean;
};

/**
 * Contexto transaccional PURO (014, research D5): mira el último saliente
 * anterior a la ráfaga de entrantes. Si es una plantilla enviada por API,
 * la conversación está en modo "notificación": devuelve el texto para el
 * prompt y si los entrantes son solo acuses de recibo. Cualquier otro
 * saliente (agente, operador, campaña) → null: comportamiento intacto.
 */
export function transactionalContext(
  history: readonly {
    direction: "in" | "out";
    type: string;
    text: string | null;
    apiKeyId: string | null;
  }[]
): TransactionalContext | null {
  let lastOut = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.direction === "out") {
      lastOut = i;
      break;
    }
  }
  if (lastOut === -1) return null;
  const outbound = history[lastOut]!;
  if (outbound.type !== "template" || !outbound.apiKeyId) return null;
  const inbounds = history.slice(lastOut + 1).filter((m) => m.direction === "in");
  if (inbounds.length === 0) return null;
  return {
    notice: (outbound.text ?? "").slice(0, 300),
    allAcknowledgments: inbounds.every((m) => isPlainAcknowledgment(m.text)),
  };
}

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
  // 013 (FR-006): avisar a todos los dispositivos que alguien necesita atención.
  notifyHandoff({ organizationId, conversationId, reason });
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
