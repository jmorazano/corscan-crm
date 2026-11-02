import { parseBody, withAuth } from "@/lib/api";
import { MAX_QUICK_REPLIES, quickReplyInput } from "@/lib/quick-replies";
import {
  createQuickReply,
  listQuickReplies,
  quickReplyError,
  serializeQuickReply,
} from "@/server/quick-replies";

export const dynamic = "force-dynamic";

/**
 * Respuestas rápidas de la empresa (047). Son herramienta de OPERACIÓN: todo
 * el equipo las lee, crea, edita y borra (`withAuth`, no `withOwner`).
 */
export const GET = withAuth(async (session) => {
  const replies = await listQuickReplies(session.organizationId);
  return Response.json({ replies: replies.map(serializeQuickReply), max: MAX_QUICK_REPLIES });
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, quickReplyInput);
  if (!body.ok) return body.response;
  const result = await createQuickReply(session.organizationId, session.userId, body.data);
  if (!result.ok) return quickReplyError(result);
  return Response.json({ reply: serializeQuickReply(result.reply) }, { status: 201 });
});
