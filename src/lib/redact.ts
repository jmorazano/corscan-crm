/**
 * Redacción de secretos en texto que puede terminar en un log, en una
 * respuesta HTTP o en una columna de la base (016, corrección #14).
 *
 * Por qué por VALOR y no por forma: `redactSecrets` (hoy privada en
 * `src/lib/ai/index.ts:334`) solo reconoce el prefijo `sk-…` de OpenAI. La
 * credencial de un PMS arbitrario es una cadena opaca sin prefijo
 * reconocible, así que ningún patrón genérico de "bearer" la encuentra sin
 * producir falsos positivos masivos. La única redacción que funciona es la
 * que compara contra el valor exacto del secreto que tenemos en mano.
 *
 * El patrón `sk-` se CONSERVA como cinturón adicional: cubre el caso en que
 * el texto ajeno traiga una credencial que no es la nuestra.
 *
 * Módulo hoja: sin imports, para que lo pueda usar cualquier capa (incluido
 * `src/lib/mcp/`, que es puro por contrato constitucional).
 */

const MASK = "***";

/** Longitud mínima de un secreto redactable: menos que esto produce falsos
 * positivos que destruyen el texto (un "abc" borraría medio mensaje). */
const MIN_SECRET_CHARS = 8;

/**
 * Reemplaza cada aparición EXACTA de cada secreto — y sus dos codificaciones
 * habituales, porcentual (URL) y base64 (header/cuerpo) — por `***`.
 * Los `null`/`undefined` y los secretos demasiado cortos se ignoran.
 */
export function redactValue(
  text: string,
  ...secrets: (string | null | undefined)[]
): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret || secret.length < MIN_SECRET_CHARS) continue;
    for (const form of secretForms(secret)) {
      if (!form) continue;
      out = out.split(form).join(MASK);
    }
  }
  return out;
}

/** Las formas en que un mismo secreto puede aparecer en un texto. */
function secretForms(secret: string): string[] {
  const forms = new Set<string>([secret]);
  try {
    forms.add(encodeURIComponent(secret));
  } catch {
    // secreto con sustitutos sueltos: la forma cruda alcanza
  }
  try {
    forms.add(Buffer.from(secret, "utf8").toString("base64"));
  } catch {
    // idem
  }
  return [...forms];
}

/**
 * Cinturón adicional por forma: API keys con prefijo reconocible (`sk-…`,
 * `sk-or-…`). Mismo patrón que `src/lib/ai/index.ts:334-336`, acá exportado.
 */
export function redactSecrets(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_-]{4,}/g, `sk-${MASK}`);
}

/** Trunca con puntos suspensivos, igual que el adaptador de IA. */
export function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Lo que se usa antes de cualquier `console.error`: por valor, por forma y
 * acotado. Nunca se loguean headers ni cuerpos sin pasar por acá.
 */
export function redactForLog(
  text: string,
  secrets: (string | null | undefined)[] = [],
  max = 300
): string {
  return truncate(redactSecrets(redactValue(text, ...secrets)), max);
}
