import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import {
  getSheetsIntegrationView,
  SHEETS_ERROR_TEXT,
  updateReceiptsTarget,
} from "@/server/sheets/integration";
import {
  createReceiptsSpreadsheet,
  listReceipts,
  readReceiptHeaders,
  setReceiptsTarget,
} from "@/server/sheets/receipts";
import { sheetsApiError } from "../errors";

export const dynamic = "force-dynamic";

/** Encabezados actuales del destino + últimos comprobantes (034, US2). */
export const GET = withOwner(async (session) => {
  const [headers, log] = await Promise.all([
    readReceiptHeaders(session.organizationId),
    listReceipts(session.organizationId),
  ]);
  return Response.json({
    headers: Array.isArray(headers) ? headers : null,
    headersError: Array.isArray(headers) ? null : SHEETS_ERROR_TEXT[headers.error],
    log: log.map((r) => ({ ...r, errorText: r.error ? (SHEETS_ERROR_TEXT as Record<string, string>)[r.error] ?? r.error : null })),
  });
});

const putSchema = z.object({
  enabled: z.boolean().optional(),
  spreadsheetId: z.string().trim().min(10).max(200).optional(),
  sheetTitle: z.string().trim().min(1).max(200).optional(),
});

/**
 * PUT: elegir una planilla existente como destino (`spreadsheetId` +
 * `sheetTitle`) o prender/apagar el registro (`enabled`).
 */
export const PUT = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  const orgId = session.organizationId;
  const current = await getSheetsIntegrationView(orgId);
  if (!current) return apiError(409, "not_connected", "Google Sheets no está conectado.");

  if (body.data.spreadsheetId && body.data.sheetTitle) {
    const res = await setReceiptsTarget(orgId, body.data.spreadsheetId, body.data.sheetTitle);
    if (!res.ok) return sheetsApiError(res.error);
    if (body.data.enabled === false) await updateReceiptsTarget(orgId, { enabled: false });
    return Response.json(res);
  }
  if (body.data.enabled !== undefined) {
    if (body.data.enabled && !current.receipts.spreadsheetId) {
      return apiError(409, "no_target", "Primero elegí o creá la planilla de destino.");
    }
    await updateReceiptsTarget(orgId, { enabled: body.data.enabled });
    return Response.json({ ok: true });
  }
  return apiError(422, "invalid_body", "Nada para cambiar.");
});

/** POST: crear una planilla nueva con las columnas sugeridas. */
export const POST = withOwner(async (session) => {
  const org = await getDb()
    .select({ name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, session.organizationId))
    .limit(1);
  const res = await createReceiptsSpreadsheet(session.organizationId, org[0]?.name ?? "mi negocio");
  if (!res.ok) return sheetsApiError(res.error);
  return Response.json(res);
});
