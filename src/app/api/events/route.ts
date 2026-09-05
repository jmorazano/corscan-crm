import {
  PasswordChangeRequiredError,
  requireSession,
  UnauthorizedError,
} from "@/lib/auth/session";
import { subscribe } from "@/server/events/bus";

/**
 * Canal SSE de la bandeja (contrato sse.md).
 * Headers exactos + heartbeat ~25s para sobrevivir detrás de Caddy/Traefik.
 * El servidor no garantiza replay: el cliente hace catch-up con `since=`.
 */
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

/**
 * Tope de vida del stream (US2): la organización se resuelve UNA vez al
 * conectar, así que un stream eterno seguiría emitiendo eventos de la org
 * vieja a un usuario removido o reasignado. Cerrar cada N minutos fuerza la
 * reconexión del EventSource (automática, con catch-up vía onReconnect), que
 * re-ejecuta requireSession y revalida la membresía.
 */
const MAX_STREAM_LIFETIME_MS = 15 * 60_000;
const encoder = new TextEncoder();

export async function GET(req: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return new Response("No autenticado", { status: 401 });
    }
    if (err instanceof PasswordChangeRequiredError) {
      return new Response("Cambio de contraseña pendiente", { status: 403 });
    }
    throw err;
  }
  const { organizationId } = session;

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup?.();
        }
      };

      send(`: conectado\n\n`);

      const unsubscribe = subscribe(organizationId, (event) => {
        send(
          `event: ${event.type}\n` +
            `id: ${Date.now()}\n` +
            `data: ${JSON.stringify(event.data)}\n\n`
        );
      });

      const heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);
      const maxLifetime = setTimeout(
        () => cleanup?.(),
        MAX_STREAM_LIFETIME_MS
      );

      cleanup = () => {
        clearInterval(heartbeat);
        clearTimeout(maxLifetime);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // ya cerrado
        }
      };

      req.signal.addEventListener("abort", () => cleanup?.());
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
