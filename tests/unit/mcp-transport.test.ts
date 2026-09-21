import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { McpError } from "@/lib/mcp/errors";
import { postJsonRpc, takeSseObject } from "@/lib/mcp/transport";

/**
 * 016 — Transporte JSON-RPC (design §C.1, correcciones #12 y #20).
 *
 * Se levanta un servidor HTTP real en loopback en vez de falsear
 * `https.request`: así se ejercitan de verdad el `lookup` guardado, el corte
 * por bytes, el `destroy()` del SSE y los timeouts. `http://localhost` solo se
 * admite bajo el gate de mocks, que es exactamente el camino del self-test.
 */

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let server: http.Server;
let base = "";
let handler: Handler = (_req, res) => res.end();
let hits = 0;

beforeAll(async () => {
  process.env.WA_MOCK_ENABLED = "true";
  server = http.createServer((req, res) => {
    hits += 1;
    res.on("error", () => undefined);
    handler(req, res);
  });
  server.on("clientError", () => undefined);
  // Sin host: doble pila. `localhost` puede resolver primero a ::1 y el
  // transporte usa la primera dirección (autoSelectFamily:false).
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

function call(overrides: Partial<Parameters<typeof postJsonRpc>[0]> = {}) {
  return postJsonRpc({
    endpointUrl: `${base}/mcp`,
    headers: { authorization: "Bearer secreto-del-pms" },
    body: { jsonrpc: "2.0", id: 7, method: "tools/call", params: {} },
    timeoutMs: 2_000,
    maxResponseBytes: 64 * 1024,
    sandbox: false,
    ...overrides,
  });
}

function json(res: ServerResponse, payload: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

describe("postJsonRpc — guardrails previos a la red", () => {
  it("D4: sandbox true lanza sandbox_violation ANTES de cualquier I/O", async () => {
    await expect(call({ sandbox: true })).rejects.toMatchObject({ code: "sandbox_violation" });
    expect(hits).toBe(0);
  });

  it("la sintaxis se revalida acá adentro: IP de metadata → blocked_host, sin red", async () => {
    await expect(
      call({ endpointUrl: "https://169.254.169.254/mcp" })
    ).rejects.toMatchObject({ code: "blocked_host" });
    expect(hits).toBe(0);
  });

  it("http fuera del gate de mocks → invalid_url", async () => {
    delete process.env.WA_MOCK_ENABLED;
    try {
      await expect(call()).rejects.toMatchObject({ code: "invalid_url" });
    } finally {
      process.env.WA_MOCK_ENABLED = "true";
    }
    expect(hits).toBe(0);
  });
});

describe("postJsonRpc — respuesta JSON", () => {
  it("devuelve el sobre parseado, el status y los bytes", async () => {
    handler = (_req, res) => json(res, { jsonrpc: "2.0", id: 7, result: { ok: true } });
    const res = await call();
    expect(res.json).toEqual({ jsonrpc: "2.0", id: 7, result: { ok: true } });
    expect(res.httpStatus).toBe(200);
    expect(res.bytes).toBeGreaterThan(0);
  });

  it("#12: manda Accept-Encoding: identity y el caller no lo puede pisar", async () => {
    let seen: Record<string, unknown> = {};
    handler = (req, res) => {
      seen = req.headers as Record<string, unknown>;
      json(res, { jsonrpc: "2.0", id: 7, result: {} });
    };
    await call({ headers: { authorization: "Bearer x", "accept-encoding": "gzip" } });
    expect(seen["accept-encoding"]).toBe("identity");
    expect(seen["content-type"]).toBe("application/json");
    expect(String(seen.accept)).toContain("text/event-stream");
    expect(seen.authorization).toBe("Bearer x");
  });

  it("rechaza una respuesta comprimida (el tope de bytes dejaría de significar algo)", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
      res.end("{}");
    };
    await expect(call()).rejects.toMatchObject({ code: "bad_content_type" });
  });

  it("content-type desconocido → bad_content_type; cuerpo ilegible → bad_payload", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<h1>hola</h1>");
    };
    await expect(call()).rejects.toMatchObject({ code: "bad_content_type" });

    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("no-json");
    };
    const err = await call().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpError);
    expect((err as McpError).code).toBe("bad_payload");
    // Ni un byte del remoto en el mensaje que sale (#13).
    expect((err as McpError).message).not.toContain("no-json");
  });
});

