import { describe, expect, it } from "vitest";
import { conversationalReplyDecision } from "@/server/ai/pipeline";

describe("conversationalReplyDecision (011)", () => {
  const base = {
    turnInboundId: "msg_a",
    latestInboundId: "msg_a",
    lastOutboundText: "Hola, ¿en qué te ayudo?",
    text: "Te paso la cotización enseguida.",
  };

  it("sin novedades y texto distinto → send", () => {
    expect(conversationalReplyDecision(base)).toBe("send");
  });

  it("llegó un inbound nuevo durante la generación → stale (descartar y regenerar)", () => {
    expect(
      conversationalReplyDecision({ ...base, latestInboundId: "msg_b" })
    ).toBe("stale");
  });

  it("texto idéntico al último saliente → duplicate (no repetir)", () => {
    expect(
      conversationalReplyDecision({
        ...base,
        text: "  Hola, ¿en qué te ayudo?  ",
      })
    ).toBe("duplicate");
  });

  it("sin salientes previos ni inbound posterior → send", () => {
    expect(
      conversationalReplyDecision({
        ...base,
        lastOutboundText: null,
      })
    ).toBe("send");
  });

  it("el stale gana sobre el duplicate (primero contexto, después estilo)", () => {
    expect(
      conversationalReplyDecision({
        ...base,
        latestInboundId: "msg_c",
        text: base.lastOutboundText!,
      })
    ).toBe("stale");
  });
});
