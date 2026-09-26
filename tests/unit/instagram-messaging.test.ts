import { describe, expect, it } from "vitest";
import {
  contactHandle,
  igsidFromPhone,
  instagramContactPhone,
  instagramDisplayName,
  instagramSendMode,
  isProvisionalInstagramName,
  splitInstagramText,
} from "@/lib/instagram/messaging";
import { composerMode } from "@/lib/trainer";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-09-25T12:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * HOUR);
const bytes = (s: string) => new TextEncoder().encode(s).length;

describe("instagramSendMode (ventana de Instagram)", () => {
  it("24 h estándar para todos", () => {
    expect(instagramSendMode(ago(2), { aiGenerated: true, now })).toEqual({ mode: "standard" });
    expect(instagramSendMode(ago(23.9), { aiGenerated: false, now })).toEqual({ mode: "standard" });
  });
  it("entre 24 h y 7 días: solo personas, con HUMAN_AGENT", () => {
    expect(instagramSendMode(ago(30), { aiGenerated: false, now })).toEqual({ mode: "human_agent" });
    expect(instagramSendMode(ago(30), { aiGenerated: true, now })).toEqual({
      mode: "closed",
      reason: "window",
    });
  });
  it("más de 7 días o sin entrantes: cerrado", () => {
    expect(instagramSendMode(ago(24 * 7 + 1), { aiGenerated: false, now })).toEqual({
      mode: "closed",
      reason: "human_agent_expired",
    });
    expect(instagramSendMode(null, { aiGenerated: false, now })).toEqual({
      mode: "closed",
      reason: "no_inbound",
    });
  });
});

describe("composerMode para Instagram", () => {
  const conv = (h: number | null) => ({
    kind: "instagram" as const,
    windowOpen: h !== null && h < 24,
    lastInboundAt: h === null ? null : ago(h).toISOString(),
  });
  it("texto / agente humano / cerrado — nunca plantilla", () => {
    expect(composerMode(conv(1), now)).toBe("text");
    expect(composerMode(conv(48), now)).toBe("instagram_human");
    expect(composerMode(conv(24 * 8), now)).toBe("instagram_closed");
    expect(composerMode(conv(null), now)).toBe("instagram_closed");
  });
  it("WhatsApp sigue igual", () => {
    expect(composerMode({ kind: "whatsapp", windowOpen: false })).toBe("template");
  });
});

describe("splitInstagramText", () => {
  it("un texto corto queda entero", () => {
    expect(splitInstagramText("  Hola!  ")).toEqual(["Hola!"]);
    expect(splitInstagramText("   ")).toEqual([]);
  });

  it("parte en trozos ≤ 1000 bytes sin cortar palabras ni perder contenido", () => {
    const sentence = "La cabaña tiene dos habitaciones, parrilla y vista al lago. ";
    const text = sentence.repeat(40); // ~2400 bytes
    const parts = splitInstagramText(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(bytes(p)).toBeLessThanOrEqual(1000);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(text.trim().replace(/\s+/g, " "));
    for (const p of parts) expect(p.endsWith(".")).toBe(true);
  });

  it("cuenta bytes (acentos y emoji) y nunca parte un code point", () => {
    const text = "ñandú 🦙 ".repeat(200);
    const parts = splitInstagramText(text, 100);
    for (const p of parts) {
      expect(bytes(p)).toBeLessThanOrEqual(100);
      expect(p).not.toMatch(/�/);
    }
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(text.trim().replace(/\s+/g, " "));
  });

  it("una palabra más larga que el tope se corta igual", () => {
    const parts = splitInstagramText("x".repeat(250), 100);
    expect(parts).toEqual(["x".repeat(100), "x".repeat(100), "x".repeat(50)]);
  });

  it("prefiere cortar entre párrafos", () => {
    const a = "a".repeat(60);
    const b = "b".repeat(60);
    expect(splitInstagramText(`${a}\n\n${b}`, 100)).toEqual([a, b]);
  });
});

describe("identidad del contacto de Instagram", () => {
  it("teléfono sintético ida y vuelta", () => {
    const phone = instagramContactPhone("998877");
    expect(phone).toBe("ig:998877");
    expect(igsidFromPhone(phone)).toBe("998877");
    expect(igsidFromPhone("5493516882234")).toBeNull();
  });
  it("nombre visible: nombre → @usuario → provisorio", () => {
    expect(instagramDisplayName({ name: "Lucía", username: "lu", igsid: "12345678" })).toBe("Lucía");
    expect(instagramDisplayName({ name: " ", username: "lu", igsid: "12345678" })).toBe("@lu");
    const prov = instagramDisplayName({ igsid: "12345678" });
    expect(prov).toBe("Instagram · …5678");
    expect(isProvisionalInstagramName(prov, "12345678")).toBe(true);
    expect(isProvisionalInstagramName("Lucía", "12345678")).toBe(false);
  });
  it("contactHandle: @usuario para Instagram, +teléfono para WhatsApp", () => {
    expect(contactHandle({ phone: "ig:1", channel: "instagram", igUsername: "lu" })).toBe("@lu");
    expect(contactHandle({ phone: "ig:1", channel: "instagram", igUsername: null })).toBe("Instagram");
    expect(contactHandle({ phone: "5493516882234", channel: "whatsapp" })).toBe("+5493516882234");
  });
});
