import { eq, inArray, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getInstagramUserProfile } from "@/lib/instagram/client";
import {
  instagramContactPhone,
  instagramDisplayName,
  isProvisionalInstagramName,
} from "@/lib/instagram/messaging";
import {
  messageTypeFor,
  parseInstagramWebhook,
  storyUrlFor,
  type InstagramEvent,
} from "@/lib/instagram/webhook";
import { isHumanPayload } from "@/lib/instagram/profile";
import type { MessageDetails } from "@/lib/instagram/types";
import { publish } from "@/server/events/bus";
import {
  getOrCreateConversation,
  ingestInboundCore,
  serializeMessage,
} from "@/server/inbox/ingest";
import {
  getInstagramIntegrationByAccount,
  markInstagramStandbySeen,
  type InstagramIntegration,
} from "@/server/instagram/integration";
import { applyInstagramReferral, applyStoryOrigin } from "@/server/instagram/origin";

/**
 * Ingesta de Instagram Direct (023). Traduce los eventos del webhook al
 * embudo COMÚN de la Bandeja (`ingestInboundCore`): el resto del producto —
 * lead, no leídos, push, baja, agente, adjuntos— no distingue el canal.
 *
 * Nunca lanza hacia el webhook: un evento que falla se registra y el resto
 * del lote sigue (mismo contrato que el de WhatsApp).
 */
