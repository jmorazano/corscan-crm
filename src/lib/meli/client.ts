import { getEnv } from "@/lib/env";

/**
 * Cliente REST de Mercado Libre (025) — la única frontera con
 * `api.mercadolibre.com` fuera del OAuth. Solo LECTURA: el conector no
 * publica, no edita y no responde preguntas.
 *
 * Endpoints (documentación de ML, verificada el 26-sep-2026):
 * - `GET /users/me` → id, apodo y sitio de la cuenta.
 * - `GET /users/{id}/items/search?status=active` → ids de las publicaciones
 *   activas (50 por página, offset hasta 1000).
 * - `GET /items/bulk?ids=…` (hasta 20 ids) → detalle. Reemplaza a
 *   `/items?ids=` desde el 25-oct-2026; durante la convivencia, si el bulk
 *   devuelve 404 se cae al viejo. Cada elemento trae `status_code` (antes
 *   `code`) y `body`.
 * - `GET /items/{id}/description` → `plain_text`.
 *
 * El token SIEMPRE va por header (ML lo exige). Nada de acá loguea tokens ni
 * cuerpos de respuesta.
 */

export type MeliApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "not_found"
  | "timeout"
  | "provider_error";

export class MeliApiError extends Error {
  constructor(
    public readonly code: MeliApiErrorCode,
    message: string,
    public readonly status: number | null = null
  ) {
    super(message);
    this.name = "MeliApiError";
  }
}

/** Atributo de una publicación tal como lo devuelve ML (subconjunto). */
export type MeliRawAttribute = {
  id?: string;
  name?: string;
  value_id?: string | null;
  value_name?: string | null;
  values?: { id?: string | null; name?: string | null; struct?: { number?: number; unit?: string } | null }[];
  value_type?: string;
};

type MeliRawPlace = { id?: string; name?: string } | null | undefined;

/** Publicación tal como la devuelve ML (solo los campos que usamos). */
export type MeliRawItem = {
  id?: string;
  site_id?: string;
  title?: string;
  category_id?: string;
  price?: number | null;
  currency_id?: string | null;
  status?: string;
  permalink?: string;
  thumbnail?: string;
  secure_thumbnail?: string;
  pictures?: { secure_url?: string; url?: string }[];
  last_updated?: string;
  location?: {
    address_line?: string;
    neighborhood?: MeliRawPlace;
    city?: MeliRawPlace;
    state?: MeliRawPlace;
  } | null;
  seller_address?: {
    city?: MeliRawPlace;
    state?: MeliRawPlace;
    search_location?: { neighborhood?: MeliRawPlace; city?: MeliRawPlace; state?: MeliRawPlace } | null;
  } | null;
  attributes?: MeliRawAttribute[];
};

const DEFAULT_TIMEOUT_MS = 15_000;
/** Máximo que devuelve `items/search` por página. */
const PAGE_SIZE = 50;
/** `items/search` no pagina más allá de offset 1000 (luego pide `scan`). */
export const MAX_ITEMS = 1000;
/** Tope de ids por pedido de detalle. */
export const BULK_SIZE = 20;

function base(): string {
  return getEnv().MELI_API_BASE_URL.replace(/\/$/, "");
}

async function getJson<T>(path: string, token: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new MeliApiError("timeout", "Mercado Libre no respondió a tiempo");
    }
    throw new MeliApiError("provider_error", "No se pudo contactar a Mercado Libre");
  }
  if (res.ok) {
    return (await res.json().catch(() => {
      throw new MeliApiError("provider_error", "Respuesta ilegible de Mercado Libre", res.status);
    })) as T;
  }
  throw errorFor(res.status);
}

function errorFor(status: number): MeliApiError {
  if (status === 401) return new MeliApiError("unauthorized", "Token de Mercado Libre inválido o vencido", status);
  if (status === 403) return new MeliApiError("forbidden", "Mercado Libre denegó el acceso", status);
  if (status === 404) return new MeliApiError("not_found", "No encontrado en Mercado Libre", status);
  if (status === 429) return new MeliApiError("rate_limited", "Mercado Libre limitó los pedidos", status);
  return new MeliApiError("provider_error", `Mercado Libre respondió ${status}`, status);
}

export type MeliUser = { id: string; nickname: string | null; siteId: string };

