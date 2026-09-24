import { describe, expect, it } from "vitest";
import { brandingFromMetadata, hasSavedBranding } from "@/server/branding";

/**
 * 018: `hasSavedBranding` distingue "esta empresa nunca entró a Ajustes →
 * Marca" (acento por default por AUSENCIA) de "entró y guardó, aunque haya
 * dejado el acento por defecto" (acento por default por ELECCIÓN). El rail
 * usa esto para decidir si el mosaico respeta el acento guardado tal cual o
 * cae al color estable por id (`tileColor`).
 */
describe("hasSavedBranding", () => {
  it("metadata nula o sin branding → nunca guardó", () => {
    expect(hasSavedBranding(null)).toBe(false);
    expect(hasSavedBranding(JSON.stringify({}))).toBe(false);
    expect(hasSavedBranding("no es json")).toBe(false);
  });

  it("con branding guardado (aunque sea el acento por defecto) → true", () => {
    const metadata = JSON.stringify({ branding: { name: "Vocero", accent: "#3f5972" } });
    expect(hasSavedBranding(metadata)).toBe(true);
  });
});

describe("brandingFromMetadata: iniciales", () => {
  it("propaga las iniciales guardadas", () => {
    const metadata = JSON.stringify({
      branding: { name: "Altos de la Ciudad", accent: "#4b5563", initials: "ALC" },
    });
    expect(brandingFromMetadata(metadata).initials).toBe("ALC");
  });

  it("sin iniciales guardadas → no vienen en el resultado", () => {
    const metadata = JSON.stringify({ branding: { name: "Vocero", accent: "#3f5972" } });
    expect(brandingFromMetadata(metadata).initials).toBeUndefined();
  });
});