export async function processInstagramWebhook(body: unknown): Promise<void> {
  const events = parseInstagramWebhook(body);
  if (!events) return;
  // Traza mínima (sin contenido ni IDs): permite saber si Meta entrega algo.
  if (events.length > 0) {
    const kinds = events.map((e) =>
      e.kind === "message" && e.isEcho
        ? "eco"
        : (e.kind === "message" || e.kind === "postback") && e.standby
          ? `${e.kind}(standby)`
          : e.kind
    );
    console.log(`[instagram] webhook: ${events.length} evento(s): ${kinds.join(", ")}`);
  }

  const integrations = new Map<string, InstagramIntegration | null>();
  for (const ev of events) {
    try {
      if (!integrations.has(ev.accountId)) {
        integrations.set(ev.accountId, await getInstagramIntegrationByAccount(ev.accountId));
      }
      const integration = integrations.get(ev.accountId) ?? null;
      if (!integration) {
        console.warn(
          `[instagram] evento para una cuenta sin conectar (${ev.accountId}): se ignora`
        );
        continue;
      }
      await handleEvent(integration, ev);
    } catch (err) {
      console.error(
        `[instagram] fallo procesando un evento ${ev.kind}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}

async function handleEvent(integration: InstagramIntegration, ev: InstagramEvent) {
  // 030: otra app maneja el hilo (Conversation Routing). Se guarda igual,
  // pero el agente no responde y Ajustes avisa.
  if ((ev.kind === "message" || ev.kind === "postback") && ev.standby) {
    await markInstagramStandbySeen(integration.organizationId).catch(() => {});
  }
  switch (ev.kind) {
    case "message":
      if (ev.isEcho) return handleEcho(integration, ev);
      return handleInbound(integration, ev);
    case "postback":
      return handleInbound(
        integration,
        {
          kind: "message",
          accountId: ev.accountId,
          customerId: ev.customerId,
          mid: ev.mid,
          text: ev.text,
          attachments: [],
          isEcho: false,
          isUnsupported: false,
          at: ev.at,
          referral: ev.referral,
          storyReply: null,
          quickReplyPayload: ev.payload,
          template: null,
          standby: ev.standby,
        },
        // 030: «Hablar con una persona» del menú escala sin pasar por el modelo.
        { human: isHumanPayload(ev.payload) }
      );
    case "referral":
      return handleReferral(integration, ev);
    case "comment": {
      const { handleInstagramComment } = await import("@/server/instagram/comments");
      await handleInstagramComment(
        integration,
        {
          commentId: ev.commentId,
          mediaId: ev.mediaId,
          fromId: ev.fromId,
          username: ev.username,
          text: ev.text,
          parentId: ev.parentId,
          live: ev.live,
          at: ev.at,
        },
        "webhook"
      );
      return;
    }
    case "deleted":
      return handleDeleted(integration.organizationId, ev.mid);
    case "read":
      return handleRead(integration.organizationId, ev);
    case "reaction":
      return handleReaction(integration, ev);
  }
}

/* ============================================================
 * Contacto
 * ============================================================ */

/**
 * Contacto de Instagram de la empresa (por IGSID). El nombre y el @usuario
 * se leen del User Profile API cuando el contacto es nuevo o todavía tiene
 * el nombre provisorio — best effort: si Meta no responde, el contacto nace
 * igual y se completa en el próximo mensaje.
 */
export async function getOrCreateInstagramContact(
  integration: InstagramIntegration,
  igsid: string,
  /** Lo que ya se sabe del cliente (p. ej. el @usuario del historial). */
  hint: { username?: string | null } = {},
  /**
   * 030: no leer el perfil (quien solo comentó no dio consentimiento: Meta
   * respondería «User consent is required»).
   */
  opts: { skipProfile?: boolean } = {}
) {
  const db = getDb();
  const { organizationId } = integration;
  const phone = instagramContactPhone(igsid);

  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId,
      phone,
      channel: "instagram",
      name: instagramDisplayName({ igsid, username: hint.username }),
      igUsername: hint.username?.replace(/^@/, "") || null,
    })
    .onConflictDoNothing({ target: [schema.contact.organizationId, schema.contact.phone] })
    .returning();

  let contact = inserted[0];
  if (!contact) {
    const rows = await db
      .select()
      .from(schema.contact)
      .where(
        scoped(schema.contact.organizationId, organizationId, eq(schema.contact.phone, phone))
      )
      .limit(1);
    contact = rows[0];
    if (!contact) throw new Error("contacto de Instagram no encontrado tras upsert");
    if (contact.archivedAt) {
      await db
        .update(schema.contact)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(eq(schema.contact.id, contact.id));
      contact = { ...contact, archivedAt: null };
    }
  }

  const needsProfile =
    !contact.igUsername ||
    (isProvisionalInstagramName(contact.name, igsid, contact.igUsername) && !contact.nameEditedAt);
  if (needsProfile && !opts.skipProfile && integration.status === "connected") {
    const profile = await getInstagramUserProfile(igsid, integration.token).catch(
      (err) => {
        console.warn(
          "[instagram] no se pudo leer el perfil del cliente:",
          err instanceof Error ? err.message : err
        );
        return null;
      }
    );
    if (profile && (profile.name || profile.username)) {
      const patch: Partial<typeof schema.contact.$inferInsert> = {
        igUsername: profile.username ?? contact.igUsername,
        updatedAt: new Date(),
      };
      // Lo que cargó o editó una persona del equipo NUNCA se pisa (021).
      if (!contact.nameEditedAt && isProvisionalInstagramName(contact.name, igsid, contact.igUsername)) {
        patch.name = instagramDisplayName({ ...profile, igsid });
      }
      const updated = await db
        .update(schema.contact)
        .set(patch)
        .where(eq(schema.contact.id, contact.id))
        .returning();
      contact = updated[0] ?? contact;
    }
  }
  return contact;
}

/* ============================================================
 * Mensajes
 * ============================================================ */

type MessageEvent = Extract<InstagramEvent, { kind: "message" }>;

async function handleInbound(
  integration: InstagramIntegration,
  ev: MessageEvent,
  opts: { human?: boolean } = {}
) {
  const { organizationId } = integration;
  const contact = await getOrCreateInstagramContact(integration, ev.customerId);
  const conversation = await getOrCreateConversation(organizationId, contact.id, "instagram");
  const type = messageTypeFor(ev);
  const first = ev.attachments[0];

  // 030: de dónde llegó (link con ref, anuncio, historia).
  if (ev.referral) {
    await applyInstagramReferral({
      organizationId,
      conversationId: conversation.id,
      currentOrigin: conversation.igOrigin ?? null,
      referral: ev.referral,
      at: ev.at,
    }).catch((err) => console.warn("[instagram] no se pudo registrar el origen:", err instanceof Error ? err.message : err));
  }
  const storyUrl = type === "story" ? storyUrlFor(ev) : null;
  if (type === "story") {
    await applyStoryOrigin({
      organizationId,
      conversationId: conversation.id,
      currentOrigin: conversation.igOrigin ?? null,
      kind: ev.storyReply ? "story_reply" : "story_mention",
      at: ev.at,
    }).catch(() => {});
  }

  // 030: si la persona responde el DM de una regla de comentarios con
  // seguimiento, sale ESE mensaje y el agente no habla encima.
  const { pendingCommentFollowUp, sendCommentFollowUp } = await import("@/server/instagram/comments");
  const followUp = ev.standby || opts.human ? null : await pendingCommentFollowUp(organizationId, conversation.id);

  const details: MessageDetails = {
    ...(type === "story" ? { story: { kind: ev.storyReply ? ("reply" as const) : ("mention" as const) } } : {}),
    ...(ev.standby ? { standby: true } : {}),
  };
  const inserted = await ingestInboundCore({
    organizationId,
    contact,
    conversation,
    providerMessageId: ev.mid,
    type,
    text: ev.text,
    media:
      type === "story"
        ? storyUrl
          ? { source: { kind: "url", url: storyUrl }, mime: null }
          : null
        : first?.url && (type === "image" || type === "audio" || type === "video" || type === "document")
          ? { source: { kind: "url", url: first.url }, mime: null }
          : null,
    at: ev.at,
    details: Object.keys(details).length > 0 ? details : null,
    skipAgent: ev.standby || !!followUp || !!opts.human,
  });
  if (!inserted) return;

  if (followUp) await sendCommentFollowUp(organizationId, conversation.id, followUp);
  if (opts.human) {
    const { applyHandoff } = await import("@/server/ai/pipeline");
    await applyHandoff(conversation.id, organizationId, "cliente");
  }
}

/**
 * 030: la persona volvió a abrir el chat desde un link o un anuncio, sin
 * escribir. Solo se registra en una conversación que ya existe: en una nueva
 * la referencia llega con el primer mensaje.
 */
async function handleReferral(
  integration: InstagramIntegration,
  ev: Extract<InstagramEvent, { kind: "referral" }>
) {
  const conversation = await findConversation(integration.organizationId, ev.customerId);
  if (!conversation) return;
  const rows = await getDb()
    .select({ igOrigin: schema.conversation.igOrigin })
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversation.id))
    .limit(1);
  await applyInstagramReferral({
    organizationId: integration.organizationId,
    conversationId: conversation.id,
    currentOrigin: rows[0]?.igOrigin ?? null,
    referral: ev.referral,
    at: ev.at,
  });
}

/**
 * Espera antes de registrar un eco: el envío del CRM inserta su fila apenas
 * Instagram responde, y el eco suele llegar en paralelo. Esperar un poco
 * evita que la bandeja muestre por un instante «Desde Instagram» un mensaje
 * que mandó el propio CRM (si igual gana el eco, el envío lo reasigna).
 */
export const ECHO_SETTLE_MS = 1500;

/**
 * Eco de un mensaje que mandó la cuenta: si lo mandó el CRM ya existe (mismo
 * `mid`) y no se toca; si lo mandó alguien desde la app de Instagram, entra
 * como saliente `source='phone'` («Desde Instagram»). No despierta al agente
 * ni suma no leídos: el guard «lo último es del negocio» lo deja callado.
 */
async function handleEcho(
  integration: InstagramIntegration,
  ev: MessageEvent,
  settleMs: number = ECHO_SETTLE_MS
) {
  if (settleMs > 0) await new Promise((r) => setTimeout(r, settleMs));
  const db = getDb();
  const { organizationId } = integration;

  const existing = await db
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(
      scoped(schema.message.organizationId, organizationId, eq(schema.message.waMessageId, ev.mid))
    )
    .limit(1);
  if (existing[0]) return;

  const contact = await getOrCreateInstagramContact(integration, ev.customerId);
  const conversation = await getOrCreateConversation(organizationId, contact.id, "instagram");
  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId,
      conversationId: conversation.id,
      waMessageId: ev.mid,
      direction: "out",
      // 030: una plantilla (tarjeta/botones) de otra app entra como texto
      // legible con sus botones, no como una burbuja vacía.
      type: ev.template ? "text" : messageTypeFor(ev),
      text: ev.text,
      details: ev.template ? { template: ev.template } : null,
      status: "sent",
      source: "phone",
      waTimestamp: ev.at,
      // Mismo criterio que los ecos de coexistence (017): `now` para que el
      // orden del hilo no quede ANTES del entrante al que responde.
      createdAt: new Date(),
    })
    .onConflictDoNothing({
      target: [schema.message.organizationId, schema.message.waMessageId],
    })
    .returning();
  const message = inserted[0];
  if (!message) return;

  await db
    .update(schema.conversation)
    .set({
      lastMessageAt: sql`greatest(coalesce(${schema.conversation.lastMessageAt}, to_timestamp(0)), ${ev.at.toISOString()}::timestamp)`,
      updatedAt: new Date(),
    })
    .where(eq(schema.conversation.id, conversation.id));

  publish(organizationId, {
    type: "message.new",
    data: { conversationId: conversation.id, message: serializeMessage(message) },
  });
  publish(organizationId, {
    type: "conversations.updated",
    data: { conversationIds: [conversation.id] },
  });
}

/** El cliente borró un mensaje: se borra el contenido (política de Meta). */
async function handleDeleted(organizationId: string, mid: string) {
  const db = getDb();
  const updated = await db
    .update(schema.message)
    .set({ type: "deleted", text: null, mediaSummary: null, mediaState: null, error: null })
    .where(
      scoped(schema.message.organizationId, organizationId, eq(schema.message.waMessageId, mid))
    )
    .returning();
  const message = updated[0];
  if (!message) return;
  await db
    .delete(schema.messageMedia)
    .where(
      scoped(
        schema.messageMedia.organizationId,
        organizationId,
        eq(schema.messageMedia.messageId, message.id)
      )
    );
  publish(organizationId, {
    type: "message.updated",
    data: { conversationId: message.conversationId, message: serializeMessage(message) },
  });
}

async function findConversation(organizationId: string, igsid: string) {
  const rows = await getDb()
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.contact.phone, instagramContactPhone(igsid)),
        eq(schema.conversation.isTest, false)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * «Visto» del cliente: todos los salientes hasta ese mensaje pasan a
 * `read` (monotónico: `failed` y `read` no se tocan).
 */
async function handleRead(
  organizationId: string,
  ev: Extract<InstagramEvent, { kind: "read" }>
) {
  const db = getDb();
  const conversation = await findConversation(organizationId, ev.customerId);
  if (!conversation) return;

  let cutoff = ev.at;
  if (ev.mid) {
    const ref = await db
      .select({ createdAt: schema.message.createdAt })
      .from(schema.message)
      .where(
        scoped(
          schema.message.organizationId,
          organizationId,
          eq(schema.message.waMessageId, ev.mid)
        )
      )
      .limit(1);
    if (ref[0] && ref[0].createdAt > cutoff) cutoff = ref[0].createdAt;
  }

  const updated = await db
    .update(schema.message)
    .set({ status: "read" })
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.conversationId, conversation.id),
        eq(schema.message.direction, "out"),
        inArray(schema.message.status, ["pending", "sent", "delivered"]),
        lte(schema.message.createdAt, cutoff)
      )
    )
    .returning({ id: schema.message.id });
  for (const m of updated.slice(-50)) {
    publish(organizationId, {
      type: "message.status",
      data: { conversationId: conversation.id, messageId: m.id, status: "read" },
    });
  }
}

/**
 * Reacción del cliente: queda como nota en el hilo (tipo `reaction`) sin
 * sumar no leídos, sin lead y sin despertar al agente. Quitar la reacción
 * no genera nada.
 */
async function handleReaction(
  integration: InstagramIntegration,
  ev: Extract<InstagramEvent, { kind: "reaction" }>
) {
  if (ev.action !== "react") return;
  const db = getDb();
  const { organizationId } = integration;
  const conversation = await findConversation(organizationId, ev.customerId);
  if (!conversation) return;
  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId,
      conversationId: conversation.id,
      waMessageId: `reaction:${ev.mid ?? "?"}:${ev.at.getTime()}`,
      direction: "in",
      type: "reaction",
      text: ev.emoji ?? "❤️",
      status: "delivered",
      waTimestamp: ev.at,
    })
    .onConflictDoNothing({
      target: [schema.message.organizationId, schema.message.waMessageId],
    })
    .returning();
  const message = inserted[0];
  if (!message) return;
  publish(organizationId, {
    type: "message.new",
    data: { conversationId: conversation.id, message: serializeMessage(message) },
  });
}

/** Solo para tests: procesa un eco sin la espera de asentamiento. */
export async function __handleEchoForTest(
  integration: InstagramIntegration,
  ev: MessageEvent
) {
  await handleEcho(integration, ev, 0);
}
