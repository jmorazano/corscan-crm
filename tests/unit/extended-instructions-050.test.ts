import { describe, expect, it } from "vitest";
import {
  INSTRUCTIONS_EXTENDED_MAX,
  instructionsLimit,
  instructionsProblem,
  PROFILE_LIMITS,
  profileLimitsFor,
} from "@/lib/agent-profile-limits";
import { ProfileError, profileUpdateSchema, updateProfile, type AgentProfile } from "@/server/ai/profile";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import { TrainerChange } from "@/server/ai/trainer-actions";
import { buildTrainerSystemPrompt } from "@/server/ai/trainer-prompts";
import type { DbOrTx } from "@/server/kb/service";

/**
 * 050: cada empresa puede subir el tope de las instrucciones del agente de
 * 15.000 a 30.000 caracteres. La regla es pura (`instructionsProblem`) y se
 * aplica en un único punto del servidor (`updateProfile`).
 */

const x = (n: number) => "x".repeat(n);

describe("tope de instrucciones por empresa", () => {
  it("15.000 por defecto, 30.000 con la opción; los demás campos no cambian", () => {
    expect(instructionsLimit(false)).toBe(15000);
    expect(instructionsLimit(null)).toBe(15000);
    expect(instructionsLimit(undefined)).toBe(15000);
    expect(instructionsLimit(true)).toBe(30000);
    expect(INSTRUCTIONS_EXTENDED_MAX).toBe(30000);
    expect(profileLimitsFor(true)).toEqual({ ...PROFILE_LIMITS, instructions: 30000 });
    expect(profileLimitsFor(false)).toEqual(PROFILE_LIMITS);
  });
});

describe("instructionsProblem", () => {
  const off = { instructions: x(100), extended: false };
  const on = { instructions: x(100), extended: true };

  it("sin la opción: 15.000 entra, 15.001 no, y el motivo dice cómo subir el tope", () => {
    expect(instructionsProblem({ current: off, patch: { instructions: x(15000) } })).toBeNull();
    const problem = instructionsProblem({ current: off, patch: { instructions: x(15001) } });
    expect(problem).toContain("15.000");
    expect(problem).toContain("Instrucciones extendidas");
  });

  it("con la opción: 30.000 entra, 30.001 no", () => {
    expect(instructionsProblem({ current: on, patch: { instructions: x(30000) } })).toBeNull();
    const problem = instructionsProblem({ current: on, patch: { instructions: x(30001) } });
    expect(problem).toContain("30.000");
    expect(problem).not.toContain("activando");
  });

  it("prender la opción y guardar el texto largo en el MISMO pedido entra", () => {
    expect(
      instructionsProblem({ current: off, patch: { instructions: x(20000), extended: true } })
    ).toBeNull();
  });

  it("apagar la opción con más de 15.000 guardados se rechaza: nunca se recorta el texto", () => {
    const long = { instructions: x(20000), extended: true };
    const problem = instructionsProblem({ current: long, patch: { extended: false } });
    expect(problem).toContain("20.000");
    expect(problem).toContain("antes de desactivar");
    // Acortar y apagar en el mismo pedido sí.
    expect(
      instructionsProblem({ current: long, patch: { instructions: x(15000), extended: false } })
    ).toBeNull();
    // Y apagar con un texto que ya entra, también.
    expect(instructionsProblem({ current: on, patch: { extended: false } })).toBeNull();
  });

  it("un cambio que no toca las instrucciones ni la opción nunca falla por un texto largo", () => {
    const stale = { instructions: x(20000), extended: false };
    expect(instructionsProblem({ current: stale, patch: {} })).toBeNull();
    // El formulario manda la opción con su valor actual: sigue sin revisarse.
    expect(instructionsProblem({ current: stale, patch: { extended: false } })).toBeNull();
  });

  it("vaciar las instrucciones siempre se puede", () => {
    expect(instructionsProblem({ current: off, patch: { instructions: null } })).toBeNull();
  });

  it("cuenta caracteres visibles: 15.000 emojis entran sin la opción", () => {
    expect(instructionsProblem({ current: off, patch: { instructions: "🌲".repeat(15000) } })).toBeNull();
    expect(instructionsProblem({ current: off, patch: { instructions: "🌲".repeat(15001) } })).not.toBeNull();
  });
});

