import { protectedResourceMetadata } from "@/lib/oauth-server/metadata";
import { publicMetadata } from "@/lib/oauth-server/http";
import { assistantBase } from "@/server/assistants/authorize";

export const dynamic = "force-dynamic";

/** 040 (RFC 9728): metadatos del recurso `/api/mcp` (el que nombra el 401). */
export function GET(): Response {
  return publicMetadata(protectedResourceMetadata(assistantBase()));
}
