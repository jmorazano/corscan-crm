import { getEnv } from "@/lib/env";

/**
 * Cliente REST de Google Calendar (research D4) — ÚNICA frontera con la API
 * (Constitución II, categoría 3). Solo los endpoints que el producto usa:
 * calendarList, freeBusy (SOLO ocupado/libre: FR-008 a nivel de API),
 * events.insert y events.delete. Los errores se tipan; el access token
 * solo viaja en el header y jamás se loguea.
 */

export class GoogleApiError extends Error {
  constructor(
    public readonly code: "unauthorized" | "not_found" | "provider_error",
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export type CalendarSummary = { id: string; summary: string; primary: boolean };
export type BusyInterval = { start: Date; end: Date };

async function request<T>(
  accessToken: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  timeoutMs = 15_000
): Promise<T> {
  const base = getEnv().GOOGLE_API_BASE_URL.replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (res.status === 204) return undefined as T;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const code =
        res.status === 401
          ? "unauthorized"
          : res.status === 404 || res.status === 410
            ? "not_found"
            : "provider_error";
      throw new GoogleApiError(
        code,
        res.status,
        `Google Calendar respondió ${res.status}: ${text.slice(0, 300)}`
      );
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof GoogleApiError) throw err;
    throw new GoogleApiError(
      "provider_error",
      0,
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calendarios de la cuenta con permiso de escritura, incluidos los que el
 * usuario ocultó de su lista (`showHidden`) y paginando (`pageToken`): un
 * calendario recién creado o escondido no debe faltar en el selector.
 */
export async function listCalendars(accessToken: string): Promise<CalendarSummary[]> {
  const out: CalendarSummary[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      minAccessRole: "writer",
      showHidden: "true",
      maxResults: "250",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const json = await request<{
      items?: { id?: string; summary?: string; summaryOverride?: string; primary?: boolean }[];
      nextPageToken?: string;
    }>(accessToken, "GET", `/calendar/v3/users/me/calendarList?${params.toString()}`);
    for (const c of json.items ?? []) {
      if (!c.id) continue;
      out.push({
        id: c.id,
        summary: c.summaryOverride ?? c.summary ?? c.id,
        primary: Boolean(c.primary),
      });
    }
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/** Intervalos ocupados del calendario en [timeMin, timeMax): nada más. */
export async function queryFreeBusy(
  accessToken: string,
  calendarId: string,
  timeMin: Date,
  timeMax: Date
): Promise<BusyInterval[]> {
  const json = await request<{
    calendars?: Record<
      string,
      { busy?: { start: string; end: string }[]; errors?: { reason?: string }[] }
    >;
  }>(accessToken, "POST", "/calendar/v3/freeBusy", {
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    items: [{ id: calendarId }],
  });
  const entry = json.calendars?.[calendarId] ?? Object.values(json.calendars ?? {})[0];
  if (entry?.errors?.length) {
    const reason = entry.errors[0]?.reason ?? "unknown";
    throw new GoogleApiError(
      reason === "notFound" ? "not_found" : "provider_error",
      200,
      `freeBusy: ${reason}`
    );
  }
  return (entry?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

export async function insertEvent(
  accessToken: string,
  calendarId: string,
  input: {
    summary: string;
    description?: string;
    start: Date;
    end: Date;
    timezone: string;
  }
): Promise<{ id: string }> {
  const json = await request<{ id?: string }>(
    accessToken,
    "POST",
    `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.start.toISOString(), timeZone: input.timezone },
      end: { dateTime: input.end.toISOString(), timeZone: input.timezone },
    }
  );
  if (!json.id) {
    throw new GoogleApiError("provider_error", 200, "events.insert sin id");
  }
  return { id: json.id };
}

/** Idempotente: un evento ya borrado (404/410) no es error. */
export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  try {
    await request<void>(
      accessToken,
      "DELETE",
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
    );
  } catch (err) {
    if (err instanceof GoogleApiError && err.code === "not_found") return;
    throw err;
  }
}
