/**
 * JSON-RPC 2.0 del servidor MCP de los asistentes (040, research D2 y D8).
 * Módulo PURO: parseo, negociación de versión y forma de los resultados.
 *
 * HTTP streamable sin estado: un mensaje por pedido, sin batch (la revisión
 * 2025-06-18 lo quitó), respuestas siempre JSON.
 */

export const LATEST_PROTOCOL_VERSION = "2025-06-18";
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2025-11-25"] as const;

export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;
export const RPC_INTERNAL_ERROR = -32603;

export type JsonRpcId = string | number;

export type JsonRpcMessage = {
  /** null = notificación (no lleva respuesta). */
  id: JsonRpcId | null;
  method: string;
  params: Record<string, unknown>;
};

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId | null; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId | null; error: { code: number; message: string } };

export function rpcResult(id: JsonRpcId | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function rpcError(id: JsonRpcId | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isId(v: unknown): v is JsonRpcId {
  return typeof v === "string" || (typeof v === "number" && Number.isFinite(v));
}

export function parseJsonRpc(
  raw: string
): { ok: true; message: JsonRpcMessage } | { ok: false; response: JsonRpcResponse } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, response: rpcError(null, RPC_PARSE_ERROR, "JSON inválido") };
  }
  if (Array.isArray(parsed)) {
    return {
      ok: false,
      response: rpcError(null, RPC_INVALID_REQUEST, "No se admiten lotes: un mensaje por pedido"),
    };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, response: rpcError(null, RPC_INVALID_REQUEST, "Pedido inválido") };
  }
  const obj = parsed as Record<string, unknown>;
  const id = isId(obj.id) ? obj.id : null;
  if (obj.jsonrpc !== "2.0" || typeof obj.method !== "string" || obj.method === "") {
    return { ok: false, response: rpcError(id, RPC_INVALID_REQUEST, "Pedido JSON-RPC inválido") };
  }
  if ("id" in obj && obj.id !== undefined && !isId(obj.id)) {
    return { ok: false, response: rpcError(null, RPC_INVALID_REQUEST, "id inválido") };
  }
  const params =
    obj.params && typeof obj.params === "object" && !Array.isArray(obj.params)
      ? (obj.params as Record<string, unknown>)
      : {};
  return { ok: true, message: { id, method: obj.method, params } };
}

/** La versión que pidió el cliente si la soportamos; si no, la nuestra. */
export function negotiateProtocolVersion(requested: unknown): string {
  return typeof requested === "string" &&
    (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION;
}

export type ToolCallResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError: boolean;
};

/** Éxito: `structuredContent` y el mismo objeto como JSON compacto. */
export function toolResult(obj: Record<string, unknown>): ToolCallResult {
  return {
    content: [{ type: "text", text: JSON.stringify(obj) }],
    structuredContent: obj,
    isError: false,
  };
}

/** Error de negocio: el modelo lo ve como texto (no es un error JSON-RPC). */
export function toolError(text: string): ToolCallResult {
  return { content: [{ type: "text", text }], isError: true };
}
