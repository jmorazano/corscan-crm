import { and, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getEnv, isInstagramHumanAgentEnabled } from "@/lib/env";
import { MetaApiError, normalizeRecipient, uploadWhatsAppMedia } from "@/lib/meta/client";
import {
  sendInstagramAttachment,
  type InstagramAttachmentType,
} from "@/lib/instagram/client";
import { igsidFromPhone, instagramSendMode } from "@/lib/instagram/messaging";
import { mediaLinkSecret, signMediaLinkPath } from "@/lib/media-link";
import { toMediaDto } from "@/lib/message-media";
import { transcribeAudio } from "@/lib/ai";
import { audioFormatForMime, type VoiceMime } from "@/lib/voice-note";
import { getAiConfig } from "@/server/ai/credentials";
import { captionTravelsInline, OUTBOUND_KINDS, type OutboundKind } from "@/lib/outbound-media";
import { publish } from "@/server/events/bus";
import { serializeMessage } from "@/server/inbox/ingest";
import { callGraphSend, sendText } from "@/server/inbox/send";
import { SendError } from "@/server/inbox/send-error";
import { isWindowOpen } from "@/server/inbox/window";
import {
  ensureInstagramToken,
  getInstagramIntegration,
  type InstagramIntegration,
} from "@/server/instagram/integration";
import {
  instagramWindowError,
  toSendError as instagramSendError,
} from "@/server/instagram/send";
import {
  getCredentialsByOrg,
  markReconnectRequired,
  type Credentials,
} from "@/server/whatsapp/credentials";

/**
 * Adjuntos que el equipo manda desde la Bandeja (026): imagen, video, audio
 * o documento, por WhatsApp o Instagram.
 *
 * Mismo orden de guardas que el texto (`sendText`) — sandbox → canal →
 * ventana → credenciales — y NADA se escribe hasta pasarlas. Después, a
 * diferencia del texto, se guarda PRIMERO: el operador ve el archivo en el
 * hilo (con el reloj) mientras sube, y si el proveedor lo rechaza el mensaje
 * queda «No entregado» con el binario a mano para reintentar sin volver a
 * elegirlo.
 */

export type OutboundFile = {
  bytes: Buffer;
  kind: OutboundKind;
  mime: string;
  fileName: string;
  /** 027: nota de voz grabada (OGG/Opus → WhatsApp `voice: true`). */
  voice?: boolean;
  durationMs?: number | null;
};

/** 027: WhatsApp muestra como NOTA DE VOZ solo un OGG/Opus con `voice: true`. */
export function isWhatsAppVoiceNote(file: Pick<OutboundFile, "kind" | "mime" | "voice">): boolean {
  return file.kind === "audio" && file.voice === true && file.mime === "audio/ogg";
}

type Conversation = typeof schema.conversation.$inferSelect;
type Contact = typeof schema.contact.$inferSelect;

type Target =
  | { channel: "whatsapp"; credentials: Credentials; to: string }
  | {
      channel: "instagram";
      integration: InstagramIntegration;
      igsid: string;
      humanAgent: boolean;
    };

async function loadConversation(organizationId: string, conversationId: string) {
  const rows = await getDb()
    .select({ conversation: schema.conversation, contact: schema.contact })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new SendError("meta_error", "Conversación no encontrada");
  return row;
}

/**
 * Guardas + destino. Lanza `SendError` sin haber escrito nada. ASERCIÓN DURA
 * (FR-031 de 001): el Laboratorio y el Entrenador jamás llegan a un canal.
 */
async function resolveTarget(
  organizationId: string,
  conversation: Conversation,
  contact: Contact
): Promise<Target> {
  if (conversation.isTest) {
    throw new SendError(
      "sandbox_violation",
      "Conversación de prueba del Laboratorio: el envío real está prohibido"
    );
  }

  if (conversation.kind === "instagram") {
    const mode = instagramSendMode(conversation.lastInboundAt, {
      aiGenerated: false,
      humanAgentEnabled: isInstagramHumanAgentEnabled(),
    });
    if (mode.mode === "closed") throw instagramWindowError(mode.reason);
    const igsid = igsidFromPhone(contact.phone);
    if (!igsid) throw new SendError("meta_error", "El contacto no tiene un ID de Instagram");
    let integration = await getInstagramIntegration(organizationId);
    if (!integration) {
      throw new SendError("not_connected", "No hay una cuenta de Instagram conectada");
    }
    integration = await ensureInstagramToken(integration);
    if (integration.status === "reconnect_required") {
      throw new SendError(
        "reconnect_required",
        "La conexión con Instagram venció: reconectá la cuenta en Ajustes → Instagram"
      );
    }
    return { channel: "instagram", integration, igsid, humanAgent: mode.mode === "human_agent" };
  }

  if (conversation.kind !== "whatsapp") {
    throw new SendError(
      "sandbox_violation",
      "Conversación interna (entrenador): el envío real está prohibido"
    );
  }
  if (!isWindowOpen(conversation.lastInboundAt)) {
    throw new SendError(
      "window_closed",
      "La ventana de 24 horas está cerrada; usa una plantilla aprobada"
    );
  }
  const credentials = await getCredentialsByOrg(organizationId);
  if (!credentials) {
    throw new SendError("not_connected", "No hay número de WhatsApp conectado");
  }
  if (credentials.status === "reconnect_required") {
    throw new SendError(
      "reconnect_required",
      "El token de WhatsApp expiró: reconecta el número en Configuración"
    );
  }
  return { channel: "whatsapp", credentials, to: normalizeRecipient(contact.phone) };
}

