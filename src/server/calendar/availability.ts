import { and, eq, gte, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { queryFreeBusy } from "@/lib/google/calendar-client";
import { addDaysToKey, localDateKey, parseDateKey, zonedToUtc } from "@/lib/time";
import type { CalendarIntegration } from "@/server/calendar/integration";
import { withAccessToken } from "@/server/calendar/integration";
import { computeFreeSlots, isSlotAvailable, type Interval, type Slot } from "@/server/calendar/slots";

/**
 * Disponibilidad = reglas + ocupación real (research D4/D5).
 * Ocupado = freeBusy de Google (solo intervalos, sin datos) ∪ turnos
 * confirmados del CRM (cubre la carrera entre insertar en Google y que
 * freeBusy lo refleje). En sandbox (D7) no hay red: busy = [].
 */

export type AvailabilityResult = {
  timezone: string;
  slots: Slot[];
  source: "google" | "rules_only";
};

export async function getBusyIntervals(
  integration: CalendarIntegration,
  from: Date,
  to: Date,
  sandbox: boolean
): Promise<Interval[]> {
  const db = getDb();
  const own = await db
    .select({ start: schema.appointment.startsAt, end: schema.appointment.endsAt })
    .from(schema.appointment)
    .where(
      scoped(
        schema.appointment.organizationId,
        integration.organizationId,
        and(
          eq(schema.appointment.status, "confirmed"),
          gte(schema.appointment.endsAt, from),
          lt(schema.appointment.startsAt, to)
        )
      )
    );
  if (sandbox) return own;
  const google = await withAccessToken(integration.organizationId, (token) =>
    queryFreeBusy(token, integration.calendarId, from, to)
  );
  return [...own, ...google];
}

export async function getAvailability(
  integration: CalendarIntegration,
  opts: {
    fromDate?: string;
    days?: number;
    limit?: number;
    now?: Date;
    sandbox?: boolean;
  } = {}
): Promise<AvailabilityResult> {
  const now = opts.now ?? new Date();
  const tz = integration.rules.timezone;
  const sandbox = opts.sandbox ?? false;
  const startKey =
    opts.fromDate && parseDateKey(opts.fromDate) ? opts.fromDate : localDateKey(tz, now);
  const days = Math.max(1, Math.min(opts.days ?? integration.rules.horizonDays, integration.rules.horizonDays + 1));
  const endKey = addDaysToKey(startKey, days);
  const s = parseDateKey(startKey)!;
  const e = parseDateKey(endKey)!;
  const from = zonedToUtc(tz, s.year, s.month, s.day, 0, 0);
  const to = zonedToUtc(tz, e.year, e.month, e.day, 0, 0);
  const busy = await getBusyIntervals(integration, from, to, sandbox);
  const slots = computeFreeSlots({
    rules: integration.rules,
    timezone: tz,
    now,
    busy,
    fromDate: startKey,
    days,
    limit: opts.limit,
  });
  return { timezone: tz, slots, source: sandbox ? "rules_only" : "google" };
}

/** ¿`start` sigue libre AHORA? (re-chequeo justo antes de reservar, D8). */
export async function isStartAvailable(
  integration: CalendarIntegration,
  start: Date,
  sandbox: boolean,
  now = new Date()
): Promise<boolean> {
  const slotMs = integration.rules.slotMinutes * 60_000;
  const busy = await getBusyIntervals(
    integration,
    new Date(start.getTime() - 24 * 3_600_000),
    new Date(start.getTime() + slotMs + 24 * 3_600_000),
    sandbox
  );
  return isSlotAvailable(start, {
    rules: integration.rules,
    timezone: integration.rules.timezone,
    now,
    busy,
  });
}
