import { apiError } from "@/lib/api";
import { SHEETS_ERROR_TEXT, type SheetsErrorCode } from "@/server/sheets/integration";

/** Error de Google Sheets → respuesta con texto en criollo (034). */
export function sheetsApiError(code: SheetsErrorCode | "sheet_not_found" | "exists"): Response {
  if (code === "sheet_not_found") {
    return apiError(409, code, "Esa pestaña no existe en la planilla.");
  }
  if (code === "exists") {
    return apiError(409, code, "Esa pestaña ya está agregada.");
  }
  const status = code === "provider_error" ? 502 : code === "no_ai" ? 409 : 409;
  return apiError(status, code, SHEETS_ERROR_TEXT[code]);
}
