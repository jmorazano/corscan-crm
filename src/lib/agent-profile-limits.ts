import { visibleLength } from "@/lib/text-length";

/**
 * Topes de los campos del perfil del agente, en caracteres VISIBLES (un emoji
 * = 1, ver `visibleLength`). Puro: lo comparten el servidor (API, Entrenador,
 * MCP) y el formulario de /agent.
 *
 * `instructions` es el tope NORMAL. Desde 050 cada empresa puede subirlo a
 * `INSTRUCTIONS_EXTENDED_MAX` con `agent_profile.extended_instructions`: el
 * tope que vale para una empresa sale SIEMPRE de `instructionsLimit`.
 */
export const PROFILE_LIMITS = {
  name: 60,
  tone: 500,
  instructions: 15000,
  escalationRules: 6000,
  greeting: 1000,
} as const;

/** 050: tope de las instrucciones con «Instrucciones extendidas» activado. */
export const INSTRUCTIONS_EXTENDED_MAX = 30000;

/** El tope de instrucciones que vale para una empresa. */
export function instructionsLimit(extended: boolean | null | undefined): number {
  return extended ? INSTRUCTIONS_EXTENDED_MAX : PROFILE_LIMITS.instructions;
}

/** Los topes del perfil de una empresa (solo cambia `instructions`). */
export function profileLimitsFor(extended: boolean | null | undefined) {
  return { ...PROFILE_LIMITS, instructions: instructionsLimit(extended) };
}

const fmt = (n: number) => n.toLocaleString("es-AR");

/**
 * 050: por qué NO se puede guardar un cambio que toca las instrucciones o la
 * opción de extenderlas; `null` = se puede. Mira el estado que QUEDARÍA:
 *
 * - escribir instrucciones → contra el tope que queda vigente;
 * - apagar la opción → solo si lo guardado ya entra en el tope normal (nunca
 *   se recorta el texto de nadie);
 * - un cambio que no toca ninguna de las dos cosas no se revisa: prender o
 *   apagar el agente no puede fallar por un texto largo que ya estaba.
 */
export function instructionsProblem(input: {
  /** Lo guardado hoy. */
  current: { instructions: string | null; extended: boolean };
  /** Lo que pide el cambio (`undefined` = no lo toca). */
  patch: { instructions?: string | null; extended?: boolean };
}): string | null {
  const { current, patch } = input;
  const touchesText = patch.instructions !== undefined;
  const turnsOff = patch.extended === false && current.extended;
  if (!touchesText && !turnsOff) return null;

  const extended = patch.extended ?? current.extended;
  const text = touchesText ? patch.instructions : current.instructions;
  const length = visibleLength(text ?? "");
  const limit = instructionsLimit(extended);
  if (length <= limit) return null;

  if (!touchesText) {
    return `Las instrucciones tienen ${fmt(length)} caracteres: acortalas a ${fmt(limit)} o menos antes de desactivar las instrucciones extendidas.`;
  }
  return extended
    ? `Las instrucciones superan el tope de ${fmt(limit)} caracteres.`
    : `Las instrucciones superan el tope de ${fmt(limit)} caracteres. El propietario puede subirlo a ${fmt(INSTRUCTIONS_EXTENDED_MAX)} activando «Instrucciones extendidas» en la página Agente.`;
}
