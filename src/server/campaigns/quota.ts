import { and, count, countDistinct, eq, gt, min } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/**
 * Cupo de iniciaciones (004, FR-015 — research D4): semántica oficial de
 * Meta — contactos ÚNICOS iniciados en una ventana MÓVIL de 24h, contando
 * solo envíos con la ventana de servicio cerrada.
 *
 * El patrón es RESERVA, no chequeo: verificar + insertar `initiated_send`
 * ocurre junto, dentro de un mutex FIFO por organización, ANTES de llamar a
 * Graph — sin TOCTOU entre campañas y envíos individuales. Si Graph falla,
 * el caller compensa con releaseQuota. El caso ambiguo de un crash deja la
 * reserva puesta: el cupo sesga a conservador, nunca al revés.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_DAILY_LIMIT = 250;

export class QuotaError extends Error {
  retryInSeconds: number;

  constructor(retryInSeconds: number) {
    super(
      "Cupo de contactos iniciados en 24h agotado; el cupo se libera solo a medida que pasa la ventana"
    );
    this.name = "QuotaError";
    this.retryInSeconds = retryInSeconds;
  }
}

/**
 * Mutex FIFO por organización. NO es el patrón __agentCoalesce (ese
 * descarta/fusiona trabajo): acá cada caller ESPERA su turno en una cadena
 * de promesas. In-process alcanza: la instancia es un monolito único.
 */
const globalLocks = globalThis as unknown as {
  __voceroSendLocks?: Map<string, Promise<unknown>>;
};

export function withOrgSendLock<T>(
  organizationId: string,
  fn: () => Promise<T>
): Promise<T> {
  const locks = (globalLocks.__voceroSendLocks ??= new Map());
  const prev = locks.get(organizationId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    organizationId,
    next.catch(() => undefined)
  );
  return next;
}

export async function getDailyLimit(organizationId: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ limit: schema.sendSettings.dailyInitiatedLimit })
    .from(schema.sendSettings)
    .where(eq(schema.sendSettings.organizationId, organizationId))
    .limit(1);
  return rows[0]?.limit ?? DEFAULT_DAILY_LIMIT;
}

export async function getQuotaUsage(organizationId: string): Promise<{
  dailyInitiatedLimit: number;
  usedLast24h: number;
  available: number;
}> {
  const db = getDb();
  const since = new Date(Date.now() - WINDOW_MS);
  const [limit, usedRows] = await Promise.all([
    getDailyLimit(organizationId),
    db
      .select({ used: countDistinct(schema.initiatedSend.contactId) })
      .from(schema.initiatedSend)
      .where(
        and(
          eq(schema.initiatedSend.organizationId, organizationId),
          gt(schema.initiatedSend.sentAt, since)
        )
      ),
  ]);
  const used = usedRows[0]?.used ?? 0;
  return {
    dailyInitiatedLimit: limit,
    usedLast24h: used,
    available: Math.max(0, limit - used),
  };
}

/**
 * Reserva un cupo para (org, contacto) — lanzar QuotaError si está agotado
 * y el contacto no está exento. Devuelve el id de la reserva para poder
 * compensar (releaseQuota) si el envío falla.
 */
export async function reserveQuota(
  organizationId: string,
  contactId: string
): Promise<{ reservationId: string }> {
  return withOrgSendLock(organizationId, async () => {
    const db = getDb();
    const since = new Date(Date.now() - WINDOW_MS);

    // Exención FR-015: un contacto YA iniciado en la ventana no consume
    // cupo nuevo (Meta cuenta usuarios únicos) — se registra igual, para
    // conservar el historial, sin verificar el límite.
    const already = await db
      .select({ n: count() })
      .from(schema.initiatedSend)
      .where(
        and(
          eq(schema.initiatedSend.organizationId, organizationId),
          eq(schema.initiatedSend.contactId, contactId),
          gt(schema.initiatedSend.sentAt, since)
        )
      );
    const exempt = (already[0]?.n ?? 0) > 0;

    if (!exempt) {
      const { available } = await getQuotaUsage(organizationId);
      if (available <= 0) {
        const oldest = await db
          .select({ at: min(schema.initiatedSend.sentAt) })
          .from(schema.initiatedSend)
          .where(
            and(
              eq(schema.initiatedSend.organizationId, organizationId),
              gt(schema.initiatedSend.sentAt, since)
            )
          );
        const oldestAt = oldest[0]?.at?.getTime() ?? Date.now();
        const retryInSeconds = Math.max(
          60,
          Math.ceil((oldestAt + WINDOW_MS - Date.now()) / 1000)
        );
        throw new QuotaError(retryInSeconds);
      }
    }

    const reservationId = newId("initiatedSend");
    await db.insert(schema.initiatedSend).values({
      id: reservationId,
      organizationId,
      contactId,
    });
    return { reservationId };
  });
}

/** Compensación: el envío falló, la reserva no cuenta. */
export async function releaseQuota(reservationId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.initiatedSend)
    .where(eq(schema.initiatedSend.id, reservationId));
}
