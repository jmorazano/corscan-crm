import {
  addDays,
  attr,
  escapeXml,
  findFirst,
  firstChild,
  isIsoDate,
  nightsBetween,
  type XmlNode,
} from "@/lib/minihotel";
import type { MiniHotelMockKnobs } from "./state";

/**
 * Motor del simulador de MiniHotel (028). Imita lo VERIFICADO del sandbox
 * real el 1-oct-2026 —errores de ARI como texto plano `ERR nnn: …` con
 * `text/html` y HTTP 200; la API de contenido con `<Errors>`— y lo
 * documentado del resto (formas de Immediate/Bulk/getRoomTypes/getRooms).
 *
 * El hotel de prueba tiene tres tipos con capacidades distintas para
 * ejercitar el filtro por grupo, y atributos que NO comparten todas las
 * habitaciones de un tipo (el «Balcón» de una sola doble no se promete).
 */

export const MOCK_HOTEL_ID = "sandbox";
export const MOCK_HOTEL_NAME = "Hotel de Prueba MiniHotel";
const RATE_CODES = new Set(["USD", "ARS", "STD"]);

type MockRoomType = {
  code: string;
  name: string;
  units: number;
  maxAdults: number;
  maxChildren: number;
  maxBabies: number;
  perNight: { USD: number; ARS: number };
};

export const MOCK_ROOM_TYPES: readonly MockRoomType[] = [
  { code: "DBL", name: "Habitación doble", units: 3, maxAdults: 2, maxChildren: 1, maxBabies: 1, perNight: { USD: 120, ARS: 95_000 } },
  { code: "FAM", name: "Habitación familiar", units: 2, maxAdults: 4, maxChildren: 2, maxBabies: 1, perNight: { USD: 180, ARS: 140_000 } },
  { code: "SUITE", name: "Suite con hidromasaje", units: 1, maxAdults: 2, maxChildren: 0, maxBabies: 1, perNight: { USD: 250.5, ARS: 200_000 } },
];

const MOCK_ROOMS: ReadonlyArray<{ number: string; type: string; attrs: Array<[string, string]> }> = [
  { number: "101", type: "DBL", attrs: [["1", "Vista al jardín"], ["2", "Balcón"]] },
  { number: "102", type: "DBL", attrs: [["1", "Vista al jardín"]] },
  { number: "103", type: "DBL", attrs: [["1", "Vista al jardín"]] },
  { number: "201", type: "FAM", attrs: [["3", "Cocina equipada"]] },
  { number: "202", type: "FAM", attrs: [["3", "Cocina equipada"]] },
  { number: "301", type: "SUITE", attrs: [["4", "Hidromasaje"], ["5", "Vista a las sierras"]] },
];

const BOARDS: ReadonlyArray<{ code: string; desc: string; factor: number }> = [
  { code: "RO", desc: "Solo alojamiento", factor: 0.85 },
  { code: "BB", desc: "Desayuno", factor: 1 },
  { code: "HB", desc: "Media pensión", factor: 1.3 },
];

export type MockReply = { status: number; contentType: string; body: string };

const ARI_TYPE = "text/html; charset=utf-8";
const XML_TYPE = "text/xml; charset=utf-8";

export function ariError(code: string, text: string): MockReply {
  return { status: 200, contentType: ARI_TYPE, body: `ERR ${code}: ${text}` };
}

function contentError(code: string, description: string): MockReply {
  return {
    status: 200,
    contentType: XML_TYPE,
    body: `<Response><ServerInfo><Name>MOCK1</Name><ResponseTime>1 ms</ResponseTime></ServerInfo><Errors><Error code="${code}" description="${escapeXml(description)}" /></Errors></Response>`,
  };
}

function money(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, "");
}

function soldOutOn(knobs: MiniHotelMockKnobs, day: string): boolean {
  return knobs.soldOut !== null && day >= knobs.soldOut.from && day <= knobs.soldOut.to;
}

function currencyFor(rateCode: string): "USD" | "ARS" {
  return rateCode === "USD" ? "USD" : "ARS";
}