/** Canal de la conversación sin cargar credenciales (para validar el archivo). */
export function channelOf(kind: Conversation["kind"]): "whatsapp" | "instagram" | null {
  if (kind === "whatsapp" || kind === "instagram") return kind;
  return null;
}

export async function sendMedia(input: {
  organizationId: string;
  conversationId: string;
  file: OutboundFile;
  caption: string | null;
}): Promise<{ messageId: string; captionError: string | null }> {
  const { organizationId, conversationId, file } = input;
  const { conversation, contact } = await loadConversation(organizationId, conversationId);
  const target = await resolveTarget(organizationId, conversation, contact);
  const caption = input.caption?.trim() || null;
  const inline = captionTravelsInline(target.channel, file.kind);

  // Guardar primero (una transacción: mensaje + binario + marca).
  const db = getDb();
  const now = new Date();
  const { message, mediaId } = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.message)
      .values({
        id: newId("message"),
        organizationId,
        conversationId,
        direction: "out",
        type: file.kind,
        // El epígrafe que el canal no lleva en el adjunto sale aparte, como
        // su propio mensaje de texto.
        text: inline ? caption : null,
        status: "pending",
        mediaState: "ready",
        aiGenerated: false,
        waTimestamp: now,
      })
      .returning();
    const message = inserted[0]!;
    const mediaId = newId("messageMedia");
    await tx.insert(schema.messageMedia).values({
      id: mediaId,
      organizationId,
      messageId: message.id,
      mimeType: file.mime,
      sizeBytes: file.bytes.byteLength,
      durationMs: file.durationMs ?? null,
      fileName: file.fileName,
      data: file.bytes,
    });
    await tx
      .update(schema.conversation)
      .set({ lastMessageAt: now, updatedAt: now })
      .where(eq(schema.conversation.id, conversationId));
    return { message, mediaId };
  });
  const media = toMediaDto({
    id: mediaId,
    mimeType: file.mime,
    durationMs: file.durationMs ?? null,
    fileName: file.fileName,
    sizeBytes: file.bytes.byteLength,
  });
  publish(organizationId, {
    type: "message.new",
    data: { conversationId, message: serializeMessage(message, null, media) },
  });

  await deliver({
    organizationId,
    conversationId,
    messageId: message.id,
    media: { id: mediaId, ...file },
    caption: inline ? caption : null,
    target,
  });
  if (file.kind === "audio") {
    void transcribeOutboundAudio({
      organizationId,
      conversationId,
      messageId: message.id,
      bytes: file.bytes,
      mime: file.mime,
    });
  }

  let captionError: string | null = null;
  if (caption && !inline) {
    try {
      await sendText({ organizationId, conversationId, text: caption });
    } catch (err) {
      // El adjunto ya salió: el texto se informa aparte para reenviarlo.
      captionError = err instanceof Error ? err.message : String(err);
    }
  }
  return { messageId: message.id, captionError };
}

/**
 * Reenvía un adjunto fallido del canal con el binario guardado. Re-chequea
 * ventana y credenciales (pudo haber pasado tiempo). Reemplaza el
 * `wa_message_id`: el estado del intento anterior ya no aplica.
 */
