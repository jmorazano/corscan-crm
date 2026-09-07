import { apiError, withAuth } from "@/lib/api";
import {
  deleteTemplate,
  serializeTemplate,
  TemplateError,
  templateErrorStatus,
} from "@/server/whatsapp/templates";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Borra la plantilla (en Meta y localmente). 409 `in_use` si alguna campaña
 * la referencia; 404 si no es de esta empresa.
 */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
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
