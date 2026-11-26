import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { graphRequest, MetaApiError } from "@/lib/meta/client";
import {
  clampDays,
  HISTORY_IMPORT_DEFAULT_DAYS,
  HISTORY_SYNC_LIMIT_CODE,
  HISTORY_SYNC_LIMIT_TEXT,
  isFromOlderConnection,
  isSyncLimitError,
  type HistoryImportState,
} from "@/lib/history-import";
import { scoped } from "@/lib/db/tenant";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";

/**
 * Sincronización del historial del celular (017, coexistence): pide a Meta
 * los contactos de la agenda y hasta 180 días de mensajes
 * (`POST {phone_number_id}/smb_app_data`). Meta responde por webhooks
 * (`smb_app_state_sync`, `history`); el estado por empresa vive en
 * `history_import`. Hay que pedirla dentro de las 24 h del onboarding.
 */

export type HistoryImportDto = {
  status: "idle" | "requested" | "receiving" | "done" | "failed" | "declined";
  days: number;
  progress: number;
  importedMessages: number;
  skippedOld: number;
  threads: number;
  requestedAt: string | null;
  lastChunkAt: string | null;
  finishedAt: string | null;
  lastErrorCode: string | null;
  lastError: string | null;
};

export class HistorySyncError extends Error {
  constructor(
    public readonly code: "not_connected" | "in_progress" | "meta_error" | "meta_unavailable",
    message: string
  ) {
    super(message);
    this.name = "HistorySyncError";
  }
}

type Row = typeof schema.historyImport.$inferSelect;

export function serializeHistoryImport(row: Row): HistoryImportDto {
  return {
    status: row.status,
    days: row.days,
    progress: row.progress,
    importedMessages: row.importedMessages,
    skippedOld: row.skippedOld,
    threads: row.threads,
    requestedAt: row.requestedAt?.toISOString() ?? null,
    lastChunkAt: row.lastChunkAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    lastErrorCode: row.lastErrorCode,
    lastError: row.lastError,
  };
}

/** Lo que necesitan las reglas puras (`historyImportView`). */
export function toHistoryImportState(row: Row): HistoryImportState {
  return {
    status: row.status,
    days: row.days,
    requestedAt: row.requestedAt,
    lastChunkAt: row.lastChunkAt,
    attemptAt: row.updatedAt,
    lastErrorCode: row.lastErrorCode,
    lastError: row.lastError,
  };
}

/**
 * Última vez que se guardó la conexión del número (alta o reconexión por
 * Embedded Signup). Un pedido anterior a esto es de OTRA conexión: Meta
 * admite uno nuevo.
 */
export async function connectionUpdatedAt(organizationId: string): Promise<Date | null> {
  const db = getDb();
  const rows = await db
    .select({ updatedAt: schema.metaCredentials.updatedAt })
    .from(schema.metaCredentials)
    .where(scoped(schema.metaCredentials.organizationId, organizationId))
    .limit(1);
  return rows[0]?.updatedAt ?? null;
}

/**
 * Contadores reales desde `message` (los acumulados por chunk sobrecuentan
 * hilos repartidos en varios chunks).
 */
export async function historyImportStats(
  organizationId: string
): Promise<{ importedMessages: number; threads: number; oldestImportedAt: string | null }> {
  const db = getDb();
  const rows = await db
    .select({
      importedMessages: sql<number>`count(*)`,
      threads: sql<number>`count(distinct ${schema.message.conversationId})`,
      // `created_at` es timestamp SIN zona guardado en UTC: en segundos, para
      // no depender de cómo lo interprete el driver.
      oldestEpoch: sql<number | null>`extract(epoch from min(${schema.message.createdAt}))::float8`,
    })
    .from(schema.message)
    .where(
      sql`${schema.message.organizationId} = ${organizationId} and ${schema.message.source} = 'history'`
    );
  return {
    importedMessages: Number(rows[0]?.importedMessages ?? 0),
    threads: Number(rows[0]?.threads ?? 0),
    oldestImportedAt:
      rows[0]?.oldestEpoch != null
        ? new Date(Number(rows[0].oldestEpoch) * 1000).toISOString()
        : null,
  };
}

