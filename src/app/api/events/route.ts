import {
  PasswordChangeRequiredError,
  requireSession,
  UnauthorizedError,
} from "@/lib/auth/session";
import { subscribe, type SseEvent } from "@/server/events/bus";
import { listMembershipOrganizationIds } from "@/server/workspaces/list";

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

/**
 * 018: eventos de OTRA empresa del usuario que pueden mover su no leído.
 * Se traducen a un ping `workspace.unread { organizationId }` (sin
 * contenido, con debounce por empresa) para que el rail se refresque.
 */
const WORKSPACE_UNREAD_TRIGGERS: ReadonlySet<SseEvent["type"]> = new Set([
  "message.new",
  "conversation.updated",
  "conversations.updated",
  "conversation.deleted",
]);
const WORKSPACE_PING_DEBOUNCE_MS = 1_000;

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
  // 018: las otras empresas del usuario (resueltas UNA vez; el tope de
  // vida del stream revalida la lista al reconectar).
  const otherOrganizationIds = (
    await listMembershipOrganizationIds(session.userId).catch(() => [])
  ).filter((id) => id !== organizationId);

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

      const pingTimers = new Map<string, ReturnType<typeof setTimeout>>();
      const unsubscribeOthers = otherOrganizationIds.map((otherId) =>
        subscribe(otherId, (event) => {
          if (!WORKSPACE_UNREAD_TRIGGERS.has(event.type)) return;
          if (pingTimers.has(otherId)) return;
          pingTimers.set(
            otherId,
            setTimeout(() => {
              pingTimers.delete(otherId);
              send(
                `event: workspace.unread\n` +
                  `id: ${Date.now()}\n` +
                  `data: ${JSON.stringify({ organizationId: otherId })}\n\n`
              );
            }, WORKSPACE_PING_DEBOUNCE_MS)
          );
        })
      );

      const heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);
      const maxLifetime = setTimeout(
        () => cleanup?.(),
        MAX_STREAM_LIFETIME_MS
      );

      cleanup = () => {
        clearInterval(heartbeat);
        clearTimeout(maxLifetime);
        unsubscribe();
        for (const off of unsubscribeOthers) off();
        for (const t of pingTimers.values()) clearTimeout(t);
        pingTimers.clear();
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
