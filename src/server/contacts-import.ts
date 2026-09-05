import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { normalizeToWaId } from "@/lib/phone";
import { mergeTags, sanitizeTags } from "@/lib/tags";

/**
 * Import masivo de contactos (004, US1 — contrato contacts-import.md).
 * Idempotente por (org, phone): re-importar el mismo archivo no cambia el
 * resultado. El server RE-normaliza cada teléfono (jamás confía en el
 * cliente). Nota deliberada: NO crea conversaciones ni leads, y NUNCA toca
 * opted_out_at ni contactos del Laboratorio (is_test → fila inválida).
 *
 * La lógica de decisión (normalización, dedup interno, merge) es pura —
 * `planImportRows` / `buildContactMerge` — para poder testearla sin BD;
 * `importContacts` es el ejecutor con acceso a datos.
 */

export const MAX_IMPORT_ROWS = 5000;

export type ImportRowInput = {
  phone: string;
  name?: string;
  tags?: string[];
  notes?: string;
};

export type ImportInvalidRow = {
  index: number;
  phone?: string;
  reason: "telefono_invalido" | "telefono_vacio" | "contacto_de_prueba";
};

export type ImportReport = {
  created: number;
  updated: number;
  invalid: ImportInvalidRow[];
};

export type PendingRow = {
  index: number;
  waId: string;
  name: string | null;
  tags: string[];
  notes: string | null;
};

/**
 * Etapa pura 1: normaliza y deduplica DENTRO del archivo (la primera fila
 * gana; las siguientes se fusionan sobre la pendiente y cuentan updated).
 */
export function planImportRows(rows: ImportRowInput[]): {
  pending: PendingRow[];
  invalid: ImportInvalidRow[];
  internalDuplicates: number;
} {
  const invalid: ImportInvalidRow[] = [];
  const byWaId = new Map<string, PendingRow>();
  let internalDuplicates = 0;

  rows.forEach((row, index) => {
    const result = normalizeToWaId(row.phone);
    if (!result.ok) {
      invalid.push({
        index,
        phone: row.phone || undefined,
        reason:
          result.reason === "vacio" ? "telefono_vacio" : "telefono_invalido",
      });
      return;
    }
    const name = row.name?.trim() || null;
    const tags = sanitizeTags(row.tags);
    const notes = row.notes?.trim() || null;
    const pending = byWaId.get(result.waId);
    if (!pending) {
      byWaId.set(result.waId, { index, waId: result.waId, name, tags, notes });
      return;
    }
    internalDuplicates++;
    pending.tags = mergeTags(pending.tags, tags);
    pending.name = pending.name ?? name;
    pending.notes = pending.notes ?? notes;
  });

  return { pending: [...byWaId.values()], invalid, internalDuplicates };
}

export type ExistingContactShape = {
  phone: string;
  name: string;
  notes: string | null;
  tags: string[];
  consentSource: string | null;
};

/**
 * Etapa pura 2: merge conservador sobre un contacto existente. Etiquetas =
 * unión; nombre solo si el actual nunca fue editado (quedó igual al
 * teléfono); notas solo si faltaban; consentimiento solo si no había
 * registro. opted_out_at NO se toca. Devuelve null si no hay nada que
 * cambiar (idempotencia del re-import).
 */
export function buildContactMerge(
  current: ExistingContactShape,
  row: PendingRow,
  now: Date
): Partial<typeof schema.contact.$inferInsert> | null {
  const set: Partial<typeof schema.contact.$inferInsert> = {};
  const merged = mergeTags(current.tags, row.tags);
  if (merged.length !== current.tags.length) set.tags = merged;
  if (row.name && current.name === current.phone) set.name = row.name;
  if (row.notes && !current.notes) set.notes = row.notes;
  if (!current.consentSource) {
    set.consentSource = "import";
    set.consentAt = now;
  }
  if (Object.keys(set).length === 0) return null;
  set.updatedAt = now;
  return set;
}

const CHUNK = 500;

export async function importContacts(
  organizationId: string,
  rows: ImportRowInput[]
): Promise<ImportReport> {
  const db = getDb();
  const { pending, invalid, internalDuplicates } = planImportRows(rows);

  let created = 0;
  let updated = internalDuplicates;
  const now = new Date();

  for (let i = 0; i < pending.length; i += CHUNK) {
    const chunk = pending.slice(i, i + CHUNK);
    const waIds = chunk.map((r) => r.waId);

    const existing = await db
      .select()
      .from(schema.contact)
      .where(
        and(
          eq(schema.contact.organizationId, organizationId),
          inArray(schema.contact.phone, waIds)
        )
      );
    const existingByPhone = new Map(existing.map((c) => [c.phone, c]));

    const toInsert: (typeof schema.contact.$inferInsert)[] = [];
    for (const row of chunk) {
      const current = existingByPhone.get(row.waId);
      if (!current) {
        toInsert.push({
          id: newId("contact"),
          organizationId,
          phone: row.waId,
          name: row.name ?? row.waId,
          notes: row.notes,
          tags: row.tags,
          consentSource: "import",
          consentAt: now,
        });
        continue;
      }

      if (current.isTest) {
        invalid.push({
          index: row.index,
          phone: row.waId,
          reason: "contacto_de_prueba",
        });
        continue;
      }

      const set = buildContactMerge(current, row, now);
      if (set) {
        await db
          .update(schema.contact)
          .set(set)
          .where(eq(schema.contact.id, current.id));
      }
      updated++;
    }

    if (toInsert.length > 0) {
      // onConflictDoNothing cubre la carrera de dos imports simultáneos
      // sobre la misma lista (unique org+phone decide).
      const inserted = await db
        .insert(schema.contact)
        .values(toInsert)
        .onConflictDoNothing({
          target: [schema.contact.organizationId, schema.contact.phone],
        })
        .returning({ id: schema.contact.id });
      created += inserted.length;
      updated += toInsert.length - inserted.length;
    }
  }

  return { created, updated, invalid };
}