export async function getMe(token: string): Promise<MeliUser> {
  const me = await getJson<{ id?: number | string; nickname?: string; site_id?: string }>(
    "/users/me",
    token
  );
  if (me.id === undefined || me.id === null) {
    throw new MeliApiError("provider_error", "Mercado Libre no devolvió el id de la cuenta");
  }
  return {
    id: String(me.id),
    nickname: typeof me.nickname === "string" ? me.nickname : null,
    siteId: typeof me.site_id === "string" && /^[A-Z]{3}$/.test(me.site_id) ? me.site_id : "MLA",
  };
}

/**
 * Ids de TODAS las publicaciones activas de la cuenta (hasta `MAX_ITEMS`).
 * `truncated` avisa si la cuenta tiene más de las que se pueden paginar.
 */
export async function listActiveItemIds(
  token: string,
  userId: string
): Promise<{ ids: string[]; total: number; truncated: boolean }> {
  const ids: string[] = [];
  let total = 0;
  for (let offset = 0; offset < MAX_ITEMS; offset += PAGE_SIZE) {
    const page = await getJson<{ results?: unknown[]; paging?: { total?: number } }>(
      `/users/${encodeURIComponent(userId)}/items/search?status=active&limit=${PAGE_SIZE}&offset=${offset}`,
      token
    );
    total = typeof page.paging?.total === "number" ? page.paging.total : total;
    const batch = (page.results ?? []).filter((r): r is string => typeof r === "string");
    ids.push(...batch);
    if (batch.length < PAGE_SIZE || ids.length >= total) break;
  }
  const unique = [...new Set(ids)];
  return { ids: unique, total: Math.max(total, unique.length), truncated: total > MAX_ITEMS };
}

type BulkEntry = { id?: string; status_code?: number; code?: number; body?: MeliRawItem };

/**
 * Detalle de publicaciones en tandas de 20. Las que ML no devuelve con 200
 * se omiten (borradas entre el search y el detalle): la sync sigue.
 */
export async function getItems(token: string, ids: readonly string[]): Promise<MeliRawItem[]> {
  const out: MeliRawItem[] = [];
  let useLegacy = false;
  for (let i = 0; i < ids.length; i += BULK_SIZE) {
    const chunk = ids.slice(i, i + BULK_SIZE).map(encodeURIComponent).join(",");
    let entries: BulkEntry[];
    if (!useLegacy) {
      try {
        entries = await getJson<BulkEntry[]>(`/items/bulk?ids=${chunk}`, token);
      } catch (err) {
        // Convivencia: si el endpoint nuevo todavía no existe para esta
        // cuenta, el viejo sigue vivo hasta el 25-oct-2026.
        if (!(err instanceof MeliApiError) || err.code !== "not_found") throw err;
        useLegacy = true;
        entries = await getJson<BulkEntry[]>(`/items?ids=${chunk}`, token);
      }
    } else {
      entries = await getJson<BulkEntry[]>(`/items?ids=${chunk}`, token);
    }
    for (const e of Array.isArray(entries) ? entries : []) {
      const status = e.status_code ?? e.code ?? 200;
      if (status === 200 && e.body && typeof e.body === "object") out.push(e.body);
    }
  }
  return out;
}

/** Descripción en texto plano; `null` si la publicación no tiene. */
export async function getDescription(token: string, itemId: string): Promise<string | null> {
  try {
    const d = await getJson<{ plain_text?: string; text?: string }>(
      `/items/${encodeURIComponent(itemId)}/description`,
      token
    );
    const text = typeof d.plain_text === "string" && d.plain_text.trim() ? d.plain_text : d.text;
    return typeof text === "string" && text.trim() ? text : null;
  } catch (err) {
    if (err instanceof MeliApiError && err.code === "not_found") return null;
    throw err;
  }
}

/**
 * Revoca el permiso de la app sobre la cuenta. Best-effort: desconectar en
 * el CRM no puede fallar porque ML no responda.
 */
export async function revokeGrant(token: string, userId: string): Promise<void> {
  const appId = getEnv().MELI_CLIENT_ID;
  if (!appId) return;
  try {
    await fetch(
      `${base()}/users/${encodeURIComponent(userId)}/applications/${encodeURIComponent(appId)}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      }
    );
  } catch {
    // ignorado a propósito
  }
}
