import { and, desc, ilike, inArray, isNull, not, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { sanitizeTags, type TagMode, type TagOps } from "@/lib/tags";
import { deleteContacts } from "@/server/contacts";
import { BULK_MAX_IDS, bulkUpdateContactTags, tagsWhere } from "@/server/tags";
import { notTrainerContact } from "@/server/trainer/conversation";

/**
 * Selección en bloque de contactos (033). Dos formas:
 * - `ids`: lo tildado a mano (hasta BULK_MAX_IDS, de una página);
 * - `filter` + `excludeIds`: «todos los que coinciden» con los filtros de la
 *   lista, en TODAS las páginas, menos los destildados.
 * El filtro usa el MISMO WHERE que `GET /api/contacts` (`contactListWhere`):
 * lo que la lista cuenta es exactamente lo que la operación toca.
 */

export type ContactListFilter = {
  q?: string;
  archived?: boolean;
  tags?: readonly string[];
  mode?: TagMode;
};

/** WHERE de la lista de contactos (compartido por la lista y el bulk). */
export function contactListWhere(
  organizationId: string,
  filter: ContactListFilter
): SQL | undefined {
  const q = filter.q?.trim();
  return scoped(
    schema.contact.organizationId,
    organizationId,
    q
      ? or(
          ilike(schema.contact.name, `%${q}%`),
          ilike(schema.contact.phone, `%${q}%`)
        )
      : undefined,
    filter.archived ? undefined : isNull(schema.contact.archivedAt),
    tagsWhere(schema.contact.tags, filter.tags ?? [], filter.mode ?? "any"),
    // 015: el contacto sintético del entrenador no es un contacto.
    notTrainerContact()
  );
}

const idSchema = z.string().min(1).max(64);

export const contactFilterSchema = z.object({
  q: z.string().max(200).optional(),
  archived: z.boolean().optional(),
  tags: z.array(z.string().max(80)).max(30).optional(),
  mode: z.enum(["any", "all"]).optional(),
});

/** Selección: exactamente una de `ids` o `filter`. */
export const contactSelectionShape = {
  ids: z.array(idSchema).min(1).max(BULK_MAX_IDS).optional(),
  filter: contactFilterSchema.optional(),
  excludeIds: z.array(idSchema).max(BULK_MAX_IDS).optional(),
};

export type ContactSelection = {
  ids?: string[];
  filter?: ContactListFilter;
  excludeIds?: string[];
};

export function hasExactlyOneSelector(s: ContactSelection): boolean {
  return (s.ids !== undefined) !== (s.filter !== undefined);
}

const selectorMessage = "Indicá `ids` o `filter` (uno de los dos)";

export const bulkDeleteBodySchema = z
  .object({
    ...contactSelectionShape,
    /** Cantidad que la persona confirmó; si la selección cambió → 409. */
    expectedCount: z.number().int().min(1),
  })
  .refine(hasExactlyOneSelector, { message: selectorMessage });

export const bulkContactTagsBodySchema = z
  .object({
    ...contactSelectionShape,
    add: z.array(z.string().max(80)).max(30).optional(),
    remove: z.array(z.string().max(80)).max(30).optional(),
  })
  .refine(hasExactlyOneSelector, { message: selectorMessage })
  .refine(
    (b) => sanitizeTags(b.add).length > 0 || sanitizeTags(b.remove).length > 0,
    { message: "Indicá al menos una etiqueta válida en add o remove" }
  );

/** Ids de la organización que cubre la selección (orden de la lista). */
export async function resolveContactSelection(
  organizationId: string,
  selection: ContactSelection
): Promise<string[]> {
  const db = getDb();
  let where: SQL | undefined;
  if (selection.filter) {
    const exclude = [...new Set(selection.excludeIds ?? [])];
    where = and(
      contactListWhere(organizationId, selection.filter),
      exclude.length > 0 ? not(inArray(schema.contact.id, exclude)) : undefined
    );
  } else {
    const ids = [...new Set(selection.ids ?? [])].slice(0, BULK_MAX_IDS);
    if (ids.length === 0) return [];
    where = scoped(
      schema.contact.organizationId,
      organizationId,
      inArray(schema.contact.id, ids),
      notTrainerContact()
    );
  }
  const rows = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(where)
    .orderBy(desc(schema.contact.updatedAt), desc(schema.contact.id));
  return rows.map((r) => r.id);
}

/** Tamaño de cada transacción del borrado/etiquetado en bloque. */
export const BULK_CHUNK = 200;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type BulkDeleteResult =
  | { ok: true; deleted: number; conversationIds: string[] }
  | { ok: false; reason: "selection_changed"; count: number };

/**
 * Borra en bloque (contactos + conversaciones + mensajes por cascada). Si la
 * selección ya no tiene la cantidad que la persona confirmó (entró un
 * contacto nuevo que coincide, alguien borró otro…), NO borra nada: un
 * borrado irreversible jamás se lleva algo que no se vio en la confirmación.
 */
export async function bulkDeleteContacts(
  organizationId: string,
  selection: ContactSelection,
  expectedCount: number
): Promise<BulkDeleteResult> {
  const ids = await resolveContactSelection(organizationId, selection);
  if (ids.length !== expectedCount) {
    return { ok: false, reason: "selection_changed", count: ids.length };
  }
  let deleted = 0;
  const conversationIds: string[] = [];
  for (const chunk of chunks(ids, BULK_CHUNK)) {
    const result = await deleteContacts(organizationId, chunk);
    deleted += result.deletedIds.length;
    conversationIds.push(...result.conversationIds);
  }
  return { ok: true, deleted, conversationIds };
}

/** Agrega/quita etiquetas sobre la selección, de a tandas. */
export async function bulkTagContacts(
  organizationId: string,
  selection: ContactSelection,
  ops: TagOps
): Promise<{ matched: number; updated: number }> {
  const ids = selection.filter
    ? await resolveContactSelection(organizationId, selection)
    : (selection.ids ?? []);
  let matched = 0;
  let updated = 0;
  for (const chunk of chunks(ids, BULK_MAX_IDS)) {
    const result = await bulkUpdateContactTags(organizationId, chunk, ops);
    matched += result.matched;
    updated += result.updated;
  }
  return { matched, updated };
}
