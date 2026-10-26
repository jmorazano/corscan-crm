import { and, eq, isNull, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { RegisterRequest } from "@/lib/oauth-server/params";
import { sanitizeForeignText } from "@/server/mcp/sanitize";

/**
 * Clientes registrados por registro dinámico (040, research D4). Son de
 * plataforma (no de una empresa) y su nombre es dato no confiable.
 */

export type AssistantClientRow = typeof schema.assistantClient.$inferSelect;

const MAX_CLIENT_NAME_CHARS = 80;
/** Un cliente que nadie autorizó en este lapso se borra en el barrido. */
const ORPHAN_AFTER_MS = 24 * 60 * 60 * 1000;

export async function registerClient(req: RegisterRequest): Promise<AssistantClientRow> {
  const rows = await getDb()
    .insert(schema.assistantClient)
    .values({
      id: newId("assistantClient"),
      clientName: sanitizeForeignText(req.clientName, MAX_CLIENT_NAME_CHARS) || null,
      redirectUris: req.redirectUris,
      softwareId: sanitizeForeignText(req.softwareId, 200) || null,
      softwareVersion: sanitizeForeignText(req.softwareVersion, 100) || null,
    })
    .returning();
  return rows[0]!;
}

export async function getClient(clientId: string): Promise<AssistantClientRow | null> {
  if (!clientId || clientId.length > 64) return null;
  const rows = await getDb()
    .select()
    .from(schema.assistantClient)
    .where(eq(schema.assistantClient.id, clientId))
    .limit(1);
  return rows[0] ?? null;
}

export async function markClientAuthorized(clientId: string, now: Date = new Date()): Promise<void> {
  await getDb()
    .update(schema.assistantClient)
    .set({ lastAuthorizedAt: now })
    .where(eq(schema.assistantClient.id, clientId));
}

export async function pruneOrphanClients(now: Date = new Date()): Promise<void> {
  await getDb()
    .delete(schema.assistantClient)
    .where(
      and(
        isNull(schema.assistantClient.lastAuthorizedAt),
        lt(schema.assistantClient.createdAt, new Date(now.getTime() - ORPHAN_AFTER_MS))
      )
    );
}

export function serializeClientRegistration(row: AssistantClientRow) {
  return {
    client_id: row.id,
    client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
    client_name: row.clientName ?? undefined,
    redirect_uris: row.redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}
