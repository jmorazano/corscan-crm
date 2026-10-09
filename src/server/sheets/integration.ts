import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";
import {
  GoogleAuthError,
  refreshAccessToken,
  revokeToken,
  type TokenSet,
} from "@/lib/google/oauth";
import { SheetsApiError } from "@/lib/google/sheets-client";
import { spreadsheetUrl } from "@/lib/sheets";

/**
 * Conexión de Google Sheets POR EMPRESA (034) — calcada de la de Calendar
 * (005) pero en su propia fila: otra cuenta posible, otro permiso
 * (`drive.file`) y ciclo de vida independiente. A la UI solo viaja lo
 * visible; los tokens jamás salen del servidor.
 */

type Row = typeof schema.sheetsIntegration.$inferSelect;

export type SheetsStatus = "connected" | "reconnect_required";

export type SheetsIntegrationView = {
  accountEmail: string | null;
  status: SheetsStatus;
  connectedAt: string;
  receipts: {
    enabled: boolean;
    spreadsheetId: string | null;
    spreadsheetName: string | null;
    sheetTitle: string | null;
    url: string | null;
  };
};

async function getRow(organizationId: string): Promise<Row | null> {
  const rows = await getDb()
    .select()
    .from(schema.sheetsIntegration)
    .where(scoped(schema.sheetsIntegration.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getSheetsIntegrationRow(organizationId: string): Promise<Row | null> {
  return getRow(organizationId);
}

export function toSheetsView(row: Row): SheetsIntegrationView {
  return {
    accountEmail: row.accountEmail,
    status: row.status,
    connectedAt: row.createdAt.toISOString(),
    receipts: {
      enabled: row.receiptsEnabled,
      spreadsheetId: row.receiptsSpreadsheetId,
      spreadsheetName: row.receiptsSpreadsheetName,
      sheetTitle: row.receiptsSheetTitle,
      url: row.receiptsSpreadsheetId ? spreadsheetUrl(row.receiptsSpreadsheetId) : null,
    },
  };
}

export async function getSheetsIntegrationView(
  organizationId: string
): Promise<SheetsIntegrationView | null> {
  const row = await getRow(organizationId);
  return row ? toSheetsView(row) : null;
}

/**
 * Conecta o RECONECTA (upsert): una reconexión reemplaza tokens, vuelve a
 * `connected` y conserva el destino de comprobantes y las planillas.
 */
export async function connectSheetsIntegration(input: {
  organizationId: string;
  userId: string;
  tokens: TokenSet;
}): Promise<void> {
  if (!input.tokens.refreshToken) {
    throw new GoogleAuthError(
      "provider_error",
      "Google no devolvió refresh token (¿falta prompt=consent?)"
    );
  }
  const refresh = encryptSecret(input.tokens.refreshToken);
  const access = encryptSecret(input.tokens.accessToken);
  const tokenCols = {
    accountEmail: input.tokens.email,
    refreshTokenCipher: refresh.cipher,
    refreshTokenIv: refresh.iv,
    refreshTokenTag: refresh.tag,
    accessTokenCipher: access.cipher,
    accessTokenIv: access.iv,
    accessTokenTag: access.tag,
    accessTokenExpiresAt: input.tokens.expiresAt,
    status: "connected" as const,
    connectedBy: input.userId,
  };
  await getDb()
    .insert(schema.sheetsIntegration)
    .values({ id: newId("sheetsIntegration"), organizationId: input.organizationId, ...tokenCols })
    .onConflictDoUpdate({
      target: [schema.sheetsIntegration.organizationId],
      set: { ...tokenCols, updatedAt: new Date() },
    });
}

/**
 * Desconecta: revoca en Google (best-effort) y borra la conexión, las
 * planillas de consulta y los valores cifrados de comprobantes pendientes
 * (el registro queda como historial, sin datos bancarios). Idempotente.
 */
export async function disconnectSheetsIntegration(organizationId: string): Promise<void> {
  const row = await getRow(organizationId);
  if (!row) return;
  const refresh = decryptSecret({
    cipher: row.refreshTokenCipher,
    iv: row.refreshTokenIv,
    tag: row.refreshTokenTag,
  });
  await revokeToken(refresh);
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.sheetSource)
      .where(scoped(schema.sheetSource.organizationId, organizationId));
    await tx
      .update(schema.paymentReceipt)
      .set({ valuesCipher: null, valuesIv: null, valuesTag: null, updatedAt: new Date() })
      .where(scoped(schema.paymentReceipt.organizationId, organizationId));
    await tx
      .delete(schema.sheetsIntegration)
      .where(scoped(schema.sheetsIntegration.organizationId, organizationId));
  });
}

export async function markSheetsReconnectRequired(organizationId: string): Promise<void> {
  await getDb()
    .update(schema.sheetsIntegration)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(scoped(schema.sheetsIntegration.organizationId, organizationId));
}

