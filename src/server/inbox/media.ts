import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { describeImage, readDocument, transcribeAudio } from "@/lib/ai";
import {
  MEDIA_ERRORS,
  PDF_READ_MAX_BYTES,
  sniffImageMime,
  type MediaErrorCode,
  type MediaPlan,
} from "@/lib/inbound-media";
import { downloadMediaBinary, fetchMediaHandle } from "@/lib/meta/client";
import { downloadInstagramMedia } from "@/lib/instagram/client";
import { classifyOutboundFile, sanitizeFileName } from "@/lib/outbound-media";
import type { MessageMediaDto } from "@/lib/types";
import { toMediaDto } from "@/lib/message-media";
import { audioFormatForMime, normalizeMime, sniffAudioMime } from "@/lib/voice-note";
import { getAiConfig } from "@/server/ai/credentials";
import { maybeRunAgentTurn } from "@/server/ai/trigger";
import { publish } from "@/server/events/bus";
import { serializeMessage } from "@/server/inbox/ingest";
import { isOptOutMessage, onInboundSideEffects } from "@/server/inbox/side-effects";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";

/**
 * De dónde sale el binario. WhatsApp (020) da un id que se canjea por una URL
 * con el token de la WABA; Instagram (023) trae la URL firmada de la CDN en
 * el propio webhook y se baja sin token.
 */
export type InboundMediaSource =
  | { kind: "wa"; mediaId: string }
  | { kind: "url"; url: string };

/**
 * Adjuntos entrantes de WhatsApp (020) e Instagram (023): descarga, guardado
 * y lectura por IA, SIEMPRE en segundo plano.
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
  source: InboundMediaSource;
  declaredMime: string | null;
  /** 026: nombre original del documento (WhatsApp lo manda en el webhook). */
  fileName?: string | null;
  plan: Extract<MediaPlan, { kind: "process" | "store" }>;
  /** 030: resolver el adjunto sin despertar al agente (standby de Instagram). */
  skipAgent?: boolean;
}): Promise<void> {
  // D4/FR-010: el sandbox del Laboratorio JAMÁS toca la API real.
  if (input.isTest) {
    await finish(input, { state: "failed", errorCode: "download" });
    return;
  }

  try {
    const bytes = await download(input);
    if (!bytes) return; // `download` ya cerró el mensaje y disparó el turno
    // 026: video y documento son para el equipo; el agente no los lee.
    if (input.plan.kind === "store") {
      await finish(input, { state: "ready" });
      return;
    }
    // 027: el PDF sí lo lee.
    if (input.plan.type === "document") {
      await readPdf(input, bytes);
      return;
    }
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
  source: InboundMediaSource;
  declaredMime: string | null;
  fileName?: string | null;
  plan: Extract<MediaPlan, { kind: "process" | "store" }>;
}): Promise<{ data: Buffer; mimeType: string } | null> {
  const fetched =
    input.source.kind === "wa"
      ? await downloadFromWhatsApp(input, input.source.mediaId)
      : await downloadFromUrl(input, input.source.url);
  if (!fetched) return null;
  const { downloaded, handleMime } = fetched;

  // 026: video y documento se guardan tal cual; el MIME sale de la firma
  // (y si no se reconoce, del declarado: el visor lo sirve como binario
  // opaco si no es un tipo seguro). 027: también el PDF que se va a leer.
  if (input.plan.kind === "store" || input.plan.type === "document") {
    const plain = (downloaded.contentType || handleMime || input.declaredMime || "")
      .split(";")[0]!
      .trim()
      .toLowerCase();
    const classified = classifyOutboundFile(downloaded.bytes, input.fileName ?? "");
    const mimeType = classified?.mime ?? (plain || "application/octet-stream");
    const fileName =
      input.plan.type === "document" || input.fileName
        ? sanitizeFileName(input.fileName, { mime: mimeType })
        : null;
    await saveMedia(input, downloaded.bytes, mimeType, fileName);
    // 027: el equipo ve el archivo ya, mientras la IA lo lee.
    if (input.plan.kind === "process") await publishCurrent(input);
    return { data: downloaded.bytes, mimeType };
  }

  // El MIME declarado no manda: el contenido sí. Un `image/jpeg` que en
  // realidad es otra cosa hace fallar al proveedor con un error opaco.
  const declared = normalizeMime(
    downloaded.contentType || handleMime || input.declaredMime || ""
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
    // 030: una historia de Instagram puede ser un video: se guarda para que
    // el equipo la vea, sin descripción (el agente sabe igual que respondió
    // a una historia).
    if (input.plan.story && (mimeType.startsWith("video/") || declared.startsWith("video/"))) {
      await saveMedia(input, downloaded.bytes, mimeType.startsWith("video/") ? mimeType : declared);
      await finish(input, { state: "ready" });
      return null;
    }
    await saveMedia(input, downloaded.bytes, mimeType || "application/octet-stream");
    await finish(input, { state: "failed", errorCode: "unsupported" });
    return null;
  }

  await saveMedia(input, downloaded.bytes, mimeType);
  return { data: downloaded.bytes, mimeType };
}

type Downloaded = {
  downloaded: { bytes: Buffer; contentType: string };
  handleMime: string | null;
};

