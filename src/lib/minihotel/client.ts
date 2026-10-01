import {
  McpError,
  postGuardedText,
  type McpRequestFn,
  type McpToolUnwrap,
} from "@/lib/mcp";
import {
  ALTERNATIVE_SPREAD_DAYS,
  MAX_ALTERNATIVES,
  bulkRangeFor,
  findAlternativeWindows,
  type StayWindow,
} from "./alternatives";
import { isIsoDate, nightsBetween } from "./dates";
import { contentUrlFor } from "./endpoints";
import {
  buildBulkAriRequest,
  buildContentRequest,
  buildImmediateAriRequest,
  type ContentOperation,
  type MiniHotelAuth,
} from "./requests";
import {
  CONFIG_ERROR_CODES,
  isRoomAvailable,
  parseBulk,
  parseImmediate,
  parseRoomTypes,
  parseRooms,
  readBody,
  type ImmediateRoom,
  type MiniHotelErrorCode,
  type MiniHotelProviderError,
  type ParsedBody,
  type RoomInfo,
  type RoomTypeInfo,
} from "./responses";

/**
 * Cliente de MiniHotel (028) — la ÚNICA pieza con I/O del adaptador.
 *
 * Expone dos herramientas VIRTUALES, que son las únicas que el perfil puede
 * pedir (allowlist) y las únicas cuatro operaciones de lectura que existen
 * acá (Constitución II, cat. 5, letra f):
 *
 * - `availability`: 1 a 3 rangos con *Immediate ARI* en paralelo. Con UN
 *   rango sin lugar, busca alternativas: *Bulk ARI* ±7 días → ventanas
 *   candidatas (`alternatives.ts`) → *Immediate ARI* para confirmar cada una.
 * - `room_catalog`: `getRoomTypes` + `getRooms` en paralelo.
 *
 * Todas las subconsultas comparten UN deadline (`timeoutMs` de la llamada):
 * el turno del agente nunca espera más que eso. Nada de acá loguea: el
 * cuerpo XML lleva la credencial.
 *
 * Errores:
 * - de CONFIGURACIÓN (`auth`, `hotel`, `ip_not_authorized`) → lanza
 *   `McpError("unauthorized", {providerCode})`: la integración necesita
 *   atención y `calls.ts` la pasa a «Requiere reconexión» con el motivo;
 * - de la CONSULTA (fechas, tarifa…) → `{ok:false, code}`: el perfil arma el
 *   texto que le permite al modelo corregirse;
 * - ilegibles → `McpError("bad_payload")`.
 */

export const MINIHOTEL_TOOL_AVAILABILITY = "availability";
export const MINIHOTEL_TOOL_ROOM_CATALOG = "room_catalog";
export const MINIHOTEL_TOOLS = [MINIHOTEL_TOOL_AVAILABILITY, MINIHOTEL_TOOL_ROOM_CATALOG] as const;

/** Verificado 1-oct-2026: `/gds` responde `text/html`, incluso los errores. */
const ACCEPTED_TYPES = ["text/xml", "application/xml", "text/html", "text/plain"] as const;
const REQUEST_CONTENT_TYPE = "text/xml; charset=utf-8";
const REQUEST_ACCEPT = "text/xml, application/xml, text/html;q=0.9, text/plain;q=0.8";
/** Por debajo de esto no se abre otro socket: se devuelve lo que haya. */
const MIN_REMAINING_MS = 300;
export const MAX_RANGES = 3;
export const MAX_NIGHTS = 30;

export type MiniHotelClientConfig = {
  /** Dirección ARI (`…/gds`) que fijó el super admin. */
  ariEndpoint: string;
  username: string;
  password: string;
  hotelId: string;
  rateCode: string;
  /** Deadline TOTAL de la herramienta (todas las subconsultas). */
  timeoutMs: number;
  maxResponseBytes: number;
  /** "YYYY-MM-DD" de hoy en la zona de la empresa: no se busca en el pasado. */
  today: string;
  /** D4: `true` ⇒ excepción antes de cualquier I/O (fusible). */
  sandbox: boolean;
  request?: McpRequestFn;
  now?: () => number;
};

