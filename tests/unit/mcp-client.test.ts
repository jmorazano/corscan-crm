import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  mcpCallTool,
  mcpInitialize,
  mcpListTools,
  type McpEndpointConfig,
} from "@/lib/mcp";

/**
 * 016 — Cliente MCP contra un servidor real en loopback (design §C.1).
 * Replica el comportamiento verificado del servidor de Altos: SIN ESTADO
 * (tools/list y tools/call responden sin `Mcp-Session-Id`) y errores con
 * HTTP 200 + `isError:true` + JSON anidado.
 */

let server: http.Server;
let base = "";
let seen: { method: string; auth: string | undefined; body: unknown }[] = [];

function reply(res: ServerResponse, id: unknown, result: unknown): void {
  res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "sess-1" });
  res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  let raw = "";
  req.on("data", (c) => (raw += String(c)));
  req.on("end", () => {
    const body = JSON.parse(raw) as { id: unknown; method: string; params?: unknown };
    seen.push({ method: body.method, auth: req.headers.authorization, body: body.params });
    if (body.method === "initialize") {
      reply(res, body.id, {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "Altos de Calamuchita", version: "1.4.0" },
        instructions: "Consultá disponibilidad antes de responder precios.",
      });
      return;
    }
    if (body.method === "tools/list") {
      reply(res, body.id, {
        tools: [
          {
            name: "check-availability",
            description: "Disponibilidad y precios",
            inputSchema: { type: "object" },
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
          },
        ],
      });
      return;
    }
    const args = (body.params as { arguments?: { city?: string } } | undefined)?.arguments;
    const payload =
      args?.city === "carlos paz"
        ? {
            success: false,
            error: {
              code: "unknown_city",
              message: "La localidad indicada no existe.",
              accepted: ["Potrero de Garay", "San Clemente"],
            },
          }
        : req.headers.authorization
          ? { success: true, available_count: 1 }
          : {
              success: false,
              error: { code: "unauthorized", message: "Credencial inválida o ausente." },
            };
    reply(res, body.id, {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      isError: payload.success === false,
    });
  });
}

beforeAll(async () => {
  process.env.WA_MOCK_ENABLED = "true";
  server = http.createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  base = `http://localhost:${typeof address === "object" && address ? address.port : 0}/mcp`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.WA_MOCK_ENABLED;
});

function cfg(overrides: Partial<McpEndpointConfig> = {}): McpEndpointConfig {
  seen = [];
  return {
    endpointUrl: base,
    credential: "credencial-opaca-del-pms",
    authScheme: "bearer",
    timeoutMs: 2_000,
    sandbox: false,
    ...overrides,
  };
}

describe("mcpInitialize / mcpListTools", () => {
  it("devuelve serverInfo, instructions y el session id del header", async () => {
    const session = await mcpInitialize(cfg());
    expect(session).toMatchObject({
      protocolVersion: "2025-06-18",
      serverName: "Altos de Calamuchita",
      serverVersion: "1.4.0",
      sessionId: "sess-1",
    });
    expect(session.instructions).toContain("disponibilidad");
    expect(seen[0]?.auth).toBe("Bearer credencial-opaca-del-pms");
  });

  it("lista herramientas con sus annotations", async () => {
    const tools = await mcpListTools(cfg());
    expect(tools).toHaveLength(1);
    expect(tools[0]?.annotations?.readOnlyHint).toBe(true);
  });

  it("api_key_header manda la credencial en su propio header, nunca en el cuerpo", async () => {
    const config = cfg({ authScheme: "api_key_header", apiKeyHeader: "X-Api-Key" });
    await mcpListTools(config);
    expect(seen[0]?.auth).toBeUndefined();
    expect(JSON.stringify(seen[0]?.body ?? {})).not.toContain("credencial-opaca");
  });
});

describe("mcpCallTool", () => {
  it("abre el doble sobre en el camino feliz", async () => {
    const res = await mcpCallTool(cfg(), "check-availability", { guests: 4 });
    expect(res.outcome).toEqual({ ok: true, data: { success: true, available_count: 1 } });
    expect(res.httpStatus).toBe(200);
    expect(res.bytes).toBeGreaterThan(0);
  });

  it("un rechazo con código estable NO lanza: vuelve como outcome para el perfil", async () => {
    const res = await mcpCallTool(cfg(), "check-availability", { city: "carlos paz" });
    expect(res.outcome).toEqual({
      ok: false,
      code: "unknown_city",
      details: { accepted: ["Potrero de Garay", "San Clemente"] },
    });
  });

  it("unauthorized del proveedor SÍ lanza (es la credencial, no la consulta)", async () => {
    await expect(
      mcpCallTool(cfg({ credential: null }), "check-availability", {})
    ).rejects.toMatchObject({ code: "unauthorized", providerCode: "unauthorized" });
  });

  it("D4: con sandbox true no sale ni una request", async () => {
    const config = cfg({ sandbox: true });
    await expect(mcpCallTool(config, "check-availability", {})).rejects.toMatchObject({
      code: "sandbox_violation",
    });
    expect(seen).toHaveLength(0);
  });
});
