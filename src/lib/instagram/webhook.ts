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
 */

const idSchema = z.object({ id: z.union([z.string(), z.number()]).transform(String) });

const attachmentSchema = z
  .object({
    type: z.string(),
    payload: z
      .object({ url: z.string().optional(), title: z.string().optional() })
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
    reply_to: z.unknown().optional(),
    referral: z.unknown().optional(),
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
      })
      .passthrough()
      .optional(),
    is_self: z.boolean().optional(),
  })
  .passthrough();

const entrySchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    time: z.union([z.number(), z.string()]).optional(),
    messaging: z.array(z.unknown()).optional(),
    // Formato alternativo: el botón «Test» del panel (y algunas entregas)
    // mandan cada evento como `changes[{field, value}]`, con `value` = el
    // mismo objeto que iría en `messaging[]`.
    changes: z
      .array(z.object({ field: z.string().optional(), value: z.unknown() }).passthrough())
      .optional(),
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

const payloadSchema = z
  .object({ object: z.string(), entry: z.array(entrySchema) })
  .passthrough();

export type InstagramAttachment = {
  /** image | audio | video | file | share | story_mention | ig_reel | reel | ephemeral… */
  type: string;
  url: string | null;
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
    const raws = [
      ...(entry.messaging ?? []),
      ...(entry.changes ?? [])
        .filter((c) => !c.field || MESSAGING_FIELDS.has(c.field))
        .map((c) => c.value),
    ];
    for (const raw of raws) {
      const m = messagingSchema.safeParse(raw);
      if (!m.success) continue;
      const ev = normalize(accountId, m.data, now);
      if (ev) events.push(ev);
    }
  }
  return events;
}

function normalize(
  accountId: string,
  m: z.infer<typeof messagingSchema>,
  now: Date
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
    const text = msg.text?.trim() ? msg.text : quick?.trim() ? quick : null;
    return {
      kind: "message",
      accountId,
      customerId,
      mid: msg.mid,
      text,
      attachments,
      isEcho,
      isUnsupported: msg.is_unsupported === true,
      at,
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
  if (m.postback?.mid) {
    const text = m.postback.title?.trim() || m.postback.payload?.trim();
    if (!text) return null;
    return {
      kind: "postback",
      accountId,
      customerId,
      mid: m.postback.mid,
      text,
      at,
    };
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
}): string {
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
