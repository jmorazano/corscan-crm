/**
 * Vuelta del login y del cambio de contraseña al consentimiento de un
 * asistente (040, research D6). Módulo PURO.
 *
 * Solo se acepta volver a `/oauth/authorize?…` dentro del mismo sitio: un
 * `next` abierto sería una redirección arbitraria servida por el CRM.
 */

export const AUTHORIZE_PATH = "/oauth/authorize";

const MAX_NEXT_CHARS = 4096;

export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > MAX_NEXT_CHARS) return null;
  if (!raw.startsWith(`${AUTHORIZE_PATH}?`)) return null;
  if (/[\\\s]/.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw, "http://vocero.invalid");
  } catch {
    return null;
  }
  if (u.host !== "vocero.invalid" || u.pathname !== AUTHORIZE_PATH) return null;
  return `${u.pathname}${u.search}`;
}
