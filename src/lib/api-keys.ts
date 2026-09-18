import { createHash, randomBytes } from "node:crypto";

/**
 * Claves de API (014, research D1). Módulo PURO (sin BD): formato,
 * hash y prefijo visible.
 *
 * Formato: `vk_` + 32 bytes aleatorios en base64url (43 caracteres) —
 * 256 bits de entropía. En reposo solo vive el SHA-256 de la clave
 * completa; se busca por ese hash (índice único), así que no hace falta
 * comparación en tiempo constante: el atacante no controla qué fila se lee.
 */

export const API_KEY_PREFIX = "vk_";

/** Caracteres del prefijo visible: `vk_` + 8 (identifica sin revelar). */
export const API_KEY_VISIBLE_CHARS = API_KEY_PREFIX.length + 8;

const KEY_PATTERN = /^vk_[A-Za-z0-9_-]{43}$/;

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Prefijo visible de una clave (`vk_xxxxxxxx`), para listas y el hilo. */
export function apiKeyPrefix(key: string): string {
  return key.slice(0, API_KEY_VISIBLE_CHARS);
}

/** Forma válida de una clave completa (descarta basura antes de ir a BD). */
export function looksLikeApiKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/** Extrae el token del header `Authorization: Bearer …` (null si no hay). */
export function bearerFromHeader(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m?.[1] ?? null;
}
