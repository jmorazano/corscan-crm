import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { readTrainerImage } from "@/lib/ai";
import { TRAINER_IMAGE_ERRORS, type TrainerImageMime } from "@/lib/trainer-image";
import type { MessageMediaDto } from "@/lib/types";
import { getAiConfig } from "@/server/ai/credentials";
import { forceTrainerTurn } from "@/server/ai/trainer";
import { publish } from "@/server/events/bus";
import { serializeMessage } from "@/server/inbox/ingest";

/**
 * Imágenes del Entrenador (022): el dueño le adjunta a su agente una foto
 * (lista de precios, producto, captura) para que aprenda de ella. Mismo
 * circuito que las notas de voz (015): el binario vive en `message_media`
 * (1:1), el mensaje nace `media_state=pending`, la lectura por visión corre
 * en segundo plano y entra al turno como DATO. Ningún camino deja mudo al
 * agente: una lectura fallida también dispara el turno.
 */

export async function createTrainerImage(input: {
  organizationId: string;
  conversationId: string;
  bytes: Buffer;
  mimeType: TrainerImageMime;
  caption: string | null;
}): Promise<{ message: typeof schema.message.$inferSelect; media: MessageMediaDto }> {
  const db = getDb();
  const now = new Date();
  const { message, mediaId } = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.message)
      .values({
        id: newId("message"),
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        direction: "out",
        type: "image",
        // El epígrafe es texto del dueño; la lectura irá a `media_summary`.
        text: input.caption,
        status: "delivered",
        mediaState: "pending",
        aiGenerated: false,
        waTimestamp: now,
      })
      .returning();
    const message = inserted[0]!;
    const mediaId = newId("messageMedia");
    await tx.insert(schema.messageMedia).values({
      id: mediaId,
      organizationId: input.organizationId,
      messageId: message.id,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      durationMs: null,
      data: input.bytes,
    });
    await tx
      .update(schema.conversation)
      .set({ lastMessageAt: now, updatedAt: now })
      .where(eq(schema.conversation.id, input.conversationId));
    return { message, mediaId };
  });
  const media: MessageMediaDto = {
    url: `/api/message-media/${mediaId}`,
    mimeType: input.mimeType,
    durationMs: null,
  };
  publish(input.organizationId, {
    type: "message.new",
    data: { conversationId: input.conversationId, message: serializeMessage(message, null, media) },
  });
  return { message, media };
}

/**
 * Lee la imagen en segundo plano y dispara el turno. Nunca lanza: todo
 * camino termina con `media_state` en `ready` o `failed` con motivo legible
 * y el turno agendado (forzado: aunque el dueño haya escrito después).
 */
export async function readTrainerImageInBackground(input: {
  organizationId: string;
  conversationId: string;
  messageId: string;
}): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.messageMedia.id,
      mimeType: schema.messageMedia.mimeType,
      data: schema.messageMedia.data,
      caption: schema.message.text,
    })
    .from(schema.messageMedia)
    .innerJoin(schema.message, eq(schema.message.id, schema.messageMedia.messageId))
    .where(
      scoped(
        schema.messageMedia.organizationId,
        input.organizationId,
        eq(schema.messageMedia.messageId, input.messageId)
      )
    )
    .limit(1);
  const media = rows[0];
  if (!media) return;
  const mediaDto: MessageMediaDto = {
    url: `/api/message-media/${media.id}`,
    mimeType: media.mimeType,
    durationMs: null,
  };

  const finish = async (patch: {
    mediaSummary?: string;
    mediaState: "ready" | "failed";
    error?: string;
  }) => {
    const updated = await db
      .update(schema.message)
      .set({ ...patch })
      .where(eq(schema.message.id, input.messageId))
      .returning();
    const m = updated[0];
    if (m) {
      publish(input.organizationId, {
        type: "message.updated",
        data: { conversationId: input.conversationId, message: serializeMessage(m, null, mediaDto) },
      });
    }
    // Leída o fallida, el agente tiene que reaccionar: forzado para que la
    // marca de cobertura de un turno intermedio no se la trague.
    forceTrainerTurn(input.conversationId);
  };

  const config = await getAiConfig(input.organizationId);
  if (!config) {
    await finish({ mediaState: "failed", error: TRAINER_IMAGE_ERRORS.not_configured });
    return;
  }

  let result;
  try {
    result = await readTrainerImage(config, {
      bytes: media.data,
      mimeType: media.mimeType,
      caption: media.caption,
    });
  } catch (err) {
    console.error("[entrenador] lectura de imagen falló:", err instanceof Error ? err.message : err);
    await finish({ mediaState: "failed", error: TRAINER_IMAGE_ERRORS.provider });
    return;
  }

  if (!result.ok) {
    if (result.error !== "empty") {
      console.warn(`[entrenador] lectura de imagen ${result.error}: ${result.detail}`);
    }
    const error =
      result.error === "empty"
        ? TRAINER_IMAGE_ERRORS.empty
        : result.error === "unsupported_image"
          ? TRAINER_IMAGE_ERRORS.unsupported
          : result.error === "not_configured"
            ? TRAINER_IMAGE_ERRORS.not_configured
            : TRAINER_IMAGE_ERRORS.provider;
    await finish({ mediaState: "failed", error });
    return;
  }

  await finish({ mediaState: "ready", mediaSummary: result.text });
}
