import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getConversation, listMessages } from "@/server/inbox/queries";
import { serializeMessage } from "@/server/inbox/ingest";
import { SendError, sendText } from "@/server/inbox/send";
import { postTrainerMessage, TrainerError } from "@/server/ai/trainer";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const row = await getConversation(session.organizationId, id);
  if (!row) return apiError(404, "not_found", "Conversación no encontrada");

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;
  const messages = await listMessages(
    session.organizationId,
    id,
    since && !Number.isNaN(since.getTime()) ? since : undefined
  );
  return Response.json({
    messages: messages.map((r) =>
      serializeMessage(
        r.message,
        r.apiKeyName ? { kind: "api", label: r.apiKeyName } : null,
        r.mediaId
          ? {
              url: `/api/message-media/${r.mediaId}`,
              mimeType: r.mediaMime ?? "audio/wav",
              durationMs: r.mediaDuration,
            }
          : null
      )
    ),
  });
});

const sendSchema = z.object({ text: z.string().trim().min(1).max(4096) });

const SEND_ERROR_STATUS: Record<SendError["code"], number> = {
  sandbox_violation: 403,
  not_connected: 409,
  reconnect_required: 409,
  window_closed: 409,
  opted_out: 409,
  meta_error: 422,
  meta_unavailable: 503,
};

const TRAINER_ERROR_STATUS: Record<TrainerError["code"], number> = {
  ai_not_configured: 409,
  not_found: 404,
  not_trainer: 409,
};

export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, sendSchema);
  if (!body.ok) return body.response;

  // 015: la conversación con el propio agente no va a WhatsApp — el mensaje
  // del dueño se persiste y dispara el turno del entrenador.
  const row = await getConversation(session.organizationId, id);
  if (row?.conversation.kind === "trainer") {
    try {
      const result = await postTrainerMessage({
        conversationId: id,
        organizationId: session.organizationId,
        text: body.data.text,
      });
      return Response.json({ messageId: result.messageId });
    } catch (err) {
      if (err instanceof TrainerError) {
        return apiError(TRAINER_ERROR_STATUS[err.code], err.code, err.message);
      }
      throw err;
    }
  }

  try {
    const result = await sendText({
      conversationId: id,
      organizationId: session.organizationId,
      text: body.data.text,
    });
    return Response.json({ messageId: result.messageId });
  } catch (err) {
    if (err instanceof SendError) {
      return apiError(SEND_ERROR_STATUS[err.code], err.code, err.message);
    }
    throw err;
  }
});
