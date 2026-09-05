/**
 * Detección de columnas del import de contactos (004, FR-003): módulo puro
 * compartido por el wizard (navegador) y los tests. Busca la fila de
 * encabezados en las primeras filas (tolera títulos arriba, p. ej.
 * encabezados en la fila 2) y mapea por sinónimos ES/EN.
 */

export type RawCell = string | number | boolean | Date | null | undefined;

export type ColumnMapping = {
  headerRow: number;
  phone: number;
  name: number | null;
  tags: number | null;
  notes: number | null;
};

export type ColumnDetection =
  | { ok: true; mapping: ColumnMapping }
  | { ok: false; reason: "sin_filas" | "sin_columna_telefono" };

const SYNONYMS: Record<Exclude<keyof ColumnMapping, "headerRow">, string[]> = {
  phone: [
    "telefono",
    "phone",
    "celular",
    "movil",
    "whatsapp",
    "numero",
    "tel",
    "cel",
  ],
  name: ["nombre", "name", "cliente", "contacto", "razon social"],
  tags: ["etiquetas", "etiqueta", "tags", "tag", "segmento", "grupo"],
  notes: ["notas", "nota", "notes", "observaciones", "comentarios"],
};

const HEADER_SEARCH_ROWS = 5;

function normalizeHeader(cell: RawCell): string {
  return String(cell ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function matchColumn(
  headers: string[],
  field: keyof typeof SYNONYMS
): number | null {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (!h) continue;
    if (SYNONYMS[field].some((s) => h === s || h.includes(s))) return i;
  }
  return null;
}

export function detectColumns(rows: RawCell[][]): ColumnDetection {
  if (rows.length === 0) return { ok: false, reason: "sin_filas" };

  const limit = Math.min(rows.length, HEADER_SEARCH_ROWS);
  for (let r = 0; r < limit; r++) {
    const headers = (rows[r] ?? []).map(normalizeHeader);
    const phone = matchColumn(headers, "phone");
    if (phone === null) continue;
    return {
      ok: true,
      mapping: {
        headerRow: r,
        phone,
        name: matchColumn(headers, "name"),
        tags: matchColumn(headers, "tags"),
        notes: matchColumn(headers, "notes"),
      },
    };
  }
  return { ok: false, reason: "sin_columna_telefono" };
}

export type ExtractedRow = {
  /** Índice de fila en el ARCHIVO (1-based, encabezado incluido) para que el
   * reporte de inválidas apunte a la fila que el operador ve. */
  fileRow: number;
  phone: string;
  name: string;
  tagsCell: string;
  notes: string;
};

/** Extrae las filas de datos (posteriores al encabezado), saltando vacías. */
export function extractRows(
  rows: RawCell[][],
  mapping: ColumnMapping
): ExtractedRow[] {
  const out: ExtractedRow[] = [];
  for (let r = mapping.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const cell = (i: number | null): string =>
      i === null ? "" : String(row[i] ?? "").trim();
    const phone = cell(mapping.phone);
    const name = cell(mapping.name);
    const tagsCell = cell(mapping.tags);
    const notes = cell(mapping.notes);
    if (!phone && !name && !tagsCell && !notes) continue; // fila vacía
    out.push({ fileRow: r + 1, phone, name, tagsCell, notes });
  }
  return out;
}
