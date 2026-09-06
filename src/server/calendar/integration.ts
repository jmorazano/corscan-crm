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
import {
  GoogleApiError,
  listCalendars as apiListCalendars,
  type CalendarSummary,
} from "@/lib/google/calendar-client";
import {
  DEFAULT_RULES,
  normalizeWeeklyHours,
  type CalendarRules,
  type WeeklyHours,
} from "@/server/calendar/rules";

/**
 * Integración de calendario POR EMPRESA (data-model 005) — patrón calcado
 * de ai/credentials.ts: tokens cifrados en reposo, a la UI solo viaja lo
 * visible (cuenta, calendario, reglas), todo acceso scoped por organización.
 */

type Row = typeof schema.calendarIntegration.$inferSelect;

/** Vista para la UI (contrato integrations-api.md): jamás tokens. */
export type CalendarIntegrationView = CalendarRules & {
  accountEmail: string | null;
  calendarId: string;
  calendarName: string | null;
  status: "connected" | "reconnect_required";
  connectedAt: string;
};

/** Lo que consume el runtime (agente, disponibilidad): con reglas tipadas. */
export type CalendarIntegration = {
  id: string;
  organizationId: string;
  accountEmail: string | null;
  calendarId: string;
  calendarName: string | null;
  status: "connected" | "reconnect_required";
  rules: CalendarRules;
};

function toIntegration(row: Row): CalendarIntegration {
  return {
    id: row.id,
    organizationId: row.organizationId,
    accountEmail: row.accountEmail,
    calendarId: row.calendarId,
    calendarName: row.calendarName,
    status: row.status,
    rules: {
      timezone: row.timezone,
      agentBookingEnabled: row.agentBookingEnabled,
      slotMinutes: row.slotMinutes,
      bufferMinutes: row.bufferMinutes,
      minLeadHours: row.minLeadHours,
      horizonDays: row.horizonDays,
      weeklyHours: normalizeWeeklyHours(row.weeklyHours as WeeklyHours),
      bookingInstructions: row.bookingInstructions,
    },
  };
}

