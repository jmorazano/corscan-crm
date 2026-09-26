import { after } from "next/server";
import { getEnv, isInstagramConfigured } from "@/lib/env";
import { isValidSignature } from "@/server/inbox/webhook";
import { parseMetaJson } from "@/lib/instagram/json";
import { processInstagramWebhook } from "@/server/instagram/ingest";

/**
 * Webhook de Instagram Direct (023). URL fija, SIN segmento secreto: la
 * autenticación es la firma `X-Hub-Signature-256`, OBLIGATORIA (a diferencia
 * de WhatsApp, acá el secreto siempre existe: sin él Instagram no está
 * habilitado). Se acepta la firma con el secreto de la app de Instagram y,
 * por robustez, con el de la app de Meta.
 *
 * Responde 200 apenas valida; el procesamiento corre en `after()`.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isInstagramConfigured()) return new Response(null, { status: 404 });
  const env = getEnv();
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === env.META_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response(null, { status: 403 });
}

export async function POST(req: Request) {
  if (!isInstagramConfigured()) return new Response(null, { status: 404 });
  const env = getEnv();
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const signed = [env.INSTAGRAM_APP_SECRET, env.META_APP_SECRET].some(
    (secret) => !!secret && !!signature && isValidSignature(rawBody, signature, secret)
  );
  if (!signed) return new Response(null, { status: 401 });

  let body: unknown;
  try {
    // IDs de 17 dígitos: se preservan como texto (ver parseMetaJson).
    body = parseMetaJson(rawBody);
  } catch {
    return Response.json({ received: true });
  }

  after(async () => {
    try {
      await processInstagramWebhook(body);
    } catch (err) {
      console.error(
        "[instagram] error procesando el webhook:",
        err instanceof Error ? err.message : err
      );
    }
  });
  return Response.json({ received: true });
}
