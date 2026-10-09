import { getGoogleMockState, nextMockN, type MockSpreadsheet } from "@/server/dev/google-mock-state";

/**
 * 034: API de Google Sheets simulada (solo lo que usa el cliente): crear,
 * metadatos, leer valores y agregar filas. Sin acceso (`granted=false`) →
 * 403, como una planilla que la persona no eligió con el selector.
 */

function colLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s || "A";
}

/** «'Mi pestaña'!A1:AD5» → { tab, fromRow, toRow } (filas 1-based). */
export function parseRange(range: string): { tab: string; fromRow: number | null; toRow: number | null } {
  const bang = range.lastIndexOf("!");
  const rawTab = bang === -1 ? range : range.slice(0, bang);
  const cells = bang === -1 ? "" : range.slice(bang + 1);
  const tab = rawTab.startsWith("'") && rawTab.endsWith("'") ? rawTab.slice(1, -1).replace(/''/g, "'") : rawTab;
  const m = /^[A-Z]+(\d+)(?::[A-Z]+(\d+))?$/.exec(cells);
  if (!m) return { tab, fromRow: null, toRow: null };
  const from = Number(m[1]);
  return { tab, fromRow: from, toRow: m[2] ? Number(m[2]) : from };
}

export function forbidden(): Response {
  return Response.json(
    { error: { code: 403, message: "The caller does not have permission", status: "PERMISSION_DENIED" } },
    { status: 403 }
  );
}

export function notFound(): Response {
  return Response.json(
    { error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" } },
    { status: 404 }
  );
}

export function metaOf(s: MockSpreadsheet) {
  return {
    spreadsheetId: s.id,
    properties: { title: s.title },
    sheets: Object.entries(s.tabs).map(([title, rows]) => ({
      properties: {
        title,
        gridProperties: { rowCount: Math.max(1000, rows.length), columnCount: 26 },
      },
    })),
  };
}

export function createMockSpreadsheet(body: {
  properties?: { title?: string };
  sheets?: {
    properties?: { title?: string };
    data?: { rowData?: { values?: { userEnteredValue?: { stringValue?: string } }[] }[] }[];
  }[];
}): MockSpreadsheet {
  const s = getGoogleMockState();
  const id = `mock-sheet-created-${nextMockN()}`;
  const tabs: Record<string, string[][]> = {};
  for (const sh of body.sheets ?? [{ properties: { title: "Hoja 1" } }]) {
    const title = sh.properties?.title ?? "Hoja 1";
    tabs[title] = (sh.data?.[0]?.rowData ?? []).map((r) =>
      (r.values ?? []).map((v) => v.userEnteredValue?.stringValue ?? "")
    );
  }
  const created: MockSpreadsheet = { id, title: body.properties?.title ?? "Sin título", tabs, granted: true };
  s.spreadsheets.set(id, created);
  return created;
}

export function appendMockRow(sheet: MockSpreadsheet, tab: string, values: string[][]): string {
  const rows = (sheet.tabs[tab] ??= []);
  for (const v of values) rows.push(v.map((c) => String(c)));
  const n = rows.length;
  const width = Math.max(1, ...values.map((v) => v.length));
  return `${tab}!A${n}:${colLetter(width)}${n}`;
}
