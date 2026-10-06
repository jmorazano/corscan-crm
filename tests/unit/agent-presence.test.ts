import { describe, expect, it } from "vitest";
import {
  agentPresence,
  isTeamMessage,
  presenceHint,
  resolveTeamSilenceMs,
  TEAM_SILENCE_DEFAULT_MS,
  TEAM_SILENCE_MAX_MS,
  teamSilenceMinutesToMs,
} from "@/lib/agent-presence";

/**
 * 031 (decisión del dueño, 6-oct-2026): el equipo escribiendo calla al agente
 * N minutos; el switch apagado dura hasta que lo prendan; la atención humana
 * espera a que una persona responda y, vencida la ventana desde ahí, retoma.
 */
const MIN = 60_000;
const now = new Date("2026-10-06T13:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const base = {
  aiEnabled: true,
  handoffAt: null,
  lastTeamAt: null,
  now,
  windowMs: 10 * MIN,
};

describe("isTeamMessage", () => {
  it("CRM con autor, celular e historial son el equipo", () => {
    expect(isTeamMessage({ direction: "out", aiGenerated: false, source: "cloud", sentByUserId: "u1" })).toBe(true);
    expect(isTeamMessage({ direction: "out", aiGenerated: false, source: "phone", sentByUserId: null })).toBe(true);
    expect(isTeamMessage({ direction: "out", aiGenerated: false, source: "history", sentByUserId: null })).toBe(true);
  });
  it("la IA, campañas/API/automatismos (sin autor) y los entrantes no", () => {
    expect(isTeamMessage({ direction: "out", aiGenerated: true, source: "cloud", sentByUserId: null })).toBe(false);
    expect(isTeamMessage({ direction: "out", aiGenerated: false, source: "cloud", sentByUserId: null })).toBe(false);
    expect(isTeamMessage({ direction: "in", aiGenerated: false, source: "cloud", sentByUserId: null })).toBe(false);
  });
});

describe("agentPresence", () => {
  it("sin equipo, pausa ni derivación → responde", () => {
    expect(agentPresence(base)).toEqual({ silent: false, resumed: null });
  });

  it("el equipo escribió hace 3 min → se calla hasta los 10", () => {
    expect(agentPresence({ ...base, lastTeamAt: ago(3 * MIN) })).toEqual({
      silent: true,
      reason: "team_active",
      until: new Date(now.getTime() + 7 * MIN),
    });
  });

  it("el equipo escribió hace 10 min → vuelve (el límite es exclusivo)", () => {
    expect(agentPresence({ ...base, lastTeamAt: ago(10 * MIN) })).toEqual({ silent: false, resumed: null });
  });

  it("switch apagado → no vence nunca, aunque nadie escriba en días", () => {
    expect(agentPresence({ ...base, aiEnabled: false })).toEqual({ silent: true, reason: "paused", until: null });
    expect(agentPresence({ ...base, aiEnabled: false, lastTeamAt: ago(3 * 24 * 60 * MIN) })).toEqual({
      silent: true,
      reason: "paused",
      until: null,
    });
  });

  it("atención humana sin que nadie del equipo responda → espera a una persona, aunque pasen horas", () => {
    expect(agentPresence({ ...base, handoffAt: ago(9 * 60 * MIN) })).toEqual({ silent: true, reason: "handoff", until: null });
    // Un mensaje del equipo ANTERIOR a la derivación no cuenta como haberla atendido.
    expect(agentPresence({ ...base, handoffAt: ago(60 * MIN), lastTeamAt: ago(61 * MIN) })).toMatchObject({
      reason: "handoff",
      until: null,
    });
  });

  it("atención humana atendida: el equipo respondió hace poco → se calla hasta la ventana", () => {
    expect(agentPresence({ ...base, handoffAt: ago(30 * MIN), lastTeamAt: ago(2 * MIN) })).toEqual({
      silent: true,
      reason: "team_active",
      until: new Date(now.getTime() + 8 * MIN),
    });
  });

  it("atención humana atendida y vencida → retoma y avisa para limpiarla (caso Guillermo)", () => {
    expect(agentPresence({ ...base, handoffAt: ago(10 * 60 * MIN), lastTeamAt: ago(9 * 60 * MIN) })).toEqual({
      silent: false,
      resumed: "handoff",
    });
  });
});

describe("presenceHint (panel)", () => {
  it("respondiendo o pausada → null (eso ya lo dice el switch)", () => {
    expect(presenceHint(base, now)).toBeNull();
    expect(presenceHint({ ...base, aiEnabled: false }, now)).toBeNull();
  });
  it("equipo escribiendo → hora de vuelta; atención humana sin respuesta → necesita una persona", () => {
    expect(presenceHint({ ...base, lastTeamAt: ago(2 * MIN) }, now)).toEqual({
      kind: "until",
      at: new Date(now.getTime() + 8 * MIN),
    });
    expect(presenceHint({ ...base, handoffAt: ago(MIN) }, now)).toEqual({ kind: "needs_person", minutes: 10 });
  });
  it("atención humana atendida y vencida → vuelve con el próximo mensaje", () => {
    expect(presenceHint({ ...base, handoffAt: ago(60 * MIN), lastTeamAt: ago(30 * MIN) }, now)).toEqual({
      kind: "next_message",
    });
  });
});

describe("ventana por empresa", () => {
  it("NULL o corrupto → 10 min; fuera de rango se acota", () => {
    expect(resolveTeamSilenceMs(null)).toBe(TEAM_SILENCE_DEFAULT_MS);
    expect(resolveTeamSilenceMs(Number.NaN)).toBe(TEAM_SILENCE_DEFAULT_MS);
    expect(resolveTeamSilenceMs(10)).toBe(MIN);
    expect(resolveTeamSilenceMs(10 ** 12)).toBe(TEAM_SILENCE_MAX_MS);
  });
  it("minutos de la UI → ms", () => {
    expect(teamSilenceMinutesToMs("")).toBeNull();
    expect(teamSilenceMinutesToMs("15")).toBe(15 * MIN);
    expect(teamSilenceMinutesToMs("0")).toBe("invalid");
    expect(teamSilenceMinutesToMs("2000")).toBe("invalid");
    expect(teamSilenceMinutesToMs("1.5")).toBe("invalid");
  });
});
