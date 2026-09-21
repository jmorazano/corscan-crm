import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { renderKb } from "@/server/ai/prompts";

/**
 * Servicio del knowledge base (015, D8): única vía de escritura compartida
 * por las rutas `/api/kb*`, la sugerencia del Laboratorio y el entrenador.
 * Centraliza límites, coherencia `kind`↔campos y el origen de cada entrada.
 */

export type KbEntry = typeof schema.kbEntry.$inferSelect;
export type KbSource = "manual" | "lab" | "trainer";

type Db = ReturnType<typeof getDb>;
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Umbral de aviso del tamaño del KB (≈6k tokens): v1 inyecta todo al prompt. */
export const WARN_CHARS = 24_000;

export const KB_LIMITS = { question: 500, answer: 4000, content: 8000 } as const;

export const kbCreateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("qa"),
    question: z.string().trim().min(1).max(KB_LIMITS.question),
    answer: z.string().trim().min(1).max(KB_LIMITS.answer),
  }),
  z.object({
    kind: z.literal("block"),
    content: z.string().trim().min(1).max(KB_LIMITS.content),
  }),
]);
export type KbCreateInput = z.infer<typeof kbCreateSchema>;

export const kbPatchSchema = z.object({
  question: z.string().trim().min(1).max(KB_LIMITS.question).optional(),
  answer: z.string().trim().min(1).max(KB_LIMITS.answer).optional(),
  content: z.string().trim().min(1).max(KB_LIMITS.content).optional(),
});
export type KbPatchInput = z.infer<typeof kbPatchSchema>;

export class KbError extends Error {
  constructor(
    public readonly code: "not_found" | "kind_mismatch" | "invalid",
    message: string
  ) {
    super(message);
    this.name = "KbError";
  }
}

/**
 * Coherencia kind↔campos (puro): una P/R no acepta `content`; un bloque no
 * acepta `question`/`answer`. Un patch vacío tampoco vale.
 */
export function coercePatchForKind(
  kind: "qa" | "block",
  patch: KbPatchInput
): KbPatchInput {
  const out: KbPatchInput = {};
  if (kind === "qa") {
    if (patch.content !== undefined) {
      throw new KbError("kind_mismatch", "Una pregunta/respuesta no lleva bloque de texto");
    }
    if (patch.question !== undefined) out.question = patch.question;
    if (patch.answer !== undefined) out.answer = patch.answer;
  } else {
    if (patch.question !== undefined || patch.answer !== undefined) {
      throw new KbError("kind_mismatch", "Un bloque de texto no lleva pregunta ni respuesta");
    }
    if (patch.content !== undefined) out.content = patch.content;
  }
  if (Object.keys(out).length === 0) {
    throw new KbError("invalid", "Nada para cambiar");
  }
  return out;
}

/** Tamaño estimado del KB tal como entra al prompt (FR-020). */
export function kbSize(entries: KbEntry[]): {
  chars: number;
  warnAt: number;
  warning: boolean;
} {
  const chars = renderKb(entries).length;
  return { chars, warnAt: WARN_CHARS, warning: chars >= WARN_CHARS };
}

export async function listEntries(
  organizationId: string,
  db: DbOrTx = getDb()
): Promise<KbEntry[]> {
  return db
    .select()
    .from(schema.kbEntry)
    .where(scoped(schema.kbEntry.organizationId, organizationId))
    .orderBy(asc(schema.kbEntry.createdAt));
}

export async function getEntry(
  organizationId: string,
  id: string,
  db: DbOrTx = getDb()
): Promise<KbEntry | null> {
  const rows = await db
    .select()
    .from(schema.kbEntry)
    .where(
      scoped(schema.kbEntry.organizationId, organizationId, eq(schema.kbEntry.id, id))
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function createEntry(
  organizationId: string,
  input: KbCreateInput,
  source: KbSource = "manual",
  db: DbOrTx = getDb()
): Promise<KbEntry> {
  const inserted = await db
    .insert(schema.kbEntry)
    .values({
      id: newId("kbEntry"),
      organizationId,
      kind: input.kind,
      question: input.kind === "qa" ? input.question : null,
      answer: input.kind === "qa" ? input.answer : null,
      content: input.kind === "block" ? input.content : null,
      source,
    })
    .returning();
  const entry = inserted[0];
  if (!entry) throw new KbError("invalid", "No se pudo crear la entrada");
  return entry;
}

/** Actualiza validando coherencia con el kind de la fila. */
export async function updateEntry(
  organizationId: string,
  id: string,
  patch: KbPatchInput,
  db: DbOrTx = getDb()
): Promise<{ before: KbEntry; after: KbEntry }> {
  const before = await getEntry(organizationId, id, db);
  if (!before) throw new KbError("not_found", "Entrada no encontrada");
  const set = coercePatchForKind(before.kind, patch);
  const updated = await db
    .update(schema.kbEntry)
    .set({ ...set, updatedAt: new Date() })
    .where(
      scoped(schema.kbEntry.organizationId, organizationId, eq(schema.kbEntry.id, id))
    )
    .returning();
  const after = updated[0];
  if (!after) throw new KbError("not_found", "Entrada no encontrada");
  return { before, after };
}

export async function deleteEntry(
  organizationId: string,
  id: string,
  db: DbOrTx = getDb()
): Promise<KbEntry> {
  const deleted = await db
    .delete(schema.kbEntry)
    .where(
      scoped(schema.kbEntry.organizationId, organizationId, eq(schema.kbEntry.id, id))
    )
    .returning();
  const row = deleted[0];
  if (!row) throw new KbError("not_found", "Entrada no encontrada");
  return row;
}

/**
 * Reinserta una entrada borrada con su MISMO id y origen (undo de kb_delete).
 * Si el id volvió a existir, no pisa nada: devuelve false.
 */
export async function restoreEntry(
  organizationId: string,
  row: KbEntry,
  db: DbOrTx = getDb()
): Promise<boolean> {
  if (row.organizationId !== organizationId) {
    throw new KbError("invalid", "La entrada no pertenece a la empresa");
  }
  const inserted = await db
    .insert(schema.kbEntry)
    .values({
      id: row.id,
      organizationId,
      kind: row.kind,
      question: row.question,
      answer: row.answer,
      content: row.content,
      source: row.source,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(),
    })
    .onConflictDoNothing({ target: schema.kbEntry.id })
    .returning({ id: schema.kbEntry.id });
  return inserted.length > 0;
}
