import { describe, expect, it } from "vitest";
import {
  AGENT_GRACE_MS,
  ATTENTION_WINDOW_MS,
  alertDue,
  attentionSettingsInput,
  closeWait,
  formatAgo,
  isLate,
  median,
  needsPerson,
  needsReview,
  opensWaitOnInbound,
  pushStatusText,
  summarizeTeamAttention,
  type OutgoingForWait,
  type WaitForSummary,
} from "@/lib/team-attention";

const MIN = 60_000;
const T0 = new Date("2026-11-02T13:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * MIN);

const conv = {
  isTest: false,
  kind: "whatsapp",
  handoffAt: null as Date | null,
  handoffReason: null as string | null,
  aiEnabled: true,
};
const inbound = { direction: "in", type: "text" };

function out(minutes: number, over: Partial<OutgoingForWait> = {}): OutgoingForWait {
  return {
    createdAt: at(minutes),
    aiGenerated: false,
    sentByUserId: "u_lucia",
    sentByName: "Lucía",
    source: "cloud",
    status: "sent",
    broadcast: false,
    ...over,
  };
}

describe("needsPerson / opensWaitOnInbound", () => {
  it("derivada → handoff; derivada por ventana → nada", () => {
    expect(needsPerson({ ...conv, handoffAt: T0, handoffReason: "cliente", agentEnabled: true })).toBe("handoff");
    expect(needsPerson({ ...conv, handoffAt: T0, handoffReason: "ventana", agentEnabled: true })).toBeNull();
  });

  it("IA apagada en la conversación o en la empresa → ai_off", () => {
    expect(needsPerson({ ...conv, aiEnabled: false, agentEnabled: true })).toBe("ai_off");
    expect(needsPerson({ ...conv, agentEnabled: false })).toBe("ai_off");
    expect(needsPerson({ ...conv, agentEnabled: true })).toBeNull();
  });

  it("abre con un mensaje del cliente en una conversación derivada", () => {
    const c = { ...conv, handoffAt: T0, handoffReason: "modelo" };
    expect(opensWaitOnInbound({ conversation: c, message: inbound, optedOut: null, agentEnabled: true })).toBe(
      "handoff"
    );
  });

  it("no abre: prueba, entrenador, reacción, baja por palabra clave", () => {
    const off = { ...conv, aiEnabled: false };
    const base = { message: inbound, optedOut: null, agentEnabled: true };
    expect(opensWaitOnInbound({ ...base, conversation: { ...off, isTest: true } })).toBeNull();
    expect(opensWaitOnInbound({ ...base, conversation: { ...off, kind: "trainer" } })).toBeNull();
    expect(
      opensWaitOnInbound({ ...base, conversation: off, message: { direction: "in", type: "reaction" } })
    ).toBeNull();
    expect(opensWaitOnInbound({ ...base, conversation: off, optedOut: { source: "keyword" } })).toBeNull();
    expect(opensWaitOnInbound({ ...base, conversation: off, optedOut: { source: null } })).toBeNull();
  });

  it("la baja que anotó el agente sí espera; Instagram también", () => {
    const off = { ...conv, aiEnabled: false };
    expect(
      opensWaitOnInbound({ conversation: off, message: inbound, optedOut: { source: "agent" }, agentEnabled: true })
    ).toBe("ai_off");
    expect(
      opensWaitOnInbound({
        conversation: { ...off, kind: "instagram" },
        message: inbound,
        optedOut: null,
        agentEnabled: true,
      })
    ).toBe("ai_off");
  });
});

describe("closeWait", () => {
  const handoff = { startedAt: T0, startReason: "handoff" as const };
  const aiOff = { startedAt: T0, startReason: "ai_off" as const };

  it("sigue abierta sin respuesta dentro de la ventana", () => {
    expect(closeWait(handoff, [], T0, at(30))).toEqual({ status: "open" });
  });

  it("respondida por una persona desde el CRM, con su demora", () => {
    const r = closeWait(handoff, [out(8)], T0, at(30));
    expect(r).toEqual({
      status: "answered",
      closedAt: at(8),
      responderUserId: "u_lucia",
      responderName: "Lucía",
      responderVia: "crm",
      responseMs: 8 * MIN,
    });
  });

  it("respondida desde el celular: sin persona", () => {
    const r = closeWait(aiOff, [out(3, { sentByUserId: null, sentByName: null, source: "phone" })], T0, at(5));
    expect(r).toMatchObject({ status: "answered", responderVia: "phone", responderUserId: null });
  });

  it("ignora difusiones, fallidos, historial y mensajes anteriores al inicio", () => {
    const msgs = [
      out(-1),
      out(2, { broadcast: true }),
      out(3, { status: "failed" }),
      out(4, { sentByUserId: null, source: "history" }),
      out(4, { sentByUserId: null, sentByName: null, source: "cloud" }), // campaña / API
    ];
    expect(closeWait(aiOff, msgs, T0, at(10))).toEqual({ status: "open" });
    expect(closeWait(aiOff, [...msgs, out(12)], T0, at(20))).toMatchObject({ status: "answered", responseMs: 12 * MIN });
  });

  it("el agente que retoma la cierra como agent", () => {
    const r = closeWait(handoff, [out(11, { aiGenerated: true, sentByUserId: null })], T0, at(20));
    expect(r).toEqual({ status: "agent", closedAt: at(11) });
  });

  it("la despedida del agente pegada a la derivación no la cierra", () => {
    const farewell = out(0, { aiGenerated: true, sentByUserId: null });
    farewell.createdAt = new Date(T0.getTime() + AGENT_GRACE_MS - 1);
    expect(closeWait(handoff, [farewell], T0, at(1))).toEqual({ status: "open" });
  });

  it("persona y agente en el mismo instante: gana la persona", () => {
    const r = closeWait(aiOff, [out(5, { aiGenerated: true, sentByUserId: null }), out(5)], T0, at(6));
    expect(r.status).toBe("answered");
  });

  it("vence justo a las 24 h del último mensaje del cliente", () => {
    const end = new Date(T0.getTime() + ATTENTION_WINDOW_MS);
    expect(closeWait(aiOff, [], T0, new Date(end.getTime() - 1))).toEqual({ status: "open" });
    expect(closeWait(aiOff, [], T0, end)).toEqual({ status: "expired", closedAt: end });
  });

  it("una respuesta después del cierre de la ventana no la rescata", () => {
    const late = out(24 * 60 + 5);
    expect(closeWait(aiOff, [late], T0, at(24 * 60 + 10))).toMatchObject({ status: "expired" });
  });
});

describe("aviso y «tarde»", () => {
  const settings = { alertEnabled: true, alertMinutes: 15 };
  const wait = { status: "open" as const, alertedAt: null, startedAt: T0 };

  it("vence a los minutos justos, una sola vez y solo encendido", () => {
    expect(alertDue(wait, settings, at(14))).toBe(false);
    expect(alertDue(wait, settings, at(15))).toBe(true);
    expect(alertDue({ ...wait, alertedAt: at(15) }, settings, at(20))).toBe(false);
    expect(alertDue({ ...wait, status: "answered" }, settings, at(20))).toBe(false);
    expect(alertDue(wait, { ...settings, alertEnabled: false }, at(20))).toBe(false);
  });

  it("justo los minutos = a tiempo", () => {
    expect(isLate(15 * MIN, 15)).toBe(false);
    expect(isLate(15 * MIN + 1, 15)).toBe(true);
  });

  it("valida los minutos 5–120", () => {
    expect(attentionSettingsInput.safeParse({ alertEnabled: true, alertMinutes: 4 }).success).toBe(false);
    expect(attentionSettingsInput.safeParse({ alertEnabled: true, alertMinutes: 121 }).success).toBe(false);
    expect(attentionSettingsInput.safeParse({ alertEnabled: false, alertMinutes: 5 }).success).toBe(true);
    expect(attentionSettingsInput.safeParse({ alertEnabled: true, alertMinutes: 7.5 }).success).toBe(false);
  });

  it("para revisar: tarde o sin respuesta", () => {
    expect(needsReview({ status: "expired", responseMs: null }, 15)).toBe(true);
    expect(needsReview({ status: "answered", responseMs: 30 * MIN }, 15)).toBe(true);
    expect(needsReview({ status: "answered", responseMs: 5 * MIN }, 15)).toBe(false);
    expect(needsReview({ status: "agent", responseMs: null }, 15)).toBe(false);
  });
});

describe("median", () => {
  it("impar, par y vacío", () => {
    expect(median([5, 2, 30])).toBe(5);
    expect(median([2, 5, 10, 30])).toBe(7.5);
    expect(median([])).toBeNull();
  });
});

describe("summarizeTeamAttention (las esperas del quickstart §2)", () => {
  const answered = (userId: string, name: string, minutes: number): WaitForSummary => ({
    status: "answered",
    responseMs: minutes * MIN,
    responderUserId: userId,
    responderName: name,
    responderVia: "crm",
  });
  const none = (status: "agent" | "expired" | "open"): WaitForSummary => ({
    status,
    responseMs: null,
    responderUserId: null,
    responderName: null,
    responderVia: null,
  });
  const waits = [
    answered("u_lucia", "Lucía", 2),
    answered("u_lucia", "Lucía", 5),
    answered("u_lucia", "Lucía", 30),
    answered("u_pedro", "Pedro", 10),
    none("agent"),
    none("expired"),
    none("open"),
  ];

  it("totales y medianas", () => {
    const { summary, byUser } = summarizeTeamAttention(waits, 15);
    expect(summary).toMatchObject({ total: 7, onTime: 3, late: 1, agent: 1, unanswered: 1, open: 1 });
    expect(summary.medianResponseMs).toBe(7.5 * MIN);
    expect(byUser.get("u_lucia")).toEqual({ name: "Lucía", answered: 3, late: 1, medianResponseMs: 5 * MIN });
    expect(byUser.get("u_pedro")).toEqual({ name: "Pedro", answered: 1, late: 0, medianResponseMs: 10 * MIN });
  });

  it("celular y plataforma van aparte, pero cuentan en el total del equipo", () => {
    const extra: WaitForSummary[] = [
      { status: "answered", responseMs: 4 * MIN, responderUserId: null, responderName: null, responderVia: "phone" },
      answered("u_admin", "Soporte", 1),
    ];
    const { summary, byUser } = summarizeTeamAttention([...waits, ...extra], 15, new Set(["u_admin"]));
    expect(summary.phone).toEqual({ answered: 1, medianResponseMs: 4 * MIN });
    expect(summary.platform).toEqual({ answered: 1 });
    expect(summary.onTime).toBe(5);
    expect(byUser.has("u_admin")).toBe(false);
  });
});

describe("textos", () => {
  it("formatAgo", () => {
    const now = at(0);
    expect(formatAgo(null, now)).toBe("nunca");
    expect(formatAgo(at(0).toISOString(), now)).toBe("hace instantes");
    expect(formatAgo(at(-5).toISOString(), now)).toBe("hace 5 min");
    expect(formatAgo(at(-180).toISOString(), now)).toBe("hace 3 h");
    expect(formatAgo(at(-3 * 24 * 60).toISOString(), now)).toBe("hace 3 días");
  });

  it("pushStatusText", () => {
    expect(pushStatusText({ devices: 0, modes: [] })).toBe("Sin avisos en ningún dispositivo");
    expect(pushStatusText({ devices: 1, modes: ["handoff"] })).toBe("1 dispositivo · solo derivaciones");
    expect(pushStatusText({ devices: 2, modes: ["handoff", "all"] })).toBe("2 dispositivos · todos los mensajes");
  });
});
