import { z } from "zod";
import { McpError, sanitizeProviderCode } from "./errors";

/**
 * Sobre JSON-RPC del protocolo MCP y su DOBLE SOBRE (016, design §C.1).
 *
 * Todo lo de este archivo es PURO: Zod + parsers, sin red y sin dominio. Es el
 * punto de valor del mcp-mock: si el mock no replica el doble sobre
 * literalmente, este parser nunca se ejercita.
 *
 * Hallazgo verificado contra el servidor real (21-sep-2026): los errores de
 * herramienta llegan con **HTTP 200 + `result.isError:true`**, y el detalle
 * está en un JSON anidado dentro de `result.content[0].text`. Mirar el status
 * HTTP no alcanza nunca.
 */

/** Versión que declara el servidor real de Altos. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

/* ------------------------------------------------------------------ */
/* Sobre JSON-RPC                                                      */
/* ------------------------------------------------------------------ */

const jsonRpcErrorSchema = z.object({
  code: z.number().optional(),
  message: z.unknown().optional(),
  data: z.unknown().optional(),
});

export const jsonRpcResponseSchema = z.object({
  jsonrpc: z.literal("2.0").optional(),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  result: z.unknown().optional(),
  error: jsonRpcErrorSchema.optional(),
});

/**
 * Extrae `result` del sobre. Lanza `McpError` sin un solo byte del remoto:
 * el `message` del `error` JSON-RPC es texto ajeno y se descarta (#13).
 */
export function parseJsonRpcResult(
  raw: unknown,
  expectedId?: string | number | null
): unknown {
  const parsed = jsonRpcResponseSchema.safeParse(raw);
  if (!parsed.success) throw new McpError("bad_payload");
  const envelope = parsed.data;
  if (envelope.error) {
    // Un servidor que exige sesión responde acá (R-1). El código numérico sí
    // es dato estructurado y se conserva como `providerCode`.
    throw new McpError("rpc_error", {
      providerCode:
        typeof envelope.error.code === "number"
          ? `jsonrpc_${Math.abs(envelope.error.code)}`
          : undefined,
    });
  }
  if (
    expectedId !== undefined &&
    expectedId !== null &&
    envelope.id !== undefined &&
    envelope.id !== expectedId
  ) {
    // Respuesta a otra request: no la aceptamos como propia.
    throw new McpError("rpc_error");
  }
  if (envelope.result === undefined) throw new McpError("bad_payload");
  return envelope.result;
}

/* ------------------------------------------------------------------ */
/* initialize / tools/list                                             */
/* ------------------------------------------------------------------ */

export const mcpToolAnnotationsSchema = z.object({
  readOnlyHint: z.boolean().optional(),
  idempotentHint: z.boolean().optional(),
  openWorldHint: z.boolean().optional(),
  destructiveHint: z.boolean().optional(),
});

export const mcpToolSchema = z.object({
  name: z.string().min(1).max(200),
  title: z.string().max(200).nullish(),
  description: z.string().nullish(),
  /** JSON Schema del proveedor: dato opaco, se guarda tal cual. */
  inputSchema: z.unknown().optional(),
  annotations: mcpToolAnnotationsSchema.nullish(),
});

export type McpTool = z.infer<typeof mcpToolSchema>;

export const toolsListResultSchema = z.object({
  tools: z.array(mcpToolSchema).default([]),
});

export const initializeResultSchema = z.object({
  protocolVersion: z.string().max(40).optional(),
  serverInfo: z
    .object({
      name: z.string().max(200).nullish(),
      version: z.string().max(80).nullish(),
    })
    .nullish(),
  instructions: z.string().nullish(),
  capabilities: z.unknown().optional(),
});

export type McpSession = {
  protocolVersion: string;
  serverName: string | null;
  serverVersion: string | null;
  /** Texto AJENO. Nunca entra a un prompt sin sanear y sin consentimiento. */
  instructions: string | null;
  sessionId: string | null;
};

/**
 * Guardrail estructural (hallazgo 4 del servidor real): solo se ofrece al
 * agente una herramienta que se declara de SOLO LECTURA. Sin `readOnlyHint`
 * explícito en `true`, la herramienta no entra al prompt ni se puede
 * ejecutar — así es imposible que el agente reserve, cancele o modifique
 * algo, en este MCP y en cualquier otro futuro.
 */
export function isReadOnlyTool(tool: McpTool): boolean {
  return tool.annotations?.readOnlyHint === true;
}

/* ------------------------------------------------------------------ */
/* Doble sobre de tools/call                                           */
/* ------------------------------------------------------------------ */

export const callToolResultSchema = z.object({
  content: z
    .array(
      z.object({
        type: z.string().optional(),
        text: z.string().optional(),
      })
    )
    .optional(),
  structuredContent: z.unknown().optional(),
  isError: z.boolean().optional(),
});

/** Forma de error del proveedor dentro del JSON anidado. */
export const providerErrorSchema = z.object({
  success: z.literal(false),
  error: z
    .object({ code: z.unknown().optional(), message: z.unknown().optional() })
    .passthrough(),
});

export type McpToolUnwrap =
  | { ok: true; data: unknown }
  | {
      ok: false;
      /** Código estable del proveedor, saneado (`unknown_city`, …). */
      code: string;
      /**
       * Campos ESTRUCTURADOS del error, tal como los devolvió el proveedor
       * (`window`, `accepted`, `max`…): son lo que le permite al modelo
       * autocorregirse en la vuelta siguiente. El `message` del proveedor NO
       * se propaga como texto nuestro: quien renderice estos campos los pasa
       * por `sanitizeForeignText`.
       */
      details: Record<string, unknown> | null;
    };

/**
 * Abre el doble sobre: `result.content[0].text` → `JSON.parse` → payload.
 * Devuelve `{ok:false}` cuando `isError === true` **o** cuando el JSON trae
 * `{success:false, error:{code}}` (el servidor real usa las dos señales a la
 * vez, pero no hay garantía de que siempre sea así).
 */
export function unwrapToolResult(result: unknown): McpToolUnwrap {
  const parsed = callToolResultSchema.safeParse(result);
  if (!parsed.success) throw new McpError("bad_payload");
  const { content, isError, structuredContent } = parsed.data;

  const text = (content ?? []).find(
    (item) => typeof item.text === "string" && (item.type ?? "text") === "text"
  )?.text;

  if (text === undefined) {
    // Un servidor nuevo puede responder solo `structuredContent`.
    if (structuredContent !== undefined && !isError) {
      return { ok: true, data: structuredContent };
    }
    throw new McpError("bad_payload");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    // Texto libre donde esperábamos JSON: no lo propagamos (son bytes de un
    // tercero) y lo tratamos como payload ilegible.
    throw new McpError("bad_payload");
  }

  const providerError = providerErrorSchema.safeParse(payload);
  if (providerError.success) {
    const { code, ...rest } = providerError.data.error as Record<string, unknown>;
    const { message: _message, ...details } = rest;
    return {
      ok: false,
      code: sanitizeProviderCode(code),
      details: Object.keys(details).length > 0 ? details : null,
    };
  }
  if (isError === true) {
    return { ok: false, code: "provider_error", details: null };
  }
  return { ok: true, data: payload };
}

/**
 * `unauthorized` del proveedor ⇒ el mismo código que un 401 HTTP, para que la
 * integración pase a `reconnect_required` por cualquiera de los dos caminos.
 */
export function isUnauthorizedCode(code: string): boolean {
  return code === "unauthorized" || code === "invalid_credential" || code === "forbidden";
}