describe("contratos de entrada", () => {
  it("la API acepta la opción y hasta 30.000 de forma (el tope por empresa lo pone el servicio)", () => {
    expect(profileUpdateSchema.parse({ extendedInstructions: true })).toEqual({ extendedInstructions: true });
    expect(() => profileUpdateSchema.parse({ extendedInstructions: "si" })).toThrow();
    expect(profileUpdateSchema.safeParse({ instructions: x(30000) }).success).toBe(true);
    expect(profileUpdateSchema.safeParse({ instructions: x(30001) }).success).toBe(false);
  });

  it("el Entrenador puede reescribir instrucciones de hasta 30.000", () => {
    expect(TrainerChange.safeParse({ op: "profile_set", field: "instructions", value: x(30000) }).success).toBe(true);
    expect(TrainerChange.safeParse({ op: "profile_set", field: "instructions", value: x(30001) }).success).toBe(false);
  });
});

describe("updateProfile aplica el tope de la empresa", () => {
  /** BD mínima: un perfil guardado; `update` devuelve el perfil con el parche. */
  function dbWith(saved: Partial<AgentProfile>) {
    const before = { name: "Giuliana", instructions: null, extendedInstructions: false, ...saved } as AgentProfile;
    const writes: Record<string, unknown>[] = [];
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [before] }) }) }),
      update: () => ({
        set: (set: Record<string, unknown>) => {
          writes.push(set);
          return { where: () => ({ returning: async () => [{ ...before, ...set }] }) };
        },
      }),
    } as unknown as DbOrTx;
    return { db, writes };
  }

  it("sin la opción rechaza 15.001 SIN escribir nada", async () => {
    const { db, writes } = dbWith({});
    await expect(updateProfile("org_1", { instructions: x(15001) }, db)).rejects.toBeInstanceOf(ProfileError);
    expect(writes).toEqual([]);
  });

  it("con la opción guarda 30.000 y rechaza 30.001", async () => {
    const { db, writes } = dbWith({ extendedInstructions: true });
    const { after } = await updateProfile("org_1", { instructions: x(30000) }, db);
    expect(after.instructions).toHaveLength(30000);
    expect(writes).toHaveLength(1);
    await expect(updateProfile("org_1", { instructions: x(30001) }, db)).rejects.toMatchObject({ code: "invalid" });
  });

  it("no deja apagar la opción con 20.000 guardados, pero sí prender o apagar el agente", async () => {
    const { db, writes } = dbWith({ extendedInstructions: true, instructions: x(20000) });
    await expect(updateProfile("org_1", { extendedInstructions: false }, db)).rejects.toMatchObject({
      code: "invalid",
      message: expect.stringContaining("20.000"),
    });
    expect(writes).toEqual([]);
    await updateProfile("org_1", { enabled: false }, db);
    expect(writes).toEqual([expect.objectContaining({ enabled: false })]);
  });
});

describe("las instrucciones extendidas llegan ENTERAS al modelo", () => {
  const tail = " FINAL_DE_LAS_INSTRUCCIONES_050";
  const instructions = x(30000 - tail.length) + tail;
  const profile = {
    name: "Giuliana",
    enabled: true,
    tone: null,
    instructions,
    escalationRules: null,
    greeting: null,
    extendedInstructions: true,
    followUpTimezone: "America/Argentina/Cordoba",
    followUpStartHour: 9,
    followUpEndHour: 21,
  } as AgentProfile;

  it("30.000 caracteres: ni el agente ni el Entrenador las recortan", () => {
    expect(instructions).toHaveLength(30000);
    const agent = buildAgentSystemPrompt({ profile, kb: [], stages: [{ name: "Nuevo" }] });
    expect(agent).toContain("FINAL_DE_LAS_INSTRUCCIONES_050");
    const trainer = buildTrainerSystemPrompt({ profile, kb: [], kbChars: 0, warnAt: 24_000 });
    expect(trainer).toContain("FINAL_DE_LAS_INSTRUCCIONES_050");
  });
});
