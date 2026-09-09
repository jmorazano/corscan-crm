import { describe, expect, it } from "vitest";
import {
  countVariables,
  freeTextCount,
  resolveVariableValues,
  sampleValuesFor,
  validateBodyVariables,
} from "@/lib/template-body";
import { buildTemplateSendPayload } from "@/server/whatsapp/templates";

describe("validateBodyVariables (009: hasta 5, contiguas)", () => {
  it("acepta 1..5 contiguas, con repeticiones", () => {
    expect(validateBodyVariables("{{1}} {{2}} {{3}} {{4}} {{5}}")).toBeNull();
    expect(validateBodyVariables("{{1}} y de nuevo {{1}} con {{2}}")).toBeNull();
  });

  it("rechaza huecos y más de 5", () => {
    expect(validateBodyVariables("{{1}} {{3}}")).toMatch(/consecutivas/);
    expect(validateBodyVariables("{{2}}")).toMatch(/consecutivas/);
    expect(
      validateBodyVariables("{{1}} {{2}} {{3}} {{4}} {{5}} {{6}}")
    ).toMatch(/Máximo 5/);
  });

  it("countVariables cuenta índices distintos", () => {
    expect(countVariables("{{1}} {{1}} {{2}}")).toBe(2);
  });
});

describe("resolveVariableValues", () => {
  const ctx = {
    contactName: "Javier",
    contactPhone: "+54 9 3472 44-9202",
    orgName: "Corscan Ingeniería",
  };

  it("resuelve automáticos y textos libres en orden", () => {
    const res = resolveVariableValues(
      ["contact_name", "org_name", "free_text", "contact_phone", "free_text"],
      { ...ctx, freeTexts: ["20% off", "hasta el viernes"] }
    );
    expect(res).toEqual({
      ok: true,
      values: [
        "Javier",
        "Corscan Ingeniería",
        "20% off",
        "+54 9 3472 44-9202",
        "hasta el viernes",
      ],
    });
  });

  it("falta un texto libre (o viene vacío) → error claro", () => {
    expect(
      resolveVariableValues(["free_text"], { ...ctx, freeTexts: [] }).ok
    ).toBe(false);
    expect(
      resolveVariableValues(["free_text"], { ...ctx, freeTexts: ["  "] }).ok
    ).toBe(false);
  });

  it("sobran textos libres u origen desconocido → error", () => {
    expect(
      resolveVariableValues(["contact_name"], { ...ctx, freeTexts: ["x"] }).ok
    ).toBe(false);
    expect(resolveVariableValues(["magic"], ctx).ok).toBe(false);
  });

  it("freeTextCount cuenta solo los libres", () => {
    expect(freeTextCount(["contact_name", "free_text", "free_text"])).toBe(2);
  });

  it("sampleValuesFor produce una muestra por binding", () => {
    expect(sampleValuesFor(["contact_name", "org_name"])).toEqual([
      "María",
      "Tu Empresa",
    ]);
  });
});

describe("buildTemplateSendPayload multi-parámetro", () => {
  it("un parámetro de texto por variable, en orden", () => {
    const payload = buildTemplateSendPayload({
      name: "promo",
      language: "es_AR",
      bodyParams: ["Javier", "Corscan", "20% off"],
      headerLink: null,
    });
    expect(payload.components).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", text: "Javier" },
          { type: "text", text: "Corscan" },
          { type: "text", text: "20% off" },
        ],
      },
    ]);
  });
});
