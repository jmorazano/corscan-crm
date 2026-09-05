import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  MAX_IMPORT_ROWS,
  importContacts,
} from "@/server/contacts-import";

export const dynamic = "force-dynamic";

/**
 * Import masivo (004, US1 — contrato contacts-import.md). El archivo se
 * parsea en el NAVEGADOR: acá solo llegan filas estructuradas, que se
 * re-validan y re-normalizan server-side.
 */
const importSchema = z.object({
  rows: z
    .array(
      z.object({
        phone: z.string().trim().min(1).max(40),
        name: z.string().trim().max(120).optional(),
        tags: z.array(z.string().max(80)).max(30).optional(),
        notes: z.string().max(4000).optional(),
      })
    )
    .min(1)
    .max(MAX_IMPORT_ROWS),
  consentDeclared: z.boolean(),
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, importSchema);
  if (!body.ok) return body.response;

  // FR-004: sin la declaración explícita de consentimiento no se importa.
  if (body.data.consentDeclared !== true) {
    return apiError(
      422,
      "consent_required",
      "Debés declarar que los contactos dieron su consentimiento para recibir mensajes"
    );
  }

  const report = await importContacts(session.organizationId, body.data.rows);
  return Response.json(report);
});
