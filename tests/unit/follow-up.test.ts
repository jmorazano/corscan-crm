import { describe, expect, it } from "vitest";
import {
  allowedSlot,
  fallbackText,
  followUpDecision,
  greetingName,
  matchesRefusal,
  type FollowUpMessage,
  type FollowUpRecord,
  type FollowUpSnapshot,
} from "@/lib/follow-up";

/**
 * 042: los casos de prueba del documento de Altos de Calamuchita
 * («Seguimiento automático de conversaciones», 24-oct-2026), sobre la
 * decisión pura. Hora de Córdoba = UTC−3, sin horario de verano.
 */
const TZ = "America/Argentina/Cordoba";
const config = { timezone: TZ, startHour: 9, endHour: 21 };

/** Instante local de Córdoba del 20-oct-2026 (+ días). */
function ar(hour: number, minute = 0, day = 0): Date {
  return new Date(Date.UTC(2026, 9, 20 + day, hour + 3, minute));
}

let seq = 0;
function msg(partial: Partial<FollowUpMessage> & Pick<FollowUpMessage, "direction" | "createdAt">): FollowUpMessage {
  seq++;
  return {
    id: `msg_${seq}`,
    type: "text",
    text: partial.direction === "in" ? "Hola, ¿tienen lugar?" : "Te paso opciones",
    aiGenerated: partial.direction === "out",
    sentByUserId: null,
    source: partial.direction === "out" ? "cloud" : null,
    details: null,
    ...partial,
  };
}

function customer(at: Date, text = "Hola, ¿tienen lugar para el finde?"): FollowUpMessage {
  return msg({ direction: "in", createdAt: at, text });
}
function agent(at: Date, ...mark: [boolean | undefined] | []): FollowUpMessage {
  const awaitingReply = mark.length === 0 ? true : mark[0];
  return msg({
    direction: "out",
    createdAt: at,
    details: awaitingReply === undefined ? null : { awaitingReply },
  });
}
function followUp(at: Date, step: number): FollowUpMessage {
  return msg({ direction: "out", createdAt: at, details: { followUp: { step } } });
}

function snapshot(over: Partial<FollowUpSnapshot> & Pick<FollowUpSnapshot, "now" | "messages">): FollowUpSnapshot {
  return {
    config,
    records: [],
    stageKind: "open",
    optedOut: false,
    aiActive: true,
    ...over,
  };
}