export async function getHistoryImport(organizationId: string): Promise<Row | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.historyImport)
    .where(eq(schema.historyImport.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Pide contactos + historial. Idempotente: repetir con una importación
 * terminada la reinicia (los mensajes ya importados se deduplican por
 * wamid); con una en curso → `in_progress`.
 */
export async function requestHistorySync(
  organizationId: string,
  opts: { days?: number } = {}
): Promise<Row> {
  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) throw new HistorySyncError("not_connected", "No hay un número conectado");
  const current = await getHistoryImport(organizationId);
  if (current && (current.status === "requested" || current.status === "receiving")) {
    const ageMs = Date.now() - (current.requestedAt?.getTime() ?? 0);
    // Una solicitud colgada (>1 h sin terminar) se puede volver a pedir. Y
    // una de ANTES de reconectar el número no cuenta: si alguien desconecta y
    // reconecta dentro de la hora, el pedido automático tiene que salir (es
    // el único que Meta va a aceptar para esa conexión).
    const olderConnection = isFromOlderConnection(
      current.requestedAt,
      await connectionUpdatedAt(organizationId)
    );
    if (ageMs < 60 * 60 * 1000 && !olderConnection) {
      throw new HistorySyncError("in_progress", "Ya hay una importación en curso");
    }
  }
  const days = clampDays(opts.days ?? current?.days ?? HISTORY_IMPORT_DEFAULT_DAYS);

  let requestId: string | null = null;
  try {
    // Contactos primero (nombres de agenda), después el historial.
    await graphRequest<{ request_id?: string }>(`${creds.phoneNumberId}/smb_app_data`, {
      method: "POST",
      token: creds.token,
      body: { messaging_product: "whatsapp", sync_type: "smb_app_state_sync" },
    }).catch((err) => {
      // La agenda es accesoria: si falla, el historial igual se pide.
      console.warn("[historial] sync de contactos falló:", err instanceof Error ? err.message : err);
      return null;
    });
    const res = await graphRequest<{ request_id?: string }>(`${creds.phoneNumberId}/smb_app_data`, {
      method: "POST",
      token: creds.token,
      body: { messaging_product: "whatsapp", sync_type: "history" },
    });
    requestId = res.request_id ?? null;
  } catch (err) {
    // Meta admite un solo pedido por conexión: el rechazo se explica en
    // criollo y queda con código propio (la tarjeta deja de ofrecer el botón).
    const limit = err instanceof MetaApiError && isSyncLimitError(err.code, err.message);
    const message = limit
      ? HISTORY_SYNC_LIMIT_TEXT
      : err instanceof MetaApiError
        ? `Meta rechazó la solicitud: ${err.message}`
        : "No se pudo hablar con Meta ahora";
    const code = err instanceof MetaApiError ? "meta_error" : "meta_unavailable";
    const lastErrorCode = limit
      ? HISTORY_SYNC_LIMIT_CODE
      : err instanceof MetaApiError
        ? String(err.code ?? err.status)
        : "network";
    // Si el pedido anterior SÍ trajo chats, ese resultado no se pisa con un
    // «Falló»: solo se anota por qué no se puede repetir.
    const hadChunks = current?.status === "done" || current?.status === "receiving";
    await upsertImport(
      organizationId,
      limit && hadChunks
        ? { lastErrorCode, lastError: message }
        : { status: "failed", days, lastErrorCode, lastError: message }
    );
    throw new HistorySyncError(code, message);
  }

  return upsertImport(organizationId, {
    status: "requested",
    days,
    requestId,
    requestedAt: new Date(),
    finishedAt: null,
    progress: 0,
    importedMessages: 0,
    skippedOld: 0,
    threads: 0,
    lastErrorCode: null,
    lastError: null,
  });
}

export async function upsertImport(
  organizationId: string,
  patch: Partial<Omit<Row, "organizationId" | "createdAt" | "updatedAt">>
): Promise<Row> {
  const db = getDb();
  const rows = await db
    .insert(schema.historyImport)
    .values({ organizationId, ...patch })
    .onConflictDoUpdate({
      target: schema.historyImport.organizationId,
      set: { ...patch, updatedAt: new Date() },
    })
    .returning();
  return rows[0]!;
}

/** Avance de un chunk: contadores acumulados, progreso = máximo. */
export async function recordChunk(
  organizationId: string,
  chunk: { progress: number | null; imported: number; skippedOld: number; threads: number }
): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .insert(schema.historyImport)
    .values({
      organizationId,
      status: chunk.progress !== null && chunk.progress >= 100 ? "done" : "receiving",
      progress: chunk.progress ?? 0,
      importedMessages: chunk.imported,
      skippedOld: chunk.skippedOld,
      threads: chunk.threads,
      lastChunkAt: now,
      finishedAt: chunk.progress !== null && chunk.progress >= 100 ? now : null,
    })
    .onConflictDoUpdate({
      target: schema.historyImport.organizationId,
      set: {
        status:
          chunk.progress !== null && chunk.progress >= 100
            ? "done"
            : sql`case when ${schema.historyImport.status} = 'done' then 'done' else 'receiving' end`,
        progress: sql`greatest(${schema.historyImport.progress}, ${chunk.progress ?? 0})`,
        importedMessages: sql`${schema.historyImport.importedMessages} + ${chunk.imported}`,
        skippedOld: sql`${schema.historyImport.skippedOld} + ${chunk.skippedOld}`,
        threads: sql`${schema.historyImport.threads} + ${chunk.threads}`,
        lastChunkAt: now,
        finishedAt:
          chunk.progress !== null && chunk.progress >= 100
            ? now
            : schema.historyImport.finishedAt,
        lastErrorCode: null,
        lastError: null,
        updatedAt: now,
      },
    });
}

export async function recordDeclined(
  organizationId: string,
  code: string,
  message: string
): Promise<void> {
  await upsertImport(organizationId, {
    status: "declined",
    lastErrorCode: code,
    lastError: message,
    finishedAt: new Date(),
  });
}
