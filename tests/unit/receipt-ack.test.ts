import { describe, expect, it } from "vitest";
import {
  needsReceiptAck,
  hasPendingAttachment,
  isReceiptMessage,
  RECEIPT_ACK_MAX_AGE_MS,
  HANDOFF_RACE_MS,
  type AckMessage,
} from "@/lib/receipt-ack";
import { closeWait } from "@/lib/team-attention";

const MIN = 60_000;
const NOW = new Date("2026-11-02T13:00:00Z");
const at = (m: number) => new Date(NOW.getTime() + m * MIN);

const receipt = (minutes: number, extra: Partial<AckMessage> = {}): AckMessage => ({
  direction: "in",
  type: "image",
  createdAt: at(minutes),
  aiGenerated: false,
  status: "received",
  mediaState: "ready",
  mediaSummary: "Comprobante de transferencia bancaria realizada.",
  details: null,
  ...extra,
});
const ack = (minutes: number, extra: Partial<AckMessage> = {}): AckMessage => ({
  ...receipt(minutes),
  direction: "out",
  type: "text",
  aiGenerated: true,
  status: "sent",
  mediaState: null,
  mediaSummary: null,
  ...extra,
});

const base = {
  enabled: true,
  aiEnabled: true,
  handoffAt: at(-6) as Date | null,
  lastTeamAt: null as Date | null,
  now: NOW,
};

describe("isReceiptMessage", () => {
  it("acepta imagen o PDF leído", () => {
    expect(isReceiptMessage(receipt(0))).toBe(true);
    expect(isReceiptMessage(receipt(0, { type: "document" }))).toBe(true);
  });
  it("rechaza video, no leído y otras descripciones", () => {
    expect(isReceiptMessage(receipt(0, { type: "video" }))).toBe(false);
    expect(isReceiptMessage(receipt(0, { mediaState: "failed" }))).toBe(false);
    expect(isReceiptMessage(receipt(0, { mediaSummary: "Una foto de un lote." }))).toBe(false);
  });
});

describe("needsReceiptAck", () => {
  it("acusa en atención humana", () => {
    expect(needsReceiptAck({ ...base, history: [receipt(-1)] })).toBe(true);
  });
  it("acusa con la IA apagada sin marca de atención humana", () => {
    expect(needsReceiptAck({ ...base, aiEnabled: false, handoffAt: null, history: [receipt(-1)] })).toBe(true);
  });
  it("no acusa con la opción apagada ni con la IA prendida y sin marca", () => {
    expect(needsReceiptAck({ ...base, enabled: false, history: [receipt(-1)] })).toBe(false);
    expect(needsReceiptAck({ ...base, handoffAt: null, history: [receipt(-1)] })).toBe(false);
  });
  it("no acusa comprobantes viejos", () => {
    const old = -(RECEIPT_ACK_MAX_AGE_MS / MIN) - 1;
    expect(needsReceiptAck({ ...base, handoffAt: at(old - 5), history: [receipt(old)] })).toBe(false);
  });
  it("tolera un comprobante apenas antes de la derivación, no uno muy anterior", () => {
    const h = at(-3);
    expect(needsReceiptAck({ ...base, handoffAt: h, history: [receipt(-4)] })).toBe(true);
    const early = -3 - HANDOFF_RACE_MS / MIN - 1;
    expect(needsReceiptAck({ ...base, handoffAt: h, history: [receipt(early)] })).toBe(false);
    expect(needsReceiptAck({ ...base, aiEnabled: false, handoffAt: h, history: [receipt(early)] })).toBe(true);
  });
  it("no acusa si el equipo ya respondió o ya hay acuse", () => {
    expect(needsReceiptAck({ ...base, lastTeamAt: at(-1), history: [receipt(-2)] })).toBe(false);
    expect(needsReceiptAck({ ...base, history: [receipt(-2), ack(-1)] })).toBe(false);
    expect(needsReceiptAck({ ...base, history: [receipt(-2), ack(-1, { status: "failed" })] })).toBe(true);
  });
  it("dos comprobantes → un acuse; uno posterior → otro", () => {
    expect(needsReceiptAck({ ...base, history: [receipt(-3), receipt(-2), ack(-1)] })).toBe(false);
    expect(needsReceiptAck({ ...base, history: [receipt(-4), ack(-3), receipt(-1)] })).toBe(true);
  });
  it("no acusa standby ni sin comprobante", () => {
    expect(needsReceiptAck({ ...base, history: [receipt(-1, { details: { standby: true } })] })).toBe(false);
    expect(needsReceiptAck({ ...base, history: [] })).toBe(false);
  });
});

describe("hasPendingAttachment", () => {
  const pend = (m: number, extra: Partial<AckMessage> = {}) => receipt(m, { mediaState: "pending", ...extra });
  it("detecta una imagen o PDF en lectura posterior a lo último del negocio", () => {
    expect(hasPendingAttachment([pend(-1)], NOW)).toBe(true);
    expect(hasPendingAttachment([receipt(-1)], NOW)).toBe(false);
  });
  it("una plantilla de API posterior al comprobante no descarta la lectura pendiente", () => {
    const template = ack(-2, { aiGenerated: false, type: "template" });
    const question = receipt(-1, { type: "text", mediaState: null, mediaSummary: null });
    expect(hasPendingAttachment([pend(-3), template, question], NOW)).toBe(true);
  });
  it("un documento que solo se guarda no retiene el turno", () => {
    expect(hasPendingAttachment([pend(-1, { type: "document", details: { storeOnly: true } })], NOW)).toBe(false);
    expect(hasPendingAttachment([pend(-1, { type: "document" })], NOW)).toBe(true);
  });
  it("una lectura trabada hace más de 15 min ya no frena", () => {
    expect(hasPendingAttachment([pend(-20)], NOW)).toBe(false);
  });
});

describe("closeWait con acuse", () => {
  it("el acuse no cierra la espera como «agent»", () => {
    const out = (receiptAck: boolean) => ({
      createdAt: at(10),
      aiGenerated: true,
      sentByUserId: null,
      sentByName: null,
      source: "cloud",
      status: "sent",
      broadcast: false,
      receiptAck,
    });
    const wait = { startedAt: at(0), startReason: "handoff" as const };
    expect(closeWait(wait, [out(true)], at(0), at(20)).status).toBe("open");
    expect(closeWait(wait, [out(false)], at(0), at(20)).status).toBe("agent");
  });
});
