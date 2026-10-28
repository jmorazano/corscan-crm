import { asc, count, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  MAX_ORIGIN_RULES,
  META_ADS_TAG,
  matchOriginRules,
  opensConversation,
  originTag,
  type OriginRuleInput,
} from "@/lib/contact-origin";
import { MAX_TAGS_PER_CONTACT, sanitizeTags } from "@/lib/tags";

/**
 * Etiquetas de origen en el contacto (043). Las reglas puras viven en
 * `src/lib/contact-origin.ts`; acá solo la escritura y las reglas guardadas
 * de cada empresa.
 *
 * Lo llama SOLO la ingesta de entrantes EN VIVO de WhatsApp
 * (`ingestInboundMessage`): el historial y los ecos de 017 tienen su propio
 * camino y nunca etiquetan, y el sandbox no tiene anuncios.
 */

/**
 * Suma las etiquetas que falten (sin duplicar ni pasar el tope de 004) y
 * corre `origin_at` al instante más nuevo. Un único UPDATE: dos mensajes del
 * mismo contacto que llegan juntos no se pisan las etiquetas.
 */
export async function addContactOriginTags(input: {
  organizationId: string;
  contactId: string;
  tags: string[];
  at: Date;
}): Promise<void> {
  const tags = sanitizeTags(input.tags);
  if (tags.length === 0) return;
  const at = Number.isNaN(input.at.getTime()) ? new Date() : input.at;
  const missing = sql`array(select t from unnest(array[${sql.join(
    tags.map((t) => sql`${t}`),
    sql`, `
  )}]::text[]) with ordinality as n(t, i) where not (t = any(${schema.contact.tags})) order by i)`;
  const room = sql`greatest(${MAX_TAGS_PER_CONTACT} - cardinality(${schema.contact.tags}), 0)`;
  await getDb()
    .update(schema.contact)
    .set({
      tags: sql`${schema.contact.tags} || (${missing})[1:${room}]`,
      // Date dentro de sql`` no se serializa: va como texto ISO (UTC, como la BD).
      originAt: sql`greatest(${schema.contact.originAt}, ${at.toISOString()}::timestamp)`,
      updatedAt: new Date(),
    })
    .where(
      scoped(
        schema.contact.organizationId,
        input.organizationId,
        eq(schema.contact.id, input.contactId),
        eq(schema.contact.isTest, false)
      )
    );
}

/** La etiqueta de un anuncio de Meta aplicado (035): `meta-ads-AAAA-MM`. */
export async function tagMetaAdContact(input: {
  organizationId: string;
  contactId: string;
  at: Date;
}): Promise<void> {
  await addContactOriginTags({
    organizationId: input.organizationId,
    contactId: input.contactId,
    tags: [originTag(META_ADS_TAG, input.at)],
    at: input.at,
  });
}

export async function listOriginRules(organizationId: string) {
  return getDb()
    .select()
    .from(schema.contactOriginRule)
    .where(scoped(schema.contactOriginRule.organizationId, organizationId))
    .orderBy(asc(schema.contactOriginRule.createdAt));
}

export type CreateOriginRuleResult =
  | { ok: true; rule: typeof schema.contactOriginRule.$inferSelect }
  | { ok: false; code: "limit" };

export async function createOriginRule(
  organizationId: string,
  input: OriginRuleInput
): Promise<CreateOriginRuleResult> {
  const db = getDb();
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(schema.contactOriginRule)
    .where(scoped(schema.contactOriginRule.organizationId, organizationId));
  if (n >= MAX_ORIGIN_RULES) return { ok: false, code: "limit" };
  const [rule] = await db
    .insert(schema.contactOriginRule)
    .values({
      id: newId("contactOriginRule"),
      organizationId,
      phrase: input.phrase,
      tag: input.tag,
      appendMonth: input.appendMonth,
    })
    .returning();
  if (!rule) throw new Error("no se pudo guardar la regla");
  return { ok: true, rule };
}

export async function deleteOriginRule(organizationId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(schema.contactOriginRule)
    .where(
      scoped(
        schema.contactOriginRule.organizationId,
        organizationId,
        eq(schema.contactOriginRule.id, id)
      )
    )
    .returning({ id: schema.contactOriginRule.id });
  return rows.length > 0;
}

/**
 * Reglas por frase sobre el mensaje que abre la charla. Devuelve las
 * etiquetas que sumó (vacío si no correspondía o nada coincidió).
 */
export async function applyOriginRules(input: {
  organizationId: string;
  contactId: string;
  /** `last_inbound_at` de la conversación ANTES de este mensaje. */
  previousInboundAt: Date | null;
  text: string | null;
  at: Date;
}): Promise<string[]> {
  if (!input.text?.trim()) return [];
  if (!opensConversation(input.previousInboundAt, input.at)) return [];
  const rules = await listOriginRules(input.organizationId);
  if (rules.length === 0) return [];
  const tags = matchOriginRules(input.text, rules, input.at);
  if (tags.length === 0) return [];
  await addContactOriginTags({
    organizationId: input.organizationId,
    contactId: input.contactId,
    tags,
    at: input.at,
  });
  return tags;
}