/** Credencial y hotel. `null` = pasa. */
function checkAuth(
  auth: XmlNode | null,
  hotelId: string | null,
  knobs: MiniHotelMockKnobs,
  kind: "ari" | "content"
): MockReply | null {
  const user = attr(auth, "username");
  const pass = attr(auth, "password");
  if (!auth) {
    return kind === "ari"
      ? ariError("863", "Wrong User Code (Gds Central)")
      : contentError("013", "Invalid XML Request.");
  }
  if (!user || !pass || (knobs.expectUser !== null && user !== knobs.expectUser)) {
    return kind === "ari"
      ? ariError("863", "Wrong User Code (Gds Central)")
      : contentError("012", "Wrong user name or password");
  }
  if (hotelId !== MOCK_HOTEL_ID) {
    return kind === "ari" ? ariError("211", "Incorrect hotel ID") : contentError("014", "Hotel not found");
  }
  return null;
}

/* ============================================================
 * ARI: Immediate y Bulk
 * ============================================================ */

export function handleAri(
  doc: XmlNode,
  knobs: MiniHotelMockKnobs,
  today: string
): { reply: MockReply; op: "immediate" | "bulk"; meta: Record<string, unknown> } {
  const root = findFirst(doc, "AvailRaterq");
  const auth = firstChild(root, "Authentication");
  const hotelId = attr(firstChild(root, "Hotel"), "id");
  const range = firstChild(root, "DateRange");
  const from = attr(range, "from");
  const to = attr(range, "to");
  const guests = firstChild(root, "Guests");
  const rateCode = attr(firstChild(root, "Prices"), "rateCode") ?? "";
  const bulk = attr(auth, "ResponseType") === "05";
  const op = bulk ? "bulk" : "immediate";
  const meta = {
    user: attr(auth, "username"),
    hotel: hotelId,
    from,
    to,
    adults: Number(attr(guests, "adults") ?? "") || null,
    children: Number(attr(guests, "child") ?? "") || 0,
    babies: Number(attr(guests, "babies") ?? "") || 0,
    rateCode,
  };

  if (!root) return { reply: ariError("001", "Invalid XML"), op, meta };
  const denied = checkAuth(auth, hotelId, knobs, "ari");
  if (denied) return { reply: denied, op, meta };
  if (!from || !to) return { reply: ariError("301", "Invalid XML: date range is missing"), op, meta };
  if (!isIsoDate(from)) return { reply: ariError("101", "Invalid arrival date"), op, meta };
  if (!isIsoDate(to)) return { reply: ariError("102", "Invalid departure date"), op, meta };
  if (!RATE_CODES.has(rateCode)) return { reply: ariError("308", "Incorrect rate code"), op, meta };
  const currency = currencyFor(rateCode);

  if (bulk) {
    const days: string[] = [];
    for (let d = from; d <= to && days.length < 800; d = addDays(d, 1)) days.push(d);
    const types = MOCK_ROOM_TYPES.map(
      (t) =>
        `<RoomType id="${t.code}" RoomName="${escapeXml(t.name)}" BasicOccupancy="00${t.maxAdults}">${days
          .map(
            (d) =>
              `<Day Mdate="${d.replaceAll("-", "")}" Mavailability="${soldOutOn(knobs, d) ? 0 : t.units}" Mprice="${money(t.perNight[currency])}" Minngt="0" Mclose="No" McloseArr="No" McloseDep="No" ExtraAdultFee="0.00" ExtraChildFee="0.00" ExtraBabyFee="0.00" SingleUse="0.00" />`
          )
          .join("")}</RoomType>`
    );
    return {
      op,
      meta,
      reply: {
        status: 200,
        contentType: ARI_TYPE,
        body: `<?xml version="1.0" encoding="UTF-8"?><AvailRaters><Hotel id="${MOCK_HOTEL_ID}" Name_h="${MOCK_HOTEL_NAME}" Currency="${currency}" /><DateRange from="${from}" to="${to}" /><RoomTypes>${types.join("")}</RoomTypes></AvailRaters>`,
      },
    };
  }

  const nights = nightsBetween(from, to);
  if (from < today) return { reply: ariError("106", "Arrival date cannot be earlier than today"), op, meta };
  if (nights < 1) return { reply: ariError("108", "Stay must be at least one night"), op, meta };
  if (nights > 30) return { reply: ariError("107", "Stay exceeds the maximum number of nights defined in the setup"), op, meta };

  const wanted = attr(firstChild(firstChild(root, "RoomTypes"), "RoomType"), "id") ?? "*ALL*";
  const types = MOCK_ROOM_TYPES.filter((t) => wanted === "*ALL*" || wanted === t.code).map((t) => {
    let alloc = t.units;
    for (let k = 0; k < nights; k++) if (soldOutOn(knobs, addDays(from, k))) alloc = 0;
    const base = t.perNight[currency] * nights;
    const prices = BOARDS.map(
      (b) =>
        `<price board="${b.code}" boardDesc="${b.desc}" value="${money(base * b.factor)}" value_nrf="${money(base * b.factor * 0.9)}" />`
    ).join("");
    return `<RoomType id="${t.code}" Name_h="${escapeXml(t.name)}" Name_e="${escapeXml(t.name)}"><Inventory Allocation="${alloc}" maxavail="${t.units}" />${prices}</RoomType>`;
  });
  return {
    op,
    meta,
    reply: {
      status: 200,
      contentType: ARI_TYPE,
      body: `<?xml version="1.0" encoding="UTF-8"?><AvailRaters><Hotel id="${MOCK_HOTEL_ID}" Name_h="${MOCK_HOTEL_NAME}" Name_e="${MOCK_HOTEL_NAME}" Currency="${currency}" /><DateRange from="${from}" to="${to}" /><Guests adults="${meta.adults ?? 0}" child="${meta.children}" babies="${meta.babies}" />${types.join("")}</AvailRaters>`,
    },
  };
}

