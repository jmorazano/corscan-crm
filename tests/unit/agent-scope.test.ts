import { describe, expect, it } from "vitest";
import {
  agentScopeChangeSchema,
  agentScopeStateText,
  existingConversationsUpdate,
  newConversationAiEnabled,
} from "@/lib/agent-scope";
import { trainerVisible } from "@/lib/trainer";

describe("modo de prueba del agente", () => {
  it("las conversaciones nuevas nacen apagadas solo en modo de prueba", () => {
    expect(newConversationAiEnabled("selected")).toBe(false);
    expect(newConversationAiEnabled("all")).toBe(true);
    // Sin perfil: lo de siempre.
    expect(newConversationAiEnabled(null)).toBe(true);
  });

  it("pasar a modo de prueba apaga las existentes; repetirlo no", () => {
    expect(existingConversationsUpdate({ scope: "selected" }, "all")).toBe(false);
    // Ya en prueba: no se borran las que el equipo prendió.
    expect(existingConversationsUpdate({ scope: "selected" }, "selected")).toBeNull();
  });

  it("volver a todas prende las apagadas solo si se pide", () => {
    expect(existingConversationsUpdate({ scope: "all", enableExisting: true }, "selected")).toBe(true);
    expect(existingConversationsUpdate({ scope: "all", enableExisting: false }, "selected")).toBeNull();
  });

  it("valida el cambio", () => {
    expect(agentScopeChangeSchema.safeParse({ scope: "selected", enableAgent: true }).success).toBe(true);
    // A «todas» hay que decir qué pasa con las apagadas.
    expect(agentScopeChangeSchema.safeParse({ scope: "all" }).success).toBe(false);
    expect(agentScopeChangeSchema.safeParse({ scope: "algunas" }).success).toBe(false);
  });

  it("explica el estado", () => {
    expect(agentScopeStateText({ scope: "all", total: 10, aiOn: 10, aiOff: 0 })).toBe(
      "Responde en todas las conversaciones."
    );
    expect(agentScopeStateText({ scope: "all", total: 10, aiOn: 9, aiOff: 1 })).toBe(
      "Responde en todas, salvo 1 conversación pausada."
    );
    expect(agentScopeStateText({ scope: "selected", total: 1200, aiOn: 0, aiOff: 1200 })).toMatch(
      /ninguna conversación/
    );
    expect(agentScopeStateText({ scope: "selected", total: 1200, aiOn: 3, aiOff: 1197 })).toBe(
      "Modo de prueba: responde solo en 3 conversaciones de 1.200."
    );
  });

  it("el Entrenador no aparece bajo «IA prendida»", () => {
    expect(trainerVisible({ filter: "ai_on", q: null, tags: [], unreadCount: 0 })).toBe(false);
    expect(trainerVisible({ filter: null, q: null, tags: [], unreadCount: 0 })).toBe(true);
  });
});
