import { describe, expect, it } from "vitest";
import {
  BAD_MODEL_REPLY,
  BAD_TOKEN_REPLY,
  composerMode,
  INVALID_OUTPUT_REPLY,
  NO_CREDIT_REPLY,
  PROVIDER_DOWN_REPLY,
  TRAINER_CONTACT_PHONE,
  trainerFailureReply,
  trainerTitle,
  trainerVisible,
} from "@/lib/trainer";
import { normalizeToWaId } from "@/lib/phone";

/** La respuesta al dueño cuando el turno no se completa dice la verdad del fallo. */
describe("trainerFailureReply", () => {
  it("JSON que no cumple el contrato → pide reformular, NO culpa al proveedor", () => {
    expect(trainerFailureReply({ error: "invalid_output" })).toBe(INVALID_OUTPUT_REPLY);
    expect(INVALID_OUTPUT_REPLY).not.toMatch(/proveedor/);
  });
  it("402 crédito · 401/403 token · 404 modelo · resto «no respondió»", () => {
    expect(trainerFailureReply({ error: "provider_error", status: 402 })).toBe(NO_CREDIT_REPLY);
    expect(trainerFailureReply({ error: "provider_error", status: 401 })).toBe(BAD_TOKEN_REPLY);
    expect(trainerFailureReply({ error: "provider_error", status: 403 })).toBe(BAD_TOKEN_REPLY);
    expect(trainerFailureReply({ error: "provider_error", status: 404 })).toBe(BAD_MODEL_REPLY);
    expect(trainerFailureReply({ error: "provider_error", status: 503 })).toBe(PROVIDER_DOWN_REPLY);
    expect(trainerFailureReply({ error: "provider_error" })).toBe(PROVIDER_DOWN_REPLY);
  });
});

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
