import { bearerFromHeader } from "@/lib/api-keys";
import { RPC_INVALID_REQUEST, parseJsonRpc, rpcError } from "@/lib/mcp-server/jsonrpc";
import { wwwAuthenticate } from "@/lib/oauth-server/metadata";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveAssistantCall } from "@/server/assistants/access";
import { assistantBase } from "@/server/assistants/authorize";
import { handleMcpRequest } from "@/server/assistants/server";

export const dynamic = "force-dynamic";

/** 60 llamadas por minuto por conexión (FR-026). */
const MCP_RATE_LIMIT = { windowMs: 60 * 1000, max: 60 };
/** Un pedido JSON-RPC de herramientas nunca necesita más que esto. */
const MAX_BODY_BYTES = 64 * 1024;

function unauthorized(hadToken: boolean): Response {
  return Response.json(
    { error: "invalid_token", error_description: "Volvé a conectar el asistente" },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": wwwAuthenticate(assistantBase(), { invalidToken: hadToken }),
        "Cache-Control": "no-store",
      },
    }
  );
}

/**
 * 040: servidor MCP de SOLO LECTURA (contracts/mcp-tools.md). HTTP
 * streamable sin estado: un mensaje JSON-RPC por POST, respuesta JSON.
 * El bearer jamás se loguea.
 */
export async function POST(req: Request): Promise<Response> {
  const bearer = bearerFromHeader(req.headers.get("authorization"));
  const call = await resolveAssistantCall(bearer);
  if (!call) return unauthorized(bearer !== null);

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json(rpcError(null, RPC_INVALID_REQUEST, "Pedido demasiado grande"), { status: 413 });
  }
  const parsed = parseJsonRpc(raw);
  if (!parsed.ok) return Response.json(parsed.response, { status: 400 });

  if (parsed.message.method === "tools/call" && !checkRateLimit(`assistant:${call.grantId}`, MCP_RATE_LIMIT).allowed) {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: parsed.message.id,
        result: {
          content: [{ type: "text", text: "Demasiadas consultas seguidas: esperá un minuto y seguimos." }],
          isError: true,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const response = await handleMcpRequest(call, parsed.message);
  if (response === null) return new Response(null, { status: 202 });
  return Response.json(response, { headers: { "Cache-Control": "no-store" } });
}

function methodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
