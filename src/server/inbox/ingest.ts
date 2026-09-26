import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { MessageDto, MessageMediaDto, MessageVia } from "@/lib/types";
import { publish } from "@/server/events/bus";
import { notifyInboundMessage } from "@/server/push/events";
import { getCredentialsByPhoneNumberId } from "@/server/whatsapp/credentials";
import type { WebhookMessage, WebhookValue } from "@/server/inbox/webhook";
import { planInboundMedia } from "@/lib/inbound-media";
import { processInboundMedia, type InboundMediaSource } from "@/server/inbox/media";
import { applyStatusUpdate } from "@/server/inbox/status";
import { onLeadActivity } from "@/server/inbox/lead-activity";
import {
  isOptOutMessage,
  onInboundSideEffects,
} from "@/server/inbox/side-effects";
import { maybeRunAgentTurn } from "@/server/ai/trigger";

/** Tipos de contenido soportados; el resto se ignora sin error. */
const SUPPORTED_TYPES = new Set([
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "location",
  "contacts",
]);

export async function getOrCreateContact(
  organizationId: string,
  phone: string,
  name?: string | null
) {
  const db = getDb();
  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId,
      phone,
      name: name?.trim() || phone,
    })
    .onConflictDoNothing({
      target: [schema.contact.organizationId, schema.contact.phone],
    })
    .returning();
  if (inserted[0]) return { contact: inserted[0], isNew: true };

  const rows = await db
    .select()
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.organizationId, organizationId),
        eq(schema.contact.phone, phone)
      )
    )
    .limit(1);
  const existing = rows[0];
  if (!existing) throw new Error("contacto no encontrado tras upsert");

  // Reactivar si estaba archivado (el nombre editado por el operador se respeta).
  if (existing.archivedAt) {
    await db
      .update(schema.contact)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(eq(schema.contact.id, existing.id));
    existing.archivedAt = null;
  }
  return { contact: existing, isNew: false };
}

export async function getOrCreateConversation(
  organizationId: string,
  contactId: string,
  /** 023: el canal de una conversación NUEVA. La existente conserva el suyo. */
  kind: "whatsapp" | "instagram" = "whatsapp"
) {
  const db = getDb();
  const inserted = await db
    .insert(schema.conversation)
    .values({ id: newId("conversation"), organizationId, contactId, kind })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];

  const rows = await db
    .select()
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.contactId, contactId),
        eq(schema.conversation.isTest, false)
      )
    )
    .limit(1);
  const existing = rows[0];
  if (!existing) throw new Error("conversación no encontrada tras upsert");
  return existing;
}

/**
 * Procesa el `value` de un cambio `messages` del webhook: mensajes entrantes
 * (idempotentes por wa_message_id) y actualizaciones de estado.
 */
export async function processMessagesValue(value: WebhookValue): Promise<void> {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) return;

  const credentials = await getCredentialsByPhoneNumberId(phoneNumberId);
  if (!credentials) {
    // Caso típico: webhook/override configurado ANTES de guardar la conexión
    // en el wizard — el evento llega pero no hay a qué organización enrutarlo.
    console.warn(
      `[webhook] evento para phone_number_id desconocido (${phoneNumberId}): ` +
        "guarda la conexión en Configuración → WhatsApp para recibir mensajes"
    );
    return;
  }

  const organizationId = credentials.organizationId;

  for (const status of value.statuses ?? []) {
    await applyStatusUpdate(organizationId, status);
  }

  for (const msg of value.messages ?? []) {
    if (!SUPPORTED_TYPES.has(msg.type)) continue; // reacciones, etc.: ignorar
    const profileName = value.contacts?.find(
      (c) => c.wa_id === msg.from
    )?.profile?.name;
    const attachment = attachmentOf(msg);
    await ingestInboundMessage({
      organizationId,
      from: msg.from,
      profileName: profileName ?? null,
      waMessageId: msg.id,
      type: msg.type,
      // 020: el epígrafe de una imagen o el nombre de un documento SON del
      // cliente; van a `text` como cualquier mensaje escrito.
      text: msg.text?.body ?? attachment?.caption ?? attachment?.filename ?? null,
      mediaId: attachment?.id ?? null,
      mediaMime: attachment?.mime_type ?? null,
      timestamp: msg.timestamp,
    });
  }
}

/** El sobre del adjunto vive en una clave distinta según el tipo. */
function attachmentOf(msg: WebhookMessage) {
  return msg.image ?? msg.audio ?? msg.video ?? msg.document ?? msg.sticker ?? null;
}

export async function ingestInboundMessage(input: {
  organizationId: string;
  from: string;
  profileName: string | null;
  waMessageId: string;
  type: string;
  text: string | null;
  /** 020: id del binario en Meta, cuando el mensaje trae adjunto. */
  mediaId?: string | null;
  mediaMime?: string | null;
  timestamp: string;
}): Promise<void> {
  const { organizationId } = input;

  const { contact } = await getOrCreateContact(
    organizationId,
    input.from,
    input.profileName
  );
  const conversation = await getOrCreateConversation(
    organizationId,
    contact.id
  );

  await ingestInboundCore({
    organizationId,
    contact,
    conversation,
    providerMessageId: input.waMessageId,
    type: input.type,
    text: input.text,
    media: input.mediaId
      ? { source: { kind: "wa", mediaId: input.mediaId }, mime: input.mediaMime ?? null }
      : null,
    at: toDate(input.timestamp),
  });
}

