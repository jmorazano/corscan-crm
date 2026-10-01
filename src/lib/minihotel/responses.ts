import { expandCompactDate } from "./dates";
import {
  attr,
  childElements,
  childText,
  findAll,
  findFirst,
  firstChild,
  parseXml,
  textOf,
  type XmlNode,
} from "./xml";

/**
 * Lectura de las respuestas de MiniHotel (028). PURO.
 *
 * Verificado contra el sandbox SIN credenciales (1-oct-2026):
 * - la API ARI (`/gds`) contesta los errores como TEXTO PLANO
 *   `ERR 863: Wrong User Code (Gds Central)`, con HTTP 200 y
 *   `content-type: text/html`;
 * - la API de contenido contesta `text/xml` con
 *   `<Errors><Error code="013" description="Invalid XML Request." /></Errors>`.
 *
 * Nada de lo que devuelve el proveedor sale de acá como texto nuestro: los
 * errores se reducen a un CÓDIGO ESTABLE propio (`auth`, `hotel`…) y los
 * nombres siguen siendo dato que el perfil sanea antes de mostrar.
 */

/* ============================================================
 * Errores del proveedor
 * ============================================================ */

/**
 * Códigos estables que entiende el resto del sistema. Los tres primeros son
 * de CONFIGURACIÓN (el modelo no puede corregirlos: la integración necesita
 * atención); el resto son de la CONSULTA y le sirven al modelo para
 * corregirse en la vuelta siguiente.
 */
export type MiniHotelErrorCode =
  | "auth"
  | "hotel"
  | "ip_not_authorized"
  | "past_date"
  | "too_many_nights"
  | "invalid_dates"
  | "rate_code"
  | "hotel_settings"
  | "invalid_request"
  | "provider_error";

export const CONFIG_ERROR_CODES: ReadonlySet<MiniHotelErrorCode> = new Set([
  "auth",
  "hotel",
  "ip_not_authorized",
]);

/** Lista de códigos documentada (`/reference/error-codes`) → código estable. */
const ARI_ERRORS: Record<string, MiniHotelErrorCode> = {
  "001": "invalid_request",
  "002": "auth",
  "009": "hotel",
  "101": "invalid_dates",
  "102": "invalid_dates",
  "103": "invalid_dates",
  "106": "past_date",
  "107": "too_many_nights",
  "108": "invalid_dates",
  "202": "hotel",
  "204": "hotel",
  "205": "hotel",
  "206": "hotel",
  "210": "auth",
  "211": "hotel",
  "301": "invalid_dates",
  "302": "invalid_request",
  "303": "hotel_settings",
  "304": "invalid_dates",
  "305": "invalid_dates",
  "307": "invalid_dates",
  "308": "rate_code",
  "309": "rate_code",
  "310": "hotel_settings",
  "516": "invalid_request",
  "599": "hotel_settings",
  "803": "rate_code",
  "863": "auth",
  A01: "ip_not_authorized",
};

export type MiniHotelProviderError = {
  code: MiniHotelErrorCode;
  /** Código crudo del proveedor (`863`, `A01`, `013`), saneado. */
  raw: string;
};

const ARI_ERROR_RE = /^\s*ERR\s*([A-Za-z0-9]{1,5})\b/;

/** `ERR 863: …` → `{code:"auth", raw:"863"}`. `null` si no es un error. */
export function detectAriError(body: string): MiniHotelProviderError | null {
  const m = ARI_ERROR_RE.exec(body);
  if (!m) return null;
  const raw = (m[1] ?? "").toUpperCase();
  return { code: ARI_ERRORS[raw] ?? "provider_error", raw };
}

/**
 * `<Errors><Error code description/></Errors>` de la API de contenido. La
 * documentación no lista estos códigos: se clasifica por la descripción, que
 * SOLO se usa para decidir el código (jamás se muestra ni se guarda).
 */
