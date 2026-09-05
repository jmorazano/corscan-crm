import { describe, expect, it } from "vitest";
import {
  findOpenVariableAtCursor,
  parseInlineFormat,
  splitBodyVariables,
  TEMPLATE_VARIABLES,
} from "@/lib/template-body";

describe("splitBodyVariables (preview)", () => {
  it("separa texto y variables conservando el orden", () => {
    expect(splitBodyVariables("Hola {{1}}, ¿retomamos?")).toEqual([
      { kind: "text", text: "Hola " },
      { kind: "variable", key: "1", raw: "{{1}}" },
      { kind: "text", text: ", ¿retomamos?" },
    ]);
  });

  it("sin variables → un solo segmento de texto; vacío → nada", () => {
    expect(splitBodyVariables("Hola")).toEqual([{ kind: "text", text: "Hola" }]);
    expect(splitBodyVariables("")).toEqual([]);
  });

  it("una variable no admitida se reporta con su clave (el preview la marca)", () => {
    expect(splitBodyVariables("{{2}}")).toEqual([
      { kind: "variable", key: "2", raw: "{{2}}" },
    ]);
  });
});

describe("parseInlineFormat (formato de WhatsApp)", () => {
  it("negrita, cursiva, tachado y mono", () => {
    expect(parseInlineFormat("a *b* _c_ ~d~ ```e```")).toEqual([
      { text: "a " },
      { text: "b", bold: true },
      { text: " " },
      { text: "c", italic: true },
      { text: " " },
      { text: "d", strike: true },
      { text: " " },
      { text: "e", mono: true },
    ]);
  });

  it("marcadores sin cerrar quedan como texto", () => {
    expect(parseInlineFormat("2 * 3 = 6")).toEqual([{ text: "2 * 3 = 6" }]);
  });
});

describe("findOpenVariableAtCursor (autocompletado)", () => {
  it("detecta `{{` recién abierto y lo que se tipeó después", () => {
    expect(findOpenVariableAtCursor("Hola {{", 7)).toEqual({
      start: 5,
      end: 7,
      query: "",
    });
    expect(findOpenVariableAtCursor("Hola {{1", 8)).toEqual({
      start: 5,
      end: 8,
      query: "1",
    });
  });

  it("no abre menú con la variable ya cerrada, con espacios o sin `{{`", () => {
    expect(findOpenVariableAtCursor("Hola {{1}}", 10)).toBeNull();
    expect(findOpenVariableAtCursor("Hola {{ x", 9)).toBeNull();
    expect(findOpenVariableAtCursor("Hola", 4)).toBeNull();
  });

  it("solo mira antes del cursor (y sigue abierto si el cursor está dentro)", () => {
    expect(findOpenVariableAtCursor("{{1}} y {{", 7)).toBeNull();
    expect(findOpenVariableAtCursor("{{1}} y {{", 3)).toEqual({
      start: 0,
      end: 3,
      query: "1",
    });
  });
});

describe("TEMPLATE_VARIABLES", () => {
  it("v1 expone exactamente {{1}}", () => {
    expect(TEMPLATE_VARIABLES.map((v) => v.token)).toEqual(["{{1}}"]);
  });
});
