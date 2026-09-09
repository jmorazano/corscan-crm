import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { HEADER_IMAGE_MAX_BYTES } from "@/lib/template-header";
import {
  createTemplate,
  listTemplates,
  serializeTemplate,
  TemplateError,
  templateErrorStatus,
} from "@/server/whatsapp/templates";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const templates = await listTemplates(session.organizationId);
  return Response.json({ templates });
});

const fieldsSchema = z.object({
  name: z.string().trim().min(1).max(60),
  language: z.string().trim().min(2).max(10),
  category: z.enum(["UTILITY", "MARKETING"]),
  body: z.string().trim().min(1).max(1024),
});

/**
 * Alta de plantilla (008): multipart/form-data — campos de texto +
 * `headerImage` opcional (File JPEG/PNG ≤5MB). El único consumidor es el
 * propio CRM, migrado en esta misma feature.
 */
export const POST = withAuth(async (session, req: Request) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError(422, "invalid", "Se esperaba multipart/form-data");
  }

  const parsed = fieldsSchema.safeParse({
    name: form.get("name"),
    language: form.get("language"),
    category: form.get("category"),
    body: form.get("body"),
  });
  if (!parsed.success) {
    return apiError(422, "invalid", "Datos de la plantilla inválidos");
  }

  const file = form.get("headerImage");
  let headerImage: { bytes: Buffer; mime: string } | undefined;
  if (file instanceof File && file.size > 0) {
    if (file.size > HEADER_IMAGE_MAX_BYTES) {
      // Corte temprano ANTES de materializar el buffer; la validación de
      // contenido (magic bytes) vive en createTemplate.
      return apiError(
        422,
        "invalid",
        "La imagen supera el máximo de 5MB que acepta WhatsApp"
      );
    }
    headerImage = {
      bytes: Buffer.from(await file.arrayBuffer()),
      mime: file.type,
    };
  }

  try {
    const { row, headerMediaId } = await createTemplate(
      session.organizationId,
      { ...parsed.data, headerImage }
    );
    return Response.json(
      { template: serializeTemplate(row, headerMediaId) },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof TemplateError) {
      return apiError(templateErrorStatus(err), err.code, err.message);
    }
    throw err;
  }
});
