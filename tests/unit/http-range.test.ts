import { describe, expect, it } from "vitest";
import { parseByteRange } from "@/lib/http-range";

/** 015: Range para el reproductor (iOS pide bytes=0-1 antes de reproducir). */
describe("parseByteRange", () => {
  it("sin header → null", () => {
    expect(parseByteRange(null, 100)).toBeNull();
    expect(parseByteRange("", 100)).toBeNull();
  });
  it("bytes=0-1 → {0,1}; bytes=10- → hasta el final; sufijo -5 → últimos 5", () => {
    expect(parseByteRange("bytes=0-1", 100)).toEqual({ start: 0, end: 1 });
    expect(parseByteRange("bytes=10-", 100)).toEqual({ start: 10, end: 99 });
    expect(parseByteRange("bytes=-5", 100)).toEqual({ start: 95, end: 99 });
    expect(parseByteRange("bytes=0-999", 100)).toEqual({ start: 0, end: 99 });
  });
  it("no satisfacible", () => {
    expect(parseByteRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=50-10", 100)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=0-1", 0)).toBe("unsatisfiable");
  });
  it("formatos raros o multi-rango → null (se sirve completo)", () => {
    expect(parseByteRange("bytes=0-1,5-6", 100)).toBeNull();
    expect(parseByteRange("items=0-1", 100)).toBeNull();
  });
});