/* ============================================================
 * Contenido: getRoomTypes / getRooms
 * ============================================================ */

export function handleContent(
  doc: XmlNode,
  op: "getRoomTypes" | "getRooms",
  knobs: MiniHotelMockKnobs
): { reply: MockReply; meta: Record<string, unknown> } {
  const settings = findFirst(doc, "Settings");
  const auth = firstChild(settings, "Authentication");
  const hotelId = attr(firstChild(settings, "Hotel"), "id");
  const meta = { user: attr(auth, "username"), hotel: hotelId };
  if (!settings || attr(settings, "name") !== op) {
    return { reply: contentError("013", "Invalid XML Request."), meta };
  }
  const denied = checkAuth(auth, hotelId, knobs, "content");
  if (denied) return { reply: denied, meta };

  const server = `<ServerInfo><Name>MOCK1</Name><ResponseTime>2 ms</ResponseTime><DateTime>${new Date().toISOString()}</DateTime></ServerInfo>`;
  if (op === "getRoomTypes") {
    const items = MOCK_ROOM_TYPES.map(
      (t) => `<RoomTypes><Type>${t.code}</Type><Description>${escapeXml(t.name)}</Description><Image /></RoomTypes>`
    ).join("");
    return {
      meta,
      reply: { status: 200, contentType: XML_TYPE, body: `<Response>${server}<ArrayOfRoomTypes>${items}</ArrayOfRoomTypes></Response>` },
    };
  }
  const rooms = MOCK_ROOMS.map((r, i) => {
    const t = MOCK_ROOM_TYPES.find((x) => x.code === r.type)!;
    const limits = [
      ["A", t.maxAdults],
      ["C", t.maxChildren],
      ["B", t.maxBabies],
    ]
      .map(([k, v]) => `<rec_rooms_gst_max><rgm_gst_type>${k}</rgm_gst_type><rgm_max>${v}</rgm_max></rec_rooms_gst_max>`)
      .join("");
    const attrs = r.attrs
      .map(([code, d]) => `<rnm_attribute code="${code}" description="${escapeXml(d)}" />`)
      .join("");
    return `<rnm_struct_room is_mapped="true"><rm_serial>${String(i + 1).padStart(3, "0")}</rm_serial><rm_number>${r.number}</rm_number><rm_type>${r.type}</rm_type><rm_status>C</rm_status><ArrayOfRec_rooms_gst_max>${limits}</ArrayOfRec_rooms_gst_max><ArrayOfRnm_struct_room_attributes>${attrs}</ArrayOfRnm_struct_room_attributes></rnm_struct_room>`;
  }).join("");
  return {
    meta,
    reply: {
      status: 200,
      contentType: XML_TYPE,
      body: `<Response>${server}<ArrayOfRnm_struct_room>${rooms}</ArrayOfRnm_struct_room></Response>`,
    },
  };
}
