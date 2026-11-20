import { describe, expect, it } from "vitest";
import { customerSinceLastReply, transactionalContext } from "@/server/ai/pipeline";

/**
 * CRM-5: una reacción solo vale como conformidad (escrituras MCP) o como
 * acuse de una notificación si apunta al mensaje correspondiente.
 */

const out = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  direction: "out" as const,
  type: "text",
  text: "…",
  apiKeyId: null,
  details: null,
  ...extra,
});
const reaction = (id: string, reactionToId?: string) => ({
  id,
  direction: "in" as const,
  type: "reaction",
  text: "👍",
  apiKeyId: null,
  details: reactionToId ? { reactionToId } : null,
});
const text = (id: string, t: string) => ({
  id,
  direction: "in" as const,
  type: "text",
  text: t,
  apiKeyId: null,
  details: null,
});

describe("customerSinceLastReply (consentimiento para escribir)", () => {
  it("un 👍 al resumen (el último saliente) cuenta", () => {
    expect(customerSinceLastReply([out("greet"), out("summary"), reaction("r1", "summary")])).toEqual(["👍"]);
  });

  it("un 👍 a un saludo ANTERIOR no autoriza una escritura", () => {
    expect(customerSinceLastReply([out("greet"), out("summary"), reaction("r1", "greet")])).toEqual([]);
  });

  it("un 👍 a un mensaje desconocido (sin reactionToId) no autoriza nada", () => {
    expect(customerSinceLastReply([out("summary"), reaction("r1")])).toEqual([]);
  });

  it("el texto escrito sigue contando como siempre", () => {
    expect(customerSinceLastReply([out("summary"), text("m1", "sí, confirmo")])).toEqual(["sí, confirmo"]);
  });
});

describe("transactionalContext con reacciones", () => {
  const notice = out("n1", { type: "template", apiKeyId: "key_1", text: "Tu reserva fue confirmada" });

  it("👍 dirigido a la NOTIFICACIÓN: es un acuse (se silencia)", () => {
    expect(transactionalContext([out("q1"), notice, reaction("r1", "n1")])?.allAcknowledgments).toBe(true);
  });

  it("👍 dirigido a la pregunta de la IA anterior a la notificación: NO es acuse", () => {
    expect(transactionalContext([out("q1"), notice, reaction("r2", "q1")])?.allAcknowledgments).toBe(false);
  });

  it("👍 a un mensaje desconocido: NO es acuse", () => {
    expect(transactionalContext([notice, reaction("r3")])?.allAcknowledgments).toBe(false);
  });

  it("un «gracias» escrito sigue siendo acuse", () => {
    expect(transactionalContext([notice, text("m1", "gracias")])?.allAcknowledgments).toBe(true);
  });
});
