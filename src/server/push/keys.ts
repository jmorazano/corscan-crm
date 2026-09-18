import webpush from "web-push";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getEnv } from "@/lib/env";

export type VapidKeys = { publicKey: string; privateKey: string };

/**
 * Claves VAPID POR EMPRESA (013, FR-002): se generan al primer uso y la
 * privada se guarda cifrada. Dos requests simultáneos no duplican: el
 * insert es `onConflictDoNothing` y se re-lee.
 */
export async function getOrCreateVapidKeys(
  organizationId: string
): Promise<VapidKeys> {
  const db = getDb();
  const read = async () => {
    const [row] = await db
      .select()
      .from(schema.pushVapidKey)
      .where(eq(schema.pushVapidKey.organizationId, organizationId))
      .limit(1);
    return row
      ? { publicKey: row.publicKey, privateKey: decryptSecret(row.privateKey) }
      : null;
  };
  const existing = await read();
  if (existing) return existing;

  const generated = webpush.generateVAPIDKeys();
  await db
    .insert(schema.pushVapidKey)
    .values({
      organizationId,
      publicKey: generated.publicKey,
      privateKey: encryptSecret(generated.privateKey),
    })
    .onConflictDoNothing();
  const after = await read();
  if (!after) throw new Error("No se pudieron persistir las claves VAPID");
  return after;
}

/**
 * «Subject» VAPID (a quién contactar si el push service tiene problemas):
 * env opcional; si no, la URL pública de la app cuando es https, o un
 * mailto neutro (los push services exigen https: o mailto:).
 */
export function vapidSubject(): string {
  const env = getEnv();
  if (env.VAPID_SUBJECT) return env.VAPID_SUBJECT;
  if (env.APP_BASE_URL.startsWith("https://")) return env.APP_BASE_URL;
  return "mailto:vocero@example.com";
}
