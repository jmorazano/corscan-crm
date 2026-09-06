import { and, asc, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { GoogleAuthError } from "@/lib/google/oauth";
import { deleteEvent, GoogleApiError, insertEvent } from "@/lib/google/calendar-client";
import { formatLocalLong, localDateKey, parseLocalDateTime, zonedToUtc } from "@/lib/time";
import { getAvailability, isStartAvailable } from "@/server/calendar/availability";
import { getCalendarIntegration, withAccessToken, type CalendarIntegration } from "@/server/calendar/integration";
import type { Slot } from "@/server/calendar/slots";

/**
 * Reserva y cancelación de turnos (FR-010..FR-013, research D7/D8).
 * El modelo propone; ESTE módulo decide: formato, grilla de reglas,
 * ocupación real en el momento, idempotencia por (org, contacto, inicio).
 */

export type AppointmentRecord = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  googleEventId: string | null;
  /** Texto listo para confirmar al cliente: "lunes 7 de septiembre a las 10:00". */
  whenText: string;
};

export type BookingResult =
  | { ok: true; appointment: AppointmentRecord; created: boolean; sandbox: boolean }
  | { ok: false; reason: "not_connected" | "invalid_start" | "not_available" | "provider_error"; alternatives: Slot[]; detail?: string };

