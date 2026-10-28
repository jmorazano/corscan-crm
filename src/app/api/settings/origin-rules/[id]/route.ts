import { apiError, withOwner } from "@/lib/api";
import { deleteOriginRule } from "@/server/contact-origin";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Borra una regla (043). Las etiquetas que ya dejó quedan en los contactos. */
export const DELETE = withOwner(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const deleted = await deleteOriginRule(session.organizationId, id);
  if (!deleted) return apiError(404, "not_found", "Regla no encontrada");
  return Response.json({ ok: true });
});
