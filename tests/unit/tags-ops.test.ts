import { describe, expect, it } from "vitest";
import {
  applyTagOps,
  MAX_TAGS_PER_CONTACT,
  parseTagMode,
  parseTagsParam,
  sameTagSet,
  serializeTagsParam,
} from "@/lib/tags";

/**
 * Lógica pura de etiquetas (006): parseo del query param, modo del filtro y
 * la operación en bloque agregar/quitar. Lo que se protege: saneo uniforme
 * con 004, idempotencia y el tope por fila.
 */

describe("parseTagsParam", () => {
  it("parsea CSV saneando (trim, minúsculas, únicas)", () => {
    expect(parseTagsParam(" VIP , cordoba,vip, ,")).toEqual(["vip", "cordoba"]);
  });

  it("acepta el alias tag= de 004 solo si tags= está vacío", () => {
    expect(parseTagsParam(null, "vip")).toEqual(["vip"]);
    expect(parseTagsParam("", "vip")).toEqual(["vip"]);
    expect(parseTagsParam("cordoba", "vip")).toEqual(["cordoba"]);
  });

  it("valores vacíos o basura → lista vacía", () => {
    expect(parseTagsParam(null)).toEqual([]);
    expect(parseTagsParam(" , , ")).toEqual([]);
  });

  it("serializa a CSV saneado", () => {
    expect(serializeTagsParam([" VIP", "cordoba", "vip"])).toBe("vip,cordoba");
  });
});

describe("parseTagMode", () => {
  it("solo 'all' es all; todo lo demás es any", () => {
    expect(parseTagMode("all")).toBe("all");
    expect(parseTagMode("any")).toBe("any");
    expect(parseTagMode("ALL")).toBe("any");
    expect(parseTagMode(null)).toBe("any");
  });
});

describe("applyTagOps", () => {
  it("agrega sin duplicar y saneando", () => {
    expect(applyTagOps(["vip"], { add: [" Cordoba ", "vip"] })).toEqual([
      "vip",
      "cordoba",
    ]);
  });

  it("quita solo las presentes", () => {
    expect(applyTagOps(["vip", "cordoba"], { remove: ["VIP", "nada"] })).toEqual([
      "cordoba",
    ]);
  });

  it("quita antes de agregar: la misma etiqueta en ambas termina agregada", () => {
    expect(applyTagOps(["vip"], { remove: ["vip"], add: ["vip"] })).toEqual(["vip"]);
  });

  it("es idempotente", () => {
    const once = applyTagOps(["a"], { add: ["b"], remove: ["a"] });
    const twice = applyTagOps(once, { add: ["b"], remove: ["a"] });
    expect(twice).toEqual(once);
  });

  it("respeta el tope por fila", () => {
    const many = Array.from({ length: MAX_TAGS_PER_CONTACT }, (_, i) => `t${i}`);
    const result = applyTagOps(many, { add: ["extra"] });
    expect(result).toHaveLength(MAX_TAGS_PER_CONTACT);
    expect(result).not.toContain("extra");
  });
});

describe("sameTagSet", () => {
  it("ignora el orden", () => {
    expect(sameTagSet(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameTagSet(["a"], ["a", "b"])).toBe(false);
  });
});
