/**
 * Saneo de etiquetas de segmentación (004): trim, minúsculas, sin vacías,
 * únicas, con topes. Compartido por import (cliente y server), rutas de
 * contactos y campañas — una sola definición de "tag válida".
 */

export const MAX_TAGS_PER_CONTACT = 20;
export const MAX_TAG_LENGTH = 40;

export function sanitizeTags(input: readonly string[] | undefined | null): string[] {
  if (!input) return [];
  const seen = new Set<string>();
  for (const raw of input) {
    const tag = raw.trim().toLowerCase().slice(0, MAX_TAG_LENGTH);
    if (!tag) continue;
    seen.add(tag);
    if (seen.size >= MAX_TAGS_PER_CONTACT) break;
  }
  return [...seen];
}

/** Une dos juegos de tags ya saneados preservando el tope. */
export function mergeTags(a: readonly string[], b: readonly string[]): string[] {
  return sanitizeTags([...a, ...b]);
}

/** Parsea la celda de etiquetas de un archivo ("vip, clientes-2025"). */
export function parseTagsCell(cell: string | null | undefined): string[] {
  if (!cell) return [];
  return sanitizeTags(cell.split(/[,;]/));
}

/* ============================================================
 * Filtros y operaciones en bloque (006)
 * ============================================================ */

/** Modo del filtro multi-etiqueta: `any` = al menos una · `all` = todas. */
export type TagMode = "any" | "all";

export function parseTagMode(value: string | null | undefined): TagMode {
  return value === "all" ? "all" : "any";
}

/**
 * Parsea el query param `tags=a,b` (CSV) a etiquetas saneadas. Acepta también
 * el alias `tag=` de la feature 004 cuando se le pasa como segundo valor.
 */
export function parseTagsParam(
  value: string | null | undefined,
  legacy?: string | null
): string[] {
  const raw = value && value.trim() ? value : legacy;
  if (!raw) return [];
  return sanitizeTags(raw.split(","));
}

export function serializeTagsParam(tags: readonly string[]): string {
  return sanitizeTags(tags).join(",");
}

export type TagOps = {
  add?: readonly string[];
  remove?: readonly string[];
};

/**
 * Aplica agregar/quitar sobre un juego de etiquetas: primero quita, después
 * agrega (así `remove` y `add` con la misma etiqueta termina agregándola).
 * Idempotente: aplicar dos veces da el mismo resultado.
 */
export function applyTagOps(
  current: readonly string[],
  ops: TagOps
): string[] {
  const remove = new Set(sanitizeTags(ops.remove));
  const add = sanitizeTags(ops.add);
  const kept = sanitizeTags(current).filter((t) => !remove.has(t));
  return sanitizeTags([...kept, ...add]);
}

/** Igualdad de conjuntos (el orden no importa). */
export function sameTagSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((t) => set.has(t));
}
