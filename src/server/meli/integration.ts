import { and, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { MeliAuthError, refreshTokens, type MeliTokenSet } from "@/lib/meli/oauth";
import { MeliApiError, revokeGrant, type MeliUser } from "@/lib/meli/client";

/**
 * Conexión de Mercado Libre POR EMPRESA (025) — calcado de
 * `src/server/calendar/integration.ts`: tokens cifrados en reposo, a la UI
 * solo viaja lo visible, todo acceso scoped por organización.
 *
 * La diferencia que importa es el REFRESH ROTATIVO de ML (plan D2): cada
 * renovación quema el refresh anterior. Dos turnos del agente que renuevan
 * a la vez gastarían el mismo refresh dos veces y el segundo recibiría
 * `invalid_grant` — la empresa quedaría «Requiere reconexión» sin que nadie
 * haya revocado nada. Por eso la renovación pasa por un lock en proceso por
 * empresa (una promesa compartida) y el refresh nuevo se guarda en el MISMO
 * update que el access token.
 */

type Row = typeof schema.meliIntegration.$inferSelect;

export type MeliIntegrationView = {
  nickname: string | null;
  siteId: string;
  status: "connected" | "reconnect_required";
  agentEnabled: boolean;
  connectedAt: string;
  sync: {
    status: "idle" | "running" | "ok" | "failed";
    lastSyncAt: string | null;
    lastError: string | null;
    count: number;
  };
};

export class MeliConflictError extends Error {
  constructor() {
    super("Esa cuenta de Mercado Libre ya está conectada en otra empresa");
    this.name = "MeliConflictError";
  }
}

/** Una sync que quedó `running` más que esto murió con el proceso. */
export const SYNC_STUCK_MS = 10 * 60 * 1000;

export async function getMeliRow(organizationId: string): Promise<Row | null> {
  const rows = await getDb()
    .select()
    .from(schema.meliIntegration)
    .where(scoped(schema.meliIntegration.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

export function effectiveSyncStatus(row: Row, now = new Date()): MeliIntegrationView["sync"]["status"] {
  if (
    row.syncStatus === "running" &&
    row.syncStartedAt &&
    now.getTime() - row.syncStartedAt.getTime() > SYNC_STUCK_MS
  ) {
    return "failed";
  }
  return row.syncStatus;
}

export function toMeliView(row: Row, now = new Date()): MeliIntegrationView {
  const stuck = effectiveSyncStatus(row, now) === "failed" && row.syncStatus === "running";
  return {
    nickname: row.nickname,
    siteId: row.siteId,
    status: row.status,
    agentEnabled: row.agentEnabled,
    connectedAt: row.createdAt.toISOString(),
    sync: {
      status: effectiveSyncStatus(row, now),
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      lastError: stuck ? "interrupted" : row.lastSyncError,
      count: row.listingsCount,
    },
  };
}

export async function getMeliView(organizationId: string): Promise<MeliIntegrationView | null> {
  const row = await getMeliRow(organizationId);
  return row ? toMeliView(row) : null;
}

/**
 * Conecta o RECONECTA (upsert): una reconexión reemplaza tokens y vuelve a
 * `connected` conservando el snapshot y el ajuste del agente. Si la cuenta
 * ya está en OTRA empresa → `MeliConflictError` (plan D3: el grant nuevo
 * dejaría a la otra empresa sin token).
 */
export async function connectMeliIntegration(input: {
  organizationId: string;
  userId: string;
  tokens: MeliTokenSet;
  user: MeliUser;
}): Promise<void> {
  if (!input.tokens.refreshToken) {
    throw new MeliAuthError(
      "provider_error",
      "Mercado Libre no devolvió refresh token (¿la app tiene el permiso offline_access?)"
    );
  }
  const db = getDb();
  const refresh = encryptSecret(input.tokens.refreshToken);
  const access = encryptSecret(input.tokens.accessToken);

  const taken = await db
    .select({ id: schema.meliIntegration.id })
    .from(schema.meliIntegration)
    .where(
      and(
        eq(schema.meliIntegration.mlUserId, input.user.id),
        ne(schema.meliIntegration.organizationId, input.organizationId)
      )
    )
    .limit(1);
  if (taken[0]) {
    // ML ya emitió un grant nuevo para esa cuenta y con eso MATÓ el refresh
    // de la empresa que la tenía conectada (solo vale el último). Rechazar
    // sin más la dejaría rota. Los tokens nuevos son de la MISMA cuenta de ML
    // y quien los obtuvo ya tiene el usuario de esa cuenta: dárselos a su
    // dueña no expone nada y la mantiene andando.
    await db
      .update(schema.meliIntegration)
      .set({
        refreshTokenCipher: refresh.cipher,
        refreshTokenIv: refresh.iv,
        refreshTokenTag: refresh.tag,
        accessTokenCipher: access.cipher,
        accessTokenIv: access.iv,
        accessTokenTag: access.tag,
        accessTokenExpiresAt: input.tokens.expiresAt,
        status: "connected",
        updatedAt: new Date(),
      })
      .where(eq(schema.meliIntegration.id, taken[0].id));
    throw new MeliConflictError();
  }

  const now = new Date();
  // Otra cuenta de ML en la MISMA empresa: el snapshot anterior no es de esta
  // cuenta. Se borra antes del upsert para que el agente no ofrezca avisos
  // ajenos hasta la próxima sync.
  const current = await getMeliRow(input.organizationId);
  if (current && current.mlUserId !== input.user.id) {
    await db
      .delete(schema.meliListing)
      .where(scoped(schema.meliListing.organizationId, input.organizationId));
  }
  const accountChanged = Boolean(current && current.mlUserId !== input.user.id);
  await db
    .insert(schema.meliIntegration)
    .values({
      id: newId("meliIntegration"),
      organizationId: input.organizationId,
      mlUserId: input.user.id,
      nickname: input.user.nickname,
      siteId: input.user.siteId,
      refreshTokenCipher: refresh.cipher,
      refreshTokenIv: refresh.iv,
      refreshTokenTag: refresh.tag,
      accessTokenCipher: access.cipher,
      accessTokenIv: access.iv,
      accessTokenTag: access.tag,
      accessTokenExpiresAt: input.tokens.expiresAt,
      status: "connected",
      connectedBy: input.userId,
    })
    .onConflictDoUpdate({
      target: [schema.meliIntegration.organizationId],
      set: {
        mlUserId: input.user.id,
        nickname: input.user.nickname,
        siteId: input.user.siteId,
        refreshTokenCipher: refresh.cipher,
        refreshTokenIv: refresh.iv,
        refreshTokenTag: refresh.tag,
        accessTokenCipher: access.cipher,
        accessTokenIv: access.iv,
        accessTokenTag: access.tag,
        accessTokenExpiresAt: input.tokens.expiresAt,
        status: "connected",
        connectedBy: input.userId,
        ...(accountChanged
          ? { listingsCount: 0, lastSyncAt: null, lastSyncError: null, syncStatus: "idle" as const }
          : {}),
        updatedAt: now,
      },
    });
}

export async function updateMeliSettings(
  organizationId: string,
  patch: { agentEnabled?: boolean }
): Promise<boolean> {
  const set: Partial<typeof schema.meliIntegration.$inferInsert> = { updatedAt: new Date() };
  if (patch.agentEnabled !== undefined) set.agentEnabled = patch.agentEnabled;
  const updated = await getDb()
    .update(schema.meliIntegration)
    .set(set)
    .where(scoped(schema.meliIntegration.organizationId, organizationId))
    .returning({ id: schema.meliIntegration.id });
  return updated.length > 0;
}

/**
 * Desconecta: revoca el permiso en ML (best-effort), borra el snapshot y la
 * fila. Idempotente.
 */
export async function disconnectMeli(organizationId: string): Promise<void> {
  const row = await getMeliRow(organizationId);
  if (!row) return;
  try {
    const token = await ensureAccessToken(organizationId);
    await revokeGrant(token, row.mlUserId);
  } catch {
    // sin token vigente no hay nada que revocar: el borrado sigue igual
  }
  const db = getDb();
  await db.delete(schema.meliListing).where(scoped(schema.meliListing.organizationId, organizationId));
  await db
    .delete(schema.meliIntegration)
    .where(scoped(schema.meliIntegration.organizationId, organizationId));
}

export async function markMeliReconnectRequired(organizationId: string): Promise<void> {
  await getDb()
    .update(schema.meliIntegration)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(scoped(schema.meliIntegration.organizationId, organizationId));
}

/* ---------- token vigente con lock y rotación ---------- */

const globalForMeli = globalThis as unknown as { __meliRefresh?: Map<string, Promise<string>> };

function refreshLocks(): Map<string, Promise<string>> {
  if (!globalForMeli.__meliRefresh) globalForMeli.__meliRefresh = new Map();
  return globalForMeli.__meliRefresh;
}

function isFresh(row: Row, now = Date.now()): boolean {
  return Boolean(
    row.accessTokenCipher &&
      row.accessTokenIv &&
      row.accessTokenTag &&
      row.accessTokenExpiresAt &&
      row.accessTokenExpiresAt.getTime() - now > 60_000
  );
}

function decryptAccess(row: Row): string {
  return decryptSecret({
    cipher: row.accessTokenCipher!,
    iv: row.accessTokenIv!,
    tag: row.accessTokenTag!,
  });
}

/**
 * Access token vigente: la caché cifrada si le queda más de un minuto; si no,
 * renueva bajo lock. `invalid_grant` → `reconnect_required` y se relanza.
 */
export async function ensureAccessToken(
  organizationId: string,
  options: { force?: boolean } = {}
): Promise<string> {
  const row = await getMeliRow(organizationId);
  if (!row) throw new MeliAuthError("not_configured", "La empresa no tiene Mercado Libre conectado");
  if (row.status === "reconnect_required") {
    throw new MeliAuthError("invalid_grant", "La integración requiere reconexión");
  }
  if (!options.force && isFresh(row)) return decryptAccess(row);

  const locks = refreshLocks();
  const pending = locks.get(organizationId);
  if (pending) return pending;
  const task = renew(organizationId, row.accessTokenExpiresAt, options.force === true).finally(() => {
    locks.delete(organizationId);
  });
  locks.set(organizationId, task);
  return task;
}

async function renew(
  organizationId: string,
  staleExpiry: Date | null,
  force: boolean
): Promise<string> {
  // Re-leer adentro del lock: si otro proceso/turno ya renovó (la fila
  // cambió de vencimiento), se usa ese token y NO se quema el refresh nuevo.
  const row = await getMeliRow(organizationId);
  if (!row) throw new MeliAuthError("not_configured", "La empresa no tiene Mercado Libre conectado");
  const renewedMeanwhile =
    row.accessTokenExpiresAt?.getTime() !== staleExpiry?.getTime() && isFresh(row);
  if (renewedMeanwhile && !force) return decryptAccess(row);

  const refresh = decryptSecret({
    cipher: row.refreshTokenCipher,
    iv: row.refreshTokenIv,
    tag: row.refreshTokenTag,
  });
  try {
    const renewed = await refreshTokens(refresh);
    const access = encryptSecret(renewed.accessToken);
    const nextRefresh = renewed.refreshToken ? encryptSecret(renewed.refreshToken) : null;
    await getDb()
      .update(schema.meliIntegration)
      .set({
        accessTokenCipher: access.cipher,
        accessTokenIv: access.iv,
        accessTokenTag: access.tag,
        accessTokenExpiresAt: renewed.expiresAt,
        ...(nextRefresh
          ? {
              refreshTokenCipher: nextRefresh.cipher,
              refreshTokenIv: nextRefresh.iv,
              refreshTokenTag: nextRefresh.tag,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(scoped(schema.meliIntegration.organizationId, organizationId));
    return renewed.accessToken;
  } catch (err) {
    if (err instanceof MeliAuthError && err.code === "invalid_grant") {
      await markMeliReconnectRequired(organizationId);
    }
    throw err;
  }
}

/**
 * Llamada a la API con token vigente. Un 401 (token invalidado por un cambio
 * de contraseña, por ejemplo) reintenta UNA vez con renovación forzada.
 */
export async function withMeliToken<T>(
  organizationId: string,
  fn: (accessToken: string) => Promise<T>
): Promise<T> {
  const token = await ensureAccessToken(organizationId);
  try {
    return await fn(token);
  } catch (err) {
    if (err instanceof MeliApiError && err.code === "unauthorized") {
      const retry = await ensureAccessToken(organizationId, { force: true });
      return await fn(retry);
    }
    throw err;
  }
}

/** ¿La empresa tiene publicaciones que el agente puede usar? (Laboratorio.) */
export async function hasAgentListings(organizationId: string): Promise<boolean> {
  const row = await getMeliRow(organizationId);
  return Boolean(row && row.agentEnabled && row.lastSyncAt && row.listingsCount > 0);
}
