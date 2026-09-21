import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { validateVoiceNote, VOICE_NOTE_MAX_BYTES, VOICE_NOTE_MAX_MS } from "@/lib/voice-note";
import { getAiConfig } from "@/server/ai/credentials";
import { getConversation } from "@/server/inbox/queries";
import { createVoiceNote, transcribeVoiceNote } from "@/server/trainer/voice";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const durationSchema = z.coerce.number().int().min(0).max(VOICE_NOTE_MAX_MS + 5000);

/**
 * Nota de voz para la conversación con el agente (015, US3): multipart con
 * `file` (+ `durationMs`). Solo conversaciones `trainer`. El mensaje nace
 * `pending`; la transcripción llega por SSE `message.updated`.
 */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const row = await getConversation(session.organizationId, id);
  if (!row) return apiError(404, "not_found", "Conversación no encontrada");
  if (row.conversation.kind !== "trainer") {
    return apiError(
      409,
      "not_trainer",
      "Las notas de voz solo están disponibles en la conversación con tu agente"
    );
  }
  if (!(await getAiConfig(session.organizationId))) {
    return apiError(
      409,
      "ai_not_configured",
      "La IA de la empresa está apagada: configurala en Ajustes → Inteligencia artificial"
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError(422, "invalid", "Se esperaba multipart/form-data");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return apiError(422, "invalid", "Falta el archivo de audio");
  if (file.size === 0) return apiError(422, "invalid", "El audio está vacío");
  if (file.size > VOICE_NOTE_MAX_BYTES) {
    // Corte temprano ANTES de materializar el buffer.
    return apiError(413, "too_large", "La nota de voz supera el máximo de 8 MB (unos 3 minutos)");
  }
  const durationRaw = form.get("durationMs");
  const duration =
    typeof durationRaw === "string" && durationRaw.trim()
      ? durationSchema.safeParse(durationRaw)
      : null;
  const durationMs = duration?.success ? duration.data : null;

  const bytes = Buffer.from(await file.arrayBuffer());
  const valid = validateVoiceNote(bytes, file.type);
  if (!valid.ok) return apiError(valid.status, valid.code, valid.error);

  const { message, media } = await createVoiceNote({
    organizationId: session.organizationId,
    conversationId: id,
    bytes,
    mimeType: valid.mime,
    durationMs,
  });

  // Segundo plano: transcribir → turno del entrenador. Nunca tumba el request.
  void transcribeVoiceNote({
    organizationId: session.organizationId,
    conversationId: id,
    messageId: message.id,
  }).catch((err) =>
    console.error("[entrenador] transcripción en segundo plano falló:", err instanceof Error ? err.message : err)
  );

  return Response.json({ messageId: message.id, mediaUrl: media.url }, { status: 201 });
});
