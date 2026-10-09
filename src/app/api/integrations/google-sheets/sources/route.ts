import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { getSheetsIntegrationView } from "@/server/sheets/integration";
import { addSource } from "@/server/sheets/sources";
import { sheetsApiError } from "../errors";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  spreadsheetId: z.string().trim().min(10).max(200),
  sheetTitle: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).default(""),
});

/** Alta de una planilla de consulta del agente (034, US3). */
export const POST = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  if (!(await getSheetsIntegrationView(session.organizationId))) {
    return apiError(409, "not_connected", "Google Sheets no está conectado.");
  }
  const res = await addSource(session.organizationId, body.data);
  if (!res.ok) return sheetsApiError(res.error);
  return Response.json(res.source, { status: 201 });
});
