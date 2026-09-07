import { describe, expect, it } from "vitest";
import {
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  encodeCursor,
  MAX_PAGE_SIZE,
  parseLimit,
  parsePage,
} from "@/lib/pagination";

describe("parsePage / parseLimit", () => {
  it("page inválida → 1", () => {
    expect(parsePage(null)).toBe(1);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-3")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage("2.5")).toBe(1);
    expect(parsePage("7")).toBe(7);
  });

  it("limit acotado al tope y con default", () => {
    expect(parseLimit(null)).toBe(DEFAULT_PAGE_SIZE);
    expect(parseLimit("x")).toBe(DEFAULT_PAGE_SIZE);
    expect(parseLimit("10")).toBe(10);
    expect(parseLimit("99999")).toBe(MAX_PAGE_SIZE);
  });
});

describe("cursor", () => {
  it("ida y vuelta", () => {
    const ts = new Date("2026-09-07T12:34:56.789Z");
    const encoded = encodeCursor({ ts, id: "cv_abc123" });
    expect(encoded).toBe("2026-09-07T12:34:56.789Z|cv_abc123");
    expect(decodeCursor(encoded)).toEqual({ ts, id: "cv_abc123" });
  });

  it("rechaza basura sin romper", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("sin-separador")).toBeNull();
    expect(decodeCursor("no-es-fecha|cv_1")).toBeNull();
    expect(decodeCursor("2026-09-07T12:00:00.000Z|")).toBeNull();
    expect(decodeCursor("2026-09-07T12:00:00.000Z|cv_1; drop table")).toBeNull();
  });
});
