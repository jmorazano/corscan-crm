import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { describeImage, transcribeAudio } from "@/lib/ai";
import {
  MEDIA_ERRORS,
  sniffImageMime,
  type MediaErrorCode,
  type MediaPlan,
} from "@/lib/inbound-media";
import { downloadMediaBinary, fetchMediaHandle } from "@/lib/meta/client";
import type { MessageMediaDto } from "@/lib/types";
import { audioFormatForMime, normalizeMime, sniffAudioMime } from "@/lib/voice-note";
import { getAiConfig } from "@/server/ai/credentials";
import { maybeRunAgentTurn } from "@/server/ai/trigger";
import { publish } from "@/server/events/bus";
import { serializeMessage } from "@/server/inbox/ingest";
import { isOptOutMessage, onInboundSideEffects } from "@/server/inbox/side-effects";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";

/**
 * Adjuntos entrantes de WhatsApp (020): descarga, guardado y lectura por IA,
 * SIEMPRE en segundo plano.
 *
 * La regla que gobierna todo el módulo: **ningún camino deja mudo al
 * agente**. Pase lo que pase —Meta caída, archivo enorme, audio ilegible,
 * proveedor sin crédito— la función termina marcando el mensaje y
 * disparando el turno. Un cliente que manda un audio y no recibe respuesta
 * es peor que uno que recibe «no pude escucharlo, ¿me lo escribís?».
 *
 * Nunca lanza: el llamador la invoca con `void`.
 */
export async function processInboundMedia(input: {
  organizationId: string;
  conversationId: string;
  messageId: string;
  isTest: boolean;
  mediaId: string;
  declaredMime: string | null;
  plan: Extract<MediaPlan, { kind: "process" }>;
}): Promise<void> {
  // D4/FR-010: el sandbox del Laboratorio JAMÁS toca la API real.
  if (input.isTest) {
    await finish(input, { state: "failed", errorCode: "download" });
    return;
  }

  try {
    const bytes = await download(input);
    if (!bytes) return; // `download` ya cerró el mensaje y disparó el turno
    await interpret(input, bytes);
  } catch (err) {
    console.error(
      "[medios] fallo inesperado procesando el adjunto:",
      err instanceof Error ? err.message : err
    );
    await finish(input, { state: "failed", errorCode: "download" });
  }
}

/* ============================================================
 * Descarga y guardado
 * ============================================================ */