export function detectContentError(doc: XmlNode): MiniHotelProviderError | null {
  const errors = findFirst(doc, "Errors");
  const first = firstChild(errors, "Error") ?? findFirst(errors, "Error");
  if (!first) return null;
  const raw = (attr(first, "code") ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "?";
  const description = (attr(first, "description") ?? textOf(first) ?? "").toLowerCase();
  let code: MiniHotelErrorCode = "provider_error";
  if (/\bip\b|address is not authori[sz]ed/.test(description)) code = "ip_not_authorized";
  else if (/user|password|login|authenti|credential/.test(description)) code = "auth";
  else if (/hotel/.test(description)) code = "hotel";
  else if (/invalid xml|xml request/.test(description)) code = "invalid_request";
  return { code, raw };
}

/* ============================================================
 * Números
 * ============================================================ */

function num(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number(raw.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function int(raw: string | null): number | null {
  const n = num(raw);
  return n === null ? null : Math.trunc(n);
}

function yes(raw: string | null): boolean {
  return raw !== null && /^(yes|y|true|1)$/i.test(raw);
}

/** Atributo de mínimo de noches, venga con el nombre que venga. */
function minNightsOf(node: XmlNode | null): number | null {
  if (!node) return null;
  for (const [key, value] of Object.entries(node.attrs)) {
    if (/^(min(imum)?_?nights?|minngt|minstay|min_stay)$/i.test(key)) {
      const n = int(value);
      if (n !== null && n > 0) return n;
    }
  }
  return null;
}

/* ============================================================
 * Immediate ARI
 * ============================================================ */

export type ImmediateBoard = {
  /** Código del régimen (`BB`, `HB`, `RO`…). */
  board: string;
  /** Descripción del proveedor (dato, se sanea al mostrar). */
  label: string | null;
  /** Total de la estadía con esta tarifa. */
  value: number | null;
  /** Total con la tarifa NO reembolsable. */
  valueNrf: number | null;
};

export type ImmediateRoom = {
  code: string;
  /** Nombre local (`Name_h`) o en inglés (`Name_e`). */
  name: string | null;
  /** Unidades libres para esa estadía (`Inventory Allocation`). */
  available: number | null;
  boards: ImmediateBoard[];
  minNights: number | null;
};

export type ImmediateResult = {
  hotelName: string | null;
  currency: string | null;
  rooms: ImmediateRoom[];
};

export function parseImmediate(doc: XmlNode): ImmediateResult | null {
  const root = findFirst(doc, "AvailRaters");
  if (!root) return null;
  const hotel = firstChild(root, "Hotel");
  const rooms: ImmediateRoom[] = [];
  for (const rt of childElements(root, "RoomType")) {
    const code = attr(rt, "id");
    if (!code) continue;
    const inventory = firstChild(rt, "Inventory");
    const boards: ImmediateBoard[] = childElements(rt, "price")
      .map((p) => ({
        board: attr(p, "board") ?? "",
        label: attr(p, "boardDesc"),
        value: num(attr(p, "value")),
        valueNrf: num(attr(p, "value_nrf")),
      }))
      .filter((b) => b.board !== "");
    rooms.push({
      code,
      name: attr(rt, "Name_h") ?? attr(rt, "Name_e"),
      available: int(attr(inventory, "Allocation")),
      boards,
      minNights: minNightsOf(rt) ?? minNightsOf(inventory) ?? minNightsOf(hotel),
    });
  }
  return {
    hotelName: attr(hotel, "Name_h") ?? attr(hotel, "Name_e"),
    currency: attr(hotel, "Currency"),
    rooms,
  };
}

/** ¿Este tipo se puede ofrecer? Unidades libres y al menos un precio. */
export function isRoomAvailable(room: ImmediateRoom): boolean {
  return (room.available ?? 0) > 0 && room.boards.some((b) => b.value !== null && b.value > 0);
}

/* ============================================================
 * Bulk ARI (`ResponseType="05"`)
 * ============================================================ */

export type BulkDay = {
  /** "YYYY-MM-DD" */
  date: string;
  available: number;
  price: number | null;
  minNights: number | null;
  closed: boolean;
  closedArrival: boolean;
  closedDeparture: boolean;
};

export type BulkRoom = {
  code: string;
  name: string | null;
  basicOccupancy: number | null;
  days: BulkDay[];
};

export function parseBulk(doc: XmlNode): { currency: string | null; rooms: BulkRoom[] } | null {
  const root = findFirst(doc, "AvailRaters");
  if (!root) return null;
  const container = firstChild(root, "RoomTypes") ?? root;
  const rooms: BulkRoom[] = [];
  for (const rt of childElements(container, "RoomType")) {
    const code = attr(rt, "id");
    if (!code) continue;
    const days: BulkDay[] = [];
    for (const day of childElements(rt, "Day")) {
      const date = expandCompactDate(attr(day, "Mdate"));
      if (!date) continue;
      const minNights = int(attr(day, "Minngt"));
      days.push({
        date,
        available: int(attr(day, "Mavailability")) ?? 0,
        price: num(attr(day, "Mprice")),
        minNights: minNights !== null && minNights > 0 ? minNights : null,
        closed: yes(attr(day, "Mclose")),
        closedArrival: yes(attr(day, "McloseArr")),
        closedDeparture: yes(attr(day, "McloseDep")),
      });
    }
    days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    rooms.push({
      code,
      name: attr(rt, "RoomName"),
      basicOccupancy: int(attr(rt, "BasicOccupancy")),
      days,
    });
  }
  return { currency: attr(firstChild(root, "Hotel"), "Currency"), rooms };
}

/* ============================================================
 * API de contenido: getRoomTypes / getRooms
 * ============================================================ */

export type RoomTypeInfo = {
  code: string;
  description: string | null;
  image: string | null;
};

export function parseRoomTypes(doc: XmlNode): RoomTypeInfo[] | null {
  const array = findFirst(doc, "ArrayOfRoomTypes");
  if (!array) return null;
  const out: RoomTypeInfo[] = [];
  for (const item of childElements(array, "RoomTypes")) {
    const code = childText(item, "Type");
    if (!code) continue;
    out.push({
      code,
      description: childText(item, "Description"),
      image: childText(item, "Image"),
    });
  }
  return out;
}

export type RoomAttribute = { code: string | null; description: string };

export type RoomInfo = {
  number: string | null;
  type: string | null;
  /** `is_mapped`: el tipo está asignado al usuario que consulta. */
  mapped: boolean | null;
  maxAdults: number | null;
  maxChildren: number | null;
  maxBabies: number | null;
  attributes: RoomAttribute[];
};

export function parseRooms(doc: XmlNode): RoomInfo[] | null {
  const array = findFirst(doc, "ArrayOfRnm_struct_room");
  if (!array) return null;
  const out: RoomInfo[] = [];
  for (const room of findAll(array, "rnm_struct_room")) {
    // La documentación trae un ejemplo con la etiqueta de apertura repetida:
    // un `rnm_struct_room` sin `rm_type` propio es ese envoltorio, no una
    // habitación.
    const type = childText(room, "rm_type");
    if (!type) continue;
    const mappedRaw = attr(room, "is_mapped");
    let maxAdults: number | null = null;
    let maxChildren: number | null = null;
    let maxBabies: number | null = null;
    for (const limit of findAll(firstChild(room, "ArrayOfRec_rooms_gst_max"), "rec_rooms_gst_max")) {
      const kind = (childText(limit, "rgm_gst_type") ?? "").toUpperCase();
      const max = int(childText(limit, "rgm_max"));
      if (kind === "A") maxAdults = max;
      else if (kind === "C") maxChildren = max;
      else if (kind === "B") maxBabies = max;
    }
    const attributes: RoomAttribute[] = [];
    for (const a of findAll(firstChild(room, "ArrayOfRnm_struct_room_attributes"), "rnm_attribute")) {
      const description = attr(a, "description") ?? textOf(a);
      if (description) attributes.push({ code: attr(a, "code"), description });
    }
    out.push({
      number: childText(room, "rm_number"),
      type,
      mapped: mappedRaw === null ? null : yes(mappedRaw),
      maxAdults,
      maxChildren,
      maxBabies,
      attributes,
    });
  }
  return out;
}

/* ============================================================
 * Entrada única: texto crudo → documento o error
 * ============================================================ */

export type ParsedBody =
  | { kind: "xml"; doc: XmlNode }
  | { kind: "error"; error: MiniHotelProviderError }
  | { kind: "unreadable" };

/**
 * Lo primero que se hace con una respuesta: ¿es un `ERR …` de texto plano,
 * un XML con `<Errors>`, un XML legible o basura? Nunca lanza.
 */
export function readBody(body: string): ParsedBody {
  const trimmed = body.trim();
  if (trimmed === "") return { kind: "unreadable" };
  if (!trimmed.startsWith("<")) {
    const err = detectAriError(trimmed);
    return err ? { kind: "error", error: err } : { kind: "unreadable" };
  }
  let doc: XmlNode;
  try {
    doc = parseXml(trimmed);
  } catch {
    return { kind: "unreadable" };
  }
  const contentError = detectContentError(doc);
  if (contentError) return { kind: "error", error: contentError };
  return { kind: "xml", doc };
}
