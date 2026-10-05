import { z } from "zod";

/**
 * Webhook de Instagram (023) — parseo PURO. A diferencia del de WhatsApp
 * (que solo castea el JSON), este valida con Zod y normaliza cada evento de
 * `entry[].messaging[]` a una unión discriminada. Lo que no se reconoce se
 * descarta: el webhook nunca revienta por un campo nuevo de Meta.
 *
 * IDs (doc «Webhook Notification Examples»):
 * - `entry.id`: la cuenta profesional conectada (enruta a la empresa).
 * - Mensaje del cliente: `sender` = IGSID del cliente, `recipient` = cuenta.
 * - Eco (`is_echo`): `sender` = cuenta, `recipient` = IGSID del cliente.
 *
 * 030 suma: comentarios (`changes[]` y el formato de Business Login con
 * `field`/`value` sueltos en la entrada), `standby[]` (otra app maneja el
 * hilo), la referencia de un link `ig.me` o de un anuncio (suelta, dentro de
 * `message` o dentro de `postback`), la respuesta a una historia, el
 * `payload` de las respuestas rápidas y las plantillas que manda otra app.
 */

const idLike = z.union([z.string(), z.number()]).transform(String);
const idSchema = z.object({ id: idLike });

const attachmentSchema = z
  .object({
    type: z.string(),
    title: z.string().nullish(),
    payload: z
      .object({ url: z.string().nullish(), title: z.string().nullish() })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const referralSchema = z
  .object({
    ref: z.string().nullish(),
    source: z.string().nullish(),
    type: z.string().nullish(),
    ad_id: idLike.nullish(),
    ads_context_data: z
      .object({ ad_title: z.string().nullish(), photo_url: z.string().nullish() })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const messageSchema = z
  .object({
    mid: z.string(),
    text: z.string().optional(),
    attachments: z.array(attachmentSchema).optional(),
    is_echo: z.boolean().optional(),
    is_deleted: z.boolean().optional(),
    is_unsupported: z.boolean().optional(),
    is_self: z.boolean().optional(),
    quick_reply: z.object({ payload: z.string().optional() }).passthrough().optional(),
    reply_to: z
      .object({
        mid: z.string().optional(),
        story: z.object({ url: z.string().nullish(), id: idLike.nullish() }).passthrough().nullish(),
      })
      .passthrough()
      .nullish(),
    referral: referralSchema.nullish(),
  })
  .passthrough();

const messagingSchema = z
  .object({
    sender: idSchema,
    recipient: idSchema,
    timestamp: z.union([z.number(), z.string()]).optional(),
    message: messageSchema.optional(),
    read: z.object({ mid: z.string().optional() }).passthrough().optional(),
    reaction: z
      .object({
        mid: z.string().optional(),
        action: z.string().optional(),
        emoji: z.string().optional(),
        reaction: z.string().optional(),
      })
      .passthrough()
      .optional(),
    postback: z
      .object({
        mid: z.string().optional(),
        title: z.string().optional(),
        payload: z.string().optional(),
        referral: referralSchema.nullish(),
      })
      .passthrough()
      .optional(),
    referral: referralSchema.nullish(),
    is_self: z.boolean().optional(),
  })
  .passthrough();

const commentValueSchema = z
  .object({
    id: idLike.nullish(),
    comment_id: idLike.nullish(),
    from: z.object({ id: idLike, username: z.string().nullish() }).passthrough(),
    text: z.string().nullish(),
    parent_id: idLike.nullish(),
    media: z
      .object({ id: idLike.nullish(), media_product_type: z.string().nullish() })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const entrySchema = z
  .object({
    id: idLike,
    time: z.union([z.number(), z.string()]).optional(),
    messaging: z.array(z.unknown()).optional(),
    /** 030: eventos de un hilo que maneja OTRA app (Conversation Routing). */
    standby: z.array(z.unknown()).optional(),
    // Formato alternativo: el botón «Test» del panel (y algunas entregas)
    // mandan cada evento como `changes[{field, value}]`, con `value` = el
    // mismo objeto que iría en `messaging[]`.
    changes: z
      .array(z.object({ field: z.string().optional(), value: z.unknown() }).passthrough())
      .optional(),
    /** 030: Business Login manda los comentarios con `field`/`value` sueltos. */
    field: z.string().optional(),
    value: z.unknown().optional(),
  })
  .passthrough();

/** Campos de `changes` que traen un evento de mensajería. */
const MESSAGING_FIELDS = new Set([
  "messages",
  "messaging_seen",
  "message_reactions",
  "messaging_postbacks",
  "messaging_referral",
]);

/** 030: campos de comentarios. */
const COMMENT_FIELDS = new Set(["comments", "live_comments"]);

const payloadSchema = z
  .object({ object: z.string(), entry: z.array(entrySchema) })
  .passthrough();

export type InstagramAttachment = {
  /** image | audio | video | file | share | story_mention | ig_reel | reel | ephemeral | template… */
  type: string;
  url: string | null;
};

/** 030: de dónde llegó la persona (link `ig.me` o anuncio). */
export type InstagramReferral = {
  ref: string | null;
  /** SHORTLINKS (link) · ADS (anuncio) · otros que Meta agregue. */
  source: string | null;
  adId: string | null;
  adTitle: string | null;
};

export type InstagramEvent =
  | {
      kind: "message";
      accountId: string;
      /** IGSID del cliente (del otro lado, sea entrante o eco). */
      customerId: string;
      mid: string;
      text: string | null;
      attachments: InstagramAttachment[];
      isEcho: boolean;
      isUnsupported: boolean;
      at: Date;
      /** 030 */
      referral: InstagramReferral | null;
      storyReply: { url: string | null } | null;
      quickReplyPayload: string | null;
      /** Plantilla (tarjeta/botones) que mandó una app: su texto legible. */
      template: { title: string | null; buttons: string[] } | null;
      standby: boolean;
    }
  | { kind: "deleted"; accountId: string; customerId: string; mid: string }
  | { kind: "read"; accountId: string; customerId: string; mid: string | null; at: Date }
  | {
      kind: "reaction";
      accountId: string;
      customerId: string;
      mid: string | null;
      action: "react" | "unreact";
      emoji: string | null;
      at: Date;
    }
  | {
      kind: "postback";
      accountId: string;
      customerId: string;
      mid: string;
      text: string;
      at: Date;
      /** 030 */
      payload: string | null;
      referral: InstagramReferral | null;
      standby: boolean;
    }
  | {
      /** 030: la persona abrió el chat desde un link o un anuncio (sin mensaje). */
      kind: "referral";
      accountId: string;
      customerId: string;
      referral: InstagramReferral;
      at: Date;
    }
  | {
      /** 030: comentario en una publicación (o un vivo) de la cuenta. */
      kind: "comment";
      accountId: string;
      commentId: string;
      mediaId: string | null;
      mediaProductType: string | null;
      fromId: string;
      username: string | null;
      text: string | null;
      parentId: string | null;
      live: boolean;
      at: Date;
    };

/** Instagram manda `timestamp` en milisegundos (a veces en segundos). */
export function toInstagramDate(ts: number | string | undefined, fallback: Date): Date {
  const n = typeof ts === "string" ? Number(ts) : ts;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return fallback;
  // < 1e12 → segundos (año 2001 en ms); en la práctica Meta manda ms.
  return new Date(n < 1e12 ? n * 1000 : n);
}

/**
 * Normaliza el cuerpo del webhook. `null` si no es un payload de Instagram
 * (objeto distinto o forma inválida).
 */
export function parseInstagramWebhook(
  body: unknown,
  now: Date = new Date()
): InstagramEvent[] | null {
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success || parsed.data.object !== "instagram") return null;

  const events: InstagramEvent[] = [];
  for (const entry of parsed.data.entry) {
    const accountId = entry.id;
    const entryAt = toInstagramDate(entry.time, now);
    const raws: { raw: unknown; standby: boolean }[] = [
      ...(entry.messaging ?? []).map((raw) => ({ raw, standby: false })),
      ...(entry.standby ?? []).map((raw) => ({ raw, standby: true })),
      ...(entry.changes ?? [])
        .filter((c) => !c.field || MESSAGING_FIELDS.has(c.field))
        .map((c) => ({ raw: c.value, standby: false })),
    ];
    for (const { raw, standby } of raws) {
      const m = messagingSchema.safeParse(raw);
      if (!m.success) continue;
      const ev = normalize(accountId, m.data, now, standby);
      if (ev) events.push(ev);
    }

    const comments = [
      ...(entry.changes ?? [])
        .filter((c) => c.field && COMMENT_FIELDS.has(c.field))
        .map((c) => ({ field: c.field!, value: c.value })),
      ...(entry.field && COMMENT_FIELDS.has(entry.field) ? [{ field: entry.field, value: entry.value }] : []),
    ];
    for (const c of comments) {
      const v = commentValueSchema.safeParse(c.value);
      if (!v.success) continue;
      const commentId = v.data.id ?? v.data.comment_id;
      if (!commentId) continue;
      events.push({
        kind: "comment",
        accountId,
        commentId,
        mediaId: v.data.media?.id ?? null,
        mediaProductType: v.data.media?.media_product_type ?? null,
        fromId: v.data.from.id,
        username: v.data.from.username ?? null,
        text: v.data.text ?? null,
        parentId: v.data.parent_id ?? null,
        live: c.field === "live_comments",
        at: entryAt,
      });
    }
  }
  return events;
}

function toReferral(r: z.infer<typeof referralSchema> | null | undefined): InstagramReferral | null {
  if (!r) return null;
  const ref = r.ref?.trim() || null;
  const source = r.source?.trim().toUpperCase() || null;
  const adId = r.ad_id ?? null;
  if (!ref && !adId && source !== "ADS") return null;
  return {
    ref,
    source,
    adId,
    adTitle: r.ads_context_data?.ad_title?.trim() || null,
  };
}

/**
 * Texto legible de una plantilla que mandó una app (ManyChat, el propio
 * CRM): sin esto el eco era una burbuja vacía en la Bandeja.
 */
export function templateSummary(
  attachments: readonly z.infer<typeof attachmentSchema>[]
): { title: string | null; buttons: string[] } | null {
  const t = attachments.find((a) => a.type.toLowerCase() === "template");
  if (!t) return null;
  const p = (t.payload ?? {}) as Record<string, unknown>;
  const generic = (p.generic ?? null) as { elements?: unknown } | null;
  const elements = (Array.isArray(p.elements) ? p.elements : Array.isArray(generic?.elements) ? generic.elements : []) as {
    title?: unknown;
    subtitle?: unknown;
    buttons?: unknown;
  }[];
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const buttonTitles = (list: unknown) =>
    (Array.isArray(list) ? list : [])
      .map((b) => str((b as { title?: unknown })?.title))
      .filter((s): s is string => s !== null);
  const first = elements[0];
  const title =
    str(p.text) ??
    (first ? [str(first.title), str(first.subtitle)].filter(Boolean).join(" — ") || null : null) ??
    str(t.title);
  const buttons = [...buttonTitles(p.buttons), ...elements.flatMap((e) => buttonTitles(e.buttons))];
  return { title, buttons: [...new Set(buttons)].slice(0, 10) };
}

function normalize(
  accountId: string,
  m: z.infer<typeof messagingSchema>,
  now: Date,
  standby: boolean
): InstagramEvent | null {
  const at = toInstagramDate(m.timestamp, now);
  const senderId = m.sender.id;
  const recipientId = m.recipient.id;
  // El negocio escribiéndose a sí mismo (prueba de Meta): nada que atender.
  if (m.is_self || m.message?.is_self || senderId === recipientId) return null;

  if (m.message) {
    const msg = m.message;
    const isEcho = msg.is_echo === true || senderId === accountId;
    const customerId = isEcho ? recipientId : senderId;
    if (msg.is_deleted) {
      return { kind: "deleted", accountId, customerId, mid: msg.mid };
    }
    const attachments: InstagramAttachment[] = (msg.attachments ?? []).map((a) => ({
      type: a.type.toLowerCase(),
      url: typeof a.payload?.url === "string" && a.payload.url ? a.payload.url : null,
    }));
    const quick = msg.quick_reply?.payload;
    const template = templateSummary(msg.attachments ?? []);
    const text = msg.text?.trim()
      ? msg.text
      : template?.title
        ? template.title
        : quick?.trim()
          ? quick
          : null;
    const story = msg.reply_to?.story;
    return {
      kind: "message",
      accountId,
      customerId,
      mid: msg.mid,
      text,
      attachments: template ? attachments.filter((a) => a.type !== "template") : attachments,
      isEcho,
      isUnsupported: msg.is_unsupported === true,
      at,
      referral: toReferral(msg.referral ?? m.referral),
      storyReply: story ? { url: story.url?.trim() || null } : null,
      quickReplyPayload: quick?.trim() || null,
      template,
      standby,
    };
  }

  // Los eventos que no son mensaje siempre vienen del lado del cliente.
  const customerId = senderId === accountId ? recipientId : senderId;

  if (m.read) {
    return { kind: "read", accountId, customerId, mid: m.read.mid ?? null, at };
  }
  if (m.reaction) {
    return {
      kind: "reaction",
      accountId,
      customerId,
      mid: m.reaction.mid ?? null,
      action: m.reaction.action === "unreact" ? "unreact" : "react",
      emoji: m.reaction.emoji ?? null,
      at,
    };
  }
  if (m.postback) {
    const text = m.postback.title?.trim() || m.postback.payload?.trim();
    if (!text) return null;
    // Una pregunta frecuente (ice breaker) puede llegar sin `mid`: se arma
    // uno estable para que la ingesta siga siendo idempotente.
    const mid = m.postback.mid ?? `postback:${customerId}:${at.getTime()}`;
    return {
      kind: "postback",
      accountId,
      customerId,
      mid,
      text,
      at,
      payload: m.postback.payload?.trim() || null,
      referral: toReferral(m.postback.referral ?? m.referral),
      standby,
    };
  }
  const referral = toReferral(m.referral);
  if (referral) {
    return { kind: "referral", accountId, customerId, referral, at };
  }
  return null;
}

/**
 * Tipo de mensaje del CRM para un evento de Instagram. Imagen y audio van
 * por el pipeline de adjuntos de 020; el resto se guarda con su tipo y se
 * muestra como adjunto.
 */
export function messageTypeFor(ev: {
  text: string | null;
  attachments: InstagramAttachment[];
  isUnsupported: boolean;
  storyReply?: { url: string | null } | null;
}): string {
  // 030: respuesta a una historia — la historia se baja y se describe.
  if (ev.storyReply) return "story";
  const first = ev.attachments[0];
  if (!first) return ev.isUnsupported ? "unsupported" : "text";
  switch (first.type) {
    case "image":
    case "audio":
    case "video":
      return first.type;
    case "file":
      return "document";
    case "ephemeral":
      return "unsupported";
    case "story_mention":
    case "ig_story":
    case "story":
      return "story";
    default:
      // share, ig_post, ig_reel, reel, media…: una publicación compartida.
      return "share";
  }
}

/** 030: URL de la historia (respuesta o mención), si vino. */
export function storyUrlFor(ev: {
  attachments: InstagramAttachment[];
  storyReply?: { url: string | null } | null;
}): string | null {
  if (ev.storyReply?.url) return ev.storyReply.url;
  const mention = ev.attachments.find((a) => a.type === "story_mention" || a.type === "story");
  return mention?.url ?? null;
}
