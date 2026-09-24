import { describe, expect, it } from "vitest";
import {
  REPLY_DELAY_MAX_MS,
  replyDelayMsToSeconds,
  replyDelaySecondsToMs,
  resolveReplyDelayMs,
} from "@/lib/agent-timing";

/** Espera del agente por empresa (022): la empresa manda, el env es el default. */
describe("resolveReplyDelayMs", () => {
  it("sin valor de empresa rige el default de instancia", () => {
    expect(resolveReplyDelayMs(null, 20000)).toBe(20000);
    expect(resolveReplyDelayMs(undefined, 20000)).toBe(20000);
  });

  it("el valor de la empresa gana, incluido cero (responder ya)", () => {
    expect(resolveReplyDelayMs(5000, 20000)).toBe(5000);
    expect(resolveReplyDelayMs(0, 20000)).toBe(0);
  });

  it("acota al tope y al piso", () => {
    expect(resolveReplyDelayMs(999_999, 20000)).toBe(REPLY_DELAY_MAX_MS);
    expect(resolveReplyDelayMs(-5, 20000)).toBe(0);
    expect(resolveReplyDelayMs(1500.4, 20000)).toBe(1500);
  });

  it("un valor corrupto cae al default; un default corrupto cae a cero", () => {
    expect(resolveReplyDelayMs(Number.NaN, 20000)).toBe(20000);
    expect(resolveReplyDelayMs(null, Number.NaN)).toBe(0);
  });
});

describe("replyDelaySecondsToMs", () => {
  it("vacío = default (null)", () => {
    expect(replyDelaySecondsToMs("")).toBeNull();
    expect(replyDelaySecondsToMs("   ")).toBeNull();
  });

  it("segundos enteros → ms", () => {
    expect(replyDelaySecondsToMs("5")).toBe(5000);
    expect(replyDelaySecondsToMs("0")).toBe(0);
    expect(replyDelaySecondsToMs("120")).toBe(120_000);
  });

  it("rechaza negativos, decimales, texto y más de dos minutos", () => {
    expect(replyDelaySecondsToMs("-1")).toBe("invalid");
    expect(replyDelaySecondsToMs("2.5")).toBe("invalid");
    expect(replyDelaySecondsToMs("abc")).toBe("invalid");
    expect(replyDelaySecondsToMs("121")).toBe("invalid");
  });
});

describe("replyDelayMsToSeconds", () => {
  it("redondea al entero", () => {
    expect(replyDelayMsToSeconds(20000)).toBe(20);
    expect(replyDelayMsToSeconds(2500)).toBe(3);
  });
});
