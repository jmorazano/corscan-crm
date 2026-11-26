import { apiError, parseBody, withAuth } from "@/lib/api";
import { sendContactsInput } from "@/lib/contact-card";
import { getConversation } from "@/server/inbox/queries";
import { resolveContactCards, sendContacts } from "@/server/inbox/send-contacts";
import { SEND_ERROR_STATUS, SendError } from "@/server/inbox/send-error";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 054: mandarle a un cliente una o más tarjetas de contacto. Body
 * `{ contactIds?: string[], manual?: [{ name, phone }] }` (hasta 10 entre
 * los dos): contactos del CRM y los que el equipo escribe a mano. WhatsApp
 * las lleva como tarjeta nativa; Instagram, como texto.
 *
 * 201 `{ messageId }`. Lo puede mandar cualquier miembro.
 */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, sendContactsInput);
  if (!body.ok) return body.response;

  const row = await getConversation(session.organizationId, id);
  if (!row) return apiError(404, "not_found", "Conversación no encontrada");
  if (row.conversation.kind === "trainer") {
    return apiError(409, "not_channel", "La conversación con tu agente no manda contactos a clientes");
  }

  const resolved = await resolveContactCards(session.organizationId, body.data);
  if (!resolved.ok) return apiError(422, "invalid_contact", resolved.error);

  try {
    const result = await sendContacts({
      organizationId: session.organizationId,
      conversationId: id,
      contacts: resolved.cards,
      sentByUserId: session.userId,
    });
    return Response.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof SendError) {
      return apiError(SEND_ERROR_STATUS[err.code], err.code, err.message);
    }
    throw err;
  }
});
