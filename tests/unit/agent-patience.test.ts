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

describe("conversationalReplyDecision — casi igual (fix 17-nov-2026)", () => {
  const prev =
    "Gracias, María Soledad. Te enviaré el link del llamado a la casilla que me pasaste. Hoy a las 14:30 podrás discutir todos los detalles sobre el curso con Juan Manuel.";
  const base = { turnInboundId: "msg_a", latestInboundId: "msg_a", lastOutboundText: prev };

  it("el mismo mensaje con «¡Hasta luego!» agregado → duplicate", () => {
    expect(conversationalReplyDecision({ ...base, text: `${prev} ¡Hasta luego!` })).toBe("duplicate");
  });

  it("igual salvo mayúsculas, tildes y signos → duplicate", () => {
    expect(
      conversationalReplyDecision({ ...base, text: prev.toUpperCase().replace(/[.,!]/g, "").replace("í", "i") })
    ).toBe("duplicate");
  });

  it("una despedida corta distinta → send", () => {
    expect(
      conversationalReplyDecision({ ...base, text: "¡Gracias a vos, María Soledad! Nos vemos hoy a las 14:30." })
    ).toBe("send");
  });

  it("un mensaje nuevo que retoma una parte → send", () => {
    expect(
      conversationalReplyDecision({
        ...base,
        text: "Hoy a las 14:30 Juan Manuel te cuenta el temario. Mientras tanto, ¿qué versión de AutoCAD usás?",
      })
    ).toBe("send");
  });

  it("textos cortos solo cuentan si son iguales", () => {
    expect(
      conversationalReplyDecision({ ...base, lastOutboundText: "¡Perfecto!", text: "¡Perfecto, gracias!" })
    ).toBe("send");
    expect(
      conversationalReplyDecision({ ...base, lastOutboundText: "¡Perfecto!", text: "perfecto" })
    ).toBe("duplicate");
  });
});
