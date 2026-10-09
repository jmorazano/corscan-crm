import { googleApiGuard } from "@/server/dev/google-mock-api";
import { createMockSpreadsheet, metaOf } from "@/server/dev/google-mock-sheets";

export const dynamic = "force-dynamic";

/** 034: crear planilla (la app creadora tiene acceso por `drive.file`). */
export async function POST(req: Request) {
  const guard = googleApiGuard(req);
  if (guard) return guard;
  const body = (await req.json().catch(() => ({}))) as Parameters<typeof createMockSpreadsheet>[0];
  const created = createMockSpreadsheet(body);
  return Response.json({ ...metaOf(created), spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${created.id}/edit` });
}
