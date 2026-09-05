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
