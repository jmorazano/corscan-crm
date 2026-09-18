/**
 * Detección PURA de "acuse de recibo" (014, FR-011 / research D5a).
 *
 * Tras una notificación transaccional enviada por API («te recordamos tu
 * check-in…»), un «Gracias!», «Ok dale» o «👍» no merece respuesta del
 * agente. Esta heurística corta ANTES del proveedor LLM solo cuando el
 * mensaje ENTERO se compone de vocabulario de acuse: cualquier palabra
 * fuera del lexicón, o un signo de pregunta, lo deja pasar al modelo (que
 * recibe además la sección «NOTIFICACIÓN AUTOMÁTICA» del prompt).
 */

const ACK_WORDS = new Set([
  // confirmaciones
  "ok", "oka", "okey", "okay", "okk", "dale", "listo", "lista", "va", "vale",
  "bueno", "buenisimo", "buenisima", "barbaro", "barbara", "joya", "genial",
  "perfecto", "perfecta", "excelente", "recibido", "recibida", "entendido",
  "entendida", "anotado", "anotada", "confirmado", "confirmada", "confirmo",
  "si", "sip", "claro", "obvio", "ya", "esta", "todo", "bien", "super",
  "copiado", "visto", "ahi", "nos", "vemos", "alli", "estaremos", "gracias",
  "graciass", "grasias", "muchas", "muchisimas", "mil", "agradezco", "de",
  "nada", "por", "avisar", "la", "info", "informacion", "el", "aviso",
  "recordatorio", "buen", "buena", "buenas", "buenos", "dia", "dias", "tarde",
  "tardes", "noche", "noches", "hola", "saludos", "abrazo", "chau", "adios",
  "hasta", "luego", "pronto", "igualmente", "que", "tengan", "tengas", "lindo",
  "linda", "genia", "genio", "capo", "crack", "amigo", "amiga", "y", "a",
  "vos", "usted", "ustedes", "les", "te", "lo", "los", "las", "un", "una",
  "estamos", "quedamos", "en", "contacto", "gracia", "thanks", "thank", "you",
]);

const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s️]+$/u;

const MAX_WORDS = 12;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\p{Extended_Pictographic}️]/gu, " ")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * true si el texto es SOLO un acuse de recibo/agradecimiento/confirmación.
 * Sin texto (media) → false: puede ser una pregunta en audio o una foto
 * del problema; que decida el modelo.
 */
export function isPlainAcknowledgment(text: string | null | undefined): boolean {
  const raw = text?.trim() ?? "";
  if (!raw) return false;
  if (/[?¿]/.test(raw)) return false;
  if (EMOJI_ONLY.test(raw)) return true;
  const words = normalize(raw).split(" ").filter(Boolean);
  if (words.length === 0) return true; // solo puntuación/emojis
  if (words.length > MAX_WORDS) return false;
  return words.every((w) => ACK_WORDS.has(w));
}
