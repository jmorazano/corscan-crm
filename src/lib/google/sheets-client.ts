import { getEnv } from "@/lib/env";
import { neutralizeFormula, sheetRange } from "@/lib/sheets";

/**
 * Cliente REST de Google Sheets (034) — ÚNICA frontera con la API de Sheets
 * (Constitución II, categoría 3). Sin `googleapis`: cuatro endpoints. El
 * access token solo viaja en el header y jamás se loguea.
 *
 * Con `drive.file`, una planilla que la empresa NO eligió con el selector
 * (ni creó Vocero) responde 403/404 aunque exista: se tipa como `no_access`
 * para poder explicarlo («elegila con el selector de Google»).
 */

export class SheetsApiError extends Error {
  constructor(
    public readonly code: "unauthorized" | "no_access" | "not_found" | "provider_error",
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "SheetsApiError";
  }
}

export type SpreadsheetInfo = {
  spreadsheetId: string;
  title: string;
  sheets: { title: string; rowCount: number; columnCount: number }[];
};

async function request<T>(
  accessToken: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  timeoutMs = 15_000
): Promise<T> {
  const base = getEnv().GOOGLE_SHEETS_API_BASE_URL.replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const code =
        res.status === 401
          ? "unauthorized"
          : res.status === 403
            ? "no_access"
            : res.status === 404
              ? "not_found"
              : "provider_error";
      throw new SheetsApiError(code, res.status, `Google Sheets respondió ${res.status}: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof SheetsApiError) throw err;
    throw new SheetsApiError("provider_error", 0, err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

type SpreadsheetResponse = {
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  properties?: { title?: string };
  sheets?: {
    properties?: {
      title?: string;
      gridProperties?: { rowCount?: number; columnCount?: number };
    };
  }[];
};

function toInfo(json: SpreadsheetResponse, fallbackId: string): SpreadsheetInfo {
  return {
    spreadsheetId: json.spreadsheetId ?? fallbackId,
    title: json.properties?.title?.trim() || "Planilla sin título",
    sheets: (json.sheets ?? [])
      .map((s) => ({
        title: s.properties?.title ?? "",
        rowCount: s.properties?.gridProperties?.rowCount ?? 0,
        columnCount: s.properties?.gridProperties?.columnCount ?? 0,
      }))
      .filter((s) => s.title !== ""),
  };
}

/** Título y pestañas (valida, de paso, que Vocero tenga acceso). */
export async function getSpreadsheet(
  accessToken: string,
  spreadsheetId: string
): Promise<SpreadsheetInfo> {
  const fields = encodeURIComponent(
    "spreadsheetId,properties.title,sheets.properties(title,gridProperties(rowCount,columnCount))"
  );
  const json = await request<SpreadsheetResponse>(
    accessToken,
    "GET",
    `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=${fields}`
  );
  return toInfo(json, spreadsheetId);
}

/** Crea una planilla con UNA pestaña y la fila de encabezados. */
export async function createSpreadsheet(
  accessToken: string,
  input: { title: string; sheetTitle: string; headers: readonly string[] }
): Promise<SpreadsheetInfo> {
  const json = await request<SpreadsheetResponse>(accessToken, "POST", "/v4/spreadsheets", {
    properties: { title: input.title, locale: "es_AR" },
    sheets: [
      {
        properties: { title: input.sheetTitle, gridProperties: { frozenRowCount: 1 } },
        data: [
          {
            startRow: 0,
            startColumn: 0,
            rowData: [
              {
                values: input.headers.map((h) => ({
                  userEnteredValue: { stringValue: h },
                  userEnteredFormat: { textFormat: { bold: true } },
                })),
              },
            ],
          },
        ],
      },
    ],
  });
  return toInfo(json, "");
}

/** Valores formateados (como se ven en la hoja), por filas. */
export async function getValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  timeoutMs?: number
): Promise<string[][]> {
  const json = await request<{ values?: unknown[][] }>(
    accessToken,
    "GET",
    `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
      range
    )}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
    undefined,
    timeoutMs
  );
  return (json.values ?? []).map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "")) : []));
}

/**
 * Agrega UNA fila al final de la pestaña. `USER_ENTERED` para que fechas e
 * importes queden como tales —por eso cada celda pasa otra vez por
 * `neutralizeFormula` acá, en la frontera: ningún llamador puede saltearse
 * el saneo anti-fórmula—. Devuelve el rango escrito.
 */
export async function appendRow(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
  values: readonly string[]
): Promise<{ updatedRange: string | null }> {
  const range = encodeURIComponent(sheetRange(sheetTitle, "A1"));
  const json = await request<{ updates?: { updatedRange?: string } }>(
    accessToken,
    "POST",
    `/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { majorDimension: "ROWS", values: [values.map((v) => neutralizeFormula(v))] }
  );
  return { updatedRange: json.updates?.updatedRange ?? null };
}
