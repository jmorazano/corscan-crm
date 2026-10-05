import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { getEnv } from "@/lib/env";
import {
  deliverToInstagramWebhook,
  instagramPayload,
} from "@/server/dev/ig-mock-webhook";
import { getIgMockState, nextIgN } from "@/server/dev/ig-mock-state";

export const dynamic = "force-dynamic";

const schema = z.object({
  /** IGSID del cliente simulado. */
  from: z.string().min(3),
  /** Perfil que devolverá el User Profile API para ese IGSID. */
  name: z.string().optional(),
  username: z.string().optional(),
  kind: z
    .enum(["message", "echo", "deleted", "read", "reaction", "postback", "comment", "referral"])
    .default("message"),
  text: z.string().optional(),
  /** Adjunto: `image`/`audio` bajan de la CDN simulada; el resto solo se etiqueta. */
  attachment: z.string().optional(),
  /** Id del adjunto en la CDN simulada (`…empty…` = ilegible, `…gone…` = 404). */
  mediaId: z.string().optional(),
  /** Para `deleted`/`read`/`reaction`: el mensaje referido. */
  mid: z.string().optional(),
  emoji: z.string().optional(),
  /** Otra cuenta (no conectada) para el camino infeliz. */
  accountId: z.string().optional(),
  badSignature: z.boolean().optional(),
  // ---- 030 ----
  /** Llega en `standby[]` (otra app maneja el hilo). */
  standby: z.boolean().optional(),
  /** Referencia de un link ig.me (`ref`) o de un anuncio (`adId`/`adTitle`). */
  ref: z.string().optional(),
  adId: z.string().optional(),
  adTitle: z.string().optional(),
  /** Respuesta a una historia: id de la imagen en la CDN simulada. */
  storyMediaId: z.string().optional(),
  /** Respuesta rápida tocada / payload de un postback. */
  payload: z.string().optional(),
  /** Comentario: publicación, id (opcional), respuesta a otro, vivo. */
  mediaId2: z.string().optional(),
  commentId: z.string().optional(),
  parentId: z.string().optional(),
  live: z.boolean().optional(),
  /** El comentario SOLO queda para la consulta periódica (sin webhook). */
  pollOnly: z.boolean().optional(),
  /** Formato del webhook de comentarios: `changes[]` (default) o `field`/`value`. */
  commentFormat: z.enum(["changes", "field"]).optional(),
  /** Antigüedad del comentario en minutos (para el camino de 7 días). */
  minutesAgo: z.number().optional(),
  /** Eco de una plantilla de OTRA app (ManyChat): texto y botón. */
  templateText: z.string().optional(),
  templateButton: z.string().optional(),
});

/**
 * Inyecta un evento de Instagram al webhook del CRM, firmado como Meta
 * (023). Devuelve el `mid` usado para poder referirlo después.
 */
