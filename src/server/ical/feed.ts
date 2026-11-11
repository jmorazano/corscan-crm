import { createHash } from "node:crypto";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getEnv, isMockEnabled } from "@/lib/env";
import { checkAirbnbIcalUrl } from "@/lib/ical/airbnb-url";
import type { IcalSyncError } from "@/lib/ical/input";
import { parseIcal, type BusyRange } from "@/lib/ical/parse";
import { isMcpError } from "@/lib/mcp/errors";
import { getGuardedText } from "@/lib/mcp/transport";

/**
 * Lectura de UN feed iCal (051). Única función de este módulo que sale a la
 * red, siempre por el GET protegido de 016. La URL (con su llave) se usa y se
 * suelta: nunca se loguea ni vuelve en un error.
 */

export const USER_AGENT = "VoceroCRM-CalendarSync/1.0";
export const FEED_TIMEOUT_MS = 10_000;
export const FEED_MAX_BYTES = 256 * 1024;
export const DEFAULT_TZ = "America/Argentina/Cordoba";

export type FeedResult =
  | { ok: true; busy: BusyRange[]; horizonTo: string | null; hash: string }
  | { ok: false; code: IcalSyncError };

/** Origen del ical-mock (solo con el gate de mocks del self-test). */
export function mockOrigin(): string | null {
  if (!isMockEnabled()) return null;
  try {
    return new URL(getEnv().APP_BASE_URL).origin;
  } catch {
    return null;
  }
}

/** Zona de la empresa: la misma del reloj del agente. */
export async function organizationTimezone(organizationId: string): Promise<string> {
  const rows = await getDb()
    .select({ tz: schema.agentProfile.followUpTimezone })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  return rows[0]?.tz || DEFAULT_TZ;
}

export function busyHash(busy: readonly BusyRange[]): string {
  return createHash("sha256").update(JSON.stringify(busy)).digest("hex").slice(0, 32);
}

export async function fetchFeed(rawUrl: string, tz: string): Promise<FeedResult> {
  // Cinturón: la allowlist se revalida en CADA lectura, no solo al guardar.
  const check = checkAirbnbIcalUrl(rawUrl, { mockOrigin: mockOrigin() });
  if (!check.ok) return { ok: false, code: "blocked_host" };
  let text: string;
  try {
    const res = await getGuardedText({
      endpointUrl: check.url,
      headers: { "user-agent": USER_AGENT },
      accept: "text/calendar, text/plain;q=0.5",
      allowedContentTypes: ["text/calendar", "text/plain", "application/octet-stream"],
      timeoutMs: FEED_TIMEOUT_MS,
      maxResponseBytes: FEED_MAX_BYTES,
      sandbox: false,
    });
    text = res.text;
  } catch (err) {
    return { ok: false, code: classify(err) };
  }
  const parsed = parseIcal(text, { tz });
  if (!parsed.ok) return { ok: false, code: "invalid" };
  return { ok: true, busy: parsed.busy, horizonTo: parsed.horizonTo, hash: busyHash(parsed.busy) };
}

function classify(err: unknown): IcalSyncError {
  if (!isMcpError(err)) return "unreachable";
  const status = err.httpStatus ?? 0;
  if (status === 404 || status === 410) return "link_revoked";
  if (status === 401 || status === 403 || status === 429) return "blocked";
  switch (err.code) {
    case "blocked_host":
    case "invalid_url":
      return "blocked_host";
    case "bad_content_type":
    case "too_large":
    case "bad_payload":
    case "unexpected_redirect":
      return "invalid";
    default:
      return "unreachable";
  }
}