export type MiniHotelToolResult = {
  outcome: McpToolUnwrap;
  /** Nunca el XML: la bitácora no guarda bytes del proveedor. */
  raw: null;
  httpStatus: number;
  bytes: number;
};

/* ============================================================
 * Payloads (lo que lee el perfil)
 * ============================================================ */

export type RangeResult = {
  from: string;
  to: string;
  nights: number;
  /** Error de la consulta para ESTE rango (los de configuración lanzan). */
  error: MiniHotelErrorCode | null;
  rooms: ImmediateRoom[];
};

export type AvailabilityPayload = {
  hotel: { name: string | null; currency: string | null };
  guests: { adults: number; children: number; babies: number };
  ranges: RangeResult[];
  /** `null` si no correspondía buscar (varios rangos, o hubo lugar). */
  alternatives: {
    searched: boolean;
    windows: RangeResult[];
    spreadDays: number;
  } | null;
};

export type RoomCatalogPayload = {
  roomTypes: RoomTypeInfo[];
  /** `null` si `getRooms` falló: el catálogo igual sirve con los tipos. */
  rooms: RoomInfo[] | null;
};

/* ============================================================
 * Argumentos (el perfil ya los validó; acá se re-chequea la forma)
 * ============================================================ */

type AvailabilityArgs = {
  ranges: StayWindow[];
  adults: number;
  children: number;
  babies: number;
  roomType: string | null;
  alternatives: boolean;
};

function readAvailabilityArgs(args: Record<string, unknown>): AvailabilityArgs | null {
  const rawRanges = Array.isArray(args.ranges) ? args.ranges : [];
  const ranges: StayWindow[] = [];
  for (const r of rawRanges.slice(0, MAX_RANGES)) {
    if (typeof r !== "object" || r === null) return null;
    const { from, to } = r as Record<string, unknown>;
    if (!isIsoDate(from) || !isIsoDate(to)) return null;
    const nights = nightsBetween(from, to);
    if (nights < 1 || nights > MAX_NIGHTS) return null;
    ranges.push({ from, to });
  }
  const int = (v: unknown, min: number, max: number): number | null =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;
  const adults = int(args.adults, 1, 50);
  const children = int(args.children ?? 0, 0, 50);
  const babies = int(args.babies ?? 0, 0, 20);
  if (ranges.length === 0 || adults === null || children === null || babies === null) return null;
  const roomType =
    typeof args.room_type === "string" && /^[\w.-]{1,32}$/.test(args.room_type)
      ? args.room_type
      : null;
  return {
    ranges,
    adults,
    children,
    babies,
    roomType,
    alternatives: args.alternatives === true && ranges.length === 1,
  };
}

/* ============================================================
 * Una subconsulta
 * ============================================================ */

type Stats = { bytes: number; httpStatus: number };

async function post(
  cfg: MiniHotelClientConfig,
  url: string,
  xml: string,
  deadline: number,
  stats: Stats
): Promise<ParsedBody> {
  const now = cfg.now ?? Date.now;
  const remaining = deadline - now();
  if (remaining < MIN_REMAINING_MS) throw new McpError("timeout");
  const res = await postGuardedText({
    endpointUrl: url,
    body: xml,
    contentType: REQUEST_CONTENT_TYPE,
    accept: REQUEST_ACCEPT,
    allowedContentTypes: ACCEPTED_TYPES,
    timeoutMs: remaining,
    maxResponseBytes: cfg.maxResponseBytes,
    sandbox: cfg.sandbox,
    ...(cfg.request ? { request: cfg.request } : {}),
  });
  stats.bytes += res.bytes;
  stats.httpStatus = res.httpStatus;
  return readBody(res.text);
}

/** Error de configuración ⇒ lanza; de la consulta ⇒ lo devuelve. */
function triage(error: MiniHotelProviderError, stats: Stats): MiniHotelErrorCode {
  if (CONFIG_ERROR_CODES.has(error.code)) {
    throw new McpError("unauthorized", {
      providerCode: error.code,
      httpStatus: stats.httpStatus,
    });
  }
  return error.code;
}

