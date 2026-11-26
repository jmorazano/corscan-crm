import { describe, expect, it } from "vitest";
import {
  coversWindow,
  HISTORY_SYNC_LIMIT_CODE,
  historyImportView,
  isFromOlderConnection,
  isSyncLimitError,
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

/**
 * Meta acepta UN pedido de historial por conexión del número (26-nov-2026,
 * Distrito Inmobiliario): la tarjeta no ofrece repetirlo cuando ya se sabe
 * que lo va a rechazar, y el botón vuelve si el número se reconecta.
 */
describe("historyImportView", () => {
  const T0 = new Date("2026-11-25T13:46:51Z");
  const min = (n: number) => new Date(T0.getTime() + n * 60_000);
  const base = {
    status: "requested" as const,
    days: 60,
    requestedAt: T0,
    lastChunkAt: null,
    attemptAt: T0,
    lastErrorCode: null,
    lastError: null,
  };
  const META_LIMIT =
    "Meta rechazó la solicitud: (#4) Application request limit reached: Synchronization Request limit exceeded: You have exceeded the maximum number of times to call the synchronization api for this phone number.";

  it("sin fila o sin pedir → se ofrece importar", () => {
    expect(historyImportView(null, { connectedAt: null })).toMatchObject({ kind: "idle", canRequest: true });
    expect(historyImportView({ ...base, status: "idle" }, { connectedAt: null }).canRequest).toBe(true);
  });

  it("recién pedida → espera; a los 10 min sin un solo chat → sin respuesta, sin botón y con reconexión", () => {
    expect(historyImportView(base, { connectedAt: min(-1), now: min(9) })).toEqual({
      kind: "waiting",
      problem: null,
      canRequest: false,
      needsReconnect: false,
      windowCovered: false,
    });
    expect(historyImportView(base, { connectedAt: min(-1), now: min(10) })).toEqual({
      kind: "stalled",
      problem: null,
      canRequest: false,
      needsReconnect: true,
      windowCovered: false,
    });
  });

  it("recibiendo → en curso; sin tramos hace 10 min → en parte, sin ruedita ni botón", () => {
    const receiving = { ...base, status: "receiving" as const, lastChunkAt: min(7) };
    expect(historyImportView(receiving, { connectedAt: null, now: min(12) }).kind).toBe("receiving");
    expect(historyImportView(receiving, { connectedAt: null, now: min(17) })).toMatchObject({
      kind: "paused",
      canRequest: false,
      needsReconnect: false,
    });
  });

  it("el límite de Meta (código propio o fila vieja con el texto crudo) → no se ofrece reintentar", () => {
    for (const row of [
      { ...base, status: "failed" as const, lastErrorCode: HISTORY_SYNC_LIMIT_CODE, lastError: "x" },
      { ...base, status: "failed" as const, lastErrorCode: "4", lastError: META_LIMIT },
    ]) {
      expect(historyImportView(row, { connectedAt: min(-1), now: min(600) })).toEqual({
        kind: "failed",
        problem: "sync_limit",
        canRequest: false,
        needsReconnect: true,
        windowCovered: false,
      });
    }
  });

  it("un #4 que no es de sincronización es el límite genérico: se puede reintentar", () => {
    const row = {
      ...base,
      status: "failed" as const,
      lastErrorCode: "4",
      lastError: "Meta rechazó la solicitud: (#4) Application request limit reached",
    };
    expect(historyImportView(row, { connectedAt: null })).toMatchObject({ problem: null, canRequest: true });
    expect(isSyncLimitError(4, "(#4) Application request limit reached")).toBe(false);
    expect(isSyncLimitError(4, META_LIMIT)).toBe(true);
    expect(isSyncLimitError(100, META_LIMIT)).toBe(false);
  });

  it("fuera de las 24 h (135000) → reconexión, sin botón", () => {
    const row = { ...base, status: "failed" as const, lastErrorCode: "135000", lastError: "tarde" };
    expect(historyImportView(row, { connectedAt: null })).toMatchObject({
      problem: "too_late",
      canRequest: false,
      needsReconnect: true,
    });
  });

  it("otro fallo (red, Meta caída) → se puede volver a pedir", () => {
    const row = { ...base, status: "failed" as const, lastErrorCode: "network", lastError: "No se pudo hablar con Meta ahora" };
    expect(historyImportView(row, { connectedAt: null })).toMatchObject({ problem: null, canRequest: true, needsReconnect: false });
  });

  it("importada y después el límite → sigue importada, solo sin botón", () => {
    const done = { ...base, status: "done" as const };
    expect(historyImportView(done, { connectedAt: null })).toMatchObject({ kind: "done", canRequest: true });
    expect(
      historyImportView({ ...done, lastErrorCode: HISTORY_SYNC_LIMIT_CODE, lastError: "x" }, { connectedAt: null })
    ).toEqual({
      kind: "done",
      problem: "sync_limit",
      canRequest: false,
      needsReconnect: false,
      windowCovered: false,
    });
  });

  it("Meta se quedó callada pero lo importado llega al borde de los 60 días → importado, no «en parte»", () => {
    // Caso real (Comercial, 25-nov-2026): progreso 44 % sobre 180 días.
    const day = 86_400_000;
    const receiving = { ...base, status: "receiving" as const, lastChunkAt: min(7) };
    const cutoff = new Date(T0.getTime() - 60 * day);
    const at = (ms: number) => new Date(cutoff.getTime() + ms);
    expect(
      historyImportView(receiving, { connectedAt: null, now: min(30), oldestImportedAt: at(6 * 3_600_000) })
    ).toEqual({ kind: "done", problem: null, canRequest: false, needsReconnect: false, windowCovered: true });
    // Mientras siguen llegando tramos no se adelanta el final.
    expect(
      historyImportView(receiving, { connectedAt: null, now: min(9), oldestImportedAt: at(0) }).kind
    ).toBe("receiving");
    // Lo importado se quedó a 20 días del borde: en parte.
    expect(
      historyImportView(receiving, { connectedAt: null, now: min(30), oldestImportedAt: at(20 * day) })
    ).toMatchObject({ kind: "paused", windowCovered: false });
    expect(coversWindow(at(2 * day), T0, 60)).toBe(true);
    expect(coversWindow(at(2 * day + 1), T0, 60)).toBe(false);
    expect(coversWindow(null, T0, 60)).toBe(false);
    expect(coversWindow(at(0), null, 60)).toBe(false);
  });

  it("el número se reconectó después → el botón vuelve (es otra conexión)", () => {
    const reconnected = { connectedAt: min(90), now: min(95) };
    expect(historyImportView(base, reconnected)).toMatchObject({ kind: "idle", canRequest: true });
    const failed = { ...base, status: "failed" as const, lastErrorCode: HISTORY_SYNC_LIMIT_CODE, lastError: "x", attemptAt: min(60) };
    expect(historyImportView(failed, reconnected)).toMatchObject({ kind: "failed", problem: null, canRequest: true, needsReconnect: false });
    expect(isFromOlderConnection(min(60), min(90))).toBe(true);
    expect(isFromOlderConnection(min(91), min(90))).toBe(false);
    expect(isFromOlderConnection(null, min(90))).toBe(false);
  });
});