export async function retryMedia(input: {
  organizationId: string;
  conversationId: string;
  messageId: string;
}): Promise<{ messageId: string }> {
  const db = getDb();
  const rows = await db
    .select({
      message: schema.message,
      mediaId: schema.messageMedia.id,
      mime: schema.messageMedia.mimeType,
      fileName: schema.messageMedia.fileName,
      durationMs: schema.messageMedia.durationMs,
      data: schema.messageMedia.data,
    })
    .from(schema.message)
    .innerJoin(schema.messageMedia, eq(schema.messageMedia.messageId, schema.message.id))
    .where(
      scoped(
        schema.message.organizationId,
        input.organizationId,
        eq(schema.message.id, input.messageId),
        eq(schema.message.conversationId, input.conversationId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (
    !row ||
    row.message.direction !== "out" ||
    row.message.source !== "cloud" ||
    !(OUTBOUND_KINDS as readonly string[]).includes(row.message.type)
  ) {
    throw new SendError("meta_error", "No hay un adjunto enviado con ese id");
  }
  if (row.message.status !== "failed") {
    throw new SendError("meta_error", "Ese adjunto no está fallido: no hace falta reintentarlo");
  }

  const { conversation, contact } = await loadConversation(
    input.organizationId,
    input.conversationId
  );
  const target = await resolveTarget(input.organizationId, conversation, contact);

  const reset = await db
    .update(schema.message)
    .set({ status: "pending", error: null })
    .where(and(eq(schema.message.id, row.message.id), eq(schema.message.status, "failed")))
    .returning();
  // Otro pedido ya lo estaba reintentando: no se manda dos veces.
  if (!reset[0]) throw new SendError("meta_error", "Ese adjunto ya se está reintentando");
  await publishUpdated(input.organizationId, input.conversationId, row.message.id);

  await deliver({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    messageId: row.message.id,
    media: {
      id: row.mediaId,
      bytes: row.data,
      kind: row.message.type as OutboundKind,
      mime: row.mime,
      fileName: row.fileName ?? "archivo",
      // La nota de voz grabada guarda su duración; un audio adjunto, no.
      voice: row.durationMs !== null,
      durationMs: row.durationMs,
    },
    caption: row.message.text,
    target,
  });
  return { messageId: row.message.id };
}

/* ============================================================
 * Entrega al canal
 * ============================================================ */

const IG_TYPE: Record<OutboundKind, InstagramAttachmentType> = {
  image: "image",
  video: "video",
  audio: "audio",
  document: "file",
};

async function deliver(input: {
  organizationId: string;
  conversationId: string;
  messageId: string;
  media: OutboundFile & { id: string };
  caption: string | null;
  target: Target;
}): Promise<void> {
  const { organizationId, messageId, media, target } = input;
  let providerId: string;
  try {
    if (target.channel === "whatsapp") {
      providerId = await deliverWhatsApp(target.credentials, target.to, media, input.caption);
    } else {
      providerId = await deliverInstagram(organizationId, target, media);
    }
  } catch (err) {
    const sendError =
      target.channel === "instagram"
        ? await instagramSendError(err, organizationId)
        : err instanceof SendError
          ? err
          : new SendError("meta_error", err instanceof Error ? err.message : String(err));
    await markFailed(organizationId, input.conversationId, messageId, sendError.message);
    throw new SendError(sendError.code, sendError.message, { messageId });
  }
  await markAccepted(
    organizationId,
    input.conversationId,
    messageId,
    providerId,
    // Instagram no avisa «entregado»: aceptado = enviado (como el texto).
    target.channel === "instagram" ? "sent" : "pending"
  );
}

async function deliverWhatsApp(
  credentials: Credentials,
  to: string,
  media: OutboundFile,
  caption: string | null
): Promise<string> {
  let mediaId: string;
  try {
    mediaId = await uploadWhatsAppMedia({
      phoneNumberId: credentials.phoneNumberId,
      token: credentials.token,
      bytes: media.bytes,
      mimeType: media.mime,
      fileName: media.fileName,
    });
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        await markReconnectRequired(credentials.organizationId);
        throw new SendError(
          "reconnect_required",
          "El token de WhatsApp expiró: reconecta el número en Configuración"
        );
      }
      if (err.status === 0 || err.status >= 500) {
        throw new SendError("meta_unavailable", "Meta no está disponible ahora: reintentá en un momento");
      }
      throw new SendError("meta_error", `Meta rechazó el archivo: ${err.message}`);
    }
    throw err;
  }

  const body: Record<string, unknown> = { id: mediaId };
  if (caption && media.kind !== "audio") body.caption = caption;
  if (media.kind === "document") body.filename = media.fileName;
  if (isWhatsAppVoiceNote(media)) body.voice = true;
  const { waMessageId } = await callGraphSend(credentials, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: media.kind,
    [media.kind]: body,
  });
  return waMessageId;
}

