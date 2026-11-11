import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getGuardedText } from "@/lib/mcp/transport";

/**
 * 051 — GET protegido para los feeds iCal: mismo socket que el POST de 016
 * (servidor real en loopback, bajo el gate de mocks como el self-test).
 */

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let server: http.Server;
let base = "";
let handler: Handler = (_req, res) => res.end();
let hits = 0;
let lastMethod = "";
let lastHeaders: IncomingMessage["headers"] = {};

beforeAll(async () => {
  process.env.WA_MOCK_ENABLED = "true";
  server = http.createServer((req, res) => {
    hits += 1;
    lastMethod = req.method ?? "";
    lastHeaders = req.headers;
    res.on("error", () => undefined);
    handler(req, res);
  });
  server.on("clientError", () => undefined);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  base = `http://localhost:${port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.WA_MOCK_ENABLED;
});

afterEach(() => {
  hits = 0;
  handler = (_req, res) => res.end();
});

const SECRET = "llave-secreta-del-feed";

function get(path = `/calendar/ical/1.ics?t=${SECRET}`, overrides: Partial<Parameters<typeof getGuardedText>[0]> = {}) {
  return getGuardedText({
    endpointUrl: `${base}${path}`,
    headers: { "user-agent": "VoceroCRM-CalendarSync/1.0" },
    accept: "text/calendar",
    allowedContentTypes: ["text/calendar", "text/plain"],
    timeoutMs: 2_000,
    maxResponseBytes: 1024,
    sandbox: false,
    ...overrides,
  });
}

describe("getGuardedText", () => {
  it("sandbox lanza antes de cualquier I/O", async () => {
    await expect(get(undefined, { sandbox: true })).rejects.toMatchObject({ code: "sandbox_violation" });
    expect(hits).toBe(0);
  });

  it("IP de metadata → blocked_host sin red", async () => {
    await expect(get(undefined, { endpointUrl: "https://169.254.169.254/x.ics" })).rejects.toMatchObject({
      code: "blocked_host",
    });
    expect(hits).toBe(0);
  });

  it("hace un GET sin cuerpo y devuelve el texto", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/calendar; charset=utf-8" });
      res.end("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
    };
    const r = await get();
    expect(lastMethod).toBe("GET");
    expect(lastHeaders["content-length"]).toBeUndefined();
    expect(lastHeaders["user-agent"]).toBe("VoceroCRM-CalendarSync/1.0");
    expect(r.httpStatus).toBe(200);
    expect(r.text).toContain("BEGIN:VCALENDAR");
  });

  it("no sigue redirecciones y la llave no aparece en el error", async () => {
    handler = (_req, res) => {
      res.writeHead(302, { location: "http://169.254.169.254/" });
      res.end();
    };
    const err = await get().catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "unexpected_redirect" });
    expect(JSON.stringify(err) + String(err)).not.toContain(SECRET);
  });

  it("HTML (página de login) → bad_content_type; 404 → http_error con status", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html></html>");
    };
    await expect(get()).rejects.toMatchObject({ code: "bad_content_type" });
    handler = (_req, res) => {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("no");
    };
    await expect(get()).rejects.toMatchObject({ code: "http_error", httpStatus: 404 });
  });

  it("corta por tamaño", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/calendar" });
      res.end("X".repeat(5000));
    };
    await expect(get()).rejects.toMatchObject({ code: "too_large" });
  });
});
