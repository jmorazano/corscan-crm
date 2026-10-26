import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { normalizeBase, resourceUrl } from "@/lib/oauth-server/metadata";
import {
  buildRedirect,
  validateAuthorizeRequest,
  type AuthorizeParams,
  type AuthorizeRequest,
  type AuthorizeValidation,
} from "@/lib/oauth-server/params";
import { clientLabelFor } from "@/lib/oauth-server/redirect-uris";
import { getClient, markClientAuthorized } from "./clients";
import { createAuthCode } from "./codes";
import { enabledOrganizationIds } from "./settings";

/**
 * Consentimiento de un asistente (040, research D6). Lo comparten la página
 * `/oauth/authorize` y su POST: el POST vuelve a validar TODO y recalcula las
 * empresas autorizables (no confía en el formulario).
 */

export function assistantBase(): string {
  return normalizeBase(getEnv().APP_BASE_URL);
}

export function assistantResource(): string {
  return resourceUrl(assistantBase());
}

export async function validateAuthorize(
  params: AuthorizeParams
): Promise<{ validation: AuthorizeValidation; clientName: string | null }> {
  const client = params.client_id ? await getClient(params.client_id) : null;
  const validation = validateAuthorizeRequest(params, {
    resource: assistantResource(),
    client: client ? { id: client.id, redirectUris: client.redirectUris } : null,
  });
  return { validation, clientName: client?.clientName ?? null };
}

export type ConsentWorkspace = {
  id: string;
  name: string;
  role: string;
  authorizable: boolean;
  /** Por qué no se puede tildar (null si se puede). */
  blockedReason: "not_owner" | "disabled" | null;
};

/** Empresas del usuario y cuáles puede autorizar AHORA (owner + switch). */
export async function consentWorkspaces(userId: string): Promise<ConsentWorkspace[]> {
  const memberships = await getDb()
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      role: schema.member.role,
    })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(eq(schema.member.userId, userId))
    .orderBy(schema.organization.name);
  const enabled = await enabledOrganizationIds(memberships.map((m) => m.id));
  return memberships.map((m) => {
    const blockedReason = m.role !== "owner" ? "not_owner" : !enabled.has(m.id) ? "disabled" : null;
    return { ...m, authorizable: blockedReason === null, blockedReason };
  });
}

export type ApproveResult =
  | { ok: true; redirect: string }
  | { ok: false; code: "no_workspaces" };

export async function approveAuthorization(input: {
  userId: string;
  request: AuthorizeRequest;
  organizationIds: readonly string[];
}): Promise<ApproveResult> {
  const allowed = new Set(
    (await consentWorkspaces(input.userId)).filter((w) => w.authorizable).map((w) => w.id)
  );
  const chosen = [...new Set(input.organizationIds)].filter((id) => allowed.has(id));
  if (chosen.length === 0) return { ok: false, code: "no_workspaces" };
  const code = await createAuthCode({
    clientId: input.request.clientId,
    userId: input.userId,
    organizationIds: chosen,
    redirectUri: input.request.redirectUri,
    codeChallenge: input.request.codeChallenge,
    resource: input.request.resource,
  });
  await markClientAuthorized(input.request.clientId);
  return { ok: true, redirect: buildRedirect(input.request.redirectUri, { code }, input.request.state) };
}

export function denyRedirect(request: AuthorizeRequest): string {
  return buildRedirect(
    request.redirectUri,
    { error: "access_denied", error_description: "La persona no autorizó el acceso" },
    request.state
  );
}

export { clientLabelFor };
