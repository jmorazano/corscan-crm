/**
 * Paginación (006): Contactos pagina por número de página (offset) y la
 * Bandeja por cursor keyset sobre (fecha del último mensaje, id), que no se
 * corre cuando entran conversaciones nuevas arriba.
 */

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

function parsePositiveInt(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** `page=N` (1-based); inválido → 1. */
export function parsePage(value: string | null | undefined): number {
  return parsePositiveInt(value) ?? 1;
}

/** `limit=N` acotado a [1, MAX_PAGE_SIZE]; inválido → default. */
export function parseLimit(
  value: string | null | undefined,
  fallback = DEFAULT_PAGE_SIZE
): number {
  const n = parsePositiveInt(value);
  if (n === null) return fallback;
  return Math.min(n, MAX_PAGE_SIZE);
}

export type Cursor = { ts: Date; id: string };

/** Cursor opaco `"<iso>|<id>"` del último elemento de la página. */
export function encodeCursor(cursor: Cursor): string {
  return `${cursor.ts.toISOString()}|${cursor.id}`;
}

export function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value) return null;
  const sep = value.indexOf("|");
  if (sep <= 0 || sep === value.length - 1) return null;
  const ts = new Date(value.slice(0, sep));
  const id = value.slice(sep + 1);
  if (Number.isNaN(ts.getTime()) || !/^[a-z0-9_]+$/i.test(id)) return null;
  return { ts, id };
}
