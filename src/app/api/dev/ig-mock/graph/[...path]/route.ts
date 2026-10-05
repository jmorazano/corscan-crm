import { mockGuard } from "@/lib/dev-guard";
import { getEnv } from "@/lib/env";
import {
  deliverToInstagramWebhook,
  instagramPayload,
} from "@/server/dev/ig-mock-webhook";
import { getIgMockState, nextIgN } from "@/server/dev/ig-mock-state";

/**
 * graph.instagram.com simulado (023): canje/renovación de tokens, `/me`,
 * suscripción de webhooks, perfil del cliente y envío de mensajes. Exige el
 * token largo del mock en todo lo autenticado — si el CRM mandara el token
 * corto o nada, el self-test lo detecta.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ path: string[] }> };

function err(status: number, code: number, message: string, subcode?: number) {
  return Response.json(
    { error: { message, type: "OAuthException", code, error_subcode: subcode } },
    { status }
  );
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

function authorized(req: Request): boolean {
  return (bearer(req) ?? "").startsWith("mock-ig-long-");
}

/** Formato de Meta: ISO con `+0000`. */
function metaTime(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "+0000");
}

function lastAt(c: { messages: { at: Date }[] }): Date {
  return new Date(Math.max(...c.messages.map((m) => m.at.getTime())));
}

/** Quita la versión (`v25.0`) del path. */
function route(path: string[]): string[] {
  return path[0] && /^v\d+(\.\d+)?$/.test(path[0]) ? path.slice(1) : path;
}

export async function GET(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const url = new URL(req.url);
  const path = route((await ctx.params).path);
  const s = getIgMockState();

  if (path[0] === "access_token") {
    if (url.searchParams.get("grant_type") !== "ig_exchange_token") {
      return err(400, 100, "grant_type inválido");
    }
    if (url.searchParams.get("client_secret") !== getEnv().INSTAGRAM_APP_SECRET) {
      return err(400, 101, "Error validating client secret");
    }
    if (!url.searchParams.get("access_token")?.startsWith("mock-ig-short-")) {
      return err(400, 190, "Invalid OAuth access token");
    }
    return Response.json({
      access_token: `mock-ig-long-${nextIgN()}`,
      token_type: "bearer",
      expires_in: 5_184_000,
    });
  }

  if (path[0] === "refresh_access_token") {
    if (s.refreshFails) {
      s.refreshFails = false;
      return err(400, 190, "Error validating access token: session has been invalidated");
    }
    if (!url.searchParams.get("access_token")?.startsWith("mock-ig-long-")) {
      return err(400, 190, "Invalid OAuth access token");
    }
    return Response.json({
      access_token: `mock-ig-long-${nextIgN()}`,
      token_type: "bearer",
      expires_in: 5_184_000,
    });
  }

  if (!authorized(req)) return err(401, 190, "Invalid OAuth access token");

  // 030: publicaciones, comentarios y perfil de mensajería.
  if (path[0] === "me" && path[1] === "media") {
    const limit = Number(url.searchParams.get("limit") ?? 25);
    return Response.json({
      data: s.media.slice(0, limit).map((m) => ({
        ...m,
        media_url: `${getEnv().APP_BASE_URL.replace(/\/$/, "")}/api/dev/ig-mock/media/mediamock_image_${m.id}`,
        ...(m.media_type === "VIDEO" ? { thumbnail_url: `${getEnv().APP_BASE_URL.replace(/\/$/, "")}/api/dev/ig-mock/media/mediamock_image_thumb_${m.id}` } : {}),
      })),
    });
  }
  if ((path[0] === "me" || path[0] === s.account.igUserId) && path[1] === "messenger_profile") {
    return Response.json({ data: [s.messengerProfile] });
  }
  const mediaHit = s.media.find((m) => m.id === path[0]);
  if (mediaHit && path[1] === "comments") {
    if (s.commentsReadFails) {
      s.commentsReadFails = false;
      return err(500, 2, "An unexpected error has occurred. Please retry your request later.");
    }
    return Response.json({
      data: s.comments
        .filter((c) => c.mediaId === mediaHit.id && !c.parentId)
        .map((c) => ({
          id: c.id,
          text: c.text,
          timestamp: c.timestamp,
          username: c.username,
          from: { id: c.fromId, username: c.username },
        })),
    });
  }
  if (mediaHit && path.length === 1) {
    return Response.json(mediaHit);
  }

  if (path[0] === "me" && path.length === 1) {
    return Response.json({
      id: `app-scoped-${s.account.igUserId}`,
      user_id: s.account.igUserId,
      username: s.account.username,
      name: s.account.name,
      account_type: "BUSINESS",
      profile_picture_url: null,
    });
  }

  // 023: Conversations API (historial).
  if (path[0] === "me" && path[1] === "conversations") {
    if (s.historyFails) {
      s.historyFails = false;
      return err(500, 2, "An unexpected error has occurred. Please retry your request later.");
    }
    const limit = Number(url.searchParams.get("limit") ?? 25);
    const start = Number(url.searchParams.get("after") ?? 0);
    const ordered = [...s.history].sort(
      (a, b) => lastAt(b).getTime() - lastAt(a).getTime()
    );
    const page = ordered.slice(start, start + limit);
    const hasMore = start + limit < ordered.length;
    return Response.json({
      data: page.map((c) => ({
        id: c.id,
        updated_time: metaTime(lastAt(c)),
        participants: {
          data: [
            { id: s.account.igUserId, username: s.account.username },
            { id: c.customer.igsid, username: c.customer.username },
          ],
        },
      })),
      paging: {
        cursors: { after: String(start + limit) },
        ...(hasMore ? { next: "https://graph.instagram.com/next" } : {}),
      },
    });
  }
  const conv = s.history.find((c) => c.id === path[0]);
  if (conv && path.length === 1) {
    // Meta: solo los 20 más recientes, del más nuevo al más viejo.
    const latest = [...conv.messages].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 20);
    return Response.json({
      id: conv.id,
      messages: {
        data: latest.map((m) => ({
          id: m.id,
          created_time: metaTime(m.at),
          from: m.fromCustomer
            ? { id: conv.customer.igsid, username: conv.customer.username }
            : { id: s.account.igUserId, username: s.account.username },
          message: m.text,
        })),
      },
    });
  }

  // Perfil de un cliente (User Profile API).
  if (path.length === 1 && path[0]) {
    if (s.profileFails) {
      s.profileFails = false;
      return err(400, 230, "User consent is required to access user profile");
    }
    const fromHistory = s.history.find((c) => c.customer.igsid === path[0])?.customer;
    const p =
      s.profiles.get(path[0]) ??
      (fromHistory ? { name: fromHistory.name, username: fromHistory.username } : undefined);
    return Response.json({
      name: p?.name ?? null,
      username: p?.username ?? null,
      profile_pic: null,
    });
  }
  return err(404, 100, `ruta no simulada: ${path.join("/")}`);
}

