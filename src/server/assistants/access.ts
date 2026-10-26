import { and, eq, gt, inArray, lt, or, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { hashSecret, looksLikeAccessToken } from "@/lib/oauth-server/tokens";
import {
  decideWorkspaceAccess,
  resolveWorkspaceRef,
  workspaceDeniedText,
  type GrantWorkspace,
  type WorkspaceAccess,
} from "@/lib/assistants/authorize";
import { enabledOrganizationIds } from "./settings";

/**
 * Autorización de CADA llamada de un asistente (040, research D7, FR-007).
 * Sin caché: revocar, apagar el switch o quitar al usuario corta desde la
 * consulta siguiente.
 */

export type AssistantCall = {
  grantId: string;
  userId: string;
  clientLabel: string;
  /** Empresas elegidas en el consentimiento (no todas siguen activas). */
  workspaces: GrantWorkspace[];
};

/** `last_used_at` se escribe a lo sumo una vez por minuto. */
const TOUCH_EVERY_MS = 60 * 1000;

export async function resolveAssistantCall(
  bearer: string | null,
  now: Date = new Date()
): Promise<AssistantCall | null> {
  if (!bearer || !looksLikeAccessToken(bearer)) return null;
  const db = getDb();
  const rows = await db
    .select({ grant: schema.assistantGrant })
    .from(schema.assistantToken)
    .innerJoin(schema.assistantGrant, eq(schema.assistantGrant.id, schema.assistantToken.grantId))
    .where(
      and(
        eq(schema.assistantToken.tokenHash, hashSecret(bearer)),
        eq(schema.assistantToken.kind, "access"),
        gt(schema.assistantToken.expiresAt, now),
        eq(schema.assistantGrant.status, "active")
      )
    )
    .limit(1);
  const grant = rows[0]?.grant;
  if (!grant) return null;

  const orgs = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
    })
    .from(schema.assistantGrantOrg)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.assistantGrantOrg.organizationId))
    .where(eq(schema.assistantGrantOrg.grantId, grant.id))
    .orderBy(schema.organization.name);

  if (!grant.lastUsedAt || now.getTime() - grant.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    void db
      .update(schema.assistantGrant)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(schema.assistantGrant.id, grant.id),
          or(
            isNull(schema.assistantGrant.lastUsedAt),
            lt(schema.assistantGrant.lastUsedAt, new Date(now.getTime() - TOUCH_EVERY_MS))
          )
        )
      )
      .catch(() => undefined);
  }

  return {
    grantId: grant.id,
    userId: grant.userId,
    clientLabel: grant.clientLabel,
    workspaces: orgs,
  };
}

/** Estado ACTUAL de cada empresa de la conexión (rol + switch). */
export async function workspaceStatuses(call: AssistantCall): Promise<Map<string, WorkspaceAccess>> {
  const ids = call.workspaces.map((w) => w.id);
  const out = new Map<string, WorkspaceAccess>();
  if (ids.length === 0) return out;
  const [members, enabled] = await Promise.all([
    getDb()
      .select({ organizationId: schema.member.organizationId, role: schema.member.role })
      .from(schema.member)
      .where(and(eq(schema.member.userId, call.userId), inArray(schema.member.organizationId, ids))),
    enabledOrganizationIds(ids),
  ]);
  const roleByOrg = new Map(members.map((m) => [m.organizationId, m.role]));
  for (const id of ids) {
    out.set(
      id,
      decideWorkspaceAccess({ inGrant: true, enabled: enabled.has(id), role: roleByOrg.get(id) ?? null })
    );
  }
  return out;
}

export type WorkspaceAuthorization =
  | { ok: true; workspace: GrantWorkspace }
  | {
      ok: false;
      text: string;
      reason: Exclude<WorkspaceAccess, "ok">;
      /** La empresa existe en la conexión (se registra ahí); null = desconocida. */
      workspace: GrantWorkspace | null;
    };

export async function authorizeWorkspace(
  call: AssistantCall,
  ref: string | undefined
): Promise<WorkspaceAuthorization> {
  const statuses = await workspaceStatuses(call);
  const active = new Set([...statuses].filter(([, s]) => s === "ok").map(([id]) => id));
  const resolved = resolveWorkspaceRef(ref, call.workspaces, active);
  if (!resolved.ok) {
    if (resolved.reason === "ambiguous" && !(ref ?? "").trim()) {
      const names = call.workspaces.filter((w) => active.has(w.id)).map((w) => `«${w.name}»`);
      return {
        ok: false,
        reason: "not_authorized",
        workspace: null,
        text:
          names.length > 0
            ? `Indicá la empresa con el parámetro workspace: ${names.join(", ")}.`
            : "Ninguna de las empresas conectadas está disponible ahora. Usá list_workspaces para ver por qué.",
      };
    }
    return {
      ok: false,
      reason: "not_authorized",
      workspace: null,
      text: workspaceDeniedText("not_authorized", null),
    };
  }
  const status = statuses.get(resolved.workspace.id) ?? "not_authorized";
  if (status !== "ok") {
    return {
      ok: false,
      reason: status,
      workspace: resolved.workspace,
      text: workspaceDeniedText(status, resolved.workspace.name),
    };
  }
  return { ok: true, workspace: resolved.workspace };
}
