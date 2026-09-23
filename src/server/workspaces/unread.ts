import { inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * No leídos por empresa (018, FR-006): suma de `conversation.unread_count`
 * con la MISMA regla que el badge de «Bandeja» — el sandbox del
 * Laboratorio no cuenta, salvo la conversación fija del Entrenador (015),
 * que sí suma aunque sea `is_test`.
 *
 * Deliberadamente sin `scoped()`: no es una query de dominio de UNA
 * empresa sino el agregado de las empresas de las que el usuario ES
 * miembro (el llamador pasa esa lista y nada más).
 */
export async function unreadByOrganization(
  organizationIds: readonly string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (organizationIds.length === 0) return result;
  const db = getDb();
  const rows = await db
    .select({
      organizationId: schema.conversation.organizationId,
      unread: sql<number>`coalesce(sum(${schema.conversation.unreadCount}) filter (where ${schema.conversation.isTest} = false or ${schema.conversation.kind} = 'trainer'), 0)`,
    })
    .from(schema.conversation)
    .where(inArray(schema.conversation.organizationId, [...organizationIds]))
    .groupBy(schema.conversation.organizationId);
  for (const row of rows) result.set(row.organizationId, Number(row.unread));
  return result;
}