export async function POST(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const url = new URL(req.url);
  const path = route((await ctx.params).path);
  const s = getIgMockState();
  if (!authorized(req)) return err(401, 190, "Invalid OAuth access token");

  if (path[0] === "me" && path[1] === "subscribed_apps") {
    if (s.subscribeFails) {
      s.subscribeFails = false;
      return err(400, 100, "Application does not have the capability to make this API call.");
    }
    s.subscriptions.push({
      fields: url.searchParams.get("subscribed_fields") ?? "",
      at: new Date().toISOString(),
    });
    return Response.json({ success: true });
  }

  // 030: perfil de mensajería (ice breakers y menú fijo).
  if (path[1] === "messenger_profile") {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (s.profileSaveFails) {
      s.profileSaveFails = false;
      return err(400, 100, "(#100) Invalid parameter");
    }
    if (body?.platform !== "instagram") return err(400, 100, "platform=instagram requerido");
    if (Array.isArray(body.ice_breakers)) s.messengerProfile.ice_breakers = body.ice_breakers;
    if (Array.isArray(body.persistent_menu)) s.messengerProfile.persistent_menu = body.persistent_menu;
    return Response.json({ result: "success" });
  }

  // 030: respuesta pública a un comentario.
  const replyTarget = s.comments.find((c) => c.id === path[0]);
  if (replyTarget && path[1] === "replies") {
    const body = (await req.json().catch(() => null)) as { message?: string } | null;
    if (!body?.message) return err(400, 100, "Falta message");
    const id = `mock.reply.${nextIgN()}`;
    s.publicReplies.push({ commentId: replyTarget.id, text: body.message, id, at: new Date().toISOString() });
    return Response.json({ id });
  }
  // 030: ocultar / mostrar un comentario.
  if (replyTarget && path.length === 1 && url.searchParams.has("hide")) {
    const hide = url.searchParams.get("hide") === "true";
    s.hiddenComments = s.hiddenComments.filter((id) => id !== replyTarget.id);
    if (hide) s.hiddenComments.push(replyTarget.id);
    return Response.json({ success: true });
  }

  if (path.length === 2 && path[1] === "messages") {
    const body = (await req.json().catch(() => null)) as {
      recipient?: { id?: string; comment_id?: string };
      message?: {
        text?: string;
        quick_replies?: unknown[];
        attachment?: { type?: string; payload?: Record<string, unknown> & { url?: string } };
      };
      tag?: string;
    } | null;
    // 030: respuesta privada a un comentario.
    if (body?.recipient?.comment_id) {
      return mockPrivateReply(path[0]!, body.recipient.comment_id, body.message ?? {});
    }
    // 030: plantillas (botones / carrusel).
    if (body?.recipient?.id && body.message?.attachment?.type === "template") {
      if (s.rejectTemplates) {
        s.rejectTemplates = false;
        return err(400, 100, "(#100) Template is not supported");
      }
      const mid = `mock.ig.out.${nextIgN()}`;
      s.outbox.push({
        mid,
        igUserId: path[0]!,
        recipientId: body.recipient.id,
        text: String(body.message.attachment.payload?.text ?? ""),
        humanAgent: body.tag === "HUMAN_AGENT",
        raw: body.message,
        at: new Date().toISOString(),
      });
      if (s.echoSends) {
        const igUserId = path[0]!;
        const recipient = body.recipient.id;
        const attachment = body.message.attachment;
        setTimeout(() => {
          void deliverToInstagramWebhook(
            instagramPayload(igUserId, {
              sender: { id: igUserId },
              recipient: { id: recipient },
              timestamp: Date.now(),
              message: { mid, is_echo: true, attachments: [attachment] },
            })
          ).catch(() => {});
        }, 50);
      }
      return Response.json({ recipient_id: body.recipient.id, message_id: mid });
    }
    const recipientId = body?.recipient?.id;
    const text = body?.message?.text ?? "";
    // 026: adjunto por URL — Instagram BAJA el archivo antes de responder.
    const attachment = body?.message?.attachment;
    if (recipientId && attachment) {
      return mockAttachmentSend(path[0]!, recipientId, attachment, body?.tag === "HUMAN_AGENT");
    }
    if (!recipientId || !text) return err(400, 100, "Falta recipient o message.text");
    if (Buffer.byteLength(text, "utf8") > 1000) {
      return err(400, 100, "Message text exceeds the 1000 byte limit");
    }
    if (s.failNextSend) {
      const kind = s.failNextSend;
      s.failNextSend = null;
      if (kind === "auth") return err(401, 190, "Error validating access token");
      if (kind === "down") return err(503, 2, "Service temporarily unavailable");
      return err(400, 10, "This message is sent outside of allowed window.", 2018278);
    }
    const mid = `mock.ig.out.${nextIgN()}`;
    const igUserId = path[0]!;
    s.outbox.push({
      mid,
      igUserId,
      recipientId,
      text,
      humanAgent: body?.tag === "HUMAN_AGENT",
      ...(body?.message?.quick_replies ? { raw: body.message } : {}),
      at: new Date().toISOString(),
    });
    // Como Instagram real: el eco de lo que mandó la cuenta llega al webhook.
    if (s.echoSends) {
      setTimeout(() => {
        void deliverToInstagramWebhook(
          instagramPayload(igUserId, {
            sender: { id: igUserId },
            recipient: { id: recipientId },
            timestamp: Date.now(),
            message: { mid, text, is_echo: true },
          })
        ).catch(() => {});
      }, 50);
    }
    return Response.json({ recipient_id: recipientId, message_id: mid });
  }
  return err(404, 100, `ruta no simulada: ${path.join("/")}`);
}

