import { count, eq, gt, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  MAX_TAG_CONTACTS_PER_CALL,
  MAX_TAGGING_CALLS_PER_HOUR,
  summarizeTagging,
  type TagRequest,
  type TaggedRow,
  type TaggingSummary,
} from "@/lib/assistants/tagging";
import { BULK_MAX_IDS, bulkUpdateContactTags } from "@/server/tags";
import { contactSearchWhere, type ContactSearchFilter } from "./tools/contacts";

/**
 * 046: etiquetar contactos desde Claude. Selección por ids o por el MISMO
 * filtro de `search_contacts` con la cantidad que el asistente vio
 * (`expected_count`): si la búsqueda cambió, no se toca nada. Fuera los
 * contactos del Laboratorio y el sintético del Entrenador (`is_test`). La
 * escritura es la del etiquetado en bloque de la Bandeja (006/033).
 */

export const TAG_CONTACTS_TOOL = "tag_contacts";

const HOUR_MS = 60 * 60 * 1000;

export type TagSelection =
  | { contactIds: string[] }
  | { filter: ContactSearchFilter; expectedCount: number };

export type TagContactsOutcome =
  | ({ ok: true; matched: number; remainingThisHour: number } & TaggingSummary)
  | {
      ok: false;
      code: "rate_limited" | "selection_changed" | "too_many" | "no_tags";
      message: string;
      /** En `selection_changed`/`too_many`: lo que hoy coincide. */
      matching?: number;
    };

/** Llamadas aceptadas en la última hora (el registro es la fuente). */
async function recentTaggingCalls(organizationId: string, now: Date): Promise<{ n: number; oldest: Date | null }> {
  const rows = await getDb()
    .select({ createdAt: schema.assistantAccessLog.createdAt })
    .from(schema.assistantAccessLog)
    .where(
      scoped(
        schema.assistantAccessLog.organizationId,
        organizationId,
        eq(schema.assistantAccessLog.tool, TAG_CONTACTS_TOOL),
        eq(schema.assistantAccessLog.outcome, "ok"),
        gt(schema.assistantAccessLog.createdAt, new Date(now.getTime() - HOUR_MS))
      )
    )
    .orderBy(schema.assistantAccessLog.createdAt);
  return { n: rows.length, oldest: rows[0]?.createdAt ?? null };
}

function hourLabel(date: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(date);
}

async function resolveIds(organizationId: string, selection: TagSelection): Promise<
  { ok: true; ids: string[] } | Extract<TagContactsOutcome, { ok: false }>
> {
  const db = getDb();
  const ct = schema.contact;
  if ("contactIds" in selection) {
    const wanted = [...new Set(selection.contactIds)].slice(0, BULK_MAX_IDS);
    const rows = await db
      .select({ id: ct.id })
      .from(ct)
      .where(scoped(ct.organizationId, organizationId, inArray(ct.id, wanted), eq(ct.isTest, false)));
    return { ok: true, ids: rows.map((r) => r.id) };
  }
  const where = contactSearchWhere(organizationId, selection.filter);
  const total = (await db.select({ n: count() }).from(ct).where(where))[0]?.n ?? 0;
  if (total > MAX_TAG_CONTACTS_PER_CALL) {
    return {
      ok: false,
      code: "too_many",
      matching: total,
      message: `La búsqueda abarca ${total} contactos y el tope por llamada es ${MAX_TAG_CONTACTS_PER_CALL}: acotala con más filtros o hacelo desde Contactos en el CRM.`,
    };
  }
  if (total !== selection.expectedCount) {
    return {
      ok: false,
      code: "selection_changed",
      matching: total,
      message: `La búsqueda hoy abarca ${total} contactos, no ${selection.expectedCount}: no toqué nada. Volvé a mirarla con search_contacts y confirmá con la persona.`,
    };
  }
  const rows = await db.select({ id: ct.id }).from(ct).where(where);
  return { ok: true, ids: rows.map((r) => r.id) };
}

export async function tagContactsFromAssistant(
  organizationId: string,
  selection: TagSelection,
  request: Pick<TagRequest, "add" | "remove">,
  now: Date = new Date()
): Promise<TagContactsOutcome> {
  if (request.add.length === 0 && request.remove.length === 0) {
    return { ok: false, code: "no_tags", message: "No quedó ninguna etiqueta válida para agregar o quitar." };
  }
  const recent = await recentTaggingCalls(organizationId, now);
  if (recent.n >= MAX_TAGGING_CALLS_PER_HOUR) {
    const retryAt = new Date((recent.oldest ?? now).getTime() + HOUR_MS);
    return {
      ok: false,
      code: "rate_limited",
      message: `Tope de ${MAX_TAGGING_CALLS_PER_HOUR} etiquetados por hora desde Claude: volvé a probar desde las ${hourLabel(retryAt)}.`,
    };
  }

  const resolved = await resolveIds(organizationId, selection);
  if (!resolved.ok) return resolved;

  const rows: TaggedRow[] = [];
  for (let i = 0; i < resolved.ids.length; i += BULK_MAX_IDS) {
    const chunk = resolved.ids.slice(i, i + BULK_MAX_IDS);
    const result = await bulkUpdateContactTags(organizationId, chunk, request);
    rows.push(...result.rows);
  }
  const summary = summarizeTagging(rows, request);
  return {
    ok: true,
    matched: rows.length,
    // Esta llamada también cuenta: el registro la anota como aceptada.
    remainingThisHour: Math.max(0, MAX_TAGGING_CALLS_PER_HOUR - recent.n - 1),
    ...summary,
  };
}
