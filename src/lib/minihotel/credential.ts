/**
 * Credencial de MiniHotel (028): usuario + contraseña de la API, guardados
 * como UN solo secreto cifrado (`mcp_integration.credential`), igual que el
 * token de un servidor MCP. Así hereda sin cambios todo el ciclo de vida de
 * 016: cifrado AES-256-GCM, `resolveCredential()` bajo demanda, borrado al
 * cambiar la dirección, «Desconectar» de la empresa.
 */

export type MiniHotelCredential = { username: string; password: string };

export const MINIHOTEL_USERNAME_MAX = 128;
export const MINIHOTEL_PASSWORD_MAX = 256;

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v.length > 0 && v.length <= max ? v : null;
}

/** Valida y normaliza lo que carga la empresa. `null` si falta algo. */
export function normalizeMiniHotelCredential(input: {
  username?: unknown;
  password?: unknown;
}): MiniHotelCredential | null {
  const username = clean(input.username, MINIHOTEL_USERNAME_MAX);
  const password = clean(input.password, MINIHOTEL_PASSWORD_MAX);
  return username && password ? { username, password } : null;
}

/** Lo que se cifra y se guarda. */
export function serializeMiniHotelCredential(c: MiniHotelCredential): string {
  return JSON.stringify({ username: c.username, password: c.password });
}

/** El secreto descifrado → credencial. Nunca lanza: corrupto ⇒ `null`. */
export function parseMiniHotelCredential(raw: string | null): MiniHotelCredential | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  return normalizeMiniHotelCredential({ username: o.username, password: o.password });
}

/** Lo único visible en la interfaz: los últimos 4 de la CONTRASEÑA. */
export function miniHotelCredentialLast4(c: MiniHotelCredential): string {
  return c.password.slice(-4);
}