describe("followUpDecision — casos del documento", () => {
  it("1: pide fechas y el cliente no contesta → el 1 a las 2 h y el 2 a las 20 h", () => {
    const c = customer(ar(10));
    const a = agent(ar(10, 1));
    const messages = [c, a];
    expect(followUpDecision(snapshot({ now: ar(11), messages }))).toMatchObject({
      kind: "wait",
      step: 1,
      until: ar(12, 1),
    });
    expect(followUpDecision(snapshot({ now: ar(12, 2), messages }))).toEqual({
      kind: "send",
      step: 1,
      cycleMessageId: c.id,
    });
    const f1 = followUp(ar(12, 2), 1);
    const records: FollowUpRecord[] = [{ step: 1, status: "sent", sentAt: ar(12, 2) }];
    expect(followUpDecision(snapshot({ now: ar(20), messages: [...messages, f1], records }))).toMatchObject({
      kind: "wait",
      step: 2,
      until: ar(9, 0, 1), // 20 h desde las 10:00 = 06:00 → fuera de horario → 09:00
    });
  });

  it("1 (bis): si el 2 cae fuera de horario espera la apertura dentro de la ventana", () => {
    const c = customer(ar(10));
    const messages = [c, agent(ar(10, 1)), followUp(ar(12, 2), 1)];
    const records: FollowUpRecord[] = [{ step: 1, status: "sent", sentAt: ar(12, 2) }];
    // 06:00 del día siguiente → 09:00, y la ventana cierra a las 10:00.
    expect(followUpDecision(snapshot({ now: ar(6, 0, 1), messages, records }))).toMatchObject({
      kind: "wait",
      step: 2,
      until: ar(9, 0, 1),
    });
    expect(followUpDecision(snapshot({ now: ar(9, 0, 1), messages, records }))).toMatchObject({
      kind: "send",
      step: 2,
    });
  });

  it("2: reservó y el lead está en una etapa ganada → nada", () => {
    const messages = [customer(ar(10), "Listo, reservo"), agent(ar(10, 1), false)];
    expect(followUpDecision(snapshot({ now: ar(13), messages, stageKind: "won" }))).toMatchObject({
      kind: "skip",
      reason: "stage_closed",
    });
  });

  it("3: dado de baja → nada", () => {
    const messages = [customer(ar(10), "No me interesa, no me escribas más"), agent(ar(10, 1), false)];
    expect(followUpDecision(snapshot({ now: ar(13), messages, optedOut: true }))).toMatchObject({
      kind: "skip",
      reason: "opted_out",
    });
  });

  it("4: pasó precio y el cliente dijo «lo pienso» → sale el 1", () => {
    const messages = [customer(ar(10), "Lo pienso"), agent(ar(10, 1), true)];
    expect(followUpDecision(snapshot({ now: ar(12, 5), messages }))).toMatchObject({ kind: "send", step: 1 });
  });

  it("5: el cliente contesta después del 1 → ciclo nuevo, el 2 no sale", () => {
    const messages = [
      customer(ar(10)),
      agent(ar(10, 1)),
      followUp(ar(12, 2), 1),
      customer(ar(12, 30), "Gracias, después te escribo"),
      agent(ar(12, 31), false),
    ];
    // Los registros del ciclo NUEVO están vacíos; el agente no marcó espera.
    expect(followUpDecision(snapshot({ now: ar(20), messages }))).toMatchObject({
      kind: "skip",
      step: 1,
      reason: "not_awaiting",
      cycleMessageId: messages[3]!.id,
    });
  });

  it("6: una persona del equipo respondió → nada", () => {
    const messages = [
      customer(ar(10)),
      agent(ar(10, 1)),
      msg({ direction: "out", createdAt: ar(10, 30), aiGenerated: false, sentByUserId: "usr_1" }),
    ];
    expect(followUpDecision(snapshot({ now: ar(13), messages }))).toMatchObject({ kind: "skip", reason: "team" });
    const echo = [customer(ar(10)), agent(ar(10, 1)), msg({ direction: "out", createdAt: ar(10, 30), aiGenerated: false, source: "phone" })];
    expect(followUpDecision(snapshot({ now: ar(13), messages: echo }))).toMatchObject({ kind: "skip", reason: "team" });
  });

  it("7: el 1 vence a las 23:30 → sale a las 09:00 si sigue la ventana", () => {
    const messages = [customer(ar(21, 29)), agent(ar(21, 30))];
    expect(followUpDecision(snapshot({ now: ar(23, 30), messages }))).toMatchObject({
      kind: "wait",
      step: 1,
      until: ar(9, 0, 1),
    });
  });

  it("8: el 2 caería a las 02:00 y no queda horario dentro de la ventana → se omite", () => {
    // Cliente 06:00 → ventana hasta las 06:00 del día siguiente; el 2 a las
    // 02:00 y la apertura es a las 09:00: no hay hueco.
    const messages = [customer(ar(6)), agent(ar(6, 1)), followUp(ar(9), 1)];
    const records: FollowUpRecord[] = [{ step: 1, status: "sent", sentAt: ar(9) }];
    expect(followUpDecision(snapshot({ now: ar(22), messages, records }))).toMatchObject({
      kind: "skip",
      step: 2,
      reason: "no_slot",
    });
  });

  it("9: respuesta del agente sin marca → nada", () => {
    const messages = [customer(ar(10)), agent(ar(10, 1), undefined)];
    expect(followUpDecision(snapshot({ now: ar(13), messages }))).toMatchObject({ kind: "skip", reason: "unmarked" });
  });

  it("10: «basta, stop» sin que el agente marque baja → el filtro frena", () => {
    const messages = [customer(ar(10), "basta, stop"), agent(ar(10, 1), true)];
    expect(followUpDecision(snapshot({ now: ar(13), messages }))).toMatchObject({ kind: "skip", reason: "refusal" });
  });

  it("11: pasaron más de 24 h → nunca texto libre", () => {
    const messages = [customer(ar(10)), agent(ar(10, 1))];
    expect(followUpDecision(snapshot({ now: ar(10, 30, 1), messages }))).toMatchObject({
      kind: "skip",
      reason: "no_slot",
    });
  });

  it("13: un 1 ya registrado (enviado por otra réplica o antes del reinicio) no se repite", () => {
    const messages = [customer(ar(10)), agent(ar(10, 1))];
    const reserved: FollowUpRecord[] = [{ step: 1, status: "reserved", sentAt: null }];
    expect(followUpDecision(snapshot({ now: ar(13), messages, records: reserved }))).toEqual({ kind: "done" });
  });

  it("14: un 1 fallido no se reintenta ni habilita el 2", () => {
    const messages = [customer(ar(10)), agent(ar(10, 1))];
    const failed: FollowUpRecord[] = [{ step: 1, status: "failed", sentAt: null }];
    expect(followUpDecision(snapshot({ now: ar(20), messages, records: failed }))).toEqual({ kind: "done" });
  });
});

