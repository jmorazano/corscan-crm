import {
  McpError,
  mcpCallTool,
  type McpEndpointConfig,
  type McpTool,
  type McpToolUnwrap,
} from "@/lib/mcp";
import { miniHotelCallTool, parseMiniHotelCredential } from "@/lib/minihotel";
import type { McpIntegration } from "@/server/mcp/integration";
import { localToday } from "@/server/mcp/profiles/minihotel";
import { readMiniHotelConfig } from "@/server/mcp/profiles/minihotel-config";

/**
 * Despacho por TRANSPORTE (028). El único archivo que mira
 * `profile.transport`: `calls.ts` sigue siendo la única puerta a la red y
 * llama acá ya con allowlist, sandbox, credencial, cupo y caché resueltos.
 *
 * - `mcp`       → JSON-RPC de 016 (`src/lib/mcp`).
 * - `minihotel` → API XML de MiniHotel (`src/lib/minihotel`), con la
 *   credencial `{username,password}` y la config no secreta de la fila.
 */

export type ProviderCallResult = {
  outcome: McpToolUnwrap;
  httpStatus: number;
  bytes: number;
};

export async function callProviderTool(input: {
  integration: McpIntegration;
  /** Descifrada por `calls.ts` en el momento del uso. Acá no se guarda. */
  credential: string;
  tool: string;
  args: Record<string, unknown>;
  timeoutMs: number;
  now?: Date;
}): Promise<ProviderCallResult> {
  const { integration } = input;

  if (integration.profile.transport === "minihotel") {
    const credential = parseMiniHotelCredential(input.credential);
    // Un secreto que no es {usuario, contraseña} es una credencial rota:
    // misma salida que un rechazo del proveedor.
    if (!credential) throw new McpError("unauthorized", { providerCode: "auth" });
    const config = readMiniHotelConfig(integration.providerConfig);
    if (!config) throw new McpError("not_allowed");
    const result = await miniHotelCallTool(
      {
        ariEndpoint: integration.endpointUrl,
        username: credential.username,
        password: credential.password,
        hotelId: config.hotelId,
        rateCode: config.rateCode,
        timeoutMs: input.timeoutMs,
        maxResponseBytes: integration.maxResponseBytes,
        today: localToday(input.now ?? new Date(), integration.timezone),
        sandbox: false,
      },
      input.tool,
      input.args
    );
    return { outcome: result.outcome, httpStatus: result.httpStatus, bytes: result.bytes };
  }

  const cfg: McpEndpointConfig = {
    endpointUrl: integration.endpointUrl,
    credential: input.credential,
    authScheme: integration.authScheme,
    timeoutMs: input.timeoutMs,
    maxResponseBytes: integration.maxResponseBytes,
    sandbox: false,
  };
  const result = await mcpCallTool(cfg, input.tool, input.args);
  return { outcome: result.outcome, httpStatus: result.httpStatus, bytes: result.bytes };
}

/**
 * Lo que se guarda como "herramientas" de una integración MiniHotel tras
 * verificar: las NUESTRAS (virtuales), con su traducción a las operaciones
 * reales de lectura. MiniHotel no publica una lista: la allowlist es del
 * perfil, y esto es lo que la UI muestra para que el dueño sepa qué se usa.
 */
export const MINIHOTEL_HANDSHAKE_TOOLS: McpTool[] = [
  {
    name: "availability",
    description: "Disponibilidad y tarifas (Immediate ARI) y fechas alternativas (Bulk ARI).",
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: true },
  },
  {
    name: "room_catalog",
    description: "Tipos de habitación, capacidad y atributos (getRoomTypes y getRooms).",
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: true },
  },
];

/** Motivos de reconexión que vale la pena distinguir en la interfaz (D8). */
export const PROVIDER_REASONS: ReadonlySet<string> = new Set([
  "auth",
  "hotel",
  "ip_not_authorized",
  "rate_code",
]);
