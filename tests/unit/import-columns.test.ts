import { describe, expect, it } from "vitest";
import { detectColumns, extractRows } from "@/lib/import-columns";

/**
 * FR-003 + edge cases de US1: detección de columnas por sinónimos ES/EN,
 * encabezados que no están en la primera fila, y hoja vacía con error claro.
 */

describe("detectColumns", () => {
  it("sinónimos ES con acentos", () => {
    const d = detectColumns([["Teléfono", "Nombre", "Etiquetas", "Notas"]]);
    expect(d).toEqual({
      ok: true,
      mapping: { headerRow: 0, phone: 0, name: 1, tags: 2, notes: 3 },
    });
  });

  it("sinónimos EN y orden distinto", () => {
    const d = detectColumns([["Name", "WhatsApp", "Tags"]]);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.mapping.phone).toBe(1);
      expect(d.mapping.name).toBe(0);
      expect(d.mapping.tags).toBe(2);
      expect(d.mapping.notes).toBeNull();
    }
  });

  it("encabezados en la fila 2 (título arriba)", () => {
    const d = detectColumns([
      ["Listado de clientes 2026", null, null],
      ["Celular", "Cliente", "Observaciones"],
      ["351123", "Ana", ""],
    ]);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.mapping.headerRow).toBe(1);
      expect(d.mapping.phone).toBe(0);
      expect(d.mapping.notes).toBe(2);
    }
  });

  it("hoja vacía → sin_filas", () => {
    expect(detectColumns([])).toEqual({ ok: false, reason: "sin_filas" });
  });

  it("sin columna de teléfono reconocible → error claro", () => {
    const d = detectColumns([["Apellido", "Dirección"]]);
    expect(d).toEqual({ ok: false, reason: "sin_columna_telefono" });
  });
});

describe("extractRows", () => {
  it("salta filas vacías y reporta el número de fila del ARCHIVO", () => {
    const rows = [
      ["Teléfono", "Nombre"],
      ["+54 9 351 688 2200", "Ana"],
      [null, null],
      ["+54 9 351 688 2201", ""],
    ];
    const d = detectColumns(rows);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const extracted = extractRows(rows, d.mapping);
    expect(extracted).toHaveLength(2);
    expect(extracted[0]).toMatchObject({ fileRow: 2, phone: "+54 9 351 688 2200", name: "Ana" });
    expect(extracted[1]).toMatchObject({ fileRow: 4, name: "" });
  });
});
