import { formatLocalLabel, formatLocalLong, localDateTimeKey, parseDateKey, WEEKDAY_ES_LONG } from "@/lib/time";
import { getAvailability } from "@/server/calendar/availability";
import { bookAppointment, getNextAppointmentForContact, type AppointmentRecord } from "@/server/calendar/booking";
import { getCalendarIntegration, type CalendarIntegration } from "@/server/calendar/integration";
import { WEEKDAY_KEYS, type WeekdayKey } from "@/server/calendar/rules";
import type { Slot } from "@/server/calendar/slots";

/**
 * Puente agente ↔ agenda (FR-010/FR-016, research D6/D7): arma la sección
 * del system prompt y ejecuta las acciones-herramienta devolviendo el texto
 * que se le muestra al modelo en la vuelta siguiente. Nunca expone eventos
 * ajenos: solo huecos libres y el próximo turno del PROPIO contacto.
 */

export const TOOL_MARKER = "[HERRAMIENTA]";
const MAX_SLOTS_FOR_MODEL = 12;

export type CalendarContext = {
  integration: CalendarIntegration;
  nextOwn: { startsAt: Date; endsAt: Date; timezone: string } | null;
  now: Date;
};

/** null si la empresa no tiene calendario conectado. */
export async function loadCalendarContext(
  organizationId: string,
  contactId: string,
  now = new Date()
): Promise<CalendarContext | null> {
  const integration = await getCalendarIntegration(organizationId);
  if (!integration) return null;
  const nextOwn = await getNextAppointmentForContact(organizationId, contactId, now);
  return { integration, nextOwn, now };
}

function renderWeeklyHours(ctx: CalendarContext): string {
  const wh = ctx.integration.rules.weeklyHours;
  const lines: string[] = [];
  // Lunes primero, domingo al final.
  const order: WeekdayKey[] = ["1", "2", "3", "4", "5", "6", "0"];
  for (const k of order) {
    if (!WEEKDAY_KEYS.includes(k)) continue;
    const ranges = wh[k];
    const name = WEEKDAY_ES_LONG[Number(k)]!;
    lines.push(
      ranges.length === 0
        ? `- ${name}: cerrado`
        : `- ${name}: ${ranges.map(([a, b]) => `${a}–${b}`).join(" y ")}`
    );
  }
  return lines.join("\n");
}

/** Sección "AGENDA DE TURNOS" del system prompt (FR-016). */
export function renderCalendarSection(ctx: CalendarContext): string {
  const { integration, now } = ctx;
  const tz = integration.rules.timezone;
  const r = integration.rules;
  if (integration.status === "reconnect_required") {
    return [
      "AGENDA DE TURNOS: la agenda del negocio está TEMPORALMENTE NO DISPONIBLE (requiere reconexión por parte del equipo).",
      "Si el cliente pide turno: NO ofrezcas horarios ni confirmes nada; decile que el equipo le confirma el turno y usa handoff.",
    ].join("\n");
  }
  const parts = [
    `AGENDA DE TURNOS (fecha y hora actual del negocio: ${formatLocalLong(tz, now)} — ${localDateTimeKey(tz, now)}, zona ${tz}):`,
    `Horarios de atención:\n${renderWeeklyHours(ctx)}`,
    `Duración del turno: ${r.slotMinutes} min${r.bufferMinutes ? ` (+${r.bufferMinutes} min entre turnos)` : ""}. Anticipación mínima: ${r.minLeadHours} h. Se agenda hasta ${r.horizonDays} días adelante.`,
    r.bookingInstructions ? `Instrucciones del negocio para turnos:\n${r.bookingInstructions}` : null,
    ctx.nextOwn
      ? `Este cliente YA tiene un turno confirmado: ${formatLocalLong(ctx.nextOwn.timezone, ctx.nextOwn.startsAt)}. Podés recordárselo si pregunta.`
      : "Este cliente no tiene turnos futuros registrados.",
    [
      "Cómo trabajar con turnos:",
      '- Para saber qué horarios hay, usá {"action":"check_availability","date":"YYYY-MM-DD"} (fecha local; sin "date" te devuelvo los próximos días). NUNCA inventes horarios: solo ofrecé los que te devuelva la herramienta.',
      r.agentBookingEnabled
        ? '- Cuando el cliente elija un horario que la herramienta devolvió, agendalo con {"action":"book_appointment","start":"YYYY-MM-DDTHH:MM","note":"motivo breve","reply":"confirmación al cliente"}. Si no está claro cuál eligió, preguntá antes.'
        : "- NO podés agendar vos: cuando el cliente elija, decile que el equipo le confirma el turno y usá handoff.",
      "- Los datos de otros turnos son confidenciales: solo hablás de horarios LIBRES y del turno de este cliente.",
      "- Si el cliente pide un horario fuera de los de atención, explicalo y ofrecé alternativas de la herramienta.",
    ].join("\n"),
  ];
  return parts.filter(Boolean).join("\n\n");
}

