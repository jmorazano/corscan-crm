import { describe, expect, it } from "vitest";
import {
  composerMode,
  TRAINER_CONTACT_PHONE,
  trainerTitle,
  trainerVisible,
} from "@/lib/trainer";
import { normalizeToWaId } from "@/lib/phone";

/** 015 (D2/D3): reglas puras de la fila fija del entrenador. */
describe("trainerVisible", () => {
  it("visible sin filtros", () => {
    expect(trainerVisible({ filter: null, q: "", tags: [], unreadCount: 0 })).toBe(true);
  });
  it("oculta bajo búsqueda o etiquetas", () => {
    expect(trainerVisible({ filter: null, q: "ari", tags: [], unreadCount: 3 })).toBe(false);
    expect(trainerVisible({ filter: null, q: "", tags: ["vip"], unreadCount: 3 })).toBe(false);
  });
  it("en «No leídas» solo con pendientes", () => {
    expect(trainerVisible({ filter: "unread", q: "", tags: [], unreadCount: 0 })).toBe(false);
    expect(trainerVisible({ filter: "unread", q: "", tags: [], unreadCount: 1 })).toBe(true);
  });
});

describe("composerMode", () => {
  it("trainer ignora la ventana de 24h", () => {
    expect(composerMode({ kind: "trainer", windowOpen: false })).toBe("trainer");
  });
  it("whatsapp alterna texto/plantilla por ventana", () => {
    expect(composerMode({ kind: "whatsapp", windowOpen: true })).toBe("text");
    expect(composerMode({ kind: "whatsapp", windowOpen: false })).toBe("template");
    expect(composerMode({ windowOpen: false })).toBe("template");
  });
});

describe("contacto sintético", () => {
  it("el teléfono del entrenador NO es un wa_id válido (no se puede crear por import/API)", () => {
    expect(normalizeToWaId(TRAINER_CONTACT_PHONE).ok).toBe(false);
  });
  it("título de la fila", () => {
    expect(trainerTitle("Ari")).toBe("Entrená a Ari");
  });
});
