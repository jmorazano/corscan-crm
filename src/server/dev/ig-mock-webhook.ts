import { createHmac } from "node:crypto";
import { getEnv } from "@/lib/env";

/**
 * Entrega un payload de Instagram al webhook público por loopback, FIRMADO
 * con el secreto real de la app de Instagram (el webhook lo exige): el
 * self-test ejercita la capa de firma de verdad.
 */
export async function deliverToInstagramWebhook(
  payload: unknown,
  opts: { badSignature?: boolean } = {}
): Promise<Response> {
  const env = getEnv();
  const raw = JSON.stringify(payload);
  const port = process.env.PORT ?? "3000";
  const secret = opts.badSignature ? "firma-invalida" : (env.INSTAGRAM_APP_SECRET ?? "");
  const sig = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  return fetch(`http://127.0.0.1:${port}/api/webhooks/instagram`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${sig}` },
    body: raw,
  });
}

/** Un `entry` con un solo evento de `messaging`. */
export function instagramPayload(accountId: string, messaging: Record<string, unknown>) {
  return {
    object: "instagram",
    entry: [{ id: accountId, time: Date.now(), messaging: [messaging] }],
  };
}
