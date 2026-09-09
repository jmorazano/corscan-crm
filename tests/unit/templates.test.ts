import { describe, expect, it } from "vitest";
import {
  countVariables,
  renderBody,
  validateBodyVariables,
} from "@/server/whatsapp/templates";

describe("countVariables / validateBodyVariables (FR-050)", () => {
  it("sin variables → 0, válido", () => {
    expect(countVariables("Hola, seguimos disponibles.")).toBe(0);
    expect(validateBodyVariables("Hola, seguimos disponibles.")).toBeNull();
  });

  it("una variable {{1}} → 1, válido (con y sin espacios)", () => {
    expect(countVariables("Hola {{1}}, ¿retomamos?")).toBe(1);
    expect(countVariables("Hola {{ 1 }}, ¿retomamos?")).toBe(1);
    expect(validateBodyVariables("Hola {{1}}, ¿retomamos?")).toBeNull();
  });

  it("dos variables contiguas → válido (009)", () => {
    expect(countVariables("Hola {{1}}, tu pedido {{2}} llegó")).toBe(2);
    expect(
      validateBodyVariables("Hola {{1}}, tu pedido {{2}} llegó")
    ).toBeNull();
  });

  it("variable {{2}} sola → inválida (hueco: falta {{1}})", () => {
    expect(validateBodyVariables("Tu pedido {{2}} llegó")).toMatch(
      /consecutivas/
    );
  });
});

describe("renderBody", () => {
  it("sustituye cada variable por su valor posicional (009)", () => {
    expect(renderBody("Hola {{1}}, ¿retomamos?", ["María"])).toBe(
      "Hola María, ¿retomamos?"
    );
    expect(renderBody("{{1}} de {{2}}: {{1}}", ["Ana", "Acme"])).toBe(
      "Ana de Acme: Ana"
    );
  });

  it("sin valor → variable vacía", () => {
    expect(renderBody("Hola {{1}}!")).toBe("Hola !");
  });
});