type DownloadInput = {
  organizationId: string;
  conversationId: string;
  messageId: string;
  plan: Extract<MediaPlan, { kind: "process" | "store" }>;
};

/** WhatsApp: id → URL (con el token de la WABA) → bytes. */
async function downloadFromWhatsApp(
  input: DownloadInput,
  mediaId: string
): Promise<Downloaded | null> {
  const creds = await getCredentialsByOrg(input.organizationId);
  if (!creds) {
    await finish(input, { state: "failed", errorCode: "download" });
    return null;
  }

  let handle;
  try {
    handle = await fetchMediaHandle(mediaId, creds.token);
  } catch (err) {
    console.warn(
      `[medios] no se pudo pedir el archivo ${mediaId}:`,
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

  try {
    const downloaded = await downloadMediaBinary(handle.url, creds.token, input.plan.maxBytes);
    return { downloaded, handleMime: handle.mimeType };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[medios] descarga fallida de ${mediaId}: ${message}`);
    await finish(input, {
      state: "failed",
      errorCode: /máximo|tamaño/i.test(message) ? "too_large" : "download",
    });
    return null;
  }
}

/** Instagram: la URL firmada de la CDN llega en el webhook. */
async function downloadFromUrl(input: DownloadInput, url: string): Promise<Downloaded | null> {
  try {
    const downloaded = await downloadInstagramMedia(url, input.plan.maxBytes);
    return { downloaded, handleMime: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[medios] descarga fallida del adjunto de Instagram: ${message}`);
    await finish(input, {
      state: "failed",
      errorCode: /máximo|tamaño/i.test(message) ? "too_large" : "download",
    });
    return null;
  }
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
  mimeType: string,
  fileName: string | null = null
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
      fileName,
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
    plan: Extract<MediaPlan, { kind: "process" | "store" }>;
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

/** 027: publica el mensaje como está (con su binario), sin cambiarlo. */
async function publishCurrent(input: {
  organizationId: string;
  conversationId: string;
  messageId: string;
}): Promise<void> {
  const rows = await getDb()
    .select({
      message: schema.message,
      id: schema.messageMedia.id,
      mimeType: schema.messageMedia.mimeType,
      durationMs: schema.messageMedia.durationMs,
      fileName: schema.messageMedia.fileName,
      sizeBytes: schema.messageMedia.sizeBytes,
    })
    .from(schema.message)
    .innerJoin(schema.messageMedia, eq(schema.messageMedia.messageId, schema.message.id))
    .where(
      scoped(schema.message.organizationId, input.organizationId, eq(schema.message.id, input.messageId))
    )
    .limit(1);
  const row = rows[0];
  if (!row) return;
  publish(input.organizationId, {
    type: "message.updated",
    data: {
      conversationId: input.conversationId,
      message: serializeMessage(row.message, null, toMediaDto(row)),
    },
  });
}

/* ============================================================
 * Lectura de PDF (027)
 * ============================================================ */

/**
 * Lee un PDF del cliente con el modelo de visión de la empresa. Cualquier
 * salida —leído, no es PDF, muy grande, sin IA, fallo del proveedor—
 * termina en `finish`, que suelta el turno retenido.
 */
async function readPdf(
  input: {
    organizationId: string;
    conversationId: string;
    messageId: string;
    fileName?: string | null;
    plan: Extract<MediaPlan, { kind: "process" | "store" }>;
  },
  media: { data: Buffer; mimeType: string }
): Promise<void> {
  // Un .docx que llegó sin MIME (Instagram) se guarda y el agente pregunta.
  if (media.mimeType !== "application/pdf") {
    await finish(input, { state: "ready" });
    return;
  }
  if (media.data.byteLength > PDF_READ_MAX_BYTES) {
    await finish(input, { state: "failed", errorCode: "document_too_long" });
    return;
  }
  const config = await getAiConfig(input.organizationId);
  if (!config) {
    await finish(input, { state: "failed", errorCode: "not_configured" });
    return;
  }
  const result = await readDocument(config, {
    bytes: media.data,
    fileName: input.fileName?.trim() || "documento.pdf",
  });
  if (!result.ok) {
    if (result.error !== "empty") {
      console.warn(`[medios] lectura de PDF ${result.error}: ${result.detail}`);
    }
    await finish(input, { state: "failed", errorCode: "document" });
    return;
  }
  await finish(input, { state: "ready", summary: result.text });
}

/* ============================================================
 * Cierre: marcar, publicar y soltar el turno
 * ============================================================ */

async function finish(
  input: {
    organizationId: string;
    conversationId: string;
    messageId: string;
    plan?: MediaPlan;
    skipAgent?: boolean;
  },
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
      fileName: schema.messageMedia.fileName,
      sizeBytes: schema.messageMedia.sizeBytes,
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
  const media: MessageMediaDto | null = row ? toMediaDto(row) : null;

  publish(input.organizationId, {
    type: "message.updated",
    data: {
      conversationId: input.conversationId,
      message: serializeMessage(message, null, media),
    },
  });

  // 026: el turno de un video o documento ya salió en la ingesta (no
  // espera al binario); soltarlo otra vez podría duplicar la respuesta.
  if (input.plan?.kind === "store") return;
  // 030: otra app maneja el hilo (standby): el agente no responde.
  if (input.skipAgent) return;

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
