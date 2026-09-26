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

  if (path.length === 2 && path[1] === "messages") {
    const body = (await req.json().catch(() => null)) as {
      recipient?: { id?: string };
      message?: { text?: string };
      tag?: string;
    } | null;
    const recipientId = body?.recipient?.id;
    const text = body?.message?.text ?? "";
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
  return err(404, 100, `ruta no simulada: ${path.join("/")}`);
}
