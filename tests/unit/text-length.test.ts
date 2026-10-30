import { describe, expect, it } from "vitest";
import { PROFILE_LIMITS } from "@/lib/agent-profile-limits";
import { visibleLength } from "@/lib/text-length";
import { buildFollowUpPrompt } from "@/server/ai/follow-up";
import { profileUpdateSchema } from "@/server/ai/profile";
import { TrainerChange } from "@/server/ai/trainer-actions";

describe("visibleLength", () => {
  it("cuenta como una persona: emoji, bandera, familia y tilde valen 1", () => {
    expect(visibleLength("")).toBe(0);
    expect(visibleLength("hola")).toBe(4);
    expect(visibleLength("🌲")).toBe(1);
    expect("🌲".length).toBe(2);
    expect(visibleLength("🇦🇷")).toBe(1);
    expect(visibleLength("👨‍👩‍👧")).toBe(1);
    expect(visibleLength("👍🏽")).toBe(1);
    expect(visibleLength("é")).toBe(1); // é descompuesta
    expect(visibleLength("Cabaña ☀️ con 🏊")).toBe(14);
  });
});

describe("topes del perfil del agente", () => {
  it("instrucciones hasta 15.000 y reglas de derivación hasta 6.000", () => {
    expect(PROFILE_LIMITS.instructions).toBe(15000);
    expect(PROFILE_LIMITS.escalationRules).toBe(6000);
    expect(profileUpdateSchema.safeParse({ instructions: "x".repeat(15000) }).success).toBe(true);
    expect(profileUpdateSchema.safeParse({ instructions: "x".repeat(15001) }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ escalationRules: "x".repeat(6000) }).success).toBe(true);
    expect(profileUpdateSchema.safeParse({ escalationRules: "x".repeat(6001) }).success).toBe(false);
  });

  it("un texto con emojis se mide en caracteres visibles (el caso de los 7.996)", () => {
    // 14.990 letras + 10 emojis = 15.000 visibles, 15.010 unidades UTF-16.
    const text = "x".repeat(14990) + "🌲".repeat(10);
    expect(text.length).toBe(15010);
    expect(profileUpdateSchema.safeParse({ instructions: text }).success).toBe(true);
    expect(profileUpdateSchema.safeParse({ instructions: text + "🌲" }).success).toBe(false);
  });

  it("el nombre sigue recortado y obligatorio", () => {
    expect(profileUpdateSchema.parse({ name: "  Giuliana  " }).name).toBe("Giuliana");
    expect(profileUpdateSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ name: "x".repeat(61) }).success).toBe(false);
  });

  it("el Entrenador acepta reescribir las instrucciones completas con emojis", () => {
    const value = "x".repeat(14990) + "🌲".repeat(10);
    expect(TrainerChange.safeParse({ op: "profile_set", field: "instructions", value }).success).toBe(true);
  });

  it("los recordatorios automáticos reciben las instrucciones COMPLETAS (antes se cortaban en 4.000)", () => {
    const instructions = "a".repeat(9000) + " FINAL_DE_LAS_INSTRUCCIONES";
    const p = buildFollowUpPrompt({
      profile: { name: "Giuliana", tone: null, instructions },
      step: 1,
      greetingName: null,
      fallback: "¡Hola!",
    });
    expect(p).toContain("FINAL_DE_LAS_INSTRUCCIONES");
  });
});
