import { describe, expect, it } from "vitest";
import { modifierLabel, workspaceShortcut } from "@/lib/gestures";

/**
 * 018 (FR-007): ⌘/Ctrl + 1…9 → índice del espacio (0-based); nada más
 * dispara el cambio (Alt/Shift lo anulan, sin modificador no aplica).
 */

const base = { key: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };

describe("workspaceShortcut", () => {
  it("⌘1 (Mac) y Ctrl+1 (Windows/Linux) → índice 0", () => {
    expect(workspaceShortcut({ ...base, key: "1", metaKey: true })).toBe(0);
    expect(workspaceShortcut({ ...base, key: "1", ctrlKey: true })).toBe(0);
  });

  it("⌘9 → índice 8; ⌘0 no aplica", () => {
    expect(workspaceShortcut({ ...base, key: "9", metaKey: true })).toBe(8);
    expect(workspaceShortcut({ ...base, key: "0", metaKey: true })).toBeNull();
  });

  it("sin modificador, o con Alt/Shift, no aplica", () => {
    expect(workspaceShortcut({ ...base, key: "2" })).toBeNull();
    expect(workspaceShortcut({ ...base, key: "2", metaKey: true, altKey: true })).toBeNull();
    expect(workspaceShortcut({ ...base, key: "2", ctrlKey: true, shiftKey: true })).toBeNull();
  });

  it("dígito por `code` cuando `key` llega como símbolo (teclados alternativos)", () => {
    expect(
      workspaceShortcut({ ...base, key: "¡", metaKey: true, code: "Digit1" })
    ).toBe(0);
    expect(
      workspaceShortcut({ ...base, key: "Unidentified", ctrlKey: true, code: "Numpad3" })
    ).toBe(2);
  });

  it("letras con modificador no aplican (⌘K sigue siendo búsqueda)", () => {
    expect(workspaceShortcut({ ...base, key: "k", metaKey: true, code: "KeyK" })).toBeNull();
  });
});

describe("modifierLabel", () => {
  it("⌘ en Apple, Ctrl+ en el resto", () => {
    expect(modifierLabel("MacIntel")).toBe("⌘");
    expect(modifierLabel("iPhone")).toBe("⌘");
    expect(modifierLabel("Win32")).toBe("Ctrl+");
    expect(modifierLabel("Linux x86_64")).toBe("Ctrl+");
  });
});
