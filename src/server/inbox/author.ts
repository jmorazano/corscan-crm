import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * 048: el nombre de quien manda un mensaje desde el CRM, para copiarlo en
 * `message.sent_by_name` (la firma del hilo sobrevive a que la cuenta se
 * elimine). Sin autor (agente, campaña, API) → null. Nunca lanza: una firma
 * que falta no frena un envío.
 */
export async function authorName(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  try {
    const [row] = await getDb()
      .select({ name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);
    const name = row?.name?.trim();
    return name ? name : null;
  } catch (err) {
    console.error("[firma] no se pudo leer el nombre:", err instanceof Error ? err.message : err);
    return null;
  }
}
