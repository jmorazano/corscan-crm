import { describe, expect, it } from "vitest";
import {
  bulkRangeFor,
  buildBookingLink,
  buildBulkAriRequest,
  buildContentRequest,
  buildImmediateAriRequest,
  candidateOffsets,
  checkBookingEngineUrl,
  contentUrlFor,
  detectAriError,
  environmentOf,
  escapeXml,
  expandCompactDate,
  findAlternativeWindows,
  isAriEndpoint,
  isRoomAvailable,
  miniHotelCredentialLast4,
  nightsBetween,
  normalizeDate,
  normalizeMiniHotelCredential,
  parseBulk,
  parseImmediate,
  parseMiniHotelCredential,
  parseRooms,
  parseRoomTypes,
  parseXml,
  readBody,
  serializeMiniHotelCredential,
  type BulkRoom,
} from "@/lib/minihotel";

/**
 * 028 — Piezas puras del adaptador de MiniHotel. Los cuerpos de error son
 * los REALES que devolvió el sandbox sin credenciales el 1-oct-2026.
 */

const AUTH = { username: "usr&<x>", password: 'p"ass', hotelId: "sandbox" };

describe("requests — XML de lectura, con la credencial escapada", () => {
  it("Immediate ARI: rango, huéspedes, tarifa, todos los regímenes y mínimo de noches", () => {
    const xml = buildImmediateAriRequest(AUTH, {
      from: "2026-11-10",
      to: "2026-11-12",
      adults: 2,
      children: 1,
      babies: 0,
      rateCode: "USD",
    });
    expect(xml).toContain('<Authentication username="usr&amp;&lt;x&gt;" password="p&quot;ass" MinimumNights="YES" />');
    expect(xml).toContain('<DateRange from="2026-11-10" to="2026-11-12" />');
    expect(xml).toContain('<Guests adults="2" child="1" babies="0" />');
    expect(xml).toContain('<RoomType id="*ALL*" />');
    expect(xml).toContain('<Prices rateCode="USD"><Price boardCode="*ALL*" /></Prices>');
    // El propio pedido es XML válido.
    expect(() => parseXml(xml)).not.toThrow();
  });

  it("Immediate ARI con un tipo puntual", () => {
    const xml = buildImmediateAriRequest(AUTH, {
      from: "2026-11-10",
      to: "2026-11-12",
      adults: 2,
      children: 0,
      babies: 0,
      rateCode: "USD",
      roomType: "DBL",
    });
    expect(xml).toContain('<RoomType id="DBL" />');
  });

  it("Bulk ARI lleva ResponseType=05", () => {
    const xml = buildBulkAriRequest(AUTH, { from: "2026-11-03", to: "2026-11-21", rateCode: "USD" });
    expect(xml).toContain('ResponseType="05"');
    expect(() => parseXml(xml)).not.toThrow();
  });

  it("getRoomTypes / getRooms", () => {
    expect(buildContentRequest("getRoomTypes", AUTH)).toContain('<Settings name="getRoomTypes">');
    const rooms = buildContentRequest("getRooms", AUTH);
    expect(rooms).toContain("<room_number></room_number>");
    expect(() => parseXml(rooms)).not.toThrow();
  });

  it("escapeXml cubre las cinco", () => {
    expect(escapeXml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });
});

describe("endpoints — la URL de contenido se DERIVA de la ARI", () => {
  it("producción: api → api2", () => {
    expect(contentUrlFor("https://api.minihotel.cloud/gds", "getRooms")).toBe(
      "https://api2.minihotel.cloud/agents/ws/settings/rooms/RoomsMain.asmx/getRooms"
    );
  });

  it("sandbox: mismo host", () => {
    expect(contentUrlFor("https://sandbox.minihotel.cloud/gds", "getRoomTypes")).toBe(
      "https://sandbox.minihotel.cloud/agents/ws/settings/rooms/RoomsMain.asmx/getRoomTypes"
    );
  });

  it("simulador local: mismo origen y prefijo", () => {
    expect(contentUrlFor("http://localhost:3000/api/dev/minihotel-mock/gds", "getRooms")).toBe(
      "http://localhost:3000/api/dev/minihotel-mock/agents/ws/settings/rooms/RoomsMain.asmx/getRooms"
    );
  });

  it("solo direcciones ARI (`/gds`)", () => {
    expect(isAriEndpoint("https://sandbox.minihotel.cloud/gds/")).toBe(true);
    expect(isAriEndpoint("https://sandbox.minihotel.cloud/otra")).toBe(false);
    expect(contentUrlFor("https://evil.example/otra", "getRooms")).toBeNull();
  });

  it("environmentOf", () => {
    expect(environmentOf("https://sandbox.minihotel.cloud/gds")).toBe("sandbox");
    expect(environmentOf("https://api.minihotel.cloud/gds")).toBe("production");
    expect(environmentOf("http://localhost:3000/api/dev/minihotel-mock/gds")).toBe("custom");
  });
});

describe("booking-link — base validada contra el proveedor, parámetros por código", () => {
  const BASE =
    "https://frame2.hotelpms.io/BookingFrameClient/hotel/B263C4CD7A30D45315E78416F6F4F942/153f2c6a-a062-4c7b-97d7-c6bb89533ae6/book/rooms";

  it("acepta el motor real (Latam/internacional/sandbox) y normaliza", () => {
    const check = checkBookingEngineUrl(`${BASE}/?currency=USD#x`);
    expect(check).toEqual({ ok: true, base: BASE, host: "frame2.hotelpms.io" });
    expect(checkBookingEngineUrl(BASE.replace("frame2.hotelpms.io", "sandbox.minihotel.cloud")).ok).toBe(true);
  });

  it("rechaza otro host, http, userinfo y otra ruta", () => {
    expect(checkBookingEngineUrl(BASE.replace("hotelpms.io", "evil.io"))).toMatchObject({ reason: "bad_host" });
    expect(checkBookingEngineUrl(BASE.replace("https", "http"))).toMatchObject({ reason: "not_https" });
    expect(checkBookingEngineUrl(BASE.replace("https://", "https://a@"))).toMatchObject({ reason: "invalid_url" });
    expect(checkBookingEngineUrl("https://frame2.hotelpms.io/otra/cosa")).toMatchObject({ reason: "bad_path" });
  });

  it("arma la búsqueda: fechas compactas, huéspedes, tipo, moneda, idioma", () => {
    const link = buildBookingLink(BASE, {
      from: "2026-11-10",
      to: "2026-11-12",
      adults: 2,
      children: 1,
      babies: 0,
      roomType: "DBL",
      currency: "USD",
    });
    expect(link).toBe(
      `${BASE}?from=20261110&to=20261112&nAdults=2&nChilds=1&roomType=DBL&currency=USD&language=es-ES`
    );
  });

  it("sin fechas válidas no hay enlace (mejor nada que uno roto)", () => {
    expect(buildBookingLink(BASE, { from: "2026-13-01", to: "2026-11-12", adults: 2 })).toBeNull();
  });
});

describe("dates", () => {
  it("normaliza ISO y dd/mm/aaaa; noches; YYYYMMDD", () => {
    expect(normalizeDate("10/11/2026")).toBe("2026-11-10");
    expect(normalizeDate("2026-11-10T12:00")).toBe("2026-11-10");
    expect(normalizeDate("2026-02-31")).toBeNull();
    expect(nightsBetween("2026-11-10", "2026-11-12")).toBe(2);
    expect(expandCompactDate("20261110")).toBe("2026-11-10");
    expect(expandCompactDate("2026111")).toBeNull();
  });
});

describe("credential", () => {
  it("serializa, lee y muestra solo los últimos 4 de la contraseña", () => {
    const c = normalizeMiniHotelCredential({ username: " Test ", password: " 3657488 " });
    expect(c).toEqual({ username: "Test", password: "3657488" });
    expect(parseMiniHotelCredential(serializeMiniHotelCredential(c!))).toEqual(c);
    expect(miniHotelCredentialLast4(c!)).toBe("7488");
  });

  it("corrupto o incompleto ⇒ null, nunca lanza", () => {
    expect(parseMiniHotelCredential("no-json")).toBeNull();
    expect(parseMiniHotelCredential('{"username":"x"}')).toBeNull();
    expect(normalizeMiniHotelCredential({ username: "", password: "x" })).toBeNull();
  });
});

describe("responses — errores reales del sandbox (1-oct-2026)", () => {
  it("ARI: texto plano `ERR 863` con HTTP 200 → auth", () => {
    expect(readBody("ERR 863: Wrong User Code (Gds Central)")).toEqual({
      kind: "error",
      error: { code: "auth", raw: "863" },
    });
  });

  it("ARI: IP no autorizada, hotel, fechas, tarifa, desconocido", () => {
    expect(detectAriError("ERR A01: IP address is not authorized")?.code).toBe("ip_not_authorized");
    expect(detectAriError("ERR 211: Incorrect hotel ID")?.code).toBe("hotel");
    expect(detectAriError("ERR 106: Arrival date cannot be earlier than today")?.code).toBe("past_date");
    expect(detectAriError("ERR 107: Stay exceeds the maximum number of nights")?.code).toBe("too_many_nights");
    expect(detectAriError("ERR 308: Incorrect rate code")?.code).toBe("rate_code");
    expect(detectAriError("ERR 999: algo nuevo")?.code).toBe("provider_error");
    expect(detectAriError("<AvailRaters/>")).toBeNull();
  });

  it("Contenido: `<Errors><Error code=013>` → invalid_request", () => {
    const body =
      '<Response><ServerInfo><Name>SANDBOX1</Name><ResponseTime>3 ms</ResponseTime><DateTime>10/1/2026 9:51:47 PM</DateTime></ServerInfo><Errors><Error code="013" description="Invalid XML Request." /></Errors></Response>';
    expect(readBody(body)).toEqual({ kind: "error", error: { code: "invalid_request", raw: "013" } });
  });

  it("Contenido: descripciones de credencial/hotel se clasifican sin mostrarse", () => {
    const mk = (d: string) => `<Response><Errors><Error code="020" description="${d}" /></Errors></Response>`;
    expect(readBody(mk("Wrong user name or password"))).toMatchObject({ error: { code: "auth" } });
    expect(readBody(mk("Hotel not found"))).toMatchObject({ error: { code: "hotel" } });
  });

  it("basura → unreadable (HTML de error, vacío, XML roto)", () => {
    expect(readBody("<!DOCTYPE html><html></html>")).toEqual({ kind: "unreadable" });
    expect(readBody("")).toEqual({ kind: "unreadable" });
    expect(readBody("<A><B></A>")).toEqual({ kind: "unreadable" });
    expect(readBody("hola")).toEqual({ kind: "unreadable" });
  });
});

describe("responses — Immediate ARI (ejemplo de la documentación)", () => {
  const BODY = `<?xml version="1.0" encoding="UTF-8"?>
<AvailRaters>
    <Hotel id="sandbox" Name_h="Test Hotel MiniHotel" Name_e="Test Hotel MiniHotel" Currency="USD" />
    <DateRange from="2024-06-18" to="2024-06-21" />
    <Guests adults="2" child="0" babies="0" />
    <RoomType id="2BEDAPT" Name_h="Two bedroom apartment" Name_e="Two bedroom apartment">
        <Inventory Allocation="5" maxavail="5" />
        <price board="BB" boardDesc="BB" value="352.50" value_nrf="317.25" />
        <price board="RO" boardDesc="RO" value="202.50" value_nrf="182.25" />
    </RoomType>
    <RoomType id="Executive" Name_h="Executive Room" Name_e="Executive Room" MinimumNights="3">
        <Inventory Allocation="0" maxavail="1" />
        <price board="BB" boardDesc="BB" value="352.50" value_nrf="317.25" />
    </RoomType>
</AvailRaters>`;

  it("hotel, moneda, tipos, unidades, regímenes y mínimo de noches", () => {
    const body = readBody(BODY);
    if (body.kind !== "xml") throw new Error("se esperaba XML");
    const parsed = parseImmediate(body.doc);
    expect(parsed?.hotelName).toBe("Test Hotel MiniHotel");
    expect(parsed?.currency).toBe("USD");
    expect(parsed?.rooms.map((r) => r.code)).toEqual(["2BEDAPT", "Executive"]);
    expect(parsed?.rooms[0]?.boards[0]).toEqual({
      board: "BB",
      label: "BB",
      value: 352.5,
      valueNrf: 317.25,
    });
    expect(parsed?.rooms[1]?.minNights).toBe(3);
    expect(isRoomAvailable(parsed!.rooms[0]!)).toBe(true);
    expect(isRoomAvailable(parsed!.rooms[1]!)).toBe(false);
  });
});

describe("responses — Bulk ARI y contenido", () => {
  it("Bulk: días ordenados con cierres y mínimo", () => {
    const doc = parseXml(`<AvailRaters><Hotel id="sandbox" Currency="USD"/><RoomTypes>
      <RoomType id="DBL" RoomName="Double Room" BasicOccupancy="002">
        <Day Mdate="20261111" Mavailability="0" Mprice="22.50" Minngt="0" Mclose="No" McloseArr="No" McloseDep="No" />
        <Day Mdate="20261110" Mavailability="4" Mprice="26.10" Minngt="2" Mclose="No" McloseArr="Yes" McloseDep="No" />
      </RoomType></RoomTypes></AvailRaters>`);
    const bulk = parseBulk(doc);
    expect(bulk?.currency).toBe("USD");
    expect(bulk?.rooms[0]?.basicOccupancy).toBe(2);
    expect(bulk?.rooms[0]?.days.map((d) => d.date)).toEqual(["2026-11-10", "2026-11-11"]);
    expect(bulk?.rooms[0]?.days[0]).toMatchObject({ available: 4, minNights: 2, closedArrival: true });
  });

  it("getRoomTypes y getRooms (con el envoltorio repetido de la doc)", () => {
    const types = parseRoomTypes(
      parseXml(
        "<Response><ArrayOfRoomTypes><RoomTypes><Type>DBL</Type><Description>Double Room</Description><Image>http://x/i.jpg</Image></RoomTypes><RoomTypes><Type>TRPL</Type><Description>Triple Room</Description><Image /></RoomTypes></ArrayOfRoomTypes></Response>"
      )
    );
    expect(types).toEqual([
      { code: "DBL", description: "Double Room", image: "http://x/i.jpg" },
      { code: "TRPL", description: "Triple Room", image: null },
    ]);
    const rooms = parseRooms(
      parseXml(`<Response><ArrayOfRnm_struct_room><rnm_struct_room><rnm_struct_room is_mapped="true">
        <rm_number>102</rm_number><rm_type>DBL</rm_type>
        <ArrayOfRec_rooms_gst_max>
          <rec_rooms_gst_max><rgm_gst_type>A</rgm_gst_type><rgm_max>2</rgm_max></rec_rooms_gst_max>
          <rec_rooms_gst_max><rgm_gst_type>C</rgm_gst_type><rgm_max>1</rgm_max></rec_rooms_gst_max>
          <rec_rooms_gst_max><rgm_gst_type>B</rgm_gst_type><rgm_max>1</rgm_max></rec_rooms_gst_max>
        </ArrayOfRec_rooms_gst_max>
        <ArrayOfRnm_struct_room_attributes><rnm_attribute code="1" description="Garden view" /></ArrayOfRnm_struct_room_attributes>
      </rnm_struct_room></rnm_struct_room></ArrayOfRnm_struct_room></Response>`)
    );
    expect(rooms).toEqual([
      {
        number: "102",
        type: "DBL",
        mapped: true,
        maxAdults: 2,
        maxChildren: 1,
        maxBabies: 1,
        attributes: [{ code: "1", description: "Garden view" }],
      },
    ]);
  });
});

describe("alternatives — misma cantidad de noches, ±7 días, restricciones por día", () => {
  const day = (date: string, extra: Partial<BulkRoom["days"][number]> = {}) => ({
    date,
    available: 2,
    price: 100,
    minNights: null,
    closed: false,
    closedArrival: false,
    closedDeparture: false,
    ...extra,
  });
  const range = (from: string, n: number) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8)) + i));
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  };

  it("lo más cercano primero y devuelto en orden cronológico; nunca el rango pedido", () => {
    // Lleno del 10 al 12; libre el resto.
    const days = range("2026-11-03", 20).map((d) =>
      d >= "2026-11-10" && d < "2026-11-12" ? day(d, { available: 0 }) : day(d)
    );
    const rooms: BulkRoom[] = [{ code: "DBL", name: null, basicOccupancy: 2, days }];
    const out = findAlternativeWindows({
      rooms,
      requested: { from: "2026-11-10", to: "2026-11-12" },
      nights: 2,
      today: "2026-10-01",
    });
    // -1 (9→11) choca con el 10; +1 (11→13) choca con el 11; -2 (8→10) y +2 (12→14) libres.
    expect(out).toEqual([
      { from: "2026-11-08", to: "2026-11-10", roomCodes: ["DBL"] },
      { from: "2026-11-12", to: "2026-11-14", roomCodes: ["DBL"] },
      { from: "2026-11-07", to: "2026-11-09", roomCodes: ["DBL"] },
    ].sort((a, b) => a.from.localeCompare(b.from)));
  });

  it("respeta cierre a la llegada, cierre a la salida, mínimo de noches y el pasado", () => {
    const days = range("2026-11-01", 25).map((d) => {
      if (d >= "2026-11-10" && d < "2026-11-12") return day(d, { available: 0 });
      if (d === "2026-11-08") return day(d, { closedArrival: true }); // 8→10 no
      if (d === "2026-11-14") return day(d, { closedDeparture: true }); // 12→14 no
      if (d === "2026-11-13") return day(d, { minNights: 3 }); // 13→15 no
      return day(d);
    });
    const out = findAlternativeWindows({
      rooms: [{ code: "DBL", name: null, basicOccupancy: 2, days }],
      requested: { from: "2026-11-10", to: "2026-11-12" },
      nights: 2,
      today: "2026-11-06",
      max: 5,
    });
    const starts = out.map((w) => w.from);
    expect(starts).not.toContain("2026-11-08");
    expect(starts).not.toContain("2026-11-12");
    expect(starts).not.toContain("2026-11-13");
    expect(starts.every((s) => s >= "2026-11-06")).toBe(true);
    expect(starts).toContain("2026-11-07"); // 7→9 libre, también la salida del 9
  });

  it("filtra por tipos permitidos y no inventa si no hay nada", () => {
    const days = range("2026-11-01", 25).map((d) => day(d, { available: 0 }));
    expect(
      findAlternativeWindows({
        rooms: [{ code: "DBL", name: null, basicOccupancy: 2, days }],
        requested: { from: "2026-11-10", to: "2026-11-12" },
        nights: 2,
        today: "2026-10-01",
      })
    ).toEqual([]);
  });

  it("período del Bulk: desde 7 días antes (nunca antes de hoy) hasta la última salida", () => {
    expect(bulkRangeFor({ from: "2026-11-10", to: "2026-11-12" }, 2, "2026-10-01")).toEqual({
      from: "2026-11-03",
      to: "2026-11-19",
    });
    expect(bulkRangeFor({ from: "2026-10-03", to: "2026-10-05" }, 2, "2026-10-01").from).toBe(
      "2026-10-01"
    );
    expect(candidateOffsets(2)).toEqual([-1, 1, -2, 2]);
  });
});
