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
    .enum(["message", "echo", "deleted", "read", "reaction", "postback"])
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

  let messaging: Record<string, unknown>;
  switch (b.kind) {
    case "echo":
      messaging = {
        sender: business,
        recipient: customer,
        timestamp: now,
        message: { mid, text: b.text ?? "", is_echo: true },
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
        postback: { mid, title: b.text ?? "Opción", payload: "MOCK" },
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
      messaging = {
        sender: customer,
        recipient: business,
        timestamp: now,
        message: { mid, ...(b.text ? { text: b.text } : {}), ...(attachments ? { attachments } : {}) },
      };
    }
  }

  const res = await deliverToInstagramWebhook(instagramPayload(account, messaging), {
    badSignature: b.badSignature,
  });
  return Response.json({ delivered: res.ok, status: res.status, mid }, { status: res.ok ? 200 : 502 });
}
