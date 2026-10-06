import { describe, expect, it } from "vitest";
import {
  clipReason,
  eventText,
  friendlyProviderError,
  friendlySendError,
  friendlyToolFailure,
  shouldSkipSilence,
} from "@/lib/conversation-events";
import { announcesLookup } from "@/lib/lookup-promise";

/** 031: las líneas grises del hilo y las promesas vacías. */
const hhmm = (iso: string) => iso.slice(11, 16);

describe("eventText", () => {
  it("quién prendió o apagó la IA", () => {
    expect(eventText({ kind: "ai_toggled", reason: "paused", actorName: "Juan", details: null }, hhmm).text).toBe(
      "Juan pausó la IA en este chat"
    );
    expect(eventText({ kind: "ai_toggled", reason: "enabled", actorName: null, details: null }, hhmm).text).toBe(
      "Alguien del equipo activó la IA en este chat"
    );
    expect(eventText({ kind: "ai_toggled", reason: "reactivated", actorName: "Ana", details: null }, hhmm).text).toContain(
      "reactivó la IA"
    );
  });

  it("silencio con hora de vuelta", () => {
    const { text, tone } = eventText(
      { kind: "ai_silent", reason: "team_active", actorName: null, details: { until: "2026-10-06T10:42:00Z" } },
      hhmm
    );
    expect(text).toBe(
      "La IA no respondió: alguien del equipo está atendiendo. Vuelve a responder si el cliente escribe desde las 10:42."
    );
    expect(tone).toBe("neutral");
  });

  it("atención humana con su motivo, y decidió no responder con el porqué", () => {
    expect(
      eventText({ kind: "ai_silent", reason: "handoff", actorName: null, details: { handoffReason: "modelo", minutes: 10 } }, hhmm).text
    ).toBe(
      "La IA no respondió: la conversación está en atención humana (el agente decidió derivar). Vuelve sola 10 min después de que alguien del equipo responda."
    );
    expect(eventText({ kind: "ai_silent", reason: "paused", actorName: null, details: null }, hhmm).text).toBe(
      "La IA no respondió: está pausada en este chat. Vuelve cuando alguien la prenda."
    );
    expect(
      eventText({ kind: "ai_silent", reason: "no_reply_needed", actorName: null, details: { detail: "solo agradeció" } }, hhmm)
        .text
    ).toBe("La IA leyó el mensaje y decidió no responder: solo agradeció");
  });

  it("errores en criollo", () => {
    expect(
      eventText(
        { kind: "ai_handoff", reason: "error", actorName: null, details: { detail: friendlyProviderError({ error: "provider_error", status: 402 }) } },
        hhmm
      )
    ).toEqual({
      text: "La IA no pudo responder: OpenRouter no tiene crédito suficiente (cargá saldo en openrouter.ai). Pasó a atención humana.",
      tone: "error",
    });
    expect(
      eventText({ kind: "ai_error", reason: "tool", actorName: null, details: { detail: friendlyToolFailure("timeout") } }, hhmm).text
    ).toBe("El sistema de reservas no respondió: tardó demasiado en contestar.");
    expect(
      eventText({ kind: "ai_error", reason: "send", actorName: null, details: { detail: friendlySendError("meta_unavailable", "x") } }, hhmm)
        .text
    ).toBe("La respuesta de la IA no salió: Meta no está disponible ahora.");
  });
});

describe("friendlyProviderError", () => {
  it.each([
    [{ error: "provider_error", status: 402 }, /crédito/],
    [{ error: "provider_error", status: 401 }, /token/],
    [{ error: "provider_error", status: 404 }, /modelo/],
    [{ error: "provider_error", status: 429 }, /limitó/],
    [{ error: "provider_error", status: 503 }, /no respondió/],
    [{ error: "provider_error" }, /no respondió/],
    [{ error: "invalid_output" }, /no se pudo leer/],
  ])("%o", (input, re) => {
    expect(friendlyProviderError(input)).toMatch(re);
  });
});

describe("shouldSkipSilence", () => {
  const t = (iso: string) => new Date(iso);
  it("mismo silencio sin que la IA hable en el medio → no repite", () => {
    expect(shouldSkipSilence({ kind: "ai_silent", reason: "paused", createdAt: t("2026-10-06T10:00Z") }, "paused", null)).toBe(true);
    expect(
      shouldSkipSilence({ kind: "ai_silent", reason: "paused", createdAt: t("2026-10-06T10:00Z") }, "paused", t("2026-10-06T09:00Z"))
    ).toBe(true);
  });
  it("la IA habló después, cambió el motivo u otro evento → nueva línea", () => {
    expect(
      shouldSkipSilence({ kind: "ai_silent", reason: "paused", createdAt: t("2026-10-06T10:00Z") }, "paused", t("2026-10-06T10:05Z"))
    ).toBe(false);
    expect(shouldSkipSilence({ kind: "ai_silent", reason: "paused", createdAt: t("2026-10-06T10:00Z") }, "team_active", null)).toBe(false);
    expect(shouldSkipSilence({ kind: "ai_resumed", reason: "paused", createdAt: t("2026-10-06T10:00Z") }, "paused", null)).toBe(false);
    expect(shouldSkipSilence(null, "paused", null)).toBe(false);
  });
});

describe("announcesLookup (promesas vacías)", () => {
  it.each([
    "Gracias, Agustina. Busco opciones disponibles para 10 personas, del 27 al 29 de noviembre de 2026.",
    "Dejame consultar la disponibilidad.",
    "Ya te confirmo.",
    "Perfecto, en un ratito te paso las opciones.",
    "Estoy revisando las cabañas libres.",
    "Me fijo y te digo.",
  ])("promete: %s", (text) => {
    expect(announcesLookup(text)).toBe(true);
  });

  it.each([
    "Me queda esta opción disponible: https://altosdecalamuchita.com/alquiler/casa",
    "¿Querés que busque otras fechas?",
    "Si querés, busco para otro fin de semana.",
    "Para esas fechas no hay disponibilidad. ¿Probamos otras?",
    "¡Hola! Soy Giuliana. ¿Me decís tu nombre?",
    "",
  ])("no promete: %s", (text) => {
    expect(announcesLookup(text)).toBe(false);
  });
});

describe("clipReason", () => {
  it("motivos vacíos o de código no se muestran; los largos se recortan", () => {
    expect(clipReason("modelo")).toBeUndefined();
    expect(clipReason("  ")).toBeUndefined();
    expect(clipReason("el cliente mandó el comprobante")).toBe("el cliente mandó el comprobante");
    expect(clipReason("x".repeat(200))?.length).toBe(140);
  });
});