export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }
  const b = parsed.data;
  const s = getIgMockState();
  if (b.name || b.username) {
    s.profiles.set(b.from, { name: b.name ?? null, username: b.username ?? null });
  }
  const account = b.accountId ?? s.account.igUserId;
  const now = Date.now();
  const mid = b.mid ?? `mock.ig.in.${nextIgN()}`;
  const customer = { id: b.from };
  const business = { id: account };

  // 030: comentario en una publicación (webhook y/o consulta periódica).
  if (b.kind === "comment") {
    const mediaId = b.mediaId2 ?? s.media[0]?.id ?? "17900000000000101";
    const commentId = b.commentId ?? `1800000${nextIgN().replace(/\D/g, "")}`;
    const at = new Date(now - (b.minutesAgo ?? 0) * 60_000);
    const username = b.username ?? `user.${b.from}`;
    if (!s.comments.some((c) => c.id === commentId)) {
      s.comments.push({
        id: commentId,
        mediaId,
        fromId: b.from,
        username,
        text: b.text ?? "",
        timestamp: at.toISOString().replace(/\.\d{3}Z$/, "+0000"),
        parentId: b.parentId ?? null,
        // El IGSID de mensajería es otro número (como en Instagram real).
        igsid: `9${b.from}`,
        privateReplied: false,
      });
    }
    if (b.name || b.username) s.profiles.set(`9${b.from}`, { name: b.name ?? null, username });
    if (b.pollOnly) return Response.json({ delivered: false, pollOnly: true, commentId });
    const value = b.live
      ? { from: { id: b.from, username }, comment_id: commentId, text: b.text ?? "", media: { id: mediaId, media_product_type: "LIVE" } }
      : { id: commentId, from: { id: b.from, username }, text: b.text ?? "", ...(b.parentId ? { parent_id: b.parentId } : {}), media: { id: mediaId, media_product_type: "FEED" } };
    const field = b.live ? "live_comments" : "comments";
    const payload = {
      object: "instagram",
      entry: [
        b.commentFormat === "field"
          ? { id: account, time: Math.floor(now / 1000), field, value }
          : { id: account, time: Math.floor(now / 1000), changes: [{ field, value }] },
      ],
    };
    const res = await deliverToInstagramWebhook(payload, { badSignature: b.badSignature });
    return Response.json({ delivered: res.ok, status: res.status, commentId }, { status: res.ok ? 200 : 502 });
  }

  const referral = b.ref
    ? { ref: b.ref, source: "SHORTLINKS", type: "OPEN_THREAD" }
    : b.adId
      ? { ref: null, ad_id: b.adId, source: "ADS", type: "OPEN_THREAD", ads_context_data: { ad_title: b.adTitle ?? "Anuncio" } }
      : null;

  let messaging: Record<string, unknown>;
  switch (b.kind) {
    case "referral":
      messaging = { sender: customer, recipient: business, timestamp: now, referral };
      break;
    case "echo":
      messaging = {
        sender: business,
        recipient: customer,
        timestamp: now,
        message: b.templateText
          ? {
              mid,
              is_echo: true,
              attachments: [
                {
                  type: "template",
                  payload: {
                    template_type: "button",
                    text: b.templateText,
                    buttons: [{ type: "postback", title: b.templateButton ?? "Ver", payload: "X" }],
                  },
                },
              ],
            }
          : { mid, text: b.text ?? "", is_echo: true },
      };
      break;
    case "deleted":
      messaging = {
        sender: customer,
        recipient: business,
        timestamp: now,
        message: { mid, is_deleted: true },
      };
      break;
    case "read":
      messaging = { sender: customer, recipient: business, timestamp: now, read: { mid } };
      break;
    case "reaction":
      messaging = {
        sender: customer,
        recipient: business,
        timestamp: now,
        reaction: { mid, action: "react", reaction: "love", emoji: b.emoji ?? "❤️" },
      };
      break;
    case "postback":
      messaging = {
        sender: customer,
        recipient: business,
        timestamp: now,
        postback: { mid, title: b.text ?? "Opción", payload: b.payload ?? "MOCK", ...(referral ? { referral } : {}) },
      };
      break;
    default: {
      const base = getEnv().APP_BASE_URL.replace(/\/$/, "");
      const attachments = b.attachment
        ? [
            {
              type: b.attachment,
              payload: {
                url: `${base}/api/dev/ig-mock/media/${b.mediaId ?? `mediamock_${b.attachment}_${nextIgN()}`}`,
              },
            },
          ]
        : undefined;
      const storyUrl = b.storyMediaId ? `${base}/api/dev/ig-mock/media/${b.storyMediaId}` : null;
      messaging = {
        sender: customer,
        recipient: business,
        timestamp: now,
        message: {
          mid,
          ...(b.text ? { text: b.text } : {}),
          ...(attachments ? { attachments } : {}),
          ...(referral ? { referral } : {}),
          ...(storyUrl ? { reply_to: { story: { url: storyUrl, id: `story_${nextIgN()}` } } } : {}),
          ...(b.payload ? { quick_reply: { payload: b.payload } } : {}),
        },
      };
    }
  }

  const payload = b.standby
    ? { object: "instagram", entry: [{ id: account, time: now, standby: [messaging] }] }
    : instagramPayload(account, messaging);
  const res = await deliverToInstagramWebhook(payload, {
    badSignature: b.badSignature,
  });
  return Response.json({ delivered: res.ok, status: res.status, mid }, { status: res.ok ? 200 : 502 });
}
