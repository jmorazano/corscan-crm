import { authorizationServerMetadata } from "@/lib/oauth-server/metadata";
import { publicMetadata } from "@/lib/oauth-server/http";
import { assistantBase } from "@/server/assistants/authorize";

export const dynamic = "force-dynamic";

/** 040 (RFC 8414): metadatos del servidor de autorización de los asistentes. */
export function GET(): Response {
  return publicMetadata(authorizationServerMetadata(assistantBase()));
}
