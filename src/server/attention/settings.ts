import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { newId } from "@/lib/db/ids";
import { DEFAULT_ATTENTION_SETTINGS, type AttentionSettings } from "@/lib/team-attention";

/** 048: aviso al propietario por empresa. Sin fila = apagado, 15 min. */
export async function getAttentionSettings(organizationId: string): Promise<AttentionSettings> {
  const [row] = await getDb()
    .select({
      alertEnabled: schema.attentionSettings.alertEnabled,
      alertMinutes: schema.attentionSettings.alertMinutes,
    })
    .from(schema.attentionSettings)
    .where(scoped(schema.attentionSettings.organizationId, organizationId))
    .limit(1);
  return row ?? DEFAULT_ATTENTION_SETTINGS;
}

/** Los de varias empresas a la vez (el barrido). */
export async function getAttentionSettingsMany(
  organizationIds: readonly string[]
): Promise<Map<string, AttentionSettings>> {
  const result = new Map<string, AttentionSettings>();
  for (const id of new Set(organizationIds)) {
    result.set(id, await getAttentionSettings(id));
  }
  return result;
}

export async function putAttentionSettings(
  organizationId: string,
  input: AttentionSettings
): Promise<AttentionSettings> {
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .insert(schema.attentionSettings)
    .values({
      id: newId("attentionSettings"),
      organizationId,
      alertEnabled: input.alertEnabled,
      alertMinutes: input.alertMinutes,
    })
    .onConflictDoUpdate({
      target: schema.attentionSettings.organizationId,
      set: { alertEnabled: input.alertEnabled, alertMinutes: input.alertMinutes, updatedAt: now },
    })
    .returning();
  return row
    ? { alertEnabled: row.alertEnabled, alertMinutes: row.alertMinutes }
    : getAttentionSettings(organizationId);
}

/** ¿La persona tiene notificaciones activas en algún dispositivo de esta empresa? */
export async function userHasPush(organizationId: string, userId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: schema.pushSubscription.id })
    .from(schema.pushSubscription)
    .where(
      scoped(
        schema.pushSubscription.organizationId,
        organizationId,
        eq(schema.pushSubscription.userId, userId)
      )
    )
    .limit(1);
  return Boolean(row);
}
