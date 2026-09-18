import webpush from "web-push";
import { isGoneStatus, type PushPayload } from "./payload";
import type { VapidKeys } from "./keys";

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

export type PushRequest = {
  method: string;
  headers: Record<string, string>;
  body: Uint8Array | null;
};

/** Transporte HTTP inyectable: `fetch` en producción, falso en tests. */
export type PushTransport = (
  endpoint: string,
  request: PushRequest
) => Promise<{ status: number }>;

export type SendResult = {
  endpoint: string;
  ok: boolean;
  status: number | null;
  /** 404/410: la suscripción murió; hay que podarla (FR-008). */
  gone: boolean;
  error?: string;
};

const REQUEST_TIMEOUT_MS = 10_000;

export const fetchTransport: PushTransport = async (endpoint, request) => {
  const res = await fetch(endpoint, {
    method: request.method,
    headers: request.headers,
    // Uint8Array es un BodyInit válido; el tipado de @types/node lo pelea.
    body: request.body ? (request.body as unknown as BodyInit) : null,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { status: res.status };
};

/**
 * Envía un payload a N dispositivos (013). `web-push` firma VAPID y cifra
 * (aes128gcm); el POST lo hace el transporte propio: permite el push-mock
 * local (http) y un timeout duro. Nunca lanza: cada resultado dice qué pasó.
 */
export async function sendPush(
  targets: PushTarget[],
  keys: VapidKeys,
  subject: string,
  payload: PushPayload,
  opts: { transport?: PushTransport; ttlSeconds?: number } = {}
): Promise<SendResult[]> {
  const transport = opts.transport ?? fetchTransport;
  const body = JSON.stringify(payload);
  return Promise.all(
    targets.map(async (t): Promise<SendResult> => {
      try {
        const details = webpush.generateRequestDetails(
          { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
          body,
          {
            vapidDetails: {
              subject,
              publicKey: keys.publicKey,
              privateKey: keys.privateKey,
            },
            TTL: opts.ttlSeconds ?? 3600,
            urgency: "high",
            contentEncoding: "aes128gcm",
          }
        );
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(details.headers)) {
          // fetch calcula Content-Length solo; fijarlo a mano es rechazado.
          if (k.toLowerCase() === "content-length") continue;
          headers[k] = String(v);
        }
        const raw = details.body;
        const bytes =
          raw == null
            ? null
            : typeof raw === "string"
              ? new TextEncoder().encode(raw)
              : new Uint8Array(raw);
        const res = await transport(details.endpoint, {
          method: details.method,
          headers,
          body: bytes,
        });
        return {
          endpoint: t.endpoint,
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          gone: isGoneStatus(res.status),
        };
      } catch (err) {
        return {
          endpoint: t.endpoint,
          ok: false,
          status: null,
          gone: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );
}
