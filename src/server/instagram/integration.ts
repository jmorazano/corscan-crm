import { and, eq, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { IgMenuItem } from "@/lib/instagram/types";
import {
  COMMENTS_SCOPE,
  INSTAGRAM_SCOPES,
  InstagramApiError,
  exchangeInstagramCode,
  exchangeLongLivedToken,
  getInstagramAccount,
  refreshLongLivedToken,
  subscribeInstagramWebhooks,
  unsubscribeInstagramWebhooks,
} from "@/lib/instagram/client";

/**
 * Conexión de Instagram Direct por empresa (023). Único módulo que toca el
 * token: lo cifra al guardarlo, lo descifra solo para llamar a Instagram y
 * JAMÁS lo devuelve en una vista.
 */

type Row = typeof schema.instagramIntegration.$inferSelect;

/** Lo que ve la UI: sin token. */
export type InstagramIntegrationView = {
  igUserId: string;
  username: string | null;
  name: string | null;
  profilePictureUrl: string | null;
  status: "connected" | "reconnect_required";
  tokenExpiresAt: string;
  connectedAt: string;
  /** 023: importación del historial (Conversations API). */
  history: {
    status: "idle" | "running" | "done" | "failed";
    startedAt: string | null;
    finishedAt: string | null;
    threads: number;
    messages: number;
    error: string | null;
  };
  /** 030: ¿la conexión tiene el permiso de comentarios? (si no: reconectar) */
  commentsEnabled: boolean;
  /** 030: los comentarios llegan por webhook (acceso avanzado) o por consulta. */
  commentsDelivery: "webhook" | "poll";
  commentsPolledAt: string | null;
  commentsError: string | null;
  moderationWords: string[];
  iceBreakers: string[];
  persistentMenu: IgMenuItem[];
  profileSyncedAt: string | null;
  profileError: string | null;
  /** 030: otra app (p. ej. ManyChat) maneja hilos de esta cuenta. */
  standbySeenAt: string | null;
};

/** Forma de runtime (servidor): incluye el token descifrado. */
export type InstagramIntegration = {
  organizationId: string;
  igUserId: string;
  username: string | null;
  status: "connected" | "reconnect_required";
  token: string;
  tokenExpiresAt: Date;
  tokenRefreshedAt: Date;
  /** 030 */
  commentsEnabled: boolean;
  moderationWords: string[];
  iceBreakers: string[];
  persistentMenu: IgMenuItem[];
  commentsWebhookAt: Date | null;
  commentsPolledAt: Date | null;
};

/**
 * 030: ¿la conexión puede leer/responder comentarios? Una fila de antes de
 * 030 (`granted_scopes` NULL) se conectó sin el permiso: hay que reconectar.
 */
export function hasCommentsScope(grantedScopes: readonly string[] | null | undefined): boolean {
  return !!grantedScopes?.includes(COMMENTS_SCOPE);
}

/** Un webhook de comentarios en las últimas 24 h = acceso avanzado activo. */
export const COMMENTS_WEBHOOK_FRESH_MS = 24 * 60 * 60 * 1000;

export class InstagramConnectError extends Error {
  constructor(
    public readonly code: "exchange" | "account_in_use" | "subscribe" | "not_configured",
    message: string
  ) {
    super(message);
    this.name = "InstagramConnectError";
  }
}

/** Renovar cuando al token le quedan menos de 15 días. */
export const REFRESH_BEFORE_MS = 15 * 24 * 60 * 60 * 1000;
/** Meta solo renueva tokens emitidos hace ≥ 24 h. */
const MIN_TOKEN_AGE_MS = 24 * 60 * 60 * 1000;

function toRuntime(row: Row): InstagramIntegration {
  return {
    organizationId: row.organizationId,
    igUserId: row.igUserId,
    username: row.username,
    status: row.status,
    token: decryptSecret({
      cipher: row.tokenCipher,
      iv: row.tokenIv,
      tag: row.tokenTag,
    }),
    tokenExpiresAt: row.tokenExpiresAt,
    tokenRefreshedAt: row.tokenRefreshedAt,
    commentsEnabled: hasCommentsScope(row.grantedScopes),
    moderationWords: row.moderationWords ?? [],
    iceBreakers: row.iceBreakers ?? [],
    persistentMenu: row.persistentMenu ?? [],
    commentsWebhookAt: row.commentsWebhookAt ?? null,
    commentsPolledAt: row.commentsPolledAt ?? null,
  };
}

export function toInstagramView(row: Row): InstagramIntegrationView {
  return {
    igUserId: row.igUserId,
    username: row.username,
    name: row.name,
    profilePictureUrl: row.profilePictureUrl,
    status: row.status,
    tokenExpiresAt: row.tokenExpiresAt.toISOString(),
    connectedAt: row.createdAt.toISOString(),
    history: {
      status: row.historyStatus,
      startedAt: row.historyStartedAt?.toISOString() ?? null,
      finishedAt: row.historyFinishedAt?.toISOString() ?? null,
      threads: row.historyThreads,
      messages: row.historyMessages,
      error: row.historyError,
    },
    commentsEnabled: hasCommentsScope(row.grantedScopes),
    commentsDelivery:
      row.commentsWebhookAt && Date.now() - row.commentsWebhookAt.getTime() < COMMENTS_WEBHOOK_FRESH_MS
        ? "webhook"
        : "poll",
    commentsPolledAt: row.commentsPolledAt?.toISOString() ?? null,
    commentsError: row.commentsError ?? null,
    moderationWords: row.moderationWords ?? [],
    iceBreakers: row.iceBreakers ?? [],
    persistentMenu: row.persistentMenu ?? [],
    profileSyncedAt: row.profileSyncedAt?.toISOString() ?? null,
    profileError: row.profileError ?? null,
    standbySeenAt: row.standbySeenAt?.toISOString() ?? null,
  };
}

async function getRow(organizationId: string): Promise<Row | null> {
  const rows = await getDb()
    .select()
    .from(schema.instagramIntegration)
    .where(scoped(schema.instagramIntegration.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getInstagramIntegrationView(
  organizationId: string
): Promise<InstagramIntegrationView | null> {
  const row = await getRow(organizationId);
  return row ? toInstagramView(row) : null;
}

export async function getInstagramIntegration(
  organizationId: string
): Promise<InstagramIntegration | null> {
  const row = await getRow(organizationId);
  return row ? toRuntime(row) : null;
}

/**
 * Enrutado del webhook: la cuenta profesional → su empresa. Lectura
 * cross-tenant JUSTIFICADA (como `getCredentialsByPhoneNumberId` de
 * WhatsApp): el webhook no trae sesión y el `ig_user_id` es unique en la
 * instancia, así que resuelve a lo sumo UNA empresa.
 */
export async function getInstagramIntegrationByAccount(
  igUserId: string
): Promise<InstagramIntegration | null> {
  const rows = await getDb()
    .select()
    .from(schema.instagramIntegration)
    .where(eq(schema.instagramIntegration.igUserId, igUserId))
    .limit(1);
  return rows[0] ? toRuntime(rows[0]) : null;
}

/**
 * Conecta (o reconecta) la cuenta de la empresa: código → token corto →
 * token largo → datos de la cuenta → suscripción a mensajes → fila cifrada.
 * Nada se guarda si algún paso falla.
 */
export async function connectInstagram(input: {
  organizationId: string;
  userId: string;
  code: string;
  now?: Date;
}): Promise<InstagramIntegrationView> {
  const now = input.now ?? new Date();
  let token: string;
  let expiresAt: Date;
  let grantedScopes: string[];
  try {
    const short = await exchangeInstagramCode(input.code);
    const long = await exchangeLongLivedToken(short.accessToken, now);
    token = long.accessToken;
    expiresAt = long.expiresAt;
    // 030: si Meta no manda `permissions`, se asume lo pedido; si el permiso
    // de comentarios no estaba, la primera llamada lo dice y se avisa.
    grantedScopes = short.permissions ?? [...INSTAGRAM_SCOPES];
  } catch (err) {
    throw new InstagramConnectError(
      "exchange",
      err instanceof Error ? err.message : "No se pudo obtener el token de Instagram"
    );
  }

  const account = await getInstagramAccount(token).catch((err) => {
    throw new InstagramConnectError(
      "exchange",
      err instanceof Error ? err.message : "No se pudo leer la cuenta de Instagram"
    );
  });

  // Una cuenta = una empresa: el webhook enruta por cuenta (FR-005).
  const owner = await getDb()
    .select({ organizationId: schema.instagramIntegration.organizationId })
    .from(schema.instagramIntegration)
    .where(eq(schema.instagramIntegration.igUserId, account.igUserId))
    .limit(1);
  if (owner[0] && owner[0].organizationId !== input.organizationId) {
    throw new InstagramConnectError(
      "account_in_use",
      "Esa cuenta de Instagram ya está conectada a otra empresa"
    );
  }

  let subscribedFields: string[];
  try {
    subscribedFields = await subscribeInstagramWebhooks(
      token,
      hasCommentsScope(grantedScopes) ? undefined : [
        // Sin el permiso de comentarios, pedirlos haría fallar la lista.
        ["messages", "messaging_seen", "messaging_postbacks", "message_reactions", "messaging_referral", "standby", "messaging_handover"],
        ["messages", "messaging_seen", "messaging_postbacks", "message_reactions", "messaging_referral"],
      ]
    );
  } catch (err) {
    throw new InstagramConnectError(
      "subscribe",
      err instanceof Error ? err.message : "Instagram rechazó la suscripción"
    );
  }

  const enc = encryptSecret(token);
  const values = {
    igUserId: account.igUserId,
    username: account.username,
    name: account.name,
    profilePictureUrl: account.profilePictureUrl,
    tokenCipher: enc.cipher,
    tokenIv: enc.iv,
    tokenTag: enc.tag,
    tokenExpiresAt: expiresAt,
    tokenRefreshedAt: now,
    status: "connected" as const,
    connectedBy: input.userId,
    grantedScopes,
    subscribedFields,
    updatedAt: now,
  };
  const saved = await getDb()
    .insert(schema.instagramIntegration)
    .values({ id: newId("instagramIntegration"), organizationId: input.organizationId, ...values })
    .onConflictDoUpdate({
      target: schema.instagramIntegration.organizationId,
      set: values,
    })
    .returning();
  return toInstagramView(saved[0]!);
}

/** Borra la conexión (y deja de recibir mensajes). Idempotente. */
export async function disconnectInstagram(organizationId: string): Promise<boolean> {
  const current = await getInstagramIntegration(organizationId).catch(() => null);
  if (current) await unsubscribeInstagramWebhooks(current.token);
  const deleted = await getDb()
    .delete(schema.instagramIntegration)
    .where(scoped(schema.instagramIntegration.organizationId, organizationId))
    .returning({ id: schema.instagramIntegration.id });
  return deleted.length > 0;
}

/**
 * Callbacks de Meta (desautorización / eliminación de datos): llegan con el
 * ID de la cuenta, no con la empresa. Borra la fila de esa cuenta.
 */
export async function deleteInstagramIntegrationByAccount(igUserId: string): Promise<boolean> {
  const deleted = await getDb()
    .delete(schema.instagramIntegration)
    .where(eq(schema.instagramIntegration.igUserId, igUserId))
    .returning({ id: schema.instagramIntegration.id });
  return deleted.length > 0;
}

export async function markInstagramReconnectRequired(organizationId: string): Promise<void> {
  await getDb()
    .update(schema.instagramIntegration)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(scoped(schema.instagramIntegration.organizationId, organizationId));
}

/** ¿Toca renovar? (puro) */
export function shouldRefreshToken(
  row: { tokenExpiresAt: Date; tokenRefreshedAt: Date; status: string },
  now: Date = new Date()
): boolean {
  if (row.status !== "connected") return false;
  if (row.tokenExpiresAt.getTime() <= now.getTime()) return false; // vencido: no se puede
  if (now.getTime() - row.tokenRefreshedAt.getTime() < MIN_TOKEN_AGE_MS) return false;
  return row.tokenExpiresAt.getTime() - now.getTime() < REFRESH_BEFORE_MS;
}

/**
 * Token listo para usar: lo renueva si le queda poco. Un rechazo de
 * autorización deja la conexión en `reconnect_required`; un fallo de red
 * NO: el token actual sigue sirviendo hasta que venza.
 */
export async function ensureInstagramToken(
  integration: InstagramIntegration,
  now: Date = new Date()
): Promise<InstagramIntegration> {
  if (integration.tokenExpiresAt.getTime() <= now.getTime()) {
    await markInstagramReconnectRequired(integration.organizationId);
    return { ...integration, status: "reconnect_required" };
  }
  if (!shouldRefreshToken(integration, now)) return integration;
  try {
    const fresh = await refreshLongLivedToken(integration.token, now);
    const enc = encryptSecret(fresh.accessToken);
    await getDb()
      .update(schema.instagramIntegration)
      .set({
        tokenCipher: enc.cipher,
        tokenIv: enc.iv,
        tokenTag: enc.tag,
        tokenExpiresAt: fresh.expiresAt,
        tokenRefreshedAt: now,
        updatedAt: now,
      })
      .where(scoped(schema.instagramIntegration.organizationId, integration.organizationId));
    return {
      ...integration,
      token: fresh.accessToken,
      tokenExpiresAt: fresh.expiresAt,
      tokenRefreshedAt: now,
    };
  } catch (err) {
    if (err instanceof InstagramApiError && err.isAuthError) {
      await markInstagramReconnectRequired(integration.organizationId);
      return { ...integration, status: "reconnect_required" };
    }
    console.warn(
      `[instagram] no se pudo renovar el token de ${integration.organizationId}:`,
      err instanceof Error ? err.message : err
    );
    return integration;
  }
}

/**
 * Barrido diario: renueva los tokens que están por vencer aunque la empresa
 * no haya enviado nada (una cuenta que solo RECIBE también necesita el
 * token vivo para leer perfiles y responder).
 */
export async function refreshDueInstagramTokens(now: Date = new Date()): Promise<number> {
  const due = await getDb()
    .select()
    .from(schema.instagramIntegration)
    .where(
      and(
        eq(schema.instagramIntegration.status, "connected"),
        lt(
          schema.instagramIntegration.tokenExpiresAt,
          new Date(now.getTime() + REFRESH_BEFORE_MS)
        )
      )
    );
  let refreshed = 0;
  for (const row of due) {
    const before = row.tokenExpiresAt.getTime();
    const after = await ensureInstagramToken(toRuntime(row), now);
    if (after.tokenExpiresAt.getTime() !== before) refreshed++;
  }
  return refreshed;
}

const TICKER_MS = 6 * 60 * 60 * 1000;

declare global {
  var __voceroInstagramTicker: ReturnType<typeof setInterval> | undefined;
}

/** Ticker en proceso (sin colas externas): cada 6 h revisa vencimientos. */
export function startInstagramTokenTicker(): void {
  if (globalThis.__voceroInstagramTicker) return;
  const run = () =>
    void refreshDueInstagramTokens()
      // Cuentas conectadas que nunca importaron su historial: una sola vez.
      .then(async () => {
        const { startPendingInstagramHistoryImports } = await import(
          "@/server/instagram/history"
        );
        await startPendingInstagramHistoryImports();
      })
      .catch((err) =>
        console.warn(
          "[instagram] barrido de tokens/historial falló:",
          err instanceof Error ? err.message : err
        )
      );
  globalThis.__voceroInstagramTicker = setInterval(run, TICKER_MS);
  globalThis.__voceroInstagramTicker.unref?.();
  run();
  // 030: consulta de comentarios (respaldo del webhook con acceso estándar).
  void import("@/server/instagram/comments")
    .then(({ startInstagramCommentsTicker }) => startInstagramCommentsTicker())
    .catch((err) =>
      console.warn("[instagram] no arrancó la consulta de comentarios:", err instanceof Error ? err.message : err)
    );
}

/** 030: marca que llegó un `standby` (otra app maneja hilos de la cuenta). */
export async function markInstagramStandbySeen(organizationId: string, now: Date = new Date()): Promise<void> {
  await getDb()
    .update(schema.instagramIntegration)
    .set({ standbySeenAt: now })
    .where(scoped(schema.instagramIntegration.organizationId, organizationId));
}