function auth(cfg: MiniHotelClientConfig): MiniHotelAuth {
  return { username: cfg.username, password: cfg.password, hotelId: cfg.hotelId };
}

async function immediate(
  cfg: MiniHotelClientConfig,
  window: StayWindow,
  q: Omit<AvailabilityArgs, "ranges" | "alternatives">,
  deadline: number,
  stats: Stats
): Promise<{ result: RangeResult; hotelName: string | null; currency: string | null }> {
  const nights = nightsBetween(window.from, window.to);
  const body = await post(
    cfg,
    cfg.ariEndpoint,
    buildImmediateAriRequest(auth(cfg), {
      from: window.from,
      to: window.to,
      adults: q.adults,
      children: q.children,
      babies: q.babies,
      rateCode: cfg.rateCode,
      roomType: q.roomType,
    }),
    deadline,
    stats
  );
  if (body.kind === "error") {
    const code = triage(body.error, stats);
    return {
      result: { from: window.from, to: window.to, nights, error: code, rooms: [] },
      hotelName: null,
      currency: null,
    };
  }
  if (body.kind === "unreadable") throw new McpError("bad_payload", { httpStatus: stats.httpStatus });
  const parsed = parseImmediate(body.doc);
  if (!parsed) throw new McpError("bad_payload", { httpStatus: stats.httpStatus });
  return {
    result: { from: window.from, to: window.to, nights, error: null, rooms: parsed.rooms },
    hotelName: parsed.hotelName,
    currency: parsed.currency,
  };
}

/* ============================================================
 * availability
 * ============================================================ */

async function availability(
  cfg: MiniHotelClientConfig,
  rawArgs: Record<string, unknown>,
  deadline: number,
  stats: Stats
): Promise<McpToolUnwrap> {
  const args = readAvailabilityArgs(rawArgs);
  if (!args) return { ok: false, code: "invalid_request", details: null };
  const query = {
    adults: args.adults,
    children: args.children,
    babies: args.babies,
    roomType: args.roomType,
  };

  const firsts = await Promise.all(
    args.ranges.map((r) => immediate(cfg, r, query, deadline, stats))
  );
  const ranges = firsts.map((f) => f.result);
  let hotelName = firsts.find((f) => f.hotelName)?.hotelName ?? null;
  let currency = firsts.find((f) => f.currency)?.currency ?? null;

  // Un solo rango y error de la consulta: es material para que el modelo se
  // corrija, no una respuesta con datos.
  const only = ranges[0];
  if (ranges.length === 1 && only && only.error) {
    return { ok: false, code: only.error, details: null };
  }

  let alternatives: AvailabilityPayload["alternatives"] = null;
  if (args.alternatives && only && !only.error && !only.rooms.some(isRoomAvailable)) {
    alternatives = { searched: false, windows: [], spreadDays: ALTERNATIVE_SPREAD_DAYS };
    try {
      // `null` = no se pudo buscar (Bulk caído o ilegible): NO es lo mismo
      // que "no hay alternativas", y el agente no puede afirmar lo segundo.
      const windows = await findAlternatives(cfg, only, args, deadline, stats);
      if (windows === null) throw new McpError("bad_payload");
      const confirmed = await Promise.all(
        windows.map((w) => immediate(cfg, w, query, deadline, stats))
      );
      for (const c of confirmed) {
        hotelName ??= c.hotelName;
        currency ??= c.currency;
      }
      alternatives = {
        searched: true,
        windows: confirmed
          .map((c) => c.result)
          .filter((r) => !r.error && r.rooms.some(isRoomAvailable)),
        spreadDays: ALTERNATIVE_SPREAD_DAYS,
      };
    } catch (err) {
      // La credencial rota sí sube; cualquier otra cosa (tiempo, basura) deja
      // la respuesta principal intacta: "no hay lugar" sigue siendo verdad.
      if (err instanceof McpError && err.code === "unauthorized") throw err;
    }
  }

  const payload: AvailabilityPayload = {
    hotel: { name: hotelName, currency },
    guests: { adults: args.adults, children: args.children, babies: args.babies },
    ranges,
    alternatives,
  };
  return { ok: true, data: payload };
}

