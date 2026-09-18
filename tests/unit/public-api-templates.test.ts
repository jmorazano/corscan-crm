import { describe, expect, it } from "vitest";
import { curlSendExample, exampleParams, publicVariables } from "@/lib/public-templates";
import { resolveApiParams } from "@/server/public-api/templates";
import { resolveVariableValues, validateParamValue } from "@/lib/template-body";
import { requestHash } from "@/lib/idempotency";

/** 014 (FR-003/FR-006): variables públicas y resolución de `params`. */

const withBindings = {
  body: "Hola {{1}}, te esperamos en {{2}} el {{3}}. Saludos de {{4}}.",
  variableBindings: ["contact_name", "free_text", "free_text", "org_name"],
};
const legacyOne = { body: "Hola {{1}}, ¿retomamos?", variableBindings: null };
const legacyTwo = { body: "Hola {{1}} y {{2}}", variableBindings: null };
const noVars = { body: "Hola!", variableBindings: null };

describe("publicVariables", () => {
  it("con orígenes: crm vs caller por posición", () => {
    const vars = publicVariables(withBindings);
    expect(vars.map((v) => [v.index, v.origin, v.provided_by])).toEqual([
      [1, "contact_name", "crm"],
      [2, "free_text", "caller"],
      [3, "free_text", "caller"],
      [4, "org_name", "crm"],
    ]);
    expect(vars[0]!.label).toBe("Nombre del contacto");
    expect(exampleParams(vars)).toEqual({ "2": "…", "3": "…" });
  });

  it("legada: cada {{n}} es del integrador", () => {
    expect(publicVariables(legacyOne)).toEqual([
      expect.objectContaining({ index: 1, origin: "free_text", provided_by: "caller" }),
    ]);
    expect(publicVariables(noVars)).toEqual([]);
  });
});

describe("resolveApiParams", () => {
  it("con orígenes: devuelve los freeTexts en orden", () => {
    expect(resolveApiParams(withBindings, { "3": "viernes 25/10", "2": "Cabaña Los Pinos" })).toEqual({
      ok: true,
      freeTexts: ["Cabaña Los Pinos", "viernes 25/10"],
    });
  });

  it("faltantes → missing_params con la lista", () => {
    const r = resolveApiParams(withBindings, { "2": "x" });
    expect(r).toMatchObject({ ok: false, code: "missing_params", extra: { missing: ["3"] } });
  });

  it("sobrantes (los que completa el CRM o inexistentes) → unknown_params", () => {
    const r = resolveApiParams(withBindings, { "1": "Ana", "2": "x", "3": "y" });
    expect(r).toMatchObject({ ok: false, code: "unknown_params", extra: { unknown: ["1"] } });
    expect(resolveApiParams(noVars, { "1": "x" })).toMatchObject({ code: "unknown_params" });
  });

  it("valor inválido (vacío, salto de línea, 5 espacios) → invalid_param", () => {
    expect(resolveApiParams(withBindings, { "2": " ", "3": "y" })).toMatchObject({
      code: "invalid_param",
      extra: { index: "2" },
    });
    expect(resolveApiParams(withBindings, { "2": "a\nb", "3": "y" })).toMatchObject({
      code: "invalid_param",
    });
    expect(resolveApiParams(withBindings, { "2": "a     b", "3": "y" })).toMatchObject({
      code: "invalid_param",
    });
  });

  it("legada de una variable → `variable`; sin variables → ok; legada múltiple → no soportada", () => {
    expect(resolveApiParams(legacyOne, { "1": "Ana" })).toEqual({ ok: true, variable: "Ana" });
    expect(resolveApiParams(noVars, {})).toEqual({ ok: true });
    expect(resolveApiParams(legacyTwo, { "1": "a", "2": "b" })).toMatchObject({
      ok: false,
      code: "template_not_supported",
    });
  });
});

describe("validateParamValue (regla de Meta, compartida)", () => {
  it("acepta valores normales y rechaza los prohibidos", () => {
    expect(validateParamValue("Cabaña Los Pinos")).toBeNull();
    expect(validateParamValue("a    b")).toBeNull(); // 4 espacios: ok
    expect(validateParamValue("a     b")).toMatch(/4 espacios/);
    expect(validateParamValue("a\tb")).toMatch(/saltos de línea/);
    expect(validateParamValue("")).toMatch(/vacío/);
    expect(validateParamValue("x".repeat(501))).toMatch(/500/);
  });

  it("resolveVariableValues la aplica a los free_text (campañas y 1:1 la heredan)", () => {
    const r = resolveVariableValues(["free_text"], {
      contactName: "Ana",
      contactPhone: "+54…",
      orgName: "Org",
      freeTexts: ["línea 1\nlínea 2"],
    });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("{{1}}") });
  });
});

describe("curl de ejemplo (Ajustes → API)", () => {
  it("usa el nombre real y un placeholder por índice del integrador", () => {
    const curl = curlSendExample({
      baseUrl: "https://crm.ejemplo.com",
      template: { name: "recordatorio_checkin", language: "es", ...withBindings },
      key: "vk_demo",
    });
    expect(curl).toContain("https://crm.ejemplo.com/api/v1/messages");
    expect(curl).toContain("Bearer vk_demo");
    expect(curl).toContain('"template":"recordatorio_checkin"');
    expect(curl).toContain('"2":"valor para {{2}}"');
    expect(curl).not.toContain('"1":');
  });
});

describe("requestHash (idempotencia)", () => {
  it("ignora el orden de claves y undefined; cambia con cualquier valor", () => {
    const a = requestHash({ to: "1", params: { "2": "x", "3": "y" }, name: undefined });
    const b = requestHash({ params: { "3": "y", "2": "x" }, to: "1" });
    const c = requestHash({ to: "1", params: { "2": "x", "3": "z" } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
