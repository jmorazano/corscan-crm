import { describe, expect, it } from "vitest";
import {
  ACCENT_PRESETS,
  isValidHex,
  normalizeBranding,
  resolveAccentSet,
  resolveInitials,
} from "@/lib/branding";

describe("white-label: acento", () => {
  it("preset devuelve el set exacto del handoff", () => {
    expect(resolveAccentSet("#3f5972")).toEqual(ACCENT_PRESETS["#3f5972"]!.set);
    expect(resolveAccentSet("#5f5470").soft).toBe("#e6e1ec");
  });

  it("color personalizado deriva hover/soft/tint/text", () => {
    const s = resolveAccentSet("#7a3b5e");
    expect(isValidHex(s.hover)).toBe(true);
    expect(isValidHex(s.soft)).toBe(true);
    expect(isValidHex(s.tint)).toBe(true);
    expect(s.hover).not.toBe(s.accent);
  });

  it("color demasiado claro se oscurece para contraste con texto blanco", () => {
    const s = resolveAccentSet("#ffee88"); // amarillo pálido, ilegible con blanco
    expect(s.accent).not.toBe("#ffee88");
    // el resultado debe ser notablemente más oscuro
    const lum = parseInt(s.accent.slice(1, 3), 16);
    expect(lum).toBeLessThan(0xd0);
  });

  it("hex inválido cae al default", () => {
    expect(resolveAccentSet("rojo")).toEqual(ACCENT_PRESETS["#3f5972"]!.set);
  });
});

describe("white-label: normalización", () => {
  it("nombre vacío o nulo → default 'Vocero'; se recorta a 30", () => {
    expect(normalizeBranding(null).name).toBe("Vocero");
    expect(normalizeBranding({ name: "   " }).name).toBe("Vocero");
    expect(normalizeBranding({ name: "x".repeat(50) }).name).toHaveLength(30);
  });

  it("acento inválido → default", () => {
    expect(normalizeBranding({ accent: "azul" }).accent).toBe("#3f5972");
    expect(normalizeBranding({ accent: "#3F6B66" }).accent).toBe("#3f6b66");
  });

  it("iniciales: se recortan a 3, se pasan a mayúscula y se ignoran si quedan vacías", () => {
    expect(normalizeBranding({ initials: "adc" }).initials).toBe("ADC");
    expect(normalizeBranding({ initials: "  al  " }).initials).toBe("AL");
    expect(normalizeBranding({ initials: "altos" }).initials).toBe("ALT");
    expect(normalizeBranding({ initials: "" }).initials).toBeUndefined();
    expect(normalizeBranding({ initials: "   " }).initials).toBeUndefined();
    expect(normalizeBranding(null).initials).toBeUndefined();
  });

  it("sin iniciales personalizadas, el objeto normalizado no lleva la clave (018: toEqual sin sorpresas)", () => {
    expect(normalizeBranding({ name: "Corscan", accent: "#3f6b66" })).toEqual({
      name: "Corscan",
      accent: "#3f6b66",
    });
  });
});

describe("white-label: iniciales del mosaico (018)", () => {
  it("personalizadas → se usan tal cual quedaron normalizadas", () => {
    expect(resolveInitials({ name: "Altos de la Ciudad", initials: "ALC" })).toBe("ALC");
  });

  it("sin personalizar → se calculan del nombre (misma regla que cualquier avatar)", () => {
    expect(resolveInitials({ name: "Altos de la Ciudad" })).toBe("AC");
    expect(resolveInitials({ name: "Altos de Calamuchita" })).toBe("AC");
  });

  it("es lo que distingue en el rail a dos empresas que colisionan en el cálculo automático", () => {
    const a = resolveInitials({ name: "Altos de la Ciudad", initials: "ALC" });
    const b = resolveInitials({ name: "Altos de Calamuchita", initials: "ADC" });
    expect(a).not.toBe(b);
  });
});