async function findAlternatives(
  cfg: MiniHotelClientConfig,
  requested: RangeResult,
  args: AvailabilityArgs,
  deadline: number,
  stats: Stats
): Promise<StayWindow[] | null> {
  const nights = requested.nights;
  const range = bulkRangeFor(requested, nights, cfg.today);
  const body = await post(
    cfg,
    cfg.ariEndpoint,
    buildBulkAriRequest(auth(cfg), { from: range.from, to: range.to, rateCode: cfg.rateCode }),
    deadline,
    stats
  );
  if (body.kind === "error") {
    triage(body.error, stats);
    return null;
  }
  if (body.kind === "unreadable") return null;
  const bulk = parseBulk(body.doc);
  if (!bulk) return null;
  return findAlternativeWindows({
    rooms: bulk.rooms,
    requested,
    nights,
    today: cfg.today,
    max: MAX_ALTERNATIVES,
    roomCodes: args.roomType ? new Set([args.roomType]) : null,
  }).map(({ from, to }) => ({ from, to }));
}

/* ============================================================
 * room_catalog
 * ============================================================ */

async function content(
  cfg: MiniHotelClientConfig,
  op: ContentOperation,
  deadline: number,
  stats: Stats
): Promise<ParsedBody> {
  const url = contentUrlFor(cfg.ariEndpoint, op);
  if (!url) throw new McpError("invalid_url");
  return post(cfg, url, buildContentRequest(op, auth(cfg)), deadline, stats);
}

async function roomCatalog(
  cfg: MiniHotelClientConfig,
  deadline: number,
  stats: Stats
): Promise<McpToolUnwrap> {
  const [typesBody, roomsBody] = await Promise.all([
    content(cfg, "getRoomTypes", deadline, stats),
    // `getRooms` es un plus (capacidad y atributos): si falla, el catálogo
    // igual sirve con los tipos. Solo la credencial rota sube.
    content(cfg, "getRooms", deadline, stats).catch((err: unknown) => {
      if (err instanceof McpError && err.code === "unauthorized") throw err;
      return { kind: "unreadable" } as const;
    }),
  ]);

  if (typesBody.kind === "error") {
    return { ok: false, code: triage(typesBody.error, stats), details: null };
  }
  if (typesBody.kind === "unreadable") throw new McpError("bad_payload", { httpStatus: stats.httpStatus });
  const roomTypes = parseRoomTypes(typesBody.doc);
  if (!roomTypes) throw new McpError("bad_payload", { httpStatus: stats.httpStatus });

  let rooms: RoomInfo[] | null = null;
  if (roomsBody.kind === "error") triage(roomsBody.error, stats);
  else if (roomsBody.kind === "xml") rooms = parseRooms(roomsBody.doc);

  const payload: RoomCatalogPayload = { roomTypes, rooms };
  return { ok: true, data: payload };
}

/* ============================================================
 * Entrada única
 * ============================================================ */

export async function miniHotelCallTool(
  cfg: MiniHotelClientConfig,
  tool: string,
  args: Record<string, unknown>
): Promise<MiniHotelToolResult> {
  // Fusible antes de cualquier cálculo: el Laboratorio jamás llega acá
  // (el corte real vive en `callGuarded`), pero si una rama futura se olvida
  // de propagar el booleano, esto truena en vez de llamar al hotel.
  if (cfg.sandbox) throw new McpError("sandbox_violation");
  const now = cfg.now ?? Date.now;
  const deadline = now() + Math.max(1, cfg.timeoutMs);
  const stats: Stats = { bytes: 0, httpStatus: 0 };

  let outcome: McpToolUnwrap;
  if (tool === MINIHOTEL_TOOL_AVAILABILITY) {
    outcome = await availability(cfg, args, deadline, stats);
  } else if (tool === MINIHOTEL_TOOL_ROOM_CATALOG) {
    outcome = await roomCatalog(cfg, deadline, stats);
  } else {
    // La allowlist del perfil ya lo impide; esto es el segundo cinturón.
    throw new McpError("not_allowed");
  }
  return { outcome, raw: null, httpStatus: stats.httpStatus, bytes: stats.bytes };
}
