import { describe, expect, it } from "vitest";
import { normalizeToWaId } from "@/lib/phone";

/**
 * Research 004 D3: todos los formatos en los que un operador argentino puede
 * tener anotado un número deben converger al MISMO wa_id (549…), porque la
 * ingesta upserta por (org, phone) y una divergencia crea duplicados.
 */

describe("normalizeToWaId — Argentina (la trampa del 9)", () => {
  const esperado = "5493516882234";

  it.each([
    ["formato local con 0 y 15", "0351 15 688 2234"],
    ["E.164 sin 9 (el que da libphonenumber solo)", "+54 351 688 2234"],
    ["wa_id crudo", "5493516882234"],
    ["internacional móvil completo", "+54 9 351 688 2234"],
    ["con guiones y paréntesis", "+54 (351) 688-2234"],
  ])("%s → 549…", (_label, input) => {
    expect(normalizeToWaId(input)).toEqual({ ok: true, waId: esperado });
  });

  it("wa_id crudo con espacio interno (fixture) → válido", () => {
    expect(normalizeToWaId("549351688 2202")).toEqual({
      ok: true,
      waId: "5493516882202",
    });
  });
});

describe("normalizeToWaId — otros países", () => {
  it("México moderno queda 52… (el legacy 521 lo corrige la reconciliación wa_id)", () => {
    const r = normalizeToWaId("+52 55 1234 5678", "MX");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.waId).toBe("525512345678");
  });

  it("un E.164 genérico pasa sin tocarse", () => {
    const r = normalizeToWaId("+34 612 345 678", "ES");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.waId).toBe("34612345678");
  });
});

describe("normalizeToWaId — rechazos con motivo", () => {
  it("vacío", () => {
    expect(normalizeToWaId("   ")).toEqual({ ok: false, reason: "vacio" });
  });

  it("letras u otros caracteres", () => {
    expect(normalizeToWaId("ABC-NO-ES-TELEFONO")).toEqual({
      ok: false,
      reason: "caracteres_invalidos",
    });
  });

  it("demasiado corto", () => {
    const r = normalizeToWaId("123");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["longitud_invalida", "no_parseable"]).toContain(r.reason);
  });

  it("no parseable aun con largo razonable", () => {
    const r = normalizeToWaId("99999999999999");
    expect(r.ok).toBe(false);
  });
});
