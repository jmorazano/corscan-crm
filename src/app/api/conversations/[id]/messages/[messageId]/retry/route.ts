import { apiError, withAuth } from "@/lib/api";
import { getConversation } from "@/server/inbox/queries";
import { retryMedia } from "@/server/inbox/send-media";
import { SEND_ERROR_STATUS, SendError } from "@/server/inbox/send-error";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; messageId: string }> };

/**
 * Reintenta un adjunto fallido (026) con el binario ya guardado: el
 * operador no vuelve a elegir el archivo. Mismas guardas que el envío.
 */
export const POST = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id, messageId } = await ctx.params;
  const row = await getConversation(session.organizationId, id);
  if (!row) return apiError(404, "not_found", "Conversación no encontrada");
  try {
    const result = await retryMedia({
      organizationId: session.organizationId,
      conversationId: id,
      messageId,
    });
    return Response.json(result);
  } catch (err) {
    if (err instanceof SendError) {
      return apiError(SEND_ERROR_STATUS[err.code], err.code, err.message);
    }
    throw err;
  }
});
