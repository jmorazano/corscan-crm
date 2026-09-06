import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleApiError } from "@/lib/google/calendar-client";
import { DEFAULT_RULES } from "@/server/calendar/rules";
import type { CalendarIntegration } from "@/server/calendar/integration";

/**
 * FR-010..FR-014: la reserva la decide el SERVIDOR: formato, hueco libre
 * ahora, idempotencia por (org, contacto, inicio), sandbox sin Google, y
 * fallo del proveedor tipado (jamás excepción al turno).
 */

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  /** Resultados de los SELECT en orden de llamada (vacío = []). */
  selectQueue: [] as Row[][],
  inserted: [] as Row[],
  available: true,
  alternatives: [] as { start: Date; end: Date; label: string; localKey: string }[],
  insertedEvents: [] as Record<string, unknown>[],
  deletedEvents: [] as string[],
  insertRowThrows: null as Error | null,
  insertEventThrows: null as Error | null,
  wheres: [] as unknown[],
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const { PgDialect } = await import("drizzle-orm/pg-core");
  return {
    ...actual,
    getDb: () => ({
      select: () => ({
        from: () => ({
          where: (cond: unknown) => {
            state.wheres.push(new PgDialect().sqlToQuery(cond as never));
            return { limit: () => Promise.resolve(state.selectQueue.shift() ?? []) };
          },
        }),
      }),
      insert: () => ({
        values: (v: Row) => ({
          returning: () => {
            if (state.insertRowThrows) return Promise.reject(state.insertRowThrows);
            state.inserted.push(v);
            return Promise.resolve([{ ...v }]);
          },
        }),
      }),
    }),
  };
});

vi.mock("@/server/calendar/availability", () => ({
  isStartAvailable: () => Promise.resolve(state.available),
  getAvailability: () =>
    Promise.resolve({ slots: state.alternatives, timezone: "America/Argentina/Buenos_Aires", source: "google" }),
}));

vi.mock("@/server/calendar/integration", () => ({
  withAccessToken: (_org: string, fn: (t: string) => Promise<unknown>) => fn("tok"),
  getCalendarIntegration: () => Promise.resolve(null),
}));

vi.mock("@/lib/google/calendar-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/google/calendar-client")>();
  return {
    ...actual,
    insertEvent: (_t: string, _c: string, input: Record<string, unknown>) => {
      if (state.insertEventThrows) return Promise.reject(state.insertEventThrows);
      state.insertedEvents.push(input);
      return Promise.resolve({ id: `evt_${state.insertedEvents.length}` });
    },
    deleteEvent: (_t: string, _c: string, id: string) => {
      state.deletedEvents.push(id);
      return Promise.resolve();
    },
  };
});

const integration: CalendarIntegration = {
  id: "cint_1",
  organizationId: "org_1",
  accountEmail: "agenda@negocio.test",
  calendarId: "primary",
  calendarName: "Agenda",
  status: "connected",
  rules: DEFAULT_RULES,
};

const base = {
  organizationId: "org_1",
  contactId: "ct_1",
  contactName: "Lucía",
  contactPhone: "5493511111111",
  conversationId: "cv_1",
  createdBy: "agent" as const,
  now: new Date("2026-09-07T11:00:00.000Z"),
  integration,
};

const existingRow = {
  id: "apt_prev",
  startsAt: new Date("2026-09-08T13:00:00.000Z"),
  endsAt: new Date("2026-09-08T13:30:00.000Z"),
  timezone: DEFAULT_RULES.timezone,
  googleEventId: "evt_prev",
};

beforeEach(() => {
  state.selectQueue.length = 0;
  state.inserted.length = 0;
  state.available = true;
  state.alternatives.length = 0;
  state.insertedEvents.length = 0;
  state.deletedEvents.length = 0;
  state.insertRowThrows = null;
  state.insertEventThrows = null;
  state.wheres.length = 0;
});

