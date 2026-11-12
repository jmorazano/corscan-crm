import { z } from "zod";
import { apiError, withOwner } from "@/lib/api";
import { HEADER_IMAGE_MAX_BYTES } from "@/lib/template-header";
import {
  deleteTemplate,
  editTemplate,
  serializeTemplate,
  TemplateError,
  templateErrorStatus,
  type HeaderEdit,
} from "@/server/whatsapp/templates";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const editSchema = z.object({
  category: z.enum(["UTILITY", "MARKETING"]),
  body: z.string().trim().min(1).max(1024),
  headerMode: z.enum(["keep", "remove", "replace"]),
});

/**
 * 052: edita la plantilla (multipart, como el alta): `category`, `body`,
 * `variables` (JSON), `headerMode` keep|remove|replace y `headerImage` si
 * se reemplaza. Nombre e idioma no se editan (Meta no lo permite).
 */
export const PATCH = withOwner(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError(422, "invalid", "Se esperaba multipart/form-data");
  }

  const parsed = editSchema.safeParse({
    category: form.get("category"),
    body: form.get("body"),
    headerMode: form.get("headerMode") ?? "keep",
  });
  if (!parsed.success) {
    return apiError(422, "invalid", "Datos de la plantilla inválidos");
  }

  const variablesRaw = form.get("variables");
  let variables: string[] | undefined;
  if (typeof variablesRaw === "string" && variablesRaw.trim()) {
    let json: unknown = null;
    try {
      json = JSON.parse(variablesRaw);
    } catch {
      json = null;
    }
    const parsedVars = z.array(z.string().min(1).max(40)).max(5).safeParse(json);
    if (!parsedVars.success) {
      return apiError(422, "invalid", "Orígenes de variables inválidos");
    }
    variables = parsedVars.data;
  }

  let header: HeaderEdit = { mode: "keep" };
  if (parsed.data.headerMode === "remove") header = { mode: "remove" };
  if (parsed.data.headerMode === "replace") {
    const file = form.get("headerImage");
    if (!(file instanceof File) || file.size === 0) {
      return apiError(422, "invalid", "Falta la imagen nueva del encabezado");
    }
    if (file.size > HEADER_IMAGE_MAX_BYTES) {
      return apiError(
        422,
        "invalid",
        "La imagen supera el máximo de 5MB que acepta WhatsApp"
      );
    }
    header = {
      mode: "replace",
      image: { bytes: Buffer.from(await file.arrayBuffer()), mime: file.type },
    };
  }

  try {
    const { row, headerMediaId } = await editTemplate(session.organizationId, id, {
      category: parsed.data.category,
      body: parsed.data.body,
      variables,
      header,
    });
    return Response.json({ template: serializeTemplate(row, headerMediaId) });
  } catch (err) {
    if (err instanceof TemplateError) {
      return apiError(templateErrorStatus(err), err.code, err.message, err.extra);
    }
    throw err;
  }
});

/**
 * Borra la plantilla (en Meta y localmente). 409 `in_use` si alguna campaña
 * la referencia; 404 si no es de esta empresa.
 */
export const DELETE = withOwner(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  try {
    const template = await deleteTemplate(session.organizationId, id);
    return Response.json({ ok: true, template: serializeTemplate(template) });
  } catch (err) {
    if (err instanceof TemplateError) {
      return apiError(templateErrorStatus(err), err.code, err.message, err.extra);
    }
    throw err;
  }
});
