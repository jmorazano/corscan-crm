import { generateKeyPairSync } from "node:crypto";
import webpush from "web-push";
import { describe, expect, it } from "vitest";
import { sendPush, type PushRequest, type PushTarget } from "@/server/push/notify";
import type { PushPayload } from "@/server/push/payload";

/**
 * 013 — envío de push con transporte falso. Lo que se protege:
 * (1) el request va firmado (VAPID) y cifrado (aes128gcm) al endpoint;
 * (2) 404/410 se marcan `gone` (la poda la hace el llamador) y un fallo del
 *     transporte no lanza: cada destino devuelve su resultado;
 * (3) no se fija Content-Length a mano (fetch lo calcula).
 */

function fakeSubscription(endpoint: string): PushTarget {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const raw = publicKey.export({ format: "jwk" });
  const b64 = (s: string) => s.replace(/=+$/, "");
  const x = Buffer.from(raw.x!, "base64url");
  const y = Buffer.from(raw.y!, "base64url");
  const p256dh = b64(Buffer.concat([Buffer.from([0x04]), x, y]).toString("base64url"));
  const auth = b64(Buffer.from("0123456789abcdef").toString("base64url"));
  return { endpoint, p256dh, auth };
}

const keys = webpush.generateVAPIDKeys();
const payload: PushPayload = {
  kind: "inbound",
  title: "Ana",
  body: "Hola",
  tag: "conv:cv_1",
  url: "/inbox?c=cv_1",
};

describe("sendPush", () => {
  it("firma VAPID, cifra aes128gcm y reporta ok/gone por destino", async () => {
    const calls: { endpoint: string; request: PushRequest }[] = [];
    const statuses: Record<string, number> = {
      "https://push.example/ok": 201,
      "https://push.example/gone": 410,
      "https://push.example/missing": 404,
      "https://push.example/busy": 429,
    };
    const results = await sendPush(
      Object.keys(statuses).map(fakeSubscription),
      keys,
      "mailto:test@example.com",
      payload,
      {
        transport: async (endpoint, request) => {
          calls.push({ endpoint, request });
          return { status: statuses[endpoint] ?? 500 };
        },
      }
    );
    expect(calls).toHaveLength(4);
    for (const c of calls) {
      expect(c.request.method).toBe("POST");
      expect(c.request.headers["Authorization"]).toMatch(/^vapid t=\S+, k=\S+$/);
      expect(c.request.headers["Content-Encoding"]).toBe("aes128gcm");
      expect(c.request.headers["TTL"]).toBe("3600");
      expect(Object.keys(c.request.headers).map((k) => k.toLowerCase())).not.toContain(
        "content-length"
      );
      expect(c.request.body).toBeInstanceOf(Uint8Array);
      expect(c.request.body!.byteLength).toBeGreaterThan(payload.body.length);
    }
    const byEndpoint = Object.fromEntries(results.map((r) => [r.endpoint, r]));
    expect(byEndpoint["https://push.example/ok"]).toMatchObject({ ok: true, gone: false, status: 201 });
    expect(byEndpoint["https://push.example/gone"]).toMatchObject({ ok: false, gone: true, status: 410 });
    expect(byEndpoint["https://push.example/missing"]).toMatchObject({ ok: false, gone: true });
    expect(byEndpoint["https://push.example/busy"]).toMatchObject({ ok: false, gone: false, status: 429 });
  });

  it("un transporte que explota no tumba el lote", async () => {
    const results = await sendPush(
      [fakeSubscription("https://push.example/boom"), fakeSubscription("https://push.example/ok")],
      keys,
      "mailto:test@example.com",
      payload,
      {
        transport: async (endpoint) => {
          if (endpoint.endsWith("boom")) throw new Error("timeout");
          return { status: 201 };
        },
      }
    );
    expect(results.find((r) => r.endpoint.endsWith("boom"))).toMatchObject({
      ok: false,
      gone: false,
      status: null,
      error: "timeout",
    });
    expect(results.find((r) => r.endpoint.endsWith("ok"))?.ok).toBe(true);
  });
});
