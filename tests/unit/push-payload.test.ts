import { describe, expect, it } from "vitest";
import {
  buildHandoffPayload,
  buildInboundPayload,
  buildTestPayload,
  isGoneStatus,
  messagePreview,
  shouldNotifyInbound,
  truncateBody,
} from "@/server/push/payload";

describe("truncateBody", () => {
  it("colapsa espacios y corta a 120 con elipsis", () => {
    expect(truncateBody("hola   \n mundo")).toBe("hola mundo");
    const long = "a".repeat(200);
    const out = truncateBody(long);
    expect(out.length).toBe(120);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("messagePreview", () => {
  it("texto → texto; media → etiqueta (con caption si hay)", () => {
    expect(messagePreview("text", "¿Tienen stock?")).toBe("¿Tienen stock?");
    expect(messagePreview("image", null)).toBe("📎 Imagen");
    expect(messagePreview("document", "factura.pdf")).toBe("📎 Documento — factura.pdf");
    expect(messagePreview("desconocido", null)).toBe("Nuevo mensaje");
  });
});

describe("payloads", () => {
  it("entrante: título = contacto, tag por conversación, URL al hilo", () => {
    const p = buildInboundPayload({
      contactName: "Ana",
      conversationId: "cv_1",
      type: "text",
      text: "Hola",
      icon: "/api/pwa/icon/192",
    });
    expect(p).toMatchObject({
      kind: "inbound",
      title: "Ana",
      body: "Hola",
      tag: "conv:cv_1",
      url: "/inbox?c=cv_1",
      icon: "/api/pwa/icon/192",
    });
  });
  it("handoff: motivo humano y mismo tag que el chat", () => {
    const p = buildHandoffPayload({ contactName: "Ana", conversationId: "cv_1", reason: "cliente" });
    expect(p.title).toBe("Atención humana: Ana");
    expect(p.body).toMatch(/pidió hablar/);
    expect(p.tag).toBe("conv:cv_1");
    expect(buildHandoffPayload({ contactName: "Ana", conversationId: "cv_1", reason: "otro" }).body).toMatch(/en pausa/);
  });
  it("prueba: abre Ajustes → Notificaciones", () => {
    expect(buildTestPayload({ appName: "Vocero" }).url).toBe("/settings/notifications");
  });
});

describe("shouldNotifyInbound", () => {
  const ai = { aiEnabled: true, handoffAt: null };
  it("modo all: siempre", () => {
    expect(shouldNotifyInbound("all", ai)).toBe(true);
  });
  it("modo handoff: solo con IA apagada o escalada", () => {
    expect(shouldNotifyInbound("handoff", ai)).toBe(false);
    expect(shouldNotifyInbound("handoff", { aiEnabled: false, handoffAt: null })).toBe(true);
    expect(shouldNotifyInbound("handoff", { aiEnabled: true, handoffAt: new Date() })).toBe(true);
  });
});

describe("isGoneStatus", () => {
  it("404 y 410 podan; el resto no", () => {
    expect(isGoneStatus(404)).toBe(true);
    expect(isGoneStatus(410)).toBe(true);
    expect(isGoneStatus(201)).toBe(false);
    expect(isGoneStatus(500)).toBe(false);
    expect(isGoneStatus(null)).toBe(false);
  });
});