describe("bookAppointment", () => {
  it("inicio malformado → invalid_start sin tocar Google", async () => {
    const { bookAppointment } = await import("@/server/calendar/booking");
    const r = await bookAppointment({ ...base, startLocal: "mañana a las 10", sandbox: false });
    expect(r).toMatchObject({ ok: false, reason: "invalid_start" });
    expect(state.insertedEvents).toEqual([]);
  });

  it("hueco no disponible → not_available con alternativas, nada creado", async () => {
    const { bookAppointment } = await import("@/server/calendar/booking");
    state.available = false;
    state.alternatives.push({
      start: new Date("2026-09-08T13:00:00.000Z"),
      end: new Date("2026-09-08T13:30:00.000Z"),
      label: "mar 8 sep 10:00",
      localKey: "2026-09-08",
    });
    const r = await bookAppointment({ ...base, startLocal: "2026-09-08T09:00", sandbox: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("not_available");
      expect(r.alternatives.map((s) => s.label)).toEqual(["mar 8 sep 10:00"]);
    }
    expect(state.insertedEvents).toEqual([]);
    expect(state.inserted).toEqual([]);
  });

  it("camino feliz: evento en Google + fila con org/contacto/inicio en UTC + texto de confirmación", async () => {
    const { bookAppointment } = await import("@/server/calendar/booking");
    const r = await bookAppointment({ ...base, startLocal: "2026-09-08T10:00", note: "control", sandbox: false });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.created).toBe(true);
      expect(r.appointment.startsAt.toISOString()).toBe("2026-09-08T13:00:00.000Z");
      expect(r.appointment.googleEventId).toBe("evt_1");
      expect(r.appointment.whenText).toBe("martes 8 de septiembre a las 10:00");
    }
    expect(state.insertedEvents[0]).toMatchObject({ summary: "Turno: Lucía" });
    expect(String(state.insertedEvents[0]!.description)).toContain("+5493511111111");
    expect(state.inserted[0]).toMatchObject({
      organizationId: "org_1",
      contactId: "ct_1",
      conversationId: "cv_1",
      googleEventId: "evt_1",
      status: "confirmed",
      createdBy: "agent",
      note: "control",
    });
    expect(String(state.inserted[0]!.id)).toMatch(/^apt_/);
  });

  it("idempotencia: reserva repetida devuelve la existente sin crear otro evento", async () => {
    const { bookAppointment } = await import("@/server/calendar/booking");
    state.selectQueue.push([existingRow]);
    const r = await bookAppointment({ ...base, startLocal: "2026-09-08T10:00", sandbox: false });
    expect(r).toMatchObject({ ok: true, created: false });
    if (r.ok) expect(r.appointment.id).toBe("apt_prev");
    expect(state.insertedEvents).toEqual([]);
    // La búsqueda de la existente va scoped por organización (Constitución III).
    expect(JSON.stringify(state.wheres[0])).toContain("organization_id");
  });

  it("carrera UNIQUE: borra el evento duplicado y devuelve la fila ganadora", async () => {
    const { bookAppointment } = await import("@/server/calendar/booking");
    state.insertRowThrows = Object.assign(new Error("duplicate"), { code: "23505" });
    // 1er SELECT (idempotencia) vacío; 2do (tras el UNIQUE) → la ganadora.
    state.selectQueue.push([], [{ ...existingRow, id: "apt_winner", googleEventId: "evt_winner" }]);
    const r = await bookAppointment({ ...base, startLocal: "2026-09-08T10:00", sandbox: false });
    expect(r).toMatchObject({ ok: true, created: false });
    if (r.ok) expect(r.appointment.id).toBe("apt_winner");
    expect(state.deletedEvents).toEqual(["evt_1"]);
  });

  it("sandbox (Laboratorio): confirma sin Google ni fila", async () => {
    const { bookAppointment } = await import("@/server/calendar/booking");
    const r = await bookAppointment({ ...base, startLocal: "2026-09-08T10:00", sandbox: true });
    expect(r).toMatchObject({ ok: true, sandbox: true, created: true });
    expect(state.insertedEvents).toEqual([]);
    expect(state.inserted).toEqual([]);
    expect(state.wheres).toEqual([]); // ni siquiera consulta la BD
  });

  it("proveedor caído → provider_error tipado (sin excepción)", async () => {
    const { bookAppointment } = await import("@/server/calendar/booking");
    state.insertEventThrows = new GoogleApiError("provider_error", 500, "Backend Error");
    const r = await bookAppointment({ ...base, startLocal: "2026-09-08T10:00", sandbox: false });
    expect(r).toMatchObject({ ok: false, reason: "provider_error" });
    expect(state.inserted).toEqual([]);
  });
});
