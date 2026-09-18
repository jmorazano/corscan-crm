import { describe, expect, it } from "vitest";
import { isPlainAcknowledgment } from "@/server/ai/acknowledgment";
import { transactionalContext } from "@/server/ai/pipeline";

/** 014 (FR-011, research D5a): acuse de recibo puro vs. pedido/pregunta. */
describe("isPlainAcknowledgment", () => {
  it.each([
    "Gracias!",
    "gracias",
    "Muchas gracias por avisar",
    "Ok dale",
    "OK",
    "Perfecto, gracias.",
    "Listo!! 👍",
    "👍",
    "🙏🙏",
    "Buenísimo, nos vemos!",
    "Recibido",
    "Dale, ahí estaremos",
    "Genial, mil gracias",
  ])("acuse: %s", (text) => {
    expect(isPlainAcknowledgment(text)).toBe(true);
  });

  it.each([
    "¿A qué hora es el check-in?",
    "a que hora es el check in",
    "Gracias! Una consulta: se puede llegar más tarde?",
    "No voy a poder ir",
    "Quiero cancelar la reserva",
    "Necesito la dirección",
    "ok pero no encuentro la cabaña",
    "Hola, me pasan el precio?",
  ])("NO es acuse: %s", (text) => {
    expect(isPlainAcknowledgment(text)).toBe(false);
  });

  it("sin texto (media) → false: que decida el modelo", () => {
    expect(isPlainAcknowledgment(null)).toBe(false);
    expect(isPlainAcknowledgment("")).toBe(false);
    expect(isPlainAcknowledgment("   ")).toBe(false);
  });
});

const api = (text: string) => ({
  direction: "out" as const,
  type: "template",
  text,
  apiKeyId: "ak_1",
});
const agent = (text: string) => ({
  direction: "out" as const,
  type: "text",
  text,
  apiKeyId: null,
});
const campaign = (text: string) => ({
  direction: "out" as const,
  type: "template",
  text,
  apiKeyId: null,
});
const inb = (text: string | null) => ({
  direction: "in" as const,
  type: text ? "text" : "image",
  text,
  apiKeyId: null,
});

describe("transactionalContext", () => {
  it("notificación por API + acuse → silencio", () => {
    const ctx = transactionalContext([api("Hola Ana, te esperamos el viernes"), inb("Gracias!")]);
    expect(ctx).toEqual({ notice: "Hola Ana, te esperamos el viernes", allAcknowledgments: true });
  });

  it("notificación por API + pregunta → contexto sin silencio", () => {
    const ctx = transactionalContext([api("Hola"), inb("¿A qué hora?")]);
    expect(ctx?.allAcknowledgments).toBe(false);
  });

  it("ráfaga: un acuse y luego una pregunta → no silencio", () => {
    const ctx = transactionalContext([api("Hola"), inb("Gracias"), inb("una duda, hay wifi?")]);
    expect(ctx?.allAcknowledgments).toBe(false);
  });

  it("media sin texto tras la notificación → no silencio", () => {
    expect(transactionalContext([api("Hola"), inb(null)])?.allAcknowledgments).toBe(false);
  });

  it("último saliente del agente o de campaña → null (comportamiento intacto)", () => {
    expect(transactionalContext([api("Hola"), inb("gracias"), agent("De nada"), inb("gracias")])).toBeNull();
    expect(transactionalContext([campaign("Promo"), inb("gracias")])).toBeNull();
    expect(transactionalContext([inb("hola")])).toBeNull();
    expect(transactionalContext([api("Hola")])).toBeNull();
  });
});
