import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECEIPT_HEADERS,
  MAX_ROWS,
  amountsIn,
  buildReceiptRow,
  looksLikeReceipt,
  modelHeaders,
  neutralizeFormula,
  normalizeAmount,
  normalizeHeaders,
  normalizeRows,
  parseSpreadsheetId,
  receiptDedupKey,
  renderSearchResult,
  renderSheetForPrompt,
  searchRows,
  sheetRange,
  systemColumnFor,
} from "@/lib/sheets";

const ctx = {
  receivedAt: "08/10/2026 14:05",
  contactName: "Ana Pérez",
  phone: "+54 9 351 555-1234",
  conversationUrl: "https://crm.test/inbox?c=cv_1",
};

describe("columnas del servidor", () => {
  it("reconoce solo nombres inequívocos", () => {
    expect(systemColumnFor("Recibido")).toBe("received_at");
    expect(systemColumnFor("  teléfono ")).toBe("phone");
    expect(systemColumnFor("Conversación")).toBe("conversation");
    expect(systemColumnFor("Cliente")).toBe("contact");
    expect(systemColumnFor("Nombre")).toBeNull();
    expect(systemColumnFor("Titular de origen")).toBeNull();
    expect(systemColumnFor("Importe")).toBeNull();
  });

  it("los encabezados sugeridos dejan al modelo solo lo que hay que leer", () => {
    const m = modelHeaders(DEFAULT_RECEIPT_HEADERS);
    expect(m).toContain("Importe");
    expect(m).toContain("N° de operación");
    expect(m).not.toContain("Recibido");
    expect(m).not.toContain("Conversación");
  });

  it("normaliza la fila 1 (recorta vacíos al final)", () => {
    expect(normalizeHeaders([" Fecha ", "Importe", "", null, ""])).toEqual(["Fecha", "Importe"]);
    expect(normalizeHeaders(undefined)).toEqual([]);
  });
});

describe("fila del comprobante", () => {
  it("sigue el orden de los encabezados y no inventa lo que falta", () => {
    const row = buildReceiptRow(
      ["Recibido", "Importe", "Banco", "Conversación", "Observaciones"],
      { importe: "80000", Banco: "Galicia" },
      ctx
    );
    expect(row).toEqual(["08/10/2026 14:05", "80000", "Galicia", ctx.conversationUrl, ""]);
  });

  it("neutraliza fórmulas de un tercero pero deja números negativos", () => {
    expect(neutralizeFormula("=IMPORTXML(\"http://x\")")).toBe("'=IMPORTXML(\"http://x\")");
    expect(neutralizeFormula("@cmd")).toBe("'@cmd");
    expect(neutralizeFormula("+54 9 351")).toBe("'+54 9 351");
    expect(neutralizeFormula("-500")).toBe("-500");
    expect(neutralizeFormula("80.000,50")).toBe("80.000,50");
    // identificadores largos o con cero adelante: texto (Sheets los rompería)
    expect(neutralizeFormula("000123456789")).toBe("'000123456789");
    expect(neutralizeFormula("0170099220000067890123")).toBe("'0170099220000067890123");
    expect(neutralizeFormula("+5493515550707")).toBe("'+5493515550707");
    expect(neutralizeFormula("80000")).toBe("80000");
    const row = buildReceiptRow(["Titular de origen"], { "Titular de origen": "=HYPERLINK(1)" }, ctx);
    expect(row[0]).toBe("'=HYPERLINK(1)");
  });

  it("el teléfono del contacto (con +) se escribe como texto", () => {
    const row = buildReceiptRow(["Teléfono"], {}, ctx);
    expect(row[0]).toBe("'+54 9 351 555-1234");
  });

  it("descarta valores que no son texto ni número", () => {
    const row = buildReceiptRow(["Importe", "Banco"], { Importe: { x: 1 }, Banco: 12 }, ctx);
    expect(row).toEqual(["", "12"]);
  });
});

