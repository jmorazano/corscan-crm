import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { transcribeAudio } from "@/lib/ai";
import type { MessageMediaDto } from "@/lib/types";
import { audioFormatForMime, type VoiceMime } from "@/lib/voice-note";
import { getAiConfig } from "@/server/ai/credentials";
import { scheduleTrainerTurn } from "@/server/ai/trainer";
import { publish } from "@/server/events/bus";
import { serializeMessage } from "@/server/inbox/ingest";

/**
 * Notas de voz del entrenador (015, US3): el audio se guarda en Postgres
 * (message_media, 1:1 con el mensaje), se transcribe en segundo plano por el
 * proveedor OpenRouter (modelo multimodal) y la transcripción entra al turno
 * como si el dueño la hubiera escrito.
 *
 * 020: el estado de la transcripción vive en `media_state`
 * (`pending → ready | failed`), no en `status`. `status` volvió a significar
 * una sola cosa en todo el repo —el estado de ENTREGA— cuando los mensajes
 * ENTRANTES empezaron a traer adjuntos: ahí `status` ya valía `delivered` y
 * no podía servir de doble uso.
 */

export const TRANSCRIPTION_ERRORS = {
  empty: "El audio no tiene contenido reconocible",
  unsupported:
    "El modelo de transcripción configurado no acepta audio. Cambialo en Ajustes → Inteligencia artificial",
  provider: "No pude transcribir el audio",
  not_configured: "La empresa no tiene IA configurada",
} as const;

export async function createVoiceNote(input: {
  organizationId: string;
  conversationId: string;
  bytes: Buffer;
  mimeType: VoiceMime;
  durationMs: number | null;
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
        type: "audio",
        text: null,
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
      durationMs: input.durationMs,
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
    durationMs: input.durationMs,
  };
  publish(input.organizationId, {
    type: "message.new",
    data: { conversationId: input.conversationId, message: serializeMessage(message, null, media) },
  });
  return { message, media };
}

/**
 * Transcribe en segundo plano y dispara el turno. Nunca lanza: todo camino
 * termina con `media_state` en `ready` o `failed` con motivo legible.
 */
export async function transcribeVoiceNote(input: {
  organizationId: string;
  conversationId: string;
  messageId: string;
}): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.messageMedia.id,
      mimeType: schema.messageMedia.mimeType,
      durationMs: schema.messageMedia.durationMs,
      data: schema.messageMedia.data,
    })
    .from(schema.messageMedia)
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
    durationMs: media.durationMs,
  };

  const finish = async (patch: {
    text?: string;
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
  };

  const config = await getAiConfig(input.organizationId);
  if (!config) {
    await finish({ mediaState: "failed", error: TRANSCRIPTION_ERRORS.not_configured });
    return;
  }

  let result;
  try {
    result = await transcribeAudio(config, {
      bytes: media.data,
      format: audioFormatForMime(media.mimeType as VoiceMime),
    });
  } catch (err) {
    console.error("[entrenador] transcripción falló:", err instanceof Error ? err.message : err);
    await finish({ mediaState: "failed", error: TRANSCRIPTION_ERRORS.provider });
    return;
  }

  if (!result.ok) {
    if (result.error !== "empty") {
      console.warn(`[entrenador] transcripción ${result.error}: ${result.detail}`);
    }
    const error =
      result.error === "empty"
        ? TRANSCRIPTION_ERRORS.empty
        : result.error === "unsupported_audio"
          ? TRANSCRIPTION_ERRORS.unsupported
          : result.error === "not_configured"
            ? TRANSCRIPTION_ERRORS.not_configured
            : TRANSCRIPTION_ERRORS.provider;
    await finish({ mediaState: "failed", error });
    return;
  }

  await finish({ mediaState: "ready", text: result.text });
  scheduleTrainerTurn(input.conversationId);
}
