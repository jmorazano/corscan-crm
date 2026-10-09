import { arrayContains, count, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  applyTagOps,
  sameTagSet,
  sanitizeTags,
  type TagMode,
  type TagOps,
} from "@/lib/tags";

/**
 * Etiquetas (006): filtro multi-etiqueta en SQL, catálogo por ámbito y
 * operaciones en bloque sobre contactos y conversaciones. Todo scoped a la
 * organización (Constitución III).
 */

export type TagScope = "contacts" | "conversations";

export type TagFacet = { tag: string; count: number };

/** Tope de ids por operación en bloque (el cliente selecciona de a páginas). */
export const BULK_MAX_IDS = 500;

/**
 * Condición WHERE del filtro por etiquetas. `any` = al menos una (OR de
 * `@>` unitarios, usa el índice GIN); `all` = todas (`@>` con el juego
 * completo). Sin etiquetas → sin condición.
 */
export function tagsWhere(
  column: PgColumn,
  tags: readonly string[],
  mode: TagMode
): SQL | undefined {
  const clean = sanitizeTags(tags);
  if (clean.length === 0) return undefined;
  if (mode === "all") return arrayContains(column, clean);
  if (clean.length === 1) return arrayContains(column, clean);
  return or(...clean.map((t) => arrayContains(column, [t])));
}

/** Catálogo de etiquetas de la empresa con su uso, por ámbito. */
export async function listTagFacets(
  organizationId: string,
  scope: TagScope
): Promise<TagFacet[]> {
  const db = getDb();
  const table = scope === "contacts" ? schema.contact : schema.conversation;
  const tagExpr = sql<string>`unnest(${table.tags})`;
  const rows = await db
    .select({ tag: tagExpr, count: count() })
    .from(table)
    .where(
      scoped(table.organizationId, organizationId, eq(table.isTest, false))
    )
    .groupBy(tagExpr)
    .orderBy(sql`count(*) desc`, tagExpr);
  return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
}

export type BulkTagsResult = {
  /** Ids encontrados en la organización. */
  matched: number;
  /** Filas cuyo juego de etiquetas cambió. */
  updated: number;
  updatedIds: string[];
};

/**
 * Agrega/quita etiquetas a un conjunto de filas en una transacción. Ids de
 * otra organización o inexistentes se ignoran. Idempotente: repetir la
 * misma operación deja todo igual y devuelve updated=0.
 */
async function bulkUpdateTags(
  table: typeof schema.contact | typeof schema.conversation,
  organizationId: string,
  ids: readonly string[],
  ops: TagOps
): Promise<BulkTagsResult> {
  const uniqueIds = [...new Set(ids)].slice(0, BULK_MAX_IDS);
  if (uniqueIds.length === 0) return { matched: 0, updated: 0, updatedIds: [] };

  const db = getDb();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: table.id, tags: table.tags })
      .from(table)
      .where(
        scoped(table.organizationId, organizationId, inArray(table.id, uniqueIds))
      );

    const changes = rows
      .map((r) => ({ id: r.id, tags: applyTagOps(r.tags, ops), before: r.tags }))
      .filter((c) => !sameTagSet(c.before, c.tags));

    // Un UPDATE por juego de etiquetas resultante (033): las filas que
    // terminan igual —el caso típico de «todos los que coinciden»— van juntas.
    const byResult = new Map<string, { tags: string[]; ids: string[] }>();
    for (const change of changes) {
      const key = JSON.stringify(change.tags);
      const group = byResult.get(key);
      if (group) group.ids.push(change.id);
      else byResult.set(key, { tags: change.tags, ids: [change.id] });
    }
    const now = new Date();
    for (const group of byResult.values()) {
      await tx
        .update(table)
        .set({ tags: group.tags, updatedAt: now })
        .where(
          scoped(
            table.organizationId,
            organizationId,
            group.ids.length === 1
              ? eq(table.id, group.ids[0]!)
              : inArray(table.id, group.ids)
          )
        );
    }

    return {
      matched: rows.length,
      updated: changes.length,
      updatedIds: changes.map((c) => c.id),
    };
  });
}

export function bulkUpdateContactTags(
  organizationId: string,
  ids: readonly string[],
  ops: TagOps
): Promise<BulkTagsResult> {
  return bulkUpdateTags(schema.contact, organizationId, ids, ops);
}

export function bulkUpdateConversationTags(
  organizationId: string,
  ids: readonly string[],
  ops: TagOps
): Promise<BulkTagsResult> {
  return bulkUpdateTags(schema.conversation, organizationId, ids, ops);
}

/** Body de `POST .../bulk-tags` (contrato tags-api.md). */
export const bulkTagsBodySchema = z
  .object({
    ids: z.array(z.string().min(1).max(64)).min(1).max(BULK_MAX_IDS),
    add: z.array(z.string().max(80)).max(30).optional(),
    remove: z.array(z.string().max(80)).max(30).optional(),
  })
  .refine(
    (b) => sanitizeTags(b.add).length > 0 || sanitizeTags(b.remove).length > 0,
    { message: "Indicá al menos una etiqueta válida en add o remove" }
  );

export type BulkTagsBody = z.infer<typeof bulkTagsBodySchema>;

export function parseTagScope(value: string | null): TagScope | null {
  return value === "contacts" || value === "conversations" ? value : null;
}