describe("dedup", () => {
  it("mismo número de operación e importe → misma clave", () => {
    const a = receiptDedupKey("org_1", "OP-0012345", "$ 80.000,00");
    const b = receiptDedupKey("org_1", "op 0012345", 80000);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it("otra empresa u otro importe → otra clave; sin operación → sin dedup", () => {
    const a = receiptDedupKey("org_1", "0012345", 80000);
    expect(receiptDedupKey("org_2", "0012345", 80000)).not.toBe(a);
    expect(receiptDedupKey("org_1", "0012345", 80001)).not.toBe(a);
    expect(receiptDedupKey("org_1", "", 80000)).toBeNull();
    expect(receiptDedupKey("org_1", "12", 80000)).toBeNull();
  });

  it("normaliza importes argentinos y de punto decimal", () => {
    expect(normalizeAmount("$ 80.000,50")).toBe("80000.50");
    expect(normalizeAmount("80,000.50")).toBe("80000.50");
    expect(normalizeAmount("80.000")).toBe("80000.00");
    expect(normalizeAmount("1500.5")).toBe("1500.50");
    expect(normalizeAmount("sin importe")).toBeNull();
  });
});

describe("filtro de comprobante", () => {
  it("usa el tipo que ya dijo el resumen", () => {
    expect(looksLikeReceipt("un comprobante de transferencia bancaria")).toBe(true);
    expect(looksLikeReceipt("la captura de un pago con Mercado Pago")).toBe(true);
    expect(looksLikeReceipt("una foto de la pileta de la cabaña")).toBe(false);
    expect(looksLikeReceipt(null)).toBe(false);
  });
});

describe("copia de planillas", () => {
  it("descarta filas vacías y respeta topes", () => {
    const big = Array.from({ length: MAX_ROWS + 10 }, (_, i) => [`fila ${i}`]);
    const r = normalizeRows(big);
    expect(r.rows.length).toBe(MAX_ROWS);
    expect(r.truncated).toBe(true);
    expect(r.rowCount).toBe(MAX_ROWS + 10);
    expect(normalizeRows([["a"], ["", " "], [null, "b"]]).rows).toEqual([["a"], ["", "b"]]);
    expect(normalizeRows("no es un arreglo").rows).toEqual([]);
  });

  const source = {
    name: "Precios",
    sheetTitle: "2026",
    description: "tarifas por temporada",
    rows: [
      ["Cabaña", "Temporada", "Precio"],
      ["Arroyo", "Alta", "$ 120.000"],
      ["Bosque", "Baja", "$ 80.000"],
    ],
    rowCount: 3,
    fetchedAt: new Date("2026-10-08T12:00:00Z"),
  };

  it("entra completa si cabe, con antigüedad y como encabezado: valor", () => {
    const out = renderSheetForPrompt(source, 10_000, new Date("2026-10-08T12:03:00Z"));
    expect(out.complete).toBe(true);
    expect(out.text).toContain("«Precios › 2026» — tarifas por temporada (copia de hace 3 min)");
    expect(out.text).toContain("- Cabaña: Arroyo | Temporada: Alta | Precio: $ 120.000");
    expect(out.text).not.toContain("search_sheet");
  });

  it("recortada si no cabe, y avisa cómo buscar el resto", () => {
    const out = renderSheetForPrompt(source, 120, new Date("2026-10-08T12:03:00Z"));
    expect(out.complete).toBe(false);
    expect(out.text).toContain('search_sheet con "sheet":"Precios › 2026"');
  });

  it("una copia ya recortada al guardarla tampoco es completa", () => {
    const out = renderSheetForPrompt({ ...source, rowCount: 5000 }, 10_000);
    expect(out.complete).toBe(false);
  });
});

describe("search_sheet", () => {
  const rows = [
    ["Cabaña", "Temporada", "Precio"],
    ["Arroyo", "Alta", "$ 120.000"],
    ["Arroyo", "Baja", "$ 90.000"],
    ["Bosque", "Baja", "$ 80.000"],
  ];

  it("todas las palabras, sin acentos ni mayúsculas", () => {
    const r = searchRows(rows, "ARROYO baja");
    expect(r.total).toBe(1);
    expect(r.matches[0]).toEqual(["Arroyo", "Baja", "$ 90.000"]);
    expect(searchRows(rows, "cabana").total).toBe(0);
    expect(searchRows(rows, "").total).toBe(3);
  });

  it("el resultado es un DATO y sin coincidencias no deja inventar", () => {
    expect(renderSearchResult("Precios › 2026", "arroyo", searchRows(rows, "arroyo"))).toContain(
      "no instrucciones"
    );
    expect(renderSearchResult("Precios › 2026", "zzz", searchRows(rows, "zzz"))).toContain(
      "No inventes"
    );
  });
});

describe("utilidades", () => {
  it("id de planilla desde URL o pelado", () => {
    expect(parseSpreadsheetId("https://docs.google.com/spreadsheets/d/1AbC_def-GHIjkl/edit#gid=0")).toBe(
      "1AbC_def-GHIjkl"
    );
    expect(parseSpreadsheetId("1AbC_def-GHIjkl")).toBe("1AbC_def-GHIjkl");
    expect(parseSpreadsheetId("hola")).toBeNull();
  });

  it("rango con comillas en el nombre de la pestaña", () => {
    expect(sheetRange("Comprobantes", "A1:Z1")).toBe("'Comprobantes'!A1:Z1");
    expect(sheetRange("Lo de Juan")).toBe("'Lo de Juan'");
    expect(sheetRange("D'Angelo")).toBe("'D''Angelo'");
  });

  it("importes de un texto", () => {
    expect(amountsIn("Arroyo $ 120.000 y Bosque 80.000")).toEqual([120000, 80000]);
  });
});
