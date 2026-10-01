import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { postGuardedText } from "@/lib/mcp/transport";
import {
  miniHotelCallTool,
  type AvailabilityPayload,
  type MiniHotelClientConfig,
  type RoomCatalogPayload,
} from "@/lib/minihotel";

/**
 * 028 — Cliente de MiniHotel contra un servidor HTTP REAL en loopback (mismo
 * criterio que `mcp-transport.test.ts`: se ejercitan el lookup guardado, el
 * tope y los plazos de verdad). El servidor imita lo verificado en el
 * sandbox: errores de ARI como texto plano con `text/html` y HTTP 200.
 */

type Seen = { path: string; contentType: string; body: string };
type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;

let server: http.Server;
let base = "";
let handler: Handler = (_req, _body, res) => res.end();
let seen: Seen[] = [];

beforeAll(async () => {
  process.env.WA_MOCK_ENABLED = "true";
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString("utf8")));
    req.on("end", () => {
      seen.push({ path: req.url ?? "", contentType: req.headers["content-type"] ?? "", body });
      res.on("error", () => undefined);
      handler(req, body, res);
    });
  });
  server.on("clientError", () => undefined);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  base = `http://localhost:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.WA_MOCK_ENABLED;
});

afterEach(() => {
  seen = [];
  handler = (_req, _body, res) => res.end();
});

function cfg(overrides: Partial<MiniHotelClientConfig> = {}): MiniHotelClientConfig {
  return {
    ariEndpoint: `${base}/gds`,
    username: "Test",
    password: "clave-secreta-123",
    hotelId: "sandbox",
    rateCode: "USD",
    timeoutMs: 3_000,
    maxResponseBytes: 256 * 1024,
    today: "2026-10-01",
    sandbox: false,
    ...overrides,
  };
}

function send(res: ServerResponse, body: string, type = "text/xml; charset=utf-8"): void {
  res.writeHead(200, { "content-type": type });
  res.end(body);
}

function immediateXml(rooms: Array<{ id: string; alloc: number; value?: number }>): string {
  return `<?xml version="1.0" encoding="UTF-8"?><AvailRaters><Hotel id="sandbox" Name_h="Hotel Sandbox" Currency="USD" />${rooms
    .map(
      (r) =>
        `<RoomType id="${r.id}" Name_h="Habitación ${r.id}"><Inventory Allocation="${r.alloc}" maxavail="5" /><price board="BB" boardDesc="Desayuno" value="${r.value ?? 200}" value_nrf="${(r.value ?? 200) * 0.9}" /></RoomType>`
    )
    .join("")}</AvailRaters>`;
}

function dateRangeOf(body: string): { from: string; to: string } {
  const m = /<DateRange from="([^"]+)" to="([^"]+)"/.exec(body);
  return { from: m?.[1] ?? "", to: m?.[2] ?? "" };
}

/** Bulk: lleno el 10 y el 11 de noviembre, libre el resto. */
function bulkXml(from: string, to: string): string {
  const days: string[] = [];
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  for (let t = start; t <= end; t += 86_400_000) {
    const iso = new Date(t).toISOString().slice(0, 10);
    const full = iso === "2026-11-10" || iso === "2026-11-11";
    days.push(
      `<Day Mdate="${iso.replaceAll("-", "")}" Mavailability="${full ? 0 : 3}" Mprice="100" Minngt="0" Mclose="No" McloseArr="No" McloseDep="No" />`
    );
  }
  return `<AvailRaters><Hotel id="sandbox" Currency="USD" /><RoomTypes><RoomType id="DBL" RoomName="Double" BasicOccupancy="002">${days.join("")}</RoomType></RoomTypes></AvailRaters>`;
}

const ONE_RANGE = {
  ranges: [{ from: "2026-11-10", to: "2026-11-12" }],
  adults: 2,
  children: 0,
  babies: 0,
  alternatives: true,
};

describe("postGuardedText — mismo socket protegido, cuerpo de texto", () => {
  it("manda el Content-Type pedido y devuelve el texto aunque venga como text/html", async () => {
    handler = (_req, _body, res) => send(res, "ERR 863: Wrong User Code (Gds Central)", "text/html; charset=utf-8");
    const res = await postGuardedText({
      endpointUrl: `${base}/gds`,
      body: "<x/>",
      contentType: "text/xml; charset=utf-8",
      accept: "text/xml",
      allowedContentTypes: ["text/html", "text/xml"],
      timeoutMs: 2_000,
      maxResponseBytes: 1024,
      sandbox: false,
    });
    expect(res.text).toBe("ERR 863: Wrong User Code (Gds Central)");
    expect(seen[0]?.contentType).toBe("text/xml; charset=utf-8");
  });

  it("tipo no aceptado → bad_content_type; sandbox → sandbox_violation sin red", async () => {
    handler = (_req, _body, res) => send(res, "{}", "application/json");
    const opts = {
      endpointUrl: `${base}/gds`,
      body: "<x/>",
      contentType: "text/xml",
      accept: "text/xml",
      allowedContentTypes: ["text/xml"],
      timeoutMs: 2_000,
      maxResponseBytes: 1024,
      sandbox: false,
    };
    await expect(postGuardedText(opts)).rejects.toMatchObject({ code: "bad_content_type" });
    seen = [];
    await expect(postGuardedText({ ...opts, sandbox: true })).rejects.toMatchObject({
      code: "sandbox_violation",
    });
    expect(seen).toHaveLength(0);
  });

  it("conexión propia por pedido: el keep-alive de 5 s del agente global no corta antes del plazo", async () => {
    handler = (_req, _body, res) => send(res, "<A/>", "text/xml");
    let agent: unknown = "sin tocar";
    await postGuardedText({
      endpointUrl: `${base}/gds`,
      body: "<x/>",
      contentType: "text/xml",
      accept: "text/xml",
      allowedContentTypes: ["text/xml"],
      timeoutMs: 2_000,
      maxResponseBytes: 1024,
      sandbox: false,
      request: ((options: http.RequestOptions, cb: (res: IncomingMessage) => void) => {
        agent = options.agent;
        return http.request(options, cb);
      }) as never,
    });
    expect(agent).toBe(false);
  });

  it("no parte un carácter multibyte que cae entre dos pedazos", async () => {
    handler = (_req, _body, res) => {
      const buf = Buffer.from("<A>Habitación</A>", "utf8");
      const cut = buf.indexOf(0xc3) + 1; // en el medio de la «ó»
      res.writeHead(200, { "content-type": "text/xml" });
      res.write(buf.subarray(0, cut));
      setTimeout(() => res.end(buf.subarray(cut)), 20);
    };
    const res = await postGuardedText({
      endpointUrl: `${base}/x`,
      body: "",
      contentType: "text/xml",
      accept: "text/xml",
      allowedContentTypes: ["text/xml"],
      timeoutMs: 2_000,
      maxResponseBytes: 1024,
      sandbox: false,
    });
    expect(res.text).toBe("<A>Habitación</A>");
  });
});

describe("availability", () => {
  it("un rango con lugar: text/xml, credencial en el cuerpo, tipos y precios", async () => {
    handler = (_req, _body, res) => send(res, immediateXml([{ id: "DBL", alloc: 2, value: 350 }]), "text/html");
    const out = await miniHotelCallTool(cfg(), "availability", ONE_RANGE);
    expect(out.outcome.ok).toBe(true);
    const data = (out.outcome as { data: AvailabilityPayload }).data;
    expect(data.hotel).toEqual({ name: "Hotel Sandbox", currency: "USD" });
    expect(data.ranges[0]?.rooms[0]).toMatchObject({ code: "DBL", available: 2 });
    expect(data.alternatives).toBeNull();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.contentType).toContain("text/xml");
    expect(seen[0]?.body).toContain('username="Test" password="clave-secreta-123"');
    // El resultado jamás trae el XML crudo.
    expect(out.raw).toBeNull();
  });

  it("sin lugar → Bulk ±7 días → hasta 3 ventanas confirmadas con Immediate", async () => {
    handler = (_req, body, res) => {
      if (body.includes('ResponseType="05"')) {
        const r = dateRangeOf(body);
        send(res, bulkXml(r.from, r.to));
        return;
      }
      const r = dateRangeOf(body);
      // Lo pedido (10→12) no tiene lugar; cualquier otra ventana sí.
      send(res, immediateXml([{ id: "DBL", alloc: r.from === "2026-11-10" ? 0 : 1 }]));
    };
    const out = await miniHotelCallTool(cfg(), "availability", ONE_RANGE);
    const data = (out.outcome as { data: AvailabilityPayload }).data;
    expect(data.ranges[0]?.rooms.some((r) => (r.available ?? 0) > 0)).toBe(false);
    expect(data.alternatives?.searched).toBe(true);
    expect(data.alternatives?.windows.map((w) => `${w.from}→${w.to}`)).toEqual([
      "2026-11-07→2026-11-09",
      "2026-11-08→2026-11-10",
      "2026-11-12→2026-11-14",
    ]);
    // 1 Immediate + 1 Bulk + 3 confirmaciones.
    expect(seen).toHaveLength(5);
    const bulk = seen.find((s) => s.body.includes('ResponseType="05"'));
    expect(dateRangeOf(bulk!.body)).toEqual({ from: "2026-11-03", to: "2026-11-19" });
  });

  it("comparar 2 rangos: 2 Immediate en paralelo, sin buscar alternativas", async () => {
    handler = (_req, _body, res) => send(res, immediateXml([{ id: "DBL", alloc: 0 }]));
    const out = await miniHotelCallTool(cfg(), "availability", {
      ...ONE_RANGE,
      ranges: [
        { from: "2026-11-10", to: "2026-11-12" },
        { from: "2026-11-17", to: "2026-11-19" },
      ],
    });
    const data = (out.outcome as { data: AvailabilityPayload }).data;
    expect(data.ranges).toHaveLength(2);
    expect(data.alternatives).toBeNull();
    expect(seen).toHaveLength(2);
  });

  it("credencial rechazada (ERR 863) → unauthorized con motivo `auth`", async () => {
    handler = (_req, _body, res) => send(res, "ERR 863: Wrong User Code (Gds Central)", "text/html");
    await expect(miniHotelCallTool(cfg(), "availability", ONE_RANGE)).rejects.toMatchObject({
      code: "unauthorized",
      providerCode: "auth",
    });
  });

  it("IP no autorizada (ERR A01) → unauthorized con motivo `ip_not_authorized`", async () => {
    handler = (_req, _body, res) => send(res, "ERR A01: IP address is not authorized", "text/html");
    await expect(miniHotelCallTool(cfg(), "availability", ONE_RANGE)).rejects.toMatchObject({
      code: "unauthorized",
      providerCode: "ip_not_authorized",
    });
  });

  it("tarifa rechazada (ERR 308 / 803) → unauthorized con motivo `rate_code`: es configuración", async () => {
    for (const err of ["ERR 308: Incorrect rate code", "ERR 803: Incorrect rate code"]) {
      handler = (_req, _body, res) => send(res, err, "text/html");
      await expect(miniHotelCallTool(cfg(), "availability", ONE_RANGE)).rejects.toMatchObject({
        code: "unauthorized",
        providerCode: "rate_code",
      });
    }
  });

  it("tarifa inexistente como en el sandbox real: Immediate VACÍO (no valida) + Bulk ERR 308 → rate_code", async () => {
    handler = (_req, body, res) =>
      body.includes('ResponseType="05"')
        ? send(res, "ERR 308: Incorrect rate code", "text/html")
        : send(res, immediateXml([]));
    await expect(
      miniHotelCallTool(cfg(), "availability", { ...ONE_RANGE, rate_code: "NOEXISTE" })
    ).rejects.toMatchObject({ code: "unauthorized", providerCode: "rate_code" });
    // Sin alternativas (comparar rangos) el vacío NO se puede distinguir de «sin lugar».
    seen = [];
    const out = await miniHotelCallTool(cfg(), "availability", {
      ...ONE_RANGE,
      alternatives: false,
      rate_code: "NOEXISTE",
    });
    expect(out.outcome.ok).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it("la tarifa del pedido manda sobre la de la config (la que quedó en la bitácora)", async () => {
    handler = (_req, _body, res) => send(res, immediateXml([{ id: "DBL", alloc: 1 }]));
    await miniHotelCallTool(cfg(), "availability", { ...ONE_RANGE, rate_code: "ARS" });
    expect(seen[0]?.body).toContain('rateCode="ARS"');
  });

  it("error de la CONSULTA (ERR 106) → outcome con código, para que el modelo corrija", async () => {
    handler = (_req, _body, res) => send(res, "ERR 106: Arrival date cannot be earlier than today", "text/html");
    const out = await miniHotelCallTool(cfg(), "availability", ONE_RANGE);
    expect(out.outcome).toEqual({ ok: false, code: "past_date", details: null });
  });

  it("basura (HTML de error) → bad_payload", async () => {
    handler = (_req, _body, res) => send(res, "<!DOCTYPE html><html><body>Error</body></html>", "text/html");
    await expect(miniHotelCallTool(cfg(), "availability", ONE_RANGE)).rejects.toMatchObject({
      code: "bad_payload",
    });
  });

  it("si las alternativas fallan, la respuesta principal sigue en pie", async () => {
    handler = (_req, body, res) => {
      if (body.includes('ResponseType="05"')) {
        send(res, "<html>caído</html>", "text/html");
        return;
      }
      send(res, immediateXml([{ id: "DBL", alloc: 0 }]));
    };
    const out = await miniHotelCallTool(cfg(), "availability", ONE_RANGE);
    const data = (out.outcome as { data: AvailabilityPayload }).data;
    expect(data.alternatives).toEqual({ searched: false, windows: [], spreadDays: 7 });
  });

  it("argumentos rotos → invalid_request sin red", async () => {
    const out = await miniHotelCallTool(cfg(), "availability", { ranges: [], adults: 2 });
    expect(out.outcome).toEqual({ ok: false, code: "invalid_request", details: null });
    expect(seen).toHaveLength(0);
  });

  it("deadline único: el servidor lento corta con timeout", async () => {
    handler = (_req, _body, res) => {
      setTimeout(() => send(res, immediateXml([{ id: "DBL", alloc: 1 }])), 800);
    };
    await expect(
      miniHotelCallTool(cfg({ timeoutMs: 400 }), "availability", ONE_RANGE)
    ).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("room_catalog", () => {
  const TYPES =
    "<Response><ArrayOfRoomTypes><RoomTypes><Type>DBL</Type><Description>Doble</Description><Image /></RoomTypes></ArrayOfRoomTypes></Response>";
  const ROOMS =
    '<Response><ArrayOfRnm_struct_room><rnm_struct_room is_mapped="true"><rm_type>DBL</rm_type><ArrayOfRec_rooms_gst_max><rec_rooms_gst_max><rgm_gst_type>A</rgm_gst_type><rgm_max>2</rgm_max></rec_rooms_gst_max></ArrayOfRec_rooms_gst_max></rnm_struct_room></ArrayOfRnm_struct_room></Response>';

  it("pide tipos y habitaciones a la URL DERIVADA de la ARI", async () => {
    handler = (req, _body, res) => send(res, req.url?.endsWith("getRooms") ? ROOMS : TYPES);
    const out = await miniHotelCallTool(cfg(), "room_catalog", {});
    const data = (out.outcome as { data: RoomCatalogPayload }).data;
    expect(data.roomTypes.map((t) => t.code)).toEqual(["DBL"]);
    expect(data.rooms?.[0]?.maxAdults).toBe(2);
    expect(seen.map((s) => s.path).sort()).toEqual([
      "/agents/ws/settings/rooms/RoomsMain.asmx/getRoomTypes",
      "/agents/ws/settings/rooms/RoomsMain.asmx/getRooms",
    ]);
  });

  it("si getRooms falla, el catálogo sirve igual con los tipos", async () => {
    handler = (req, _body, res) =>
      req.url?.endsWith("getRooms") ? send(res, "<html/>", "text/html") : send(res, TYPES);
    const out = await miniHotelCallTool(cfg(), "room_catalog", {});
    expect((out.outcome as { data: RoomCatalogPayload }).data.rooms).toBeNull();
  });

  it("error de la API de contenido → outcome con código", async () => {
    handler = (_req, _body, res) =>
      send(res, '<Response><Errors><Error code="013" description="Invalid XML Request." /></Errors></Response>');
    const out = await miniHotelCallTool(cfg(), "room_catalog", {});
    expect(out.outcome).toEqual({ ok: false, code: "invalid_request", details: null });
  });
});

describe("cinturones", () => {
  it("sandbox → sandbox_violation antes de cualquier red", async () => {
    await expect(miniHotelCallTool(cfg({ sandbox: true }), "availability", ONE_RANGE)).rejects.toMatchObject({
      code: "sandbox_violation",
    });
    expect(seen).toHaveLength(0);
  });

  it("herramienta fuera de la allowlist → not_allowed", async () => {
    await expect(miniHotelCallTool(cfg(), "create_booking", {})).rejects.toMatchObject({
      code: "not_allowed",
    });
    expect(seen).toHaveLength(0);
  });
});
