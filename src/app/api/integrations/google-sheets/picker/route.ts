import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { getEnv, isGooglePickerConfigured, isMockEnabled } from "@/lib/env";
import { getSpreadsheet } from "@/lib/google/sheets-client";
import { parseSpreadsheetId } from "@/lib/sheets";
import {
  getSheetsIntegrationView,
  sheetsErrorCode,
  withSheetsToken,
} from "@/server/sheets/integration";
import { sheetsApiError } from "../errors";

export const dynamic = "force-dynamic";

/**
 * Selector de Google (034). GET devuelve la config PÚBLICA del selector: el
 * token lo pide el NAVEGADOR directo a Google (Google Identity Services),
 * así que ningún token guardado por Vocero sale del servidor
 * (Constitución I y II-3(d)). Con mocks, un selector simulado.
 */
export const GET = withOwner(async (session) => {
  const integration = await getSheetsIntegrationView(session.organizationId);
  if (!integration) return apiError(409, "not_connected", "Google Sheets no está conectado.");
  if (isMockEnabled()) return Response.json({ mode: "mock" });
  if (!isGooglePickerConfigured()) return Response.json({ mode: "unavailable" });
  const env = getEnv();
  return Response.json({
    mode: "google",
    clientId: env.GOOGLE_CLIENT_ID,
    apiKey: env.GOOGLE_PICKER_API_KEY,
    appId: env.GOOGLE_CLOUD_PROJECT_NUMBER,
    loginHint: integration.accountEmail,
  });
});

/**
 * POST { spreadsheet }: la planilla que se eligió (id o URL) → título y
 * pestañas. Valida, de paso, que la cuenta conectada tenga acceso.
 */
export const POST = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, z.object({ spreadsheet: z.string().trim().min(1).max(500) }));
  if (!body.ok) return body.response;
  const id = parseSpreadsheetId(body.data.spreadsheet);
  if (!id) return apiError(422, "invalid_spreadsheet", "No reconozco esa planilla.");
  try {
    const info = await withSheetsToken(session.organizationId, (t) => getSpreadsheet(t, id));
    return Response.json(info);
  } catch (err) {
    return sheetsApiError(sheetsErrorCode(err));
  }
});
