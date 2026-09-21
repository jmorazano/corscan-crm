import { McpError } from "./errors";
import { postJsonRpc, type McpRequestFn } from "./transport";
import {
  MCP_PROTOCOL_VERSION,
  initializeResultSchema,
  isUnauthorizedCode,
  parseJsonRpcResult,
  toolsListResultSchema,
  unwrapToolResult,
  type McpSession,
  type McpTool,
  type McpToolUnwrap,
} from "./types";

/**
 * Cliente MCP: `initialize`, `tools/list`, `tools/call` (016, design §C.1).
 *
 * Adaptador PURO del protocolo — el equivalente exacto de
 * `src/lib/google/calendar-client.ts` y `src/lib/meta/client.ts`, que la
 * Constitución II (categoría 5, letra e) exige para cada dependencia externa.
 * Cero imports de `@/server/*`, de `@/lib/db` y de `@/lib/env` salvo el
 * `isMockEnabled()` que `ssrf.ts` lee por su cuenta.
 *
 * El servidor real es SIN ESTADO (hallazgo 1, verificado con credencial):
 * `tools/list` y `tools/call` responden 200 sin `Mcp-Session-Id` y sin
 * `notifications/initialized`. Por eso el modo normal es UN POST por llamada;
 * la sesión se reenvía solo si el caller la tiene (`sessionMode:"initialize"`).
 */

export * from "./errors";
export * from "./ssrf";
export * from "./transport";
export * from "./types";

/** `meta` (credencial dentro del cuerpo) queda FUERA de v1 (corrección #15):
 * el cuerpo se audita y se loguea; el header no. */
export type McpAuthScheme = "bearer" | "api_key_header";

export type McpEndpointConfig = {
  endpointUrl: string;
  /** Descifrada por el caller. Este módulo no la guarda ni la loguea. */
  credential: string | null;
  authScheme: McpAuthScheme;
  /** Header para `api_key_header`. Default `X-API-Key`. */
  apiKeyHeader?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** D4: viaja explícito por parámetro en toda la cadena, nunca por un global. */
  sandbox: boolean;
  /** Inyectable en tests. */
  request?: McpRequestFn;
};

/** 10 s: la latencia real medida es 0,66-1,31 s (hallazgo 9). */
export const DEFAULT_MCP_TIMEOUT_MS = 10_000;
/** 512 KB: la respuesta más grande medida es 19 KB (hallazgo 8). */
export const DEFAULT_MCP_MAX_RESPONSE_BYTES = 512 * 1024;

let nextId = 1;

function rpcId(): number {
  nextId = nextId >= Number.MAX_SAFE_INTEGER ? 1 : nextId + 1;
  return nextId;
}

/**
 * Headers de la llamada. Se arman POR REQUEST y se descartan: nunca viven en
 * un objeto de config reutilizable que pueda quedar colgado de un log
 * (Constitución I).
 */
function authHeaders(cfg: McpEndpointConfig, session?: McpSession): Record<string, string> {
  const headers: Record<string, string> = {};
  if (cfg.credential) {
    if (cfg.authScheme === "bearer") {
      headers.authorization = `Bearer ${cfg.credential}`;
    } else {
      headers[(cfg.apiKeyHeader ?? "X-API-Key").toLowerCase()] = cfg.credential;
    }
  }
  if (session?.sessionId) headers["mcp-session-id"] = session.sessionId;
  return headers;
}

async function rpc(
  cfg: McpEndpointConfig,
  method: string,
  params: Record<string, unknown>,
  session?: McpSession
): Promise<{ result: unknown; headers: Record<string, string>; httpStatus: number; bytes: number }> {
  const id = rpcId();
  const res = await postJsonRpc({
    endpointUrl: cfg.endpointUrl,
    headers: authHeaders(cfg, session),
    body: { jsonrpc: "2.0", id, method, params },
    timeoutMs: cfg.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS,
    maxResponseBytes: cfg.maxResponseBytes ?? DEFAULT_MCP_MAX_RESPONSE_BYTES,
    sandbox: cfg.sandbox,
    ...(cfg.request ? { request: cfg.request } : {}),
  });
  return {
    result: parseJsonRpcResult(res.json, id),
    headers: res.headers,
    httpStatus: res.httpStatus,
    bytes: res.bytes,
  };
}

/**
 * Handshake. Devuelve el `serverInfo`, las `instructions` (texto AJENO: no
 * entra a ningún prompt sin sanear y sin que el dueño lo tilde) y el
 * `mcp-session-id` si el servidor lo emite.
 */
export async function mcpInitialize(cfg: McpEndpointConfig): Promise<McpSession> {
  const { result, headers } = await rpc(cfg, "initialize", {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "vocero", version: "1" },
  });
  const parsed = initializeResultSchema.safeParse(result);
  if (!parsed.success) throw new McpError("bad_payload");
  const info = parsed.data.serverInfo ?? null;
  return {
    protocolVersion: parsed.data.protocolVersion ?? MCP_PROTOCOL_VERSION,
    serverName: info?.name ?? null,
    serverVersion: info?.version ?? null,
    instructions: parsed.data.instructions ?? null,
    sessionId: headers["mcp-session-id"] ?? null,
  };
}

export async function mcpListTools(
  cfg: McpEndpointConfig,
  session?: McpSession
): Promise<McpTool[]> {
  const { result } = await rpc(cfg, "tools/list", {}, session);
  const parsed = toolsListResultSchema.safeParse(result);
  if (!parsed.success) throw new McpError("bad_payload");
  return parsed.data.tools;
}

export type McpCallToolResult = {
  outcome: McpToolUnwrap;
  /** `result` crudo del sobre, para la bitácora. Nunca va a un prompt. */
  raw: unknown;
  httpStatus: number;
  bytes: number;
};

/**
 * `tools/call`. NO lanza cuando la herramienta rechaza la consulta con un
 * código estable (`unknown_city`, `date_out_of_window`…): eso vuelve como
 * `outcome.ok === false` para que el perfil arme el texto educativo que le
 * enseña al modelo a corregirse. Sí lanza `unauthorized`, que no es un
 * problema de la consulta sino de la credencial.
 */
export async function mcpCallTool(
  cfg: McpEndpointConfig,
  tool: string,
  args: Record<string, unknown>,
  session?: McpSession
): Promise<McpCallToolResult> {
  const { result, httpStatus, bytes } = await rpc(
    cfg,
    "tools/call",
    { name: tool, arguments: args },
    session
  );
  const outcome = unwrapToolResult(result);
  if (!outcome.ok && isUnauthorizedCode(outcome.code)) {
    throw new McpError("unauthorized", { providerCode: outcome.code, httpStatus });
  }
  return { outcome, raw: result, httpStatus, bytes };
}
