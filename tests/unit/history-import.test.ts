import { describe, expect, it } from "vitest";
import {
  clampDays,
  isValidThreadId,
  isWithinDays,
  mapEchoMessage,
  mapHistoryMessage,
  canOverwriteContactName,
  statusFor,
} from "@/lib/history-import";

/** 017: reglas puras de la importación del historial del celular. */
const NOW = new Date("2026-09-23T12:00:00Z");
const ts = (daysAgo: number) => String(Math.floor(NOW.getTime() / 1000) - daysAgo * 86_400);

describe("mapHistoryMessage", () => {
  it("del cliente → entrante delivered; del negocio → saliente con estado mapeado", () => {
    const inb = mapHistoryMessage(
      { from: "5493515550777", id: "wamid.1", timestamp: ts(3), type: "text", text: { body: "hola" }, history_context: { status: "READ" } },
      "5493515550777"
    );
    expect(inb).toMatchObject({ direction: "in", status: "delivered", text: "hola", type: "text", waMessageId: "wamid.1" });
    expect(inb!.at.toISOString()).toBe(new Date(Number(ts(3)) * 1000).toISOString());
    const out = mapHistoryMessage(
      { from: "5215500000000", id: "wamid.2", timestamp: ts(3), type: "text", text: { body: "dale" }, history_context: { status: "DELIVERED" } },
      "5493515550777"
    );
    expect(out).toMatchObject({ direction: "out", status: "delivered" });
  });
  it("from_me explícito manda sobre el número", () => {
    const r = mapHistoryMessage(
      { from: "5493515550777", id: "w", timestamp: ts(1), type: "text", text: { body: "x" }, history_context: { status: "SENT", from_me: true } },
      "5493515550777"
    );
    expect(r).toMatchObject({ direction: "out", status: "sent" });
  });
  it("media_placeholder se conserva sin texto; media con pie usa el caption; tipos raros → null", () => {
    expect(mapHistoryMessage({ from: "1", id: "w", timestamp: ts(1), type: "media_placeholder" }, "1")).toMatchObject({ type: "media_placeholder", text: null });
    expect(mapHistoryMessage({ from: "1", id: "w", timestamp: ts(1), type: "image", image: { caption: "foto" } }, "1")).toMatchObject({ type: "image", text: "foto" });
    expect(mapHistoryMessage({ from: "1", id: "w", timestamp: ts(1), type: "reaction" }, "1")).toBeNull();
    expect(mapHistoryMessage({ from: "1", id: "", timestamp: ts(1), type: "text" }, "1")).toBeNull();
    expect(mapHistoryMessage({ from: "1", id: "w", timestamp: "nope", type: "text" }, "1")).toBeNull();
  });
});

describe("statusFor / isWithinDays / clampDays / isValidThreadId", () => {
  it("mapeo de estados", () => {
    expect(statusFor("READ", "out")).toBe("read");
    expect(statusFor("PLAYED", "out")).toBe("read");
    expect(statusFor("ERROR", "out")).toBe("failed");
    expect(statusFor("PENDING", "out")).toBe("pending");
    expect(statusFor(undefined, "out")).toBe("pending");
    expect(statusFor("READ", "in")).toBe("delivered");
  });
  it("ventana de días", () => {
    expect(isWithinDays(new Date(Number(ts(59)) * 1000), 60, NOW)).toBe(true);
    expect(isWithinDays(new Date(Number(ts(61)) * 1000), 60, NOW)).toBe(false);
  });
  it("clampDays: default 60, tope 180, piso 1", () => {
    expect(clampDays(undefined)).toBe(60);
    expect(clampDays(500)).toBe(180);
    expect(clampDays(0)).toBe(1);
    expect(clampDays("30")).toBe(30);
  });
  it("wa_id válido: solo dígitos, sin grupos", () => {
    expect(isValidThreadId("5493515550777")).toBe(true);
    expect(isValidThreadId("120363012345678901@g.us")).toBe(false);
    expect(isValidThreadId("")).toBe(false);
  });
});

describe("mapEchoMessage", () => {
  it("siempre saliente `sent` hacia `to`", () => {
    const r = mapEchoMessage({ from: "5215500000000", to: "5493515550777", id: "wamid.e", timestamp: ts(0), type: "text", text: { body: "ya te respondo" } });
    expect(r).toMatchObject({ direction: "out", status: "sent", text: "ya te respondo" });
    expect(mapEchoMessage({ from: "x", id: "w", timestamp: ts(0), type: "text" })).toBeNull();
  });
});

describe("canOverwriteContactName", () => {
  it("adopta si el nombre es el teléfono o vino por entrante; conserva import/manual/api", () => {
    expect(canOverwriteContactName({ name: "5493515550777", phone: "5493515550777", consentSource: "import" })).toBe(true);
    expect(canOverwriteContactName({ name: "Juanchi 🚀", phone: "1", consentSource: "inbound" })).toBe(true);
    expect(canOverwriteContactName({ name: "Juan Pérez (cliente)", phone: "1", consentSource: "import" })).toBe(false);
    expect(canOverwriteContactName({ name: "Juan", phone: "1", consentSource: "manual" })).toBe(false);
  });
});
