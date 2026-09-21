import { and, desc, eq, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { TRAINER_CONTACT_PHONE } from "@/lib/trainer";
import { isAiConfigured } from "@/server/ai/credentials";
import type { DbOrTx } from "@/server/kb/service";

/**
 * Conversación del entrenador (015, D1–D3): UNA por empresa, con un contacto
 * sintético archivado e `is_test` (los guards de sandbox existentes la
 * excluyen de envíos, campañas, pipeline y facets). Se crea de forma
 * perezosa e idempotente al listar la Bandeja, solo si la empresa tiene IA
 * configurada.
 */

export type TrainerRow = {
  conversation: typeof schema.conversation.$inferSelect;
  contact: typeof schema.contact.$inferSelect;
  /** Último mensaje del hilo (texto o tipo), para la fila fija. */
  preview: string | null;
};

const previewSql = sql<string | null>`(
  select coalesce(m.text, m.type)
  from message m
  where m.conversation_id = ${schema.conversation.id}
  order by m.created_at desc
  limit 1
)`;

/** Condición para excluir el contacto sintético de listados de contactos. */
export function notTrainerContact() {
  return ne(schema.contact.phone, TRAINER_CONTACT_PHONE);
}

export function isTrainerContact(contact: { phone: string }): boolean {
  return contact.phone === TRAINER_CONTACT_PHONE;
}

/** Solo lectura: la conversación del entrenador si existe (aunque la IA
 * esté apagada). */
export async function getTrainerConversation(
  organizationId: string,
  db: DbOrTx = getDb()
): Promise<TrainerRow | null> {
  const rows = await db
    .select({
      conversation: schema.conversation,
      contact: schema.contact,
      preview: previewSql,
    })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.kind, "trainer")
      )
    )
    .orderBy(desc(schema.conversation.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Devuelve la conversación del entrenador creándola si falta; `null` si la
 * empresa no tiene IA configurada (la fila desaparece de la Bandeja sin
 * borrar el historial). Reconcilia el nombre del contacto con el del agente.
 */
export async function ensureTrainerConversation(
  organizationId: string
): Promise<TrainerRow | null> {
  if (!(await isAiConfigured(organizationId))) return null;
  const db = getDb();

  const profileRows = await db
    .select({ name: schema.agentProfile.name })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const agentName = profileRows[0]?.name ?? "Asistente";

  const existing = await getTrainerConversation(organizationId, db);
  if (existing) {
    if (existing.contact.name !== agentName) {
      await syncTrainerContactName(organizationId, agentName, db);
      existing.contact.name = agentName;
    }
    return existing;
  }

  const contactId = await upsertTrainerContact(organizationId, agentName, db);
  await db
    .insert(schema.conversation)
    .values({
      id: newId("conversation"),
      organizationId,
      contactId,
      kind: "trainer",
      isTest: true,
      aiEnabled: true,
    })
    .onConflictDoNothing();
  return getTrainerConversation(organizationId, db);
}

async function upsertTrainerContact(
  organizationId: string,
  name: string,
  db: DbOrTx
): Promise<string> {
  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId,
      phone: TRAINER_CONTACT_PHONE,
      name,
      isTest: true,
      archivedAt: new Date(),
    })
    .onConflictDoNothing({
      target: [schema.contact.organizationId, schema.contact.phone],
    })
    .returning({ id: schema.contact.id });
  if (inserted[0]) return inserted[0].id;
  const rows = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.organizationId, organizationId),
        eq(schema.contact.phone, TRAINER_CONTACT_PHONE)
      )
    )
    .limit(1);
  return rows[0]!.id;
}

/** El agente se renombró (por Agente o por el chat): la fila lo refleja. */
export async function syncTrainerContactName(
  organizationId: string,
  name: string,
  db: DbOrTx = getDb()
): Promise<void> {
  await db
    .update(schema.contact)
    .set({ name, updatedAt: new Date() })
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        eq(schema.contact.phone, TRAINER_CONTACT_PHONE),
        ne(schema.contact.name, name)
      )
    );
}