async function deliverInstagram(
  organizationId: string,
  target: Extract<Target, { channel: "instagram" }>,
  media: OutboundFile & { id: string }
): Promise<string> {
  const base = getEnv().APP_BASE_URL.replace(/\/$/, "");
  const url = `${base}${signMediaLinkPath(media.id, mediaLinkSecret())}`;
  const { messageId } = await sendInstagramAttachment({
    igUserId: target.integration.igUserId,
    token: target.integration.token,
    recipientId: target.igsid,
    type: IG_TYPE[media.kind],
    url,
    humanAgent: target.humanAgent,
  });
  // Si el eco de Instagram ganó la carrera ya hay una fila «Desde
  // Instagram» con este `mid`: es nuestra, se descarta el eco.
  await getDb()
    .delete(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.waMessageId, messageId),
        ne(schema.message.source, "cloud")
      )
    );
  return messageId;
}

/* ============================================================
 * Transcripción del audio que mandó el equipo (027)
 * ============================================================ */

const TRANSCRIBABLE = new Set<string>([
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/aac",
  "audio/wav",
]);

/**
 * La nota de voz del equipo se transcribe en segundo plano (si la empresa
 * tiene IA): se ve en el hilo y entra al historial del agente, que así no
 * contradice lo que dijo una persona. Nunca lanza; sin IA no hace nada y un
 * fallo solo deja el reproductor.
 */
export async function transcribeOutboundAudio(input: {
  organizationId: string;
  conversationId: string;
  messageId: string;
  bytes: Buffer;
  mime: string;
}): Promise<void> {
  if (!TRANSCRIBABLE.has(input.mime)) return;
  const db = getDb();
  const where = scoped(
    schema.message.organizationId,
    input.organizationId,
    eq(schema.message.id, input.messageId)
  );
  try {
    const config = await getAiConfig(input.organizationId);
    if (!config) return;
    await db.update(schema.message).set({ mediaState: "pending" }).where(where);
    await publishUpdated(input.organizationId, input.conversationId, input.messageId);
    const result = await transcribeAudio(config, {
      bytes: input.bytes,
      format: audioFormatForMime(input.mime as VoiceMime),
    });
    await db
      .update(schema.message)
      .set(result.ok ? { text: result.text, mediaState: "ready" } : { mediaState: "ready" })
      .where(where);
  } catch (err) {
    console.warn(
      "[medios] no se pudo transcribir el audio enviado:",
      err instanceof Error ? err.message : err
    );
    await db.update(schema.message).set({ mediaState: "ready" }).where(where).catch(() => {});
  }
  await publishUpdated(input.organizationId, input.conversationId, input.messageId).catch(() => {});
}

/* ============================================================
 * Cierre
 * ============================================================ */

async function markAccepted(
  organizationId: string,
  conversationId: string,
  messageId: string,
  providerId: string,
  status: "pending" | "sent"
): Promise<void> {
  await getDb()
    .update(schema.message)
    .set({ waMessageId: providerId, status, error: null })
    .where(scoped(schema.message.organizationId, organizationId, eq(schema.message.id, messageId)));
  await publishUpdated(organizationId, conversationId, messageId);
}

async function markFailed(
  organizationId: string,
  conversationId: string,
  messageId: string,
  error: string
): Promise<void> {
  await getDb()
    .update(schema.message)
    .set({ status: "failed", error })
    .where(scoped(schema.message.organizationId, organizationId, eq(schema.message.id, messageId)));
  await publishUpdated(organizationId, conversationId, messageId);
}

async function publishUpdated(
  organizationId: string,
  conversationId: string,
  messageId: string
): Promise<void> {
  const rows = await getDb()
    .select({
      message: schema.message,
      mediaId: schema.messageMedia.id,
      mimeType: schema.messageMedia.mimeType,
      durationMs: schema.messageMedia.durationMs,
      fileName: schema.messageMedia.fileName,
      sizeBytes: schema.messageMedia.sizeBytes,
    })
    .from(schema.message)
    .leftJoin(schema.messageMedia, eq(schema.messageMedia.messageId, schema.message.id))
    .where(scoped(schema.message.organizationId, organizationId, eq(schema.message.id, messageId)))
    .limit(1);
  const row = rows[0];
  if (!row) return;
  const media =
    row.mediaId && row.mimeType && row.sizeBytes !== null
      ? toMediaDto({
          id: row.mediaId,
          mimeType: row.mimeType,
          durationMs: row.durationMs,
          fileName: row.fileName,
          sizeBytes: row.sizeBytes,
        })
      : null;
  publish(organizationId, {
    type: "message.updated",
    data: { conversationId, message: serializeMessage(row.message, null, media) },
  });
}
