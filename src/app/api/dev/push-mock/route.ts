import { mockGuard } from "@/lib/dev-guard";
import {
  getPushMockState,
  resetPushMockState,
} from "@/server/dev/push-mock-state";

export const dynamic = "force-dynamic";

/**
 * Push service simulado (013, FR-011): el endpoint de una suscripción falsa
 * apunta acá. Registra la entrega y responde 201 (o el `?status=` pedido,
 * p. ej. 410 para verificar la poda). 404 incondicional en producción.
 */
export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const url = new URL(req.url);
  const status = Number(url.searchParams.get("status") ?? "201") || 201;
  const body = new Uint8Array(await req.arrayBuffer());
  const authorization = req.headers.get("authorization") ?? "";
  getPushMockState().deliveries.push({
    at: new Date().toISOString(),
    status,
    contentEncoding: req.headers.get("content-encoding"),
    ttl: req.headers.get("ttl"),
    urgency: req.headers.get("urgency"),
    vapid: /^vapid t=\S+, k=\S+$/.test(authorization),
    bodyLength: body.byteLength,
  });
  return new Response(null, { status });
}

export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  return Response.json({ deliveries: getPushMockState().deliveries });
}

export async function DELETE() {
  const guard = mockGuard();
  if (guard) return guard;
  resetPushMockState();
  return Response.json({ cleared: true });
}