export async function updateReceiptsTarget(
  organizationId: string,
  patch: {
    enabled?: boolean;
    spreadsheetId?: string | null;
    spreadsheetName?: string | null;
    sheetTitle?: string | null;
  }
): Promise<boolean> {
  const set: Partial<typeof schema.sheetsIntegration.$inferInsert> = { updatedAt: new Date() };
  if (patch.enabled !== undefined) set.receiptsEnabled = patch.enabled;
  if (patch.spreadsheetId !== undefined) set.receiptsSpreadsheetId = patch.spreadsheetId;
  if (patch.spreadsheetName !== undefined) set.receiptsSpreadsheetName = patch.spreadsheetName;
  if (patch.sheetTitle !== undefined) set.receiptsSheetTitle = patch.sheetTitle;
  const updated = await getDb()
    .update(schema.sheetsIntegration)
    .set(set)
    .where(scoped(schema.sheetsIntegration.organizationId, organizationId))
    .returning({ id: schema.sheetsIntegration.id });
  return updated.length > 0;
}

/**
 * Access token vigente: caché cifrada si faltan más de 60 s; si no, renueva
 * con el refresh y persiste. `invalid_grant` → `reconnect_required` y se
 * relanza (el llamador degrada).
 */
async function ensureAccessToken(organizationId: string): Promise<string> {
  const row = await getRow(organizationId);
  if (!row) {
    throw new GoogleAuthError("not_configured", "La empresa no tiene Google Sheets conectado");
  }
  if (row.status === "reconnect_required") {
    throw new GoogleAuthError("invalid_grant", "La integración requiere reconexión");
  }
  if (
    row.accessTokenCipher &&
    row.accessTokenIv &&
    row.accessTokenTag &&
    row.accessTokenExpiresAt &&
    row.accessTokenExpiresAt.getTime() - Date.now() > 60_000
  ) {
    return decryptSecret({
      cipher: row.accessTokenCipher,
      iv: row.accessTokenIv,
      tag: row.accessTokenTag,
    });
  }
  const refresh = decryptSecret({
    cipher: row.refreshTokenCipher,
    iv: row.refreshTokenIv,
    tag: row.refreshTokenTag,
  });
  try {
    const renewed = await refreshAccessToken(refresh);
    const enc = encryptSecret(renewed.accessToken);
    await getDb()
      .update(schema.sheetsIntegration)
      .set({
        accessTokenCipher: enc.cipher,
        accessTokenIv: enc.iv,
        accessTokenTag: enc.tag,
        accessTokenExpiresAt: renewed.expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.sheetsIntegration.id, row.id));
    return renewed.accessToken;
  } catch (err) {
    if (err instanceof GoogleAuthError && err.code === "invalid_grant") {
      await markSheetsReconnectRequired(organizationId);
    }
    throw err;
  }
}

async function invalidateAccessToken(organizationId: string): Promise<void> {
  await getDb()
    .update(schema.sheetsIntegration)
    .set({ accessTokenExpiresAt: null, updatedAt: new Date() })
    .where(scoped(schema.sheetsIntegration.organizationId, organizationId));
}

/**
 * Llamada a la API con token vigente. Un 401 (token revocado entre medio)
 * reintenta UNA vez con refresh forzado.
 */
export async function withSheetsToken<T>(
  organizationId: string,
  fn: (accessToken: string) => Promise<T>
): Promise<T> {
  const token = await ensureAccessToken(organizationId);
  try {
    return await fn(token);
  } catch (err) {
    if (err instanceof SheetsApiError && err.code === "unauthorized") {
      await invalidateAccessToken(organizationId);
      return await fn(await ensureAccessToken(organizationId));
    }
    throw err;
  }
}

/** Código estable propio para guardar y mostrar (jamás el texto de Google). */
export type SheetsErrorCode =
  | "reconnect_required"
  | "not_connected"
  | "no_access"
  | "not_found"
  | "no_headers"
  | "no_ai"
  | "extraction"
  | "provider_error";

export function sheetsErrorCode(err: unknown): SheetsErrorCode {
  if (err instanceof GoogleAuthError) {
    if (err.code === "invalid_grant") return "reconnect_required";
    if (err.code === "not_configured") return "not_connected";
    return "provider_error";
  }
  if (err instanceof SheetsApiError) {
    if (err.code === "no_access") return "no_access";
    if (err.code === "not_found") return "not_found";
    if (err.code === "unauthorized") return "reconnect_required";
  }
  return "provider_error";
}

/** Texto en criollo de cada código (UI y avisos). */
export const SHEETS_ERROR_TEXT: Record<SheetsErrorCode, string> = {
  reconnect_required: "Google pidió volver a conectar la cuenta.",
  not_connected: "Google Sheets no está conectado.",
  no_access:
    "Vocero no tiene acceso a esa planilla: elegila con el selector de Google usando la cuenta conectada.",
  not_found: "La planilla o la pestaña ya no existe.",
  no_headers: "La pestaña no tiene encabezados en la fila 1.",
  no_ai: "Falta configurar la inteligencia artificial en Ajustes.",
  extraction: "No se pudo leer el comprobante.",
  provider_error: "Google no respondió. Probá de nuevo en unos minutos.",
};