function renderSlots(tz: string, slots: Slot[]): string {
  return slots
    .slice(0, MAX_SLOTS_FOR_MODEL)
    .map((s) => `- ${localDateTimeKey(tz, s.start)} (${formatLocalLabel(tz, s.start)})`)
    .join("\n");
}

/** Ejecuta check_availability → texto para la vuelta siguiente del modelo. */
export async function executeCheckAvailability(
  ctx: CalendarContext,
  date: string | undefined,
  sandbox: boolean
): Promise<{ text: string; slots: Slot[] }> {
  const tz = ctx.integration.rules.timezone;
  const validDate = date && parseDateKey(date) ? date : undefined;
  try {
    const { slots } = await getAvailability(ctx.integration, {
      fromDate: validDate,
      days: validDate ? 1 : 3,
      limit: MAX_SLOTS_FOR_MODEL,
      now: ctx.now,
      sandbox,
    });
    // Sin huecos ese día: extender a los días siguientes para poder ofrecer algo.
    let effective = slots;
    let widened = false;
    if (effective.length === 0) {
      effective = (
        await getAvailability(ctx.integration, {
          fromDate: validDate,
          days: 7,
          limit: MAX_SLOTS_FOR_MODEL,
          now: ctx.now,
          sandbox,
        })
      ).slots;
      widened = true;
    }
    if (effective.length === 0) {
      return {
        text: `${TOOL_MARKER} DISPONIBILIDAD: no hay horarios libres ${validDate ? `el ${validDate} ni en la semana siguiente` : "en los próximos días"} dentro de las reglas. Ofrecé que el equipo lo contacte (handoff) o pedile otra fecha.`,
        slots: [],
      };
    }
    const header = validDate
      ? widened
        ? `${TOOL_MARKER} DISPONIBILIDAD: el ${validDate} no hay horarios libres; los próximos libres son:`
        : `${TOOL_MARKER} DISPONIBILIDAD para el ${validDate} (horarios libres, hora local ${tz}):`
      : `${TOOL_MARKER} DISPONIBILIDAD próximos días (horarios libres, hora local ${tz}):`;
    return {
      text: `${header}\n${renderSlots(tz, effective)}\nOfrecé 2 o 3 opciones concretas al cliente (fecha y hora), sin inventar otras. Cuando elija, respondé con book_appointment usando el valor exacto YYYY-MM-DDTHH:MM.`,
      slots: effective,
    };
  } catch (err) {
    console.error("[agente] disponibilidad falló:", err instanceof Error ? err.message : err);
    return {
      text: `${TOOL_MARKER} DISPONIBILIDAD: la agenda no está disponible en este momento (error del proveedor). NO ofrezcas horarios: decile al cliente que el equipo le confirma el turno y usá handoff.`,
      slots: [],
    };
  }
}

export type BookOutcome =
  | { kind: "booked"; text: string; appointment: AppointmentRecord; created: boolean }
  | { kind: "retry"; text: string }
  | { kind: "escalate"; text: string };

/** Ejecuta book_appointment con validación server-side (FR-010..013). */
export async function executeBookAppointment(
  ctx: CalendarContext,
  input: {
    organizationId: string;
    contactId: string;
    contactName: string;
    contactPhone: string;
    conversationId: string;
    start: string;
    note?: string;
    sandbox: boolean;
  }
): Promise<BookOutcome> {
  const tz = ctx.integration.rules.timezone;
  const result = await bookAppointment({
    organizationId: input.organizationId,
    contactId: input.contactId,
    contactName: input.contactName,
    contactPhone: input.contactPhone,
    conversationId: input.conversationId,
    startLocal: input.start,
    note: input.note ?? null,
    createdBy: "agent",
    sandbox: input.sandbox,
    now: ctx.now,
    integration: ctx.integration,
  });
  if (result.ok) {
    return {
      kind: "booked",
      text: `Turno confirmado para ${result.appointment.whenText}.`,
      appointment: result.appointment,
      created: result.created,
    };
  }
  switch (result.reason) {
    case "invalid_start":
      return {
        kind: "retry",
        text: `${TOOL_MARKER} RESERVA RECHAZADA: "${input.start}" no es una fecha/hora válida. Usá el formato exacto YYYY-MM-DDTHH:MM de un horario devuelto por check_availability; si no sabés cuál quiere el cliente, preguntale.`,
      };
    case "not_available":
      return {
        kind: "retry",
        text:
          result.alternatives.length > 0
            ? `${TOOL_MARKER} RESERVA RECHAZADA: el horario ${input.start} ya no está disponible (ocupado o fuera de las reglas). Alternativas libres:\n${renderSlots(tz, result.alternatives)}\nOfrecé estas alternativas al cliente; no confirmes nada todavía.`
            : `${TOOL_MARKER} RESERVA RECHAZADA: el horario ${input.start} no está disponible y no hay alternativas cercanas. Pedile otra fecha o usá handoff.`,
      };
    case "not_connected":
    case "provider_error":
    default:
      console.error("[agente] reserva falló:", result.detail ?? result.reason);
      return {
        kind: "escalate",
        text: "No pude confirmar el turno en este momento. Un compañero del equipo te lo confirma a la brevedad.",
      };
  }
}
