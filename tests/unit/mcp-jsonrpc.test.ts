import { describe, expect, it } from "vitest";
import {
  LATEST_PROTOCOL_VERSION,
  RPC_INVALID_REQUEST,
  RPC_PARSE_ERROR,
  negotiateProtocolVersion,
  parseJsonRpc,
  toolError,
  toolResult,
} from "@/lib/mcp-server/jsonrpc";

/** 040 (research D2/D8): JSON-RPC del servidor MCP de los asistentes. */
describe("parseJsonRpc", () => {
  it("pedido con id y params", () => {
    const r = parseJsonRpc('{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"a":1}}');
    expect(r).toEqual({ ok: true, message: { id: 1, method: "tools/list", params: { a: 1 } } });
  });

  it("notificación sin id", () => {
    const r = parseJsonRpc('{"jsonrpc":"2.0","method":"notifications/initialized"}');
    expect(r.ok && r.message.id).toBeNull();
  });

  it("JSON inválido, lote y forma incorrecta", () => {
    const code = (raw: string) => {
      const r = parseJsonRpc(raw);
      return r.ok ? null : "error" in r.response ? r.response.error.code : null;
    };
    expect(code("{")).toBe(RPC_PARSE_ERROR);
    expect(code('[{"jsonrpc":"2.0","id":1,"method":"ping"}]')).toBe(RPC_INVALID_REQUEST);
    expect(code('{"id":1,"method":"ping"}')).toBe(RPC_INVALID_REQUEST);
    expect(code('{"jsonrpc":"2.0","id":{},"method":"ping"}')).toBe(RPC_INVALID_REQUEST);
    expect(code('"texto"')).toBe(RPC_INVALID_REQUEST);
  });
});

describe("negotiateProtocolVersion", () => {
  it("devuelve la pedida si la soportamos", () => {
    expect(negotiateProtocolVersion("2025-03-26")).toBe("2025-03-26");
    expect(negotiateProtocolVersion("2025-11-25")).toBe("2025-11-25");
  });

  it("si no, la nuestra", () => {
    expect(negotiateProtocolVersion("2024-11-05")).toBe(LATEST_PROTOCOL_VERSION);
    expect(negotiateProtocolVersion(undefined)).toBe(LATEST_PROTOCOL_VERSION);
  });
});

describe("resultados de herramientas", () => {
  it("éxito: structuredContent y el mismo JSON en texto", () => {
    const r = toolResult({ a: 1 });
    expect(r.isError).toBe(false);
    expect(r.structuredContent).toEqual({ a: 1 });
    expect(JSON.parse(r.content[0]!.text)).toEqual({ a: 1 });
  });

  it("error de negocio como texto", () => {
    expect(toolError("no")).toEqual({ content: [{ type: "text", text: "no" }], isError: true });
  });
});
