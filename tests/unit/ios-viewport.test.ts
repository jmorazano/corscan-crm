import { describe, expect, it } from "vitest";
import {
  isEditableTarget,
  keyboardOpen,
  nextBaseline,
  viewportStuck,
} from "@/lib/viewport";

/**
 * Fix iOS (oct-2026): en la app instalada la pantalla quedaba «comprimida»
 * al cambiar de conversación (el alto del teclado pegado) y, tras el gesto
 * «atrás», en blanco.
 */

describe("isEditableTarget", () => {
  it("campos de texto sí; botones, casillas y deshabilitados no", () => {
    expect(isEditableTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isEditableTarget({ tagName: "INPUT", type: "search" })).toBe(true);
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isEditableTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isEditableTarget({ tagName: "TEXTAREA", disabled: true })).toBe(false);
    expect(isEditableTarget({ tagName: "INPUT", readOnly: true })).toBe(false);
    expect(isEditableTarget({ tagName: "BODY" })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("keyboardOpen", () => {
  it("sin un campo con foco nunca es el teclado (el caso del chat que cambió)", () => {
    expect(keyboardOpen({ innerHeight: 844, viewportHeight: 500, editableFocused: false })).toBe(false);
  });

  it("con foco y el viewport achicado, sí; una barra de 60 px no", () => {
    expect(keyboardOpen({ innerHeight: 844, viewportHeight: 500, editableFocused: true })).toBe(true);
    expect(keyboardOpen({ innerHeight: 844, viewportHeight: 784, editableFocused: true })).toBe(false);
  });
});

describe("viewport pegado (app instalada)", () => {
  it("la referencia es el mayor alto visto con ese ancho; rotar arranca otra", () => {
    let b = nextBaseline(null, { width: 390, height: 844 });
    b = nextBaseline(b, { width: 390, height: 785 });
    expect(b).toEqual({ width: 390, height: 844 });
    expect(nextBaseline(b, { width: 844, height: 390 })).toEqual({ width: 844, height: 390 });
  });

  it("más bajo que la referencia sin teclado = pegado; con teclado o redondeo, no", () => {
    const baseline = { width: 390, height: 844 };
    expect(viewportStuck({ baseline, width: 390, innerHeight: 785, keyboardOpen: false })).toBe(true);
    expect(viewportStuck({ baseline, width: 390, innerHeight: 842, keyboardOpen: false })).toBe(false);
    expect(viewportStuck({ baseline, width: 390, innerHeight: 500, keyboardOpen: true })).toBe(false);
    expect(viewportStuck({ baseline, width: 844, innerHeight: 390, keyboardOpen: false })).toBe(false);
    expect(viewportStuck({ baseline: null, width: 390, innerHeight: 785, keyboardOpen: false })).toBe(false);
  });
});