async function getRow(organizationId: string): Promise<Row | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.calendarIntegration)
    .where(scoped(schema.calendarIntegration.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getCalendarIntegration(
  organizationId: string
): Promise<CalendarIntegration | null> {
  const row = await getRow(organizationId);
  return row ? toIntegration(row) : null;
}

export async function getCalendarIntegrationView(
  organizationId: string
): Promise<CalendarIntegrationView | null> {
  const row = await getRow(organizationId);
  if (!row) return null;
  const i = toIntegration(row);
  return {
    ...i.rules,
    accountEmail: i.accountEmail,
    calendarId: i.calendarId,
    calendarName: i.calendarName,
    status: i.status,
    connectedAt: row.createdAt.toISOString(),
  };
}

/**
 * Conecta o RECONECTA (upsert): una reconexión reemplaza tokens, vuelve a
 * `connected` y conserva calendario + reglas previas (research D2/D9).
 * Sin refresh token no hay conexión durable → error tipado.
 */
export async function connectCalendarIntegration(input: {
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
  const db = getDb();
  const refresh = encryptSecret(input.tokens.refreshToken);
  const access = encryptSecret(input.tokens.accessToken);
  await db
    .insert(schema.calendarIntegration)
    .values({
      id: newId("calendarIntegration"),
      organizationId: input.organizationId,
      provider: "google",
      accountEmail: input.tokens.email,
      calendarId: "primary",
      calendarName: null,
      timezone: DEFAULT_RULES.timezone,
      refreshTokenCipher: refresh.cipher,
      refreshTokenIv: refresh.iv,
      refreshTokenTag: refresh.tag,
      accessTokenCipher: access.cipher,
      accessTokenIv: access.iv,
      accessTokenTag: access.tag,
      accessTokenExpiresAt: input.tokens.expiresAt,
      status: "connected",
      agentBookingEnabled: DEFAULT_RULES.agentBookingEnabled,
      slotMinutes: DEFAULT_RULES.slotMinutes,
      bufferMinutes: DEFAULT_RULES.bufferMinutes,
      minLeadHours: DEFAULT_RULES.minLeadHours,
      horizonDays: DEFAULT_RULES.horizonDays,
      weeklyHours: DEFAULT_RULES.weeklyHours,
      bookingInstructions: null,
      connectedBy: input.userId,
    })
    .onConflictDoUpdate({
      target: [schema.calendarIntegration.organizationId],
      set: {
        accountEmail: input.tokens.email,
        refreshTokenCipher: refresh.cipher,
        refreshTokenIv: refresh.iv,
        refreshTokenTag: refresh.tag,
        accessTokenCipher: access.cipher,
        accessTokenIv: access.iv,
        accessTokenTag: access.tag,
        accessTokenExpiresAt: input.tokens.expiresAt,
        status: "connected",
        connectedBy: input.userId,
        updatedAt: new Date(),
      },
    });
}

/** Actualiza reglas / calendario (PUT parcial). */
export async function updateCalendarIntegration(
  organizationId: string,
  patch: Partial<CalendarRules> & { calendarId?: string; calendarName?: string | null }
): Promise<boolean> {
  const db = getDb();
  const set: Partial<typeof schema.calendarIntegration.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (patch.timezone !== undefined) set.timezone = patch.timezone;
  if (patch.agentBookingEnabled !== undefined) set.agentBookingEnabled = patch.agentBookingEnabled;
  if (patch.slotMinutes !== undefined) set.slotMinutes = patch.slotMinutes;
  if (patch.bufferMinutes !== undefined) set.bufferMinutes = patch.bufferMinutes;
  if (patch.minLeadHours !== undefined) set.minLeadHours = patch.minLeadHours;
  if (patch.horizonDays !== undefined) set.horizonDays = patch.horizonDays;
  if (patch.weeklyHours !== undefined) set.weeklyHours = normalizeWeeklyHours(patch.weeklyHours);
  if (patch.bookingInstructions !== undefined) set.bookingInstructions = patch.bookingInstructions;
  if (patch.calendarId !== undefined) set.calendarId = patch.calendarId;
  if (patch.calendarName !== undefined) set.calendarName = patch.calendarName;
  const updated = await db
    .update(schema.calendarIntegration)
    .set(set)
    .where(scoped(schema.calendarIntegration.organizationId, organizationId))
    .returning({ id: schema.calendarIntegration.id });
  return updated.length > 0;
}

/** Desconecta: revoca en Google (best-effort) y borra la fila. Idempotente. */
export async function disconnectCalendarIntegration(
  organizationId: string
): Promise<void> {
  const row = await getRow(organizationId);
  if (!row) return;
  const refresh = decryptSecret({
    cipher: row.refreshTokenCipher,
    iv: row.refreshTokenIv,
    tag: row.refreshTokenTag,
  });
  await revokeToken(refresh);
  const db = getDb();
  await db
    .delete(schema.calendarIntegration)
    .where(scoped(schema.calendarIntegration.organizationId, organizationId));
}

export async function markReconnectRequired(organizationId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.calendarIntegration)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(scoped(schema.calendarIntegration.organizationId, organizationId));
}

/**
 * Access token vigente (research D9): usa la caché cifrada si faltan más
 * de 60 s; si no, renueva con el refresh token y persiste. `invalid_grant`
 * → la fila pasa a `reconnect_required` y se relanza (el llamador degrada).
 */
export async function ensureAccessToken(organizationId: string): Promise<string> {
  const row = await getRow(organizationId);
  if (!row) {
    throw new GoogleAuthError("not_configured", "La empresa no tiene Google Calendar conectado");
  }
  if (row.status === "reconnect_required") {
    throw new GoogleAuthError("invalid_grant", "La integración requiere reconexión");
  }
  const fresh =
    row.accessTokenCipher &&
    row.accessTokenIv &&
    row.accessTokenTag &&
    row.accessTokenExpiresAt &&
    row.accessTokenExpiresAt.getTime() - Date.now() > 60_000;
  if (fresh) {
    return decryptSecret({
      cipher: row.accessTokenCipher!,
      iv: row.accessTokenIv!,
      tag: row.accessTokenTag!,
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
    const db = getDb();
    await db
      .update(schema.calendarIntegration)
      .set({
        accessTokenCipher: enc.cipher,
        accessTokenIv: enc.iv,
        accessTokenTag: enc.tag,
        accessTokenExpiresAt: renewed.expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.calendarIntegration.id, row.id));
    return renewed.accessToken;
  } catch (err) {
    if (err instanceof GoogleAuthError && err.code === "invalid_grant") {
      await markReconnectRequired(organizationId);
    }
    throw err;
  }
}

/**
 * Ejecuta una llamada a la API con token vigente. Un 401 de la API (token
 * revocado entre medio) reintenta UNA vez con refresh forzado; si el refresh
 * falla por invalid_grant, la integración queda marcada (D9).
 */
export async function withAccessToken<T>(
  organizationId: string,
  fn: (accessToken: string) => Promise<T>
): Promise<T> {
  const token = await ensureAccessToken(organizationId);
  try {
    return await fn(token);
  } catch (err) {
    if (err instanceof GoogleApiError && err.code === "unauthorized") {
      await invalidateAccessToken(organizationId);
      const retry = await ensureAccessToken(organizationId);
      return await fn(retry);
    }
    throw err;
  }
}

async function invalidateAccessToken(organizationId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.calendarIntegration)
    .set({ accessTokenExpiresAt: null, updatedAt: new Date() })
    .where(scoped(schema.calendarIntegration.organizationId, organizationId));
}

export async function listCalendars(organizationId: string): Promise<CalendarSummary[]> {
  return withAccessToken(organizationId, (token) => apiListCalendars(token));
}