export async function bookAppointment(input: {
  organizationId: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
  conversationId: string | null;
  /** "YYYY-MM-DDTHH:MM" en hora local del negocio. */
  startLocal: string;
  note?: string | null;
  createdBy: "agent" | "user";
  /** Conversación del Laboratorio: NO toca Google ni persiste (D7). */
  sandbox: boolean;
  now?: Date;
  integration?: CalendarIntegration | null;
}): Promise<BookingResult> {
  const now = input.now ?? new Date();
  const integration =
    input.integration === undefined
      ? await getCalendarIntegration(input.organizationId)
      : input.integration;
  if (!integration) return { ok: false, reason: "not_connected", alternatives: [] };

  const parsed = parseLocalDateTime(input.startLocal);
  if (!parsed) return { ok: false, reason: "invalid_start", alternatives: [] };
  const tz = integration.rules.timezone;
  const start = zonedToUtc(tz, parsed.year, parsed.month, parsed.day, parsed.hour, parsed.minute);
  const end = new Date(start.getTime() + integration.rules.slotMinutes * 60_000);
  const whenText = formatLocalLong(tz, start);

  const db = getDb();

  // Idempotencia (FR-012): la misma reserva repetida devuelve la existente.
  if (!input.sandbox) {
    const existing = await db
      .select()
      .from(schema.appointment)
      .where(
        scoped(
          schema.appointment.organizationId,
          input.organizationId,
          and(
            eq(schema.appointment.contactId, input.contactId),
            eq(schema.appointment.startsAt, start),
            eq(schema.appointment.status, "confirmed")
          )
        )
      )
      .limit(1);
    if (existing[0]) {
      return {
        ok: true,
        created: false,
        sandbox: false,
        appointment: toRecord(existing[0], whenText),
      };
    }
  }

  try {
    const free = await isStartAvailable(integration, start, input.sandbox, now);
    if (!free) {
      return {
        ok: false,
        reason: "not_available",
        alternatives: await alternativesAround(integration, start, input.sandbox, now),
      };
    }

    if (input.sandbox) {
      return {
        ok: true,
        created: true,
        sandbox: true,
        appointment: {
          id: "apt_sandbox",
          startsAt: start,
          endsAt: end,
          timezone: tz,
          googleEventId: null,
          whenText,
        },
      };
    }

    const title = `Turno: ${input.contactName}`;
    const description = [
      `Cliente: ${input.contactName}`,
      `WhatsApp: +${input.contactPhone}`,
      input.note ? `Motivo: ${input.note}` : null,
      "Agendado desde Vocero CRM",
    ]
      .filter(Boolean)
      .join("\n");
    const event = await withAccessToken(input.organizationId, (token) =>
      insertEvent(token, integration.calendarId, {
        summary: title,
        description,
        start,
        end,
        timezone: tz,
      })
    );

    try {
      const inserted = await db
        .insert(schema.appointment)
        .values({
          id: newId("appointment"),
          organizationId: input.organizationId,
          contactId: input.contactId,
          conversationId: input.conversationId,
          googleEventId: event.id,
          calendarId: integration.calendarId,
          startsAt: start,
          endsAt: end,
          timezone: tz,
          title,
          note: input.note ?? null,
          status: "confirmed",
          createdBy: input.createdBy,
        })
        .returning();
      return { ok: true, created: true, sandbox: false, appointment: toRecord(inserted[0]!, whenText) };
    } catch (err) {
      // Carrera con una reserva idéntica (UNIQUE): quitar el evento duplicado
      // y devolver la fila ganadora.
      if (isUniqueViolation(err)) {
        await withAccessToken(input.organizationId, (token) =>
          deleteEvent(token, integration.calendarId, event.id)
        ).catch(() => undefined);
        const winner = await db
          .select()
          .from(schema.appointment)
          .where(
            scoped(
              schema.appointment.organizationId,
              input.organizationId,
              and(eq(schema.appointment.contactId, input.contactId), eq(schema.appointment.startsAt, start))
            )
          )
          .limit(1);
        if (winner[0]) {
          return { ok: true, created: false, sandbox: false, appointment: toRecord(winner[0], whenText) };
        }
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof GoogleAuthError || err instanceof GoogleApiError) {
      return { ok: false, reason: "provider_error", alternatives: [], detail: err.message };
    }
    throw err;
  }
}

async function alternativesAround(
  integration: CalendarIntegration,
  start: Date,
  sandbox: boolean,
  now: Date
): Promise<Slot[]> {
  try {
    const { slots } = await getAvailability(integration, {
      fromDate: localDateKey(integration.rules.timezone, start),
      days: 3,
      limit: 6,
      now,
      sandbox,
    });
    return slots;
  } catch {
    return [];
  }
}

function toRecord(row: typeof schema.appointment.$inferSelect, whenText: string): AppointmentRecord {
  return {
    id: row.id,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    timezone: row.timezone,
    googleEventId: row.googleEventId,
    whenText,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505");
}

/** Cancela (guard WHERE confirmed, monotónico) y borra el evento best-effort. */
export async function cancelAppointment(
  organizationId: string,
  appointmentId: string
): Promise<"cancelled" | "not_found"> {
  const db = getDb();
  const updated = await db
    .update(schema.appointment)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(
      scoped(
        schema.appointment.organizationId,
        organizationId,
        and(eq(schema.appointment.id, appointmentId), eq(schema.appointment.status, "confirmed"))
      )
    )
    .returning();
  const row = updated[0];
  if (!row) return "not_found";
  if (row.googleEventId) {
    await withAccessToken(organizationId, (token) =>
      deleteEvent(token, row.calendarId, row.googleEventId!)
    ).catch((err) => console.error("[calendario] no se pudo borrar el evento:", err instanceof Error ? err.message : err));
  }
  return "cancelled";
}

export type AppointmentListItem = {
  id: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
  conversationId: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  status: "confirmed" | "cancelled";
  createdBy: "agent" | "user";
  note: string | null;
};

/** Próximos turnos (+ cancelados recientes) para la UI de la integración. */
export async function listAppointments(organizationId: string): Promise<AppointmentListItem[]> {
  const db = getDb();
  const since = new Date(Date.now() - 24 * 3_600_000);
  const rows = await db
    .select({
      id: schema.appointment.id,
      contactId: schema.appointment.contactId,
      contactName: schema.contact.name,
      contactPhone: schema.contact.phone,
      conversationId: schema.appointment.conversationId,
      startsAt: schema.appointment.startsAt,
      endsAt: schema.appointment.endsAt,
      timezone: schema.appointment.timezone,
      status: schema.appointment.status,
      createdBy: schema.appointment.createdBy,
      note: schema.appointment.note,
    })
    .from(schema.appointment)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.appointment.contactId))
    .where(scoped(schema.appointment.organizationId, organizationId, gte(schema.appointment.startsAt, since)))
    .orderBy(schema.appointment.startsAt)
    .limit(200);
  return rows.map((r) => ({
    ...r,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
  }));
}

/** Próximo turno confirmado de ESTE contacto (jamás de otros — FR-016). */
export async function getNextAppointmentForContact(
  organizationId: string,
  contactId: string,
  now = new Date()
): Promise<{ startsAt: Date; endsAt: Date; timezone: string } | null> {
  const db = getDb();
  const rows = await db
    .select({
      startsAt: schema.appointment.startsAt,
      endsAt: schema.appointment.endsAt,
      timezone: schema.appointment.timezone,
    })
    .from(schema.appointment)
    .where(
      scoped(
        schema.appointment.organizationId,
        organizationId,
        and(
          eq(schema.appointment.contactId, contactId),
          eq(schema.appointment.status, "confirmed"),
          gte(schema.appointment.endsAt, now)
        )
      )
    )
    .orderBy(asc(schema.appointment.startsAt))
    .limit(1);
  return rows[0] ?? null;
}
