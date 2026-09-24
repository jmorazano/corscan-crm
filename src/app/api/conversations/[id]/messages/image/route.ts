import { apiError, withOwner } from "@/lib/api";
import {
  TRAINER_IMAGE_CAPTION_MAX,
  TRAINER_IMAGE_MAX_BYTES,
  validateTrainerImage,
} from "@/lib/trainer-image";
import { getAiConfig } from "@/server/ai/credentials";
import { getConversation } from "@/server/inbox/queries";
import { createTrainerImage, readTrainerImageInBackground } from "@/server/trainer/image";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Imagen para la conversación con el agente (022): multipart con `file`
 * (+ `caption` opcional). Solo conversaciones `trainer` y solo el
 * propietario (entrenar es configuración). El mensaje nace `pending`; la
 * lectura llega por SSE `message.updated`.
 */
export const POST = withOwner(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const row = await getConversation(session.organizationId, id);
  if (!row) return apiError(404, "not_found", "Conversación no encontrada");
  if (row.conversation.kind !== "trainer") {
    return apiError(
      409,
      "not_trainer",
      "Las imágenes solo están disponibles en la conversación con tu agente"
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
  if (!(file instanceof File)) return apiError(422, "invalid", "Falta el archivo de imagen");
  if (file.size === 0) return apiError(422, "invalid", "La imagen está vacía");
  if (file.size > TRAINER_IMAGE_MAX_BYTES) {
    // Corte temprano ANTES de materializar el buffer.
    return apiError(413, "too_large", "La imagen supera el máximo de 5 MB");
  }
  const captionRaw = form.get("caption");
  const caption =
    typeof captionRaw === "string" && captionRaw.trim()
      ? captionRaw.trim().slice(0, TRAINER_IMAGE_CAPTION_MAX)
      : null;

  const bytes = Buffer.from(await file.arrayBuffer());
  const valid = validateTrainerImage(bytes, file.type);
  if (!valid.ok) return apiError(valid.status, valid.code, valid.error);

  const { message, media } = await createTrainerImage({
    organizationId: session.organizationId,
    conversationId: id,
    bytes,
    mimeType: valid.mime,
    caption,
  });

  // Segundo plano: leer → turno del entrenador. Nunca tumba el request.
  void readTrainerImageInBackground({
    organizationId: session.organizationId,
    conversationId: id,
    messageId: message.id,
  }).catch((err) =>
    console.error(
      "[entrenador] lectura de imagen en segundo plano falló:",
      err instanceof Error ? err.message : err
    )
  );

  return Response.json({ messageId: message.id, mediaUrl: media.url }, { status: 201 });
});
