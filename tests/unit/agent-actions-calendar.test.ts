import { describe, expect, it } from "vitest";
import { AgentAction } from "@/server/ai/actions";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import { renderCalendarSection, type CalendarContext } from "@/server/calendar/agent-tools";
import { DEFAULT_RULES } from "@/server/calendar/rules";

/**
 * FR-010/FR-016: las acciones de agenda existen en el contrato del agente,
 * y la sección AGENDA del prompt (con sus acciones) solo aparece cuando la
 * empresa tiene calendario; sin reserva si el negocio la apagó.
 */

const profile = {
  id: "agp_1",
  organizationId: "org_1",
  enabled: true,
  name: "Ari",
  tone: null,
  instructions: null,
  escalationRules: null,
  greeting: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function ctx(overrides: Partial<CalendarContext["integration"]> = {}, nextOwn: CalendarContext["nextOwn"] = null): CalendarContext {
  return {
    integration: {
      id: "cint_1",
      organizationId: "org_1",
      accountEmail: "agenda@negocio.test",
      calendarId: "primary",
      calendarName: "Agenda",
      status: "connected",
      rules: { ...DEFAULT_RULES, bookingInstructions: "Pedí el nombre completo." },
      ...overrides,
    },
    nextOwn,
    now: new Date("2026-09-07T11:00:00.000Z"),
  };
}

describe("acciones de agenda del agente", () => {
  it("parsea check_availability y book_appointment", () => {
    expect(AgentAction.parse({ action: "check_availability" })).toEqual({ action: "check_availability" });
    expect(AgentAction.parse({ action: "check_availability", date: "2026-09-08" })).toEqual({
      action: "check_availability",
      date: "2026-09-08",
    });
    expect(
      AgentAction.parse({ action: "book_appointment", start: "2026-09-08T10:00", note: "consulta", reply: "ok" })
    ).toMatchObject({ action: "book_appointment", start: "2026-09-08T10:00" });
  });

  it("rechaza book_appointment sin start", () => {
    expect(AgentAction.safeParse({ action: "book_appointment" }).success).toBe(false);
    expect(AgentAction.safeParse({ action: "book_appointment", start: "" }).success).toBe(false);
  });
});

describe("sección AGENDA del prompt", () => {
  it("sin calendario: el prompt no ofrece acciones de agenda", () => {
    const p = buildAgentSystemPrompt({ profile, kb: [], stages: [{ name: "Nuevo" }] });
    expect(p).not.toContain("AGENDA DE TURNOS");
    expect(p).not.toContain("check_availability");
    expect(p).not.toContain("book_appointment");
  });

  it("con calendario: fecha actual, horarios, instrucciones y ambas acciones", () => {
    const section = renderCalendarSection(ctx());
    const p = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [],
      calendarSection: section,
      calendarBookingEnabled: true,
    });
    expect(p).toContain("AGENDA DE TURNOS");
    expect(p).toContain("2026-09-07T08:00"); // 11:00Z = 08:00 Buenos Aires
    expect(p).toContain("Lunes: 09:00–18:00");
    expect(p).toContain("Domingo: cerrado");
    expect(p).toContain("Pedí el nombre completo.");
    expect(p).toContain('"action":"check_availability"');
    expect(p).toContain('"action":"book_appointment"');
    expect(p).toContain("no tiene turnos futuros");
  });

  it("reserva apagada: solo check_availability; el turno propio del cliente se menciona", () => {
    const section = renderCalendarSection(
      ctx(
        { rules: { ...DEFAULT_RULES, agentBookingEnabled: false } },
        { startsAt: new Date("2026-09-08T13:00:00.000Z"), endsAt: new Date("2026-09-08T13:30:00.000Z"), timezone: DEFAULT_RULES.timezone }
      )
    );
    const p = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [],
      calendarSection: section,
      calendarBookingEnabled: false,
    });
    expect(p).toContain('"action":"check_availability"');
    expect(p).not.toContain('{"action":"book_appointment"');
    expect(p).toContain("NO podés agendar vos");
    expect(p).toContain("YA tiene un turno confirmado: martes 8 de septiembre a las 10:00");
  });

  it("requiere reconexión: no ofrece horarios y pide derivar", () => {
    const section = renderCalendarSection(ctx({ status: "reconnect_required" }));
    expect(section).toContain("NO DISPONIBLE");
    expect(section).not.toContain("Horarios de atención");
  });
});
