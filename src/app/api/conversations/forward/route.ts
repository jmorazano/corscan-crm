import { apiError, parseBody, withAuth } from "@/lib/api";
import { forwardInput } from "@/lib/forward";
import { ForwardError, forwardMessages } from "@/server/inbox/forward";

export const dynamic = "force-dynamic";

/**
 * 054: reenviar mensajes de un chat a otros (hasta 20 mensajes a 5 chats).
 * Lo puede hacer cualquier miembro — enviar es operar.
 *
 * 200 `{ targets: [{ conversationId, name, sent, failed, error }], sent,
 * failed }`: el resultado es POR CHAT. Un destino con la ventana cerrada o
 * un archivo que su canal no acepta no impide que salga lo demás; el
 * diálogo muestra a quién no le llegó y por qué. 4xx solo cuando el pedido
 * entero no vale (un mensaje que no se puede reenviar, un chat que no
 * existe): en ese caso no se mandó nada.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, forwardInput);
  if (!body.ok) return body.response;
  try {
    const result = await forwardMessages({
      organizationId: session.organizationId,
      sourceConversationId: body.data.sourceConversationId,
      messageIds: body.data.messageIds,
      targetConversationIds: body.data.targetConversationIds,
      sentByUserId: session.userId,
    });
    return Response.json(result);
  } catch (err) {
    if (err instanceof ForwardError) return apiError(err.status, err.code, err.message);
    throw err;
  }
});