async function download(input: {
  organizationId: string;
  conversationId: string;
  messageId: string;
  mediaId: string;
  declaredMime: string | null;
  plan: Extract<MediaPlan, { kind: "process" }>;
}): Promise<{ data: Buffer; mimeType: string } | null> {
  const creds = await getCredentialsByOrg(input.organizationId);
  if (!creds) {
    await finish(input, { state: "failed", errorCode: "download" });
    return null;
  }

  let handle;
  try {
    handle = await fetchMediaHandle(input.mediaId, creds.token);
  } catch (err) {
    console.warn(
      `[medios] no se pudo pedir el archivo ${input.mediaId}:`,
      err instanceof Error ? err.message : err
    );
    await finish(input, { state: "failed", errorCode: "download" });
    return null;
  }

  // Tope aplicado con lo que DECLARA Meta, antes de bajar el cuerpo.
  if (handle.fileSize !== null && handle.fileSize > input.plan.maxBytes) {
    await finish(input, { state: "failed", errorCode: "too_large" });
    return null;
  }

  let downloaded;
  try {
    downloaded = await downloadMediaBinary(handle.url, creds.token, input.plan.maxBytes);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[medios] descarga fallida de ${input.mediaId}: ${message}`);
    await finish(input, {
      state: "failed",
      errorCode: /máximo|tamaño/i.test(message) ? "too_large" : "download",
    });
    return null;
  }

  // El MIME declarado no manda: el contenido sí. Un `image/jpeg` que en
  // realidad es otra cosa hace fallar al proveedor con un error opaco.
  const declared = normalizeMime(
    downloaded.contentType || handle.mimeType || input.declaredMime || ""
  );
  const mimeType =
    input.plan.type === "audio"
      ? (sniffAudioMime(downloaded.bytes) ?? declared)
      : (sniffImageMime(downloaded.bytes) ?? declared);

  if (input.plan.type === "audio" && (mimeType === "audio/webm" || !isSupportedAudio(mimeType))) {
    await saveMedia(input, downloaded.bytes, mimeType || "application/octet-stream");
    await finish(input, { state: "failed", errorCode: "unsupported" });
    return null;
  }
  if (input.plan.type === "image" && !mimeType.startsWith("image/")) {
    await saveMedia(input, downloaded.bytes, mimeType || "application/octet-stream");
    await finish(input, { state: "failed", errorCode: "unsupported" });
    return null;
  }

  await saveMedia(input, downloaded.bytes, mimeType);
  return { data: downloaded.bytes, mimeType };
}

const SUPPORTED_AUDIO = new Set([
  "audio/wav",
  "audio/mp4",
  "audio/ogg",
  "audio/mpeg",
  "audio/aac",
  "audio/flac",
]);
function isSupportedAudio(mime: string): boolean {
  return SUPPORTED_AUDIO.has(mime);
}

/** Guarda el binario 1:1 con el mensaje. Re-ejecutable (el unique manda). */
async function saveMedia(
  input: { organizationId: string; messageId: string },
  bytes: Buffer,
  mimeType: string
): Promise<void> {
  await getDb()
    .insert(schema.messageMedia)
    .values({
      id: newId("messageMedia"),
      organizationId: input.organizationId,
      messageId: input.messageId,
      mimeType,
      sizeBytes: bytes.byteLength,
      durationMs: null,
      data: bytes,
    })
    .onConflictDoNothing({ target: schema.messageMedia.messageId });
}

/* ============================================================
 * Lectura por IA
 * ============================================================ */

async function interpret(
  input: {
    organizationId: string;
    conversationId: string;
    messageId: string;
    plan: Extract<MediaPlan, { kind: "process" }>;
  },
  media: { data: Buffer; mimeType: string }
): Promise<void> {
  const config = await getAiConfig(input.organizationId);
  if (!config) {
    // Sin IA el binario igual quedó guardado y visible para el equipo.
    await finish(input, { state: "failed", errorCode: "not_configured" });
    return;
  }

  if (input.plan.type === "audio") {
    const result = await transcribeAudio(config, {
      bytes: media.data,
      format: audioFormatForMime(media.mimeType as Parameters<typeof audioFormatForMime>[0]),
    });
    if (!result.ok) {
      await finish(input, { state: "failed", errorCode: "transcription" });
      return;
    }
    await finish(input, { state: "ready", text: result.text });
    return;
  }

  const result = await describeImage(config, {
    bytes: media.data,
    mimeType: media.mimeType,
  });
  if (!result.ok) {
    await finish(input, { state: "failed", errorCode: "vision" });
    return;
  }
  await finish(input, { state: "ready", summary: result.text });
}

/* ============================================================
 * Cierre: marcar, publicar y soltar el turno
 * ============================================================ */

async function finish(
  input: { organizationId: string; conversationId: string; messageId: string },
  outcome:
    | { state: "ready"; text?: string; summary?: string }
    | { state: "failed"; errorCode: MediaErrorCode }
): Promise<void> {
  const db = getDb();
  const patch: Partial<typeof schema.message.$inferInsert> = {
    mediaState: outcome.state,
  };
  if (outcome.state === "ready") {
    // La transcripción ES lo que dijo la persona: va a `text` (D3).
    if (outcome.text) patch.text = outcome.text;
    // La descripción la escribió la IA: jamás se hace pasar por texto suyo.
    if (outcome.summary) patch.mediaSummary = outcome.summary;
  } else {
    patch.error = MEDIA_ERRORS[outcome.errorCode];
  }

  const updated = await db
    .update(schema.message)
    .set(patch)
    .where(eq(schema.message.id, input.messageId))
    .returning();
  const message = updated[0];
  if (!message) return;

  const mediaRows = await db
    .select({
      id: schema.messageMedia.id,
      mimeType: schema.messageMedia.mimeType,
      durationMs: schema.messageMedia.durationMs,
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
  const row = mediaRows[0];
  const media: MessageMediaDto | null = row
    ? { url: `/api/message-media/${row.id}`, mimeType: row.mimeType, durationMs: row.durationMs }
    : null;

  publish(input.organizationId, {
    type: "message.updated",
    data: {
      conversationId: input.conversationId,
      message: serializeMessage(message, null, media),
    },
  });

  // D9: la BAJA por audio no se puede detectar en la ingesta (ahí todavía no
  // había texto). Se re-evalúa acá con la transcripción, ANTES de soltar el
  // turno, reusando el mismo camino idempotente de 004/011.
  if (outcome.state === "ready" && outcome.text && isOptOutMessage("text", outcome.text)) {
    const convRows = await db
      .select({ contactId: schema.conversation.contactId })
      .from(schema.conversation)
      .where(
        scoped(
          schema.conversation.organizationId,
          input.organizationId,
          eq(schema.conversation.id, input.conversationId)
        )
      )
      .limit(1);
    const contactId = convRows[0]?.contactId;
    if (contactId) {
      await onInboundSideEffects({
        organizationId: input.organizationId,
        contactId,
        messageType: "text",
        text: outcome.text,
        at: message.waTimestamp ?? message.createdAt,
      });
      return;
    }
  }

  await maybeRunAgentTurn(input.organizationId, input.conversationId);
}
