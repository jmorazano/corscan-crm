import { describe, expect, it } from "vitest";
import { AgentAction, degradeAction } from "@/server/ai/actions";
import { buildFollowUpPrompt, FOLLOW_UP_MARKER, guardFollowUpText } from "@/server/ai/follow-up";
import { buildAgentSystemPrompt, FOLLOW_UP_SECTION_MARKER } from "@/server/ai/prompts";
import { followUpSettingsSchema } from "@/server/follow-up/settings";
import { csvCell } from "@/lib/follow-up";
import { aiMockCompletion } from "@/server/dev/ai-mock";

/** 042: la marca del agente, el turno que redacta y la configuración. */

const profile = {
  id: "agp_1",
  organizationId: "org_1",
  enabled: true,
  name: "Giuliana",
  tone: null,
  instructions: null,
  escalationRules: null,
  greeting: null,
  replyDelayMs: null,
  teamSilenceMs: null,
  sharedPersonalNumber: false,
  readVideos: false,
  followUpEnabled: true,
  followUpTimezone: "America/Argentina/Cordoba",
  followUpStartHour: 9,
  followUpEndHour: 21,
  followUpText1: null,
  followUpText2: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("contrato: awaiting_reply y opt_out", () => {
  it("viajan con reply, update_lead y move_stage", () => {
    expect(AgentAction.parse({ action: "reply", text: "hola", awaiting_reply: true })).toMatchObject({
      awaiting_reply: true,
    });
    expect(AgentAction.parse({ action: "update_lead", note: "x", awaiting_reply: false, opt_out: true })).toMatchObject({
      awaiting_reply: false,
      opt_out: true,
    });
    expect(AgentAction.parse({ action: "move_stage", stage: "Ganado", awaiting_reply: "no" })).toMatchObject({
      awaiting_reply: false,
    });
  });

  it("son laxas: un valor raro queda «sin marca» y no tumba el turno", () => {
    const parsed = AgentAction.parse({ action: "reply", text: "hola", awaiting_reply: "quizás", opt_out: {} });
    expect(parsed).toMatchObject({ action: "reply" });
    expect((parsed as { awaiting_reply?: boolean }).awaiting_reply).toBeUndefined();
    expect((parsed as { opt_out?: boolean }).opt_out).toBeUndefined();
    expect(AgentAction.parse({ action: "reply", text: "hola", awaiting_reply: "sí" })).toMatchObject({
      awaiting_reply: true,
    });
  });

  it("move_stage sin etapa válida degrada a reply conservando la marca", () => {
    const parsed = AgentAction.parse({ action: "move_stage", stage: "x", reply: "listo", awaiting_reply: true });
    expect(degradeAction(parsed)).toMatchObject({ action: "reply", text: "listo", awaiting_reply: true });
  });
});

describe("prompt del agente", () => {
  const base = { profile, kb: [], stages: [{ name: "Nuevo" }] };
  it("la sección y la marca solo con el seguimiento encendido", () => {
    const on = buildAgentSystemPrompt({ ...base, followUp: true });
    expect(on).toContain(FOLLOW_UP_SECTION_MARKER);
    expect(on).toContain('"awaiting_reply":true|false');
    const off = buildAgentSystemPrompt({ ...base, followUp: false });
    expect(off).not.toContain(FOLLOW_UP_SECTION_MARKER);
    expect(off).not.toContain("awaiting_reply");
  });
});

describe("turno que redacta el seguimiento", () => {
  it("arranca con el marcador y dice qué paso es", () => {
    const p = buildFollowUpPrompt({ profile, step: 2, greetingName: "Juan", fallback: "¡Hola, Juan!" });
    expect(p.startsWith(FOLLOW_UP_MARKER)).toBe(true);
    expect(p).toContain("seguimiento 2 de 2");
    expect(p).toContain("Saludalo por su nombre: Juan.");
  });

  const ctx = { corpus: "Mirá https://altos.com/cabana-1 y escribime", contactPhone: "5493515550000", lastOutboundText: "Te paso opciones" };
  it("deja pasar un recordatorio limpio", () => {
    expect(guardFollowUpText("¡Hola, Juan! ¿Pudiste ver las opciones?", ctx).text).toBe("¡Hola, Juan! ¿Pudiste ver las opciones?");
    expect(guardFollowUpText("¿Viste la cabaña? https://altos.com/cabana-1", ctx).text).not.toBeNull();
  });
  it.each([
    ["un importe", "¡Hola! La cabaña sale $85.000 la noche."],
    ["un enlace inventado", "¡Hola! Reservá en https://otro-sitio.com/promo"],
    ["un teléfono ajeno", "¡Hola! Llamá al 351 444 5566 y te atienden."],
    ["una promesa de reserva", "¡Hola! Ya te reservé la cabaña para el finde."],
    ["repetir el último mensaje", "Te paso opciones"],
    ["vacío", "   "],
  ])("a respaldo si trae %s", (_why, text) => {
    expect(guardFollowUpText(text, ctx).text).toBeNull();
  });
  it("demasiado largo → respaldo", () => {
    expect(guardFollowUpText("a".repeat(401), ctx).text).toBeNull();
  });
});

describe("ai-mock", () => {
  it("marca las respuestas con la sección encendida", () => {
    const system = buildAgentSystemPrompt({ profile, kb: [], stages: [{ name: "Nuevo" }], followUp: true });
    const out = JSON.parse(aiMockCompletion([{ role: "system", content: system }, { role: "user", content: "Hola" }]));
    expect(out).toMatchObject({ action: "reply", awaiting_reply: true });
    const optOut = JSON.parse(
      aiMockCompletion([{ role: "system", content: system }, { role: "user", content: "[E2E_NO_INTERESA] no me interesa" }])
    );
    expect(optOut).toMatchObject({ opt_out: true, awaiting_reply: false });
  });
  it("redacta el seguimiento con el nombre", () => {
    const system = buildFollowUpPrompt({ profile, step: 1, greetingName: "Juan", fallback: "x" });
    const out = JSON.parse(aiMockCompletion([{ role: "system", content: system }, { role: "user", content: "Hola" }]));
    expect(out.text).toContain("¡Hola, Juan!");
  });
});

describe("configuración", () => {
  it("valida horas y zona", () => {
    expect(followUpSettingsSchema.parse({ startHour: 9, endHour: 21, timezone: "America/Argentina/Cordoba" })).toBeTruthy();
    expect(() => followUpSettingsSchema.parse({ timezone: "Marte/Olympus" })).toThrow();
    expect(() => followUpSettingsSchema.parse({ startHour: 25 })).toThrow();
    expect(() => followUpSettingsSchema.parse({ extra: true })).toThrow();
  });
  it("un texto vacío vuelve al del CRM (null)", () => {
    expect(followUpSettingsSchema.parse({ text1: "  " }).text1).toBeNull();
    expect(followUpSettingsSchema.parse({}).text1).toBeUndefined();
  });
});

describe("csvCell", () => {
  it("comillas y fórmulas como texto", () => {
    expect(csvCell('dijo "hola", chau')).toBe('"dijo ""hola"", chau"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-12,5")).toBe('"-12,5"');
    expect(csvCell(null)).toBe("");
  });
});
