/**
 * Topes de los campos del perfil del agente, en caracteres VISIBLES (un emoji
 * = 1, ver `visibleLength`). Puro: lo comparten el servidor (API, Entrenador,
 * MCP) y el formulario de /agent.
 */
export const PROFILE_LIMITS = {
  name: 60,
  tone: 500,
  instructions: 15000,
  escalationRules: 6000,
  greeting: 1000,
} as const;
