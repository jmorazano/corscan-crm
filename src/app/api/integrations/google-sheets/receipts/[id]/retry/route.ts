import { apiError, withOwner } from "@/lib/api";
import { retryReceipt } from "@/server/sheets/receipts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Reintenta un comprobante fallido (034, AC2.5). */
export const POST = withOwner(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const res = await retryReceipt(session.organizationId, id);
  if (!res.ok) {
    if (res.error === "not_found") return apiError(404, "not_found", "Comprobante inexistente");
    if (res.error === "not_failed") return apiError(409, "not_failed", "Ese comprobante no está fallido");
    return apiError(409, "no_media", "El archivo del comprobante ya no está guardado");
  }
  return Response.json(res);
});