export async function DELETE(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const path = route((await ctx.params).path);
  if (!authorized(req)) return err(401, 190, "Invalid OAuth access token");
  if (path[0] === "me" && path[1] === "subscribed_apps") {
    return Response.json({ success: true });
  }
  if (path[1] === "messenger_profile") {
    const body = (await req.json().catch(() => null)) as { fields?: string[] } | null;
    const s = getIgMockState();
    for (const f of body?.fields ?? []) delete s.messengerProfile[f];
    return Response.json({ result: "success" });
  }
  return err(404, 100, `ruta no simulada: ${path.join("/")}`);
}

/**
 * 026: envío de un adjunto. Como Instagram real: no admite texto en el mismo
 * mensaje, baja la URL (si no puede, el envío falla) y manda el eco con el
 * adjunto. Lo bajado queda en el outbox para que el guion lo verifique.
 */
async function mockAttachmentSend(
  igUserId: string,
  recipientId: string,
  attachment: { type?: string; payload?: { url?: string } },
  humanAgent: boolean
): Promise<Response> {
  const s = getIgMockState();
  const type = attachment.type ?? "";
  const url = attachment.payload?.url ?? "";
  if (!["image", "video", "audio", "file"].includes(type) || !url) {
    return err(400, 100, "Invalid attachment type or missing payload.url");
  }
  if (s.failNextSend) {
    const kind = s.failNextSend;
    s.failNextSend = null;
    if (kind === "auth") return err(401, 190, "Error validating access token");
    if (kind === "down") return err(503, 2, "Service temporarily unavailable");
    return err(400, 10, "This message is sent outside of allowed window.", 2018278);
  }
  let fetchedStatus = 0;
  let contentType: string | null = null;
  let bytes = new Uint8Array();
  try {
    const res = await fetch(url, { headers: { "User-Agent": "facebookexternalua" } });
    fetchedStatus = res.status;
    contentType = res.headers.get("content-type");
    if (res.ok) bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    fetchedStatus = 0;
  }
  if (fetchedStatus !== 200 || bytes.byteLength === 0) {
    return err(400, 100, `(#100) Upload attachment failure: could not fetch the URL (status ${fetchedStatus})`);
  }
  const mid = `mock.ig.out.${nextIgN()}`;
  s.outbox.push({
    mid,
    igUserId,
    recipientId,
    text: "",
    humanAgent,
    attachment: {
      type,
      url,
      fetchedStatus,
      contentType,
      size: bytes.byteLength,
      head: Buffer.from(bytes.subarray(0, 8)).toString("hex"),
    },
    at: new Date().toISOString(),
  });
  if (s.echoSends) {
    setTimeout(() => {
      void deliverToInstagramWebhook(
        instagramPayload(igUserId, {
          sender: { id: igUserId },
          recipient: { id: recipientId },
          timestamp: Date.now(),
          message: {
            mid,
            is_echo: true,
            attachments: [{ type, payload: { url: `https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=${mid}` } }],
          },
        })
      ).catch(() => {});
    }, 50);
  }
  return Response.json({ recipient_id: recipientId, message_id: mid });
}