describe("followUpDecision — guardas", () => {
  it("sin respuesta del agente todavía → su turno decide", () => {
    expect(followUpDecision(snapshot({ now: ar(13), messages: [customer(ar(10))] }))).toEqual({ kind: "done" });
  });

  it("espera a que el turno del agente se asiente", () => {
    const messages = [customer(ar(10)), agent(ar(10, 1), undefined)];
    expect(followUpDecision(snapshot({ now: ar(10, 2), messages }))).toEqual({ kind: "done" });
  });

  it("lo último lo mandó una campaña o la API → no es del agente", () => {
    const messages = [customer(ar(10)), msg({ direction: "out", createdAt: ar(10, 1), aiGenerated: false })];
    expect(followUpDecision(snapshot({ now: ar(13), messages }))).toMatchObject({ kind: "skip", reason: "not_agent" });
  });

  it("IA pausada o en atención humana → nada", () => {
    const messages = [customer(ar(10)), agent(ar(10, 1))];
    expect(followUpDecision(snapshot({ now: ar(13), messages, aiActive: false }))).toMatchObject({
      kind: "skip",
      reason: "ai_off",
    });
  });

  it("una reacción del cliente no abre un ciclo nuevo", () => {
    const c = customer(ar(10));
    const messages = [c, agent(ar(10, 1)), msg({ direction: "in", type: "reaction", createdAt: ar(10, 5), text: "👍" })];
    expect(followUpDecision(snapshot({ now: ar(12, 5), messages }))).toMatchObject({
      kind: "send",
      cycleMessageId: c.id,
    });
  });

  it("el 2 espera 3 h después del 1 aunque ya pasaron 20 h", () => {
    const messages = [customer(ar(9)), agent(ar(9, 1)), followUp(ar(4, 0, 1), 1)];
    const records: FollowUpRecord[] = [{ step: 1, status: "sent", sentAt: ar(4, 0, 1) }];
    // 20 h = 05:00; 1 + 3 h = 07:00 → fuera de horario → 09:00 (cierra 09:00 − margen): no hay hueco.
    expect(followUpDecision(snapshot({ now: ar(5, 0, 1), messages, records }))).toMatchObject({
      kind: "skip",
      reason: "no_slot",
    });
  });
});

describe("allowedSlot", () => {
  it("dentro del horario devuelve el mismo instante", () => {
    expect(allowedSlot(ar(15), TZ, 9, 21)).toEqual(ar(15));
  });
  it("antes de la apertura → la apertura del mismo día", () => {
    expect(allowedSlot(ar(7, 30), TZ, 9, 21)).toEqual(ar(9));
  });
  it("después del cierre (fin excluido) → la apertura del día siguiente", () => {
    expect(allowedSlot(ar(21), TZ, 9, 21)).toEqual(ar(9, 0, 1));
    expect(allowedSlot(ar(23, 59), TZ, 9, 21)).toEqual(ar(9, 0, 1));
  });
  it("horario inválido → ningún hueco", () => {
    expect(allowedSlot(ar(10), TZ, 21, 9).getTime()).toBeGreaterThan(ar(10, 0, 300).getTime());
  });
});

describe("matchesRefusal", () => {
  it.each([
    "no me interesa",
    "No me escribas más por favor",
    "Dejen de escribirme",
    "BASTA",
    "stop!!",
    "baja por favor",
    "Quiero que me den de baja",
    "sacame de la lista",
    "es spam",
    "No me molestés", // con tilde
  ])("frena: %s", (text) => {
    expect(matchesRefusal(text)).toBe(true);
  });

  it.each([
    "me gusta bastante",
    "¿baja el precio si voy entre semana?",
    "¿Stop en el camino?",
    "Hola, ¿tienen lugar del 3 al 5?",
    "la cabaña baja tiene pileta, la otra no y quería saber",
    "",
  ])("no frena: %s", (text) => {
    expect(matchesRefusal(text)).toBe(false);
  });
});

describe("greetingName", () => {
  it.each([
    ["juan pérez", "Juan"],
    ["MARÍA JOSÉ", "María"],
    ["ana-laura", "Ana-Laura"],
  ])("%s → %s", (input, expected) => {
    expect(greetingName(input)).toBe(expected);
  });

  it.each(["🌸🌸", "+54 9 351 555", "Familia Gómez", "Cabañas del Sol", "J", null, ""])("sin nombre: %s", (input) => {
    expect(greetingName(input)).toBeNull();
  });
});

describe("fallbackText", () => {
  it("usa el nombre o deja «¡Hola!»", () => {
    expect(fallbackText(1, "Juan", "¡Hola, {nombre}! ¿Seguís buscando?")).toBe("¡Hola, Juan! ¿Seguís buscando?");
    expect(fallbackText(1, null, "¡Hola, {nombre}! ¿Seguís buscando?")).toBe("¡Hola! ¿Seguís buscando?");
  });
  it("sin texto propio usa el del CRM", () => {
    expect(fallbackText(2, null, null)).toMatch(/^¡Hola! Te dejo por acá el contacto/);
  });
});
