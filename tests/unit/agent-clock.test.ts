import { describe, expect, it } from "vitest";
import {
  agentTimeZone,
  CLOCK_MARKER,
  clockSection,
  DEFAULT_AGENT_TIMEZONE,
  nowLine,
  utcOffsetLabel,
  zoneLabel,
} from "@/lib/agent-clock";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import { buildFollowUpPrompt } from "@/server/ai/follow-up";
import { buildTrainerSystemPrompt } from "@/server/ai/trainer-prompts";
import { aiMockCompletion } from "@/server/dev/ai-mock";

/**
 * Pedido de Altos de la Ciudad (3-nov-2026): el agente no sabía qué hora era
 * y aplicaba la regla de horario equivocada. Los instantes son los de los
 * casos reales, en UTC (el servidor corre en UTC).
 */

const CBA = "America/Argentina/Cordoba";

describe("nowLine", () => {
  it("31/10 22:55 en Córdoba es 01:55 UTC del 1/11: manda la hora local", () => {
    expect(nowLine(new Date("2026-11-01T01:55:00Z"), CBA)).toBe(
      "Ahora: sábado 31/10/2026, 22:55 (hora de Córdoba, UTC−3)."
    );
  });

  it("1/11 23:24 y 2/11 22:35", () => {
    expect(nowLine(new Date("2026-11-02T02:24:00Z"), CBA)).toBe(
      "Ahora: domingo 1/11/2026, 23:24 (hora de Córdoba, UTC−3)."
    );
    expect(nowLine(new Date("2026-11-03T01:35:00Z"), CBA)).toBe(
      "Ahora: lunes 2/11/2026, 22:35 (hora de Córdoba, UTC−3)."
    );
  });

  it("el ejemplo del pedido: martes 3/11/2026, 22:35", () => {
    expect(nowLine(new Date("2026-11-04T01:35:00Z"), CBA)).toBe(
      "Ahora: martes 3/11/2026, 22:35 (hora de Córdoba, UTC−3)."
    );
  });

  it("medianoche: 00:05 ya es el día siguiente", () => {
    expect(nowLine(new Date("2026-11-04T03:05:00Z"), CBA)).toBe(
      "Ahora: miércoles 4/11/2026, 00:05 (hora de Córdoba, UTC−3)."
    );
  });

  it("zona inválida o vacía → Córdoba", () => {
    expect(agentTimeZone("Marte/Olympus")).toBe(DEFAULT_AGENT_TIMEZONE);
    expect(agentTimeZone("  ")).toBe(DEFAULT_AGENT_TIMEZONE);
    expect(agentTimeZone(null)).toBe(DEFAULT_AGENT_TIMEZONE);
    expect(nowLine(new Date("2026-11-04T01:35:00Z"), "nada")).toContain("22:35 (hora de Córdoba");
  });

  it("otras zonas: nombre con tildes y desfase con minutos", () => {
    expect(zoneLabel("America/Argentina/Buenos_Aires")).toBe("hora de Buenos Aires");
    expect(zoneLabel("America/Mexico_City")).toBe("hora de Ciudad de México");
    expect(zoneLabel("UTC")).toBe("hora UTC");
    expect(utcOffsetLabel("Asia/Kolkata", new Date("2026-11-04T01:35:00Z"))).toBe("UTC+5:30");
    expect(utcOffsetLabel("UTC", new Date("2026-11-04T01:35:00Z"))).toBe("UTC");
  });
});

describe("la hora llega a los prompts", () => {
  const at = new Date("2026-11-01T01:55:00Z");
  const profile = {
    id: "agp_1",
    organizationId: "org_1",
    enabled: true,
    name: "Camila",
    tone: null,
    instructions: "Ingresos para hoy: de 17 a 22 una regla, después de las 22 otra.",
    escalationRules: null,
    greeting: null,
    followUpTimezone: CBA,
  } as unknown as Parameters<typeof buildAgentSystemPrompt>[0]["profile"];

  it("agente: sección FECHA Y HORA después de las instrucciones del negocio", () => {
    const prompt = buildAgentSystemPrompt({ profile, kb: [], stages: [], clock: clockSection(at, CBA) });
    expect(prompt).toContain(`${CLOCK_MARKER}: Ahora: sábado 31/10/2026, 22:55 (hora de Córdoba, UTC−3).`);
    expect(prompt.indexOf(CLOCK_MARKER)).toBeGreaterThan(prompt.indexOf("Instrucciones del negocio"));
    expect(prompt).toContain("«en un momento»");
  });

  it("sin reloj el prompt no cambia", () => {
    expect(buildAgentSystemPrompt({ profile, kb: [], stages: [] })).not.toContain(CLOCK_MARKER);
  });

  it("seguimiento: la línea va después del marcador (que abre el prompt)", () => {
    const prompt = buildFollowUpPrompt({
      profile,
      step: 1,
      greetingName: null,
      fallback: "¡Hola! ¿Pudiste verlo?",
      now: nowLine(at, CBA),
    });
    expect(prompt.split("\n")[1]).toBe("Ahora: sábado 31/10/2026, 22:55 (hora de Córdoba, UTC−3).");
  });

  it("Entrenador: la hora para convertir «mañana» en una fecha", () => {
    const prompt = buildTrainerSystemPrompt({ profile, kb: [], kbChars: 0, warnAt: 10_000, now: nowLine(at, CBA) });
    expect(prompt).toContain("Ahora: sábado 31/10/2026, 22:55");
  });

  it("ai-mock: «¿qué hora es?» devuelve la hora que recibió", () => {
    const system = buildAgentSystemPrompt({ profile, kb: [], stages: [], clock: clockSection(at, CBA) });
    const raw = aiMockCompletion([
      { role: "system", content: system },
      { role: "user", content: "Hola, ¿qué hora es?" },
    ]);
    expect(JSON.parse(raw)).toEqual({
      action: "reply",
      text: "Según mi reloj: sábado 31/10/2026, 22:55 (hora de Córdoba, UTC−3).",
    });
  });
});
