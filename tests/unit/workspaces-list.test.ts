import { describe, expect, it } from "vitest";
import { tileColor } from "@/server/workspaces/list";

/**
 * 018: color estable por id para el mosaico del rail cuando la empresa
 * nunca guardó su propia marca (ver `hasSavedBranding` en
 * branding-metadata.test.ts) — mismo id, mismo color siempre, y dos ids
 * distintos no deberían chocar en la paleta de 8 colores usada acá.
 */
describe("tileColor", () => {
  it("es estable para el mismo id", () => {
    expect(tileColor("org_altos_ciudad")).toBe(tileColor("org_altos_ciudad"));
  });

  it("distingue dos empresas con nombres parecidos (mismo caso que 'AC')", () => {
    expect(tileColor("org_altos_de_la_ciudad")).not.toBe(tileColor("org_altos_de_calamuchita"));
  });

  it("siempre devuelve un hex válido de la paleta", () => {
    expect(tileColor("cualquier-id")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
