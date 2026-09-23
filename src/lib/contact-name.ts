/**
 * Validación PURA del nombre que el agente aprende de la conversación (021).
 *
 * El modelo propone; esto decide. Un nombre que entra acá se escribe en el
 * contacto y se ve en la bandeja, en el pipeline y en las campañas, así que
 * la barra es alta: lo que no parece un nombre se descarta en silencio y el
 * contacto se queda como estaba.
 *
 * Sin imports, sin estado, sin I/O.
 */

export const CONTACT_NAME_MIN = 2;
export const CONTACT_NAME_MAX = 60;
/** Nadie se llama con siete palabras; siete palabras son una oración. */
const MAX_WORDS = 5;

/**
 * Arranques que el modelo copia del mensaje del huésped («mi nombre es
 * Santiago Pintos»). Se recortan en vez de rechazar: el nombre correcto
 * está ahí y tirarlo sería perder el dato por una formalidad.
 */
const LEAD_INS = [
  /^\s*mi\s+nombre\s+es\s+/i,
  /^\s*me\s+llamo\s+/i,
  /^\s*soy\s+/i,
  /^\s*habla\s+/i,
  /^\s*mi\s+nombre:\s*/i,
  /^\s*nombre:\s*/i,
];

/** Letras (con acentos y ñ), espacios y los signos que aparecen en nombres. */
const NAME_SHAPE = /^[\p{L}][\p{L}\p{M}'’.\- ]*$/u;

/**
 * Devuelve el nombre listo para guardar, o `null` si lo propuesto no es un
 * nombre. Normaliza espacios pero NO cambia mayúsculas: «de la Fuente» y
 * «McDonald» se escriben así y corregirlos sería peor.
 */
export function normalizeContactName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  let value = raw.replace(/\s+/g, " ").trim();
  for (const leadIn of LEAD_INS) {
    const stripped = value.replace(leadIn, "");
    if (stripped !== value) {
      value = stripped.trim();
      break;
    }
  }
  // Puntuación de cierre que arrastra una frase copiada.
  value = value.replace(/[.,;:!?]+$/u, "").trim();

  if (value.length < CONTACT_NAME_MIN || value.length > CONTACT_NAME_MAX) return null;
  // Un número de teléfono, un importe o una fecha no son un nombre.
  if (/\d/.test(value)) return null;
  if (/https?:|www\.|@/i.test(value)) return null;
  if (value.split(" ").length > MAX_WORDS) return null;
  if (!NAME_SHAPE.test(value)) return null;
  // Al menos dos letras seguidas: descarta «A.» y la puntuación suelta.
  if (!/\p{L}{2}/u.test(value)) return null;

  return value;
}
