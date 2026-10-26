import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/**
 * Switch «Permitir asistentes externos» por empresa (040, FR-005). Sin fila
 * = apagado: la empresa tiene que encenderlo a propósito.
 */

export type AssistantSettingsDto = {
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

export async function getAssistantSettings(organizationId: string): Promise<AssistantSettingsDto> {
  const rows = await getDb()
    .select({
      enabled: schema.assistantSettings.enabled,
      updatedAt: schema.assistantSettings.updatedAt,
      updatedBy: schema.user.name,
    })
    .from(schema.assistantSettings)
    .leftJoin(schema.user, eq(schema.user.id, schema.assistantSettings.updatedByUserId))
    .where(scoped(schema.assistantSettings.organizationId, organizationId))
    .limit(1);
  const row = rows[0];
  return {
    enabled: row?.enabled ?? false,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

export async function setAssistantsEnabled(
  organizationId: string,
  enabled: boolean,
  userId: string
): Promise<void> {
  const now = new Date();
  await getDb()
    .insert(schema.assistantSettings)
    .values({ organizationId, enabled, updatedByUserId: userId, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.assistantSettings.organizationId,
      set: { enabled, updatedByUserId: userId, updatedAt: now },
    });
}

/** Empresas (de la lista dada) con el switch encendido. */
export async function enabledOrganizationIds(organizationIds: readonly string[]): Promise<Set<string>> {
  if (organizationIds.length === 0) return new Set();
  // `inArray` sobre la PK acota a las empresas pedidas (todas del usuario).
  const rows = await getDb()
    .select({ id: schema.assistantSettings.organizationId })
    .from(schema.assistantSettings)
    .where(
      and(
        inArray(schema.assistantSettings.organizationId, [...organizationIds]),
        eq(schema.assistantSettings.enabled, true)
      )
    );
  return new Set(rows.map((r) => r.id));
}