/**
 * 030: respuesta privada como Instagram: una sola por comentario, el
 * comentario tiene que existir, devuelve el IGSID de mensajería y manda el
 * eco al webhook.
 */
function mockPrivateReply(
  igUserId: string,
  commentId: string,
  message: { text?: string; quick_replies?: unknown[] }
): Response {
  const s = getIgMockState();
  if (s.failNextPrivateReply) {
    const kind = s.failNextPrivateReply;
    s.failNextPrivateReply = null;
    if (kind === "down") return err(503, 2, "Service temporarily unavailable");
    if (kind === "routing") return err(400, 10, "Message failed to send because another app is controlling this thread now.", 2018300);
    if (kind === "invalid") return err(400, 100, "The comment is invalid for a private reply", 2534025);
    return err(400, 100, "(#100) Invalid parameter");
  }
  const comment = s.comments.find((c) => c.id === commentId);
  if (!comment) return err(400, 100, "The comment is invalid for a private reply", 2534025);
  if (comment.privateReplied) return err(400, 100, "The comment is invalid for a private reply", 2534025);
  if (message.quick_replies && s.rejectQuickRepliesInPrivateReply) {
    return err(400, 100, "(#100) quick_replies is not supported for private replies");
  }
  if (!message.text) return err(400, 100, "Falta message.text");
  comment.privateReplied = true;
  const mid = `mock.ig.out.${nextIgN()}`;
  s.outbox.push({
    mid,
    igUserId,
    recipientId: comment.igsid,
    commentId,
    text: message.text,
    humanAgent: false,
    ...(message.quick_replies ? { raw: message } : {}),
    at: new Date().toISOString(),
  });
  if (s.echoSends) {
    setTimeout(() => {
      void deliverToInstagramWebhook(
        instagramPayload(igUserId, {
          sender: { id: igUserId },
          recipient: { id: comment.igsid },
          timestamp: Date.now(),
          message: { mid, text: message.text, is_echo: true },
        })
      ).catch(() => {});
    }, 50);
  }
  return Response.json({ recipient_id: comment.igsid, message_id: mid });
}