describe("postJsonRpc — estados HTTP", () => {
  it("3xx NO se sigue: arrastraría el bearer a otro host", async () => {
    handler = (_req, res) => {
      res.writeHead(302, { location: "https://evil.example/mcp" });
      res.end();
    };
    await expect(call()).rejects.toMatchObject({ code: "unexpected_redirect", httpStatus: 302 });
  });

  it("401 y 403 → unauthorized; 500 → http_error", async () => {
    handler = (_req, res) => json(res, { error: "nope" }, 401);
    await expect(call()).rejects.toMatchObject({ code: "unauthorized", httpStatus: 401 });
    handler = (_req, res) => json(res, { error: "nope" }, 403);
    await expect(call()).rejects.toMatchObject({ code: "unauthorized" });
    handler = (_req, res) => json(res, { error: "boom" }, 500);
    await expect(call()).rejects.toMatchObject({ code: "http_error", httpStatus: 500 });
  });
});

describe("postJsonRpc — tamaño y tiempo", () => {
  it("corta por content-length declarado y por bytes reales", async () => {
    handler = (_req, res) => json(res, { relleno: "x".repeat(5_000) });
    await expect(call({ maxResponseBytes: 500 })).rejects.toMatchObject({ code: "too_large" });

    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      // Sin content-length (chunked): el corte tiene que ser por bytes vistos.
      for (let i = 0; i < 20; i += 1) res.write("x".repeat(500));
      res.end();
    };
    await expect(call({ maxResponseBytes: 800 })).rejects.toMatchObject({ code: "too_large" });
  });

  it("un servidor que no contesta corta por timeout", async () => {
    handler = () => undefined;
    const started = Date.now();
    await expect(call({ timeoutMs: 150 })).rejects.toMatchObject({ code: "timeout" });
    expect(Date.now() - started).toBeLessThan(1_500);
  });
});

describe("postJsonRpc — framing SSE", () => {
  it("#12: corta con destroy() en el primer objeto con NUESTRO id", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":99,\"result\":{\"otro\":true}}\n\n");
      res.write("event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{\"mio\":true}}\n\n");
      // El servidor deja el stream abierto a propósito: sin el corte, el
      // socket quedaría retenido todo el timeout.
      setInterval(() => res.write(": ping\n\n"), 50).unref();
    };
    const started = Date.now();
    const res = await call({ timeoutMs: 3_000 });
    expect(res.json).toEqual({ jsonrpc: "2.0", id: 7, result: { mio: true } });
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("SSE sin ningún objeto nuestro → bad_payload al cerrar", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: {\"jsonrpc\":\"2.0\",\"id\":99,\"result\":{}}\n\n");
      res.end();
    };
    await expect(call()).rejects.toMatchObject({ code: "bad_payload" });
  });
});

describe("takeSseObject", () => {
  it("junta líneas `data:` de un frame y deja el resto sin consumir", () => {
    const hit = takeSseObject('data: {"id":7,\ndata: "result":1}\n\ndata: {"id":8}', 7);
    expect(hit.found).toBe(true);
    expect(hit.found && hit.json).toEqual({ id: 7, result: 1 });
    expect(hit.rest).toBe('data: {"id":8}');
  });

  it("ignora frames de otro id, comentarios y JSON roto", () => {
    expect(takeSseObject(": ping\n\ndata: {roto\n\n", 7).found).toBe(false);
    expect(takeSseObject('data: {"id":9}\n\n', 7).found).toBe(false);
  });

  it("con expectedId null toma el primer objeto; con flush acepta el frame final sin blanco", () => {
    expect(takeSseObject('data: {"id":9}\n\n', null).found).toBe(true);
    expect(takeSseObject('data: {"id":7,"result":{}}', 7, true).found).toBe(true);
  });
});
