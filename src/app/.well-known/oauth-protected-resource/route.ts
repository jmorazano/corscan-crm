import { protectedResourceMetadata } from "@/lib/oauth-server/metadata";
import { publicMetadata } from "@/lib/oauth-server/http";
import { assistantBase } from "@/server/assistants/authorize";

export const dynamic = "force-dynamic";

/**
 * 040 (RFC 9728): metadatos del recurso MCP, en la raíz para los clientes que
 * no agregan el path del recurso (el canónico está en `…/api/mcp`).
 */
export function GET(): Response {
  return publicMetadata(protectedResourceMetadata(assistantBase()));
}