/**
 * Núcleo COMÚN de la ingesta de un mensaje entrante, sea de WhatsApp o de
 * Instagram (023): dedup por id del proveedor POR TENANT, marcas de la
 * conversación, lead, consentimiento/baja, SSE, push, adjunto y turno del
 * agente. El llamador ya resolvió contacto y conversación de su canal.
 */
export async function ingestInboundCore(input: {
  organizationId: string;
  contact: { id: string; name: string };
  conversation: typeof schema.conversation.$inferSelect;
  /** `wa_message_id` en WhatsApp, `mid` en Instagram. */
  providerMessageId: string;
  type: string;
  text: string | null;
  media: { source: InboundMediaSource; mime: string | null } | null;
  at: Date;
}): Promise<typeof schema.message.$inferSelect | null> {
  const db = getDb();
  const { organizationId, contact, conversation } = input;

  const waTimestamp = input.at;

  // 020: qué hacer con el adjunto. `process` nace `pending` y retiene el
  // turno del agente hasta que el binario esté resuelto (D5).
  const mediaRef =
    input.media?.source.kind === "wa"
      ? input.media.source.mediaId
      : input.media?.source.kind === "url"
        ? input.media.source.url
        : null;
  const plan = planInboundMedia(input.type, mediaRef);

  // Idempotencia dura POR TENANT: mismo (organization_id, wa_message_id) →
  // sin efectos adicionales. El scope evita que un wamid de la org A condicione
  // la ingesta de la org B (US2, mismo contrato que applyStatusUpdate).
  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId,
      conversationId: conversation.id,
      waMessageId: input.providerMessageId,
      direction: "in",
      type: input.type,
      text: input.text,
      status: "delivered",
      mediaState: plan.kind === "process" ? "pending" : null,
      waTimestamp,
    })
    .onConflictDoNothing({
      target: [schema.message.organizationId, schema.message.waMessageId],
    })
    .returning();
  const message = inserted[0];
  if (!message) return null; // duplicado

  await db
    .update(schema.conversation)
    .set({
      lastInboundAt: waTimestamp,
      lastMessageAt: waTimestamp,
      unreadCount: sql`${schema.conversation.unreadCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(schema.conversation.id, conversation.id));

  await onLeadActivity(organizationId, contact.id, waTimestamp);

  // 004: consentimiento inbound + baja automática + "respondió" de campañas
  // (post-gate de dedup: exactamente una vez por wamid).
  await onInboundSideEffects({
    organizationId,
    contactId: contact.id,
    messageType: input.type,
    text: input.text,
    at: waTimestamp,
  });

  publish(organizationId, {
    type: "message.new",
    data: { conversationId: conversation.id, message: serializeMessage(message) },
  });
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversation.id } },
  });

  // 013 (FR-005): push a los dispositivos de la empresa, en segundo plano;
  // un fallo del push jamás afecta la ingesta.
  notifyInboundMessage({
    organizationId,
    conversation: {
      id: conversation.id,
      isTest: conversation.isTest,
      aiEnabled: conversation.aiEnabled,
      handoffAt: conversation.handoffAt,
    },
    contactName: contact.name,
    message: { type: message.type, text: message.text },
  });

  // 011 (FR-007): el mensaje de baja no merece respuesta del agente — el
  // side-effect ya marcó la baja; responder sería insistirle a quien pidió
  // no recibir más.
  if (isOptOutMessage(input.type, input.text)) return message;

  // 020 (D5): con un adjunto procesable el turno NO sale acá. Lo dispara
  // `processInboundMedia` cuando el binario está resuelto — listo o
  // fallido. Si saliera ahora, el agente contestaría el mensaje anterior:
  // el historial del pipeline filtra los mensajes sin texto.
  if (plan.kind === "process" && input.media) {
    void processInboundMedia({
      organizationId,
      conversationId: conversation.id,
      messageId: message.id,
      isTest: conversation.isTest,
      source: input.media.source,
      declaredMime: input.media.mime,
      plan,
    });
    return message;
  }

  await maybeRunAgentTurn(organizationId, conversation.id);
  return message;
}

function toDate(timestamp: string): Date {
  const n = Number(timestamp);
  if (Number.isFinite(n) && n > 0) return new Date(n * 1000);
  return new Date();
}

export function serializeMessage(
  m: typeof schema.message.$inferSelect,
  /** 014: etiqueta de origen externo (nombre de la clave de API). */
  via: MessageVia | null = null,
  /** 015: nota de voz adjunta. */
  media: MessageMediaDto | null = null
): MessageDto {
  return {
    id: m.id,
    conversationId: m.conversationId,
    direction: m.direction,
    type: m.type,
    text: m.text,
    status: m.status,
    error: m.error ?? null,
    aiGenerated: m.aiGenerated,
    via,
    media,
    mediaState: m.mediaState ?? null,
    mediaSummary: m.mediaSummary ?? null,
    source: m.source ?? "cloud",
    createdAt: (m.waTimestamp ?? m.createdAt).toISOString(),
  };
}
