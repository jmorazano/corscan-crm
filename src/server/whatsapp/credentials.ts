import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";

export type Credentials = {
  id: string;
  organizationId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: "connected" | "reconnect_required";
  token: string;
};

type Row = typeof schema.metaCredentials.$inferSelect;

function toCredentials(row: Row): Credentials {
  return {
    id: row.id,
    organizationId: row.organizationId,
    wabaId: row.wabaId,
    phoneNumberId: row.phoneNumberId,
    displayPhoneNumber: row.displayPhoneNumber,
    verifiedName: row.verifiedName,
    status: row.status,
    token: decryptSecret({
      cipher: row.tokenCipher,
      iv: row.tokenIv,
      tag: row.tokenTag,
    }),
  };
}

/** Resuelve la conexión por phone_number_id (enrutamiento del webhook). */
export async function getCredentialsByPhoneNumberId(
  phoneNumberId: string
): Promise<Credentials | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.metaCredentials)
    .where(eq(schema.metaCredentials.phoneNumberId, phoneNumberId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/**
 * TODAS las conexiones de una WABA (eventos a nivel WABA, ej. plantillas).
 * waba_id NO es único en la instancia: dos organizaciones pueden conectar dos
 * números de la misma WABA (p. ej. WABA paraguas con un número por cliente).
 * Un `limit 1` sin ORDER BY enrutaría el evento a una org arbitraria — el
 * consumidor debe aplicar el evento por organización (US2).
 */
export async function getCredentialsListByWabaId(
  wabaId: string
): Promise<Credentials[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.metaCredentials)
    .where(eq(schema.metaCredentials.wabaId, wabaId));
  return rows.map(toCredentials);
}

export async function getCredentialsByOrg(
  organizationId: string
): Promise<Credentials | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.metaCredentials)
    .where(scoped(schema.metaCredentials.organizationId, organizationId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/**
 * El phone_number_id ya está conectado a OTRA organización (índice único
 * meta_credentials_phone_uq). Caso real de agencia: doble alta o traspaso de
 * cliente entre orgs. Se degrada a un 409 accionable — sin revelar a qué
 * organización pertenece el número (US2).
 */
export class PhoneNumberInUseError extends Error {
  constructor() {
    super(
      "Ese número ya está conectado a otra empresa de esta instancia. " +
        "Desconéctalo allí primero o contacta al administrador de la plataforma."
    );
    this.name = "PhoneNumberInUseError";
  }
}

/** Violación del unique de phone_number_id (PG 23505 + constraint). */
function isPhoneUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const candidates = [err, (err as { cause?: unknown }).cause].filter(
    (e): e is Record<string, unknown> => typeof e === "object" && e !== null
  );
  return candidates.some(
    (e) =>
      e.code === "23505" &&
      String(e.constraint_name ?? e.constraint ?? "").includes(
        "meta_credentials_phone_uq"
      )
  );
}

export async function saveCredentials(input: {
  organizationId: string;
  wabaId: string;
  phoneNumberId: string;
  token: string;
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
}): Promise<void> {
  const db = getDb();
  const enc = encryptSecret(input.token);
  try {
    await db
      .insert(schema.metaCredentials)
      .values({
        id: newId("credentials"),
        organizationId: input.organizationId,
        wabaId: input.wabaId,
        phoneNumberId: input.phoneNumberId,
        displayPhoneNumber: input.displayPhoneNumber ?? null,
        verifiedName: input.verifiedName ?? null,
        tokenCipher: enc.cipher,
        tokenIv: enc.iv,
        tokenTag: enc.tag,
        status: "connected",
      })
      .onConflictDoUpdate({
        target: [schema.metaCredentials.organizationId],
        set: {
          wabaId: input.wabaId,
          phoneNumberId: input.phoneNumberId,
          displayPhoneNumber: input.displayPhoneNumber ?? null,
          verifiedName: input.verifiedName ?? null,
          tokenCipher: enc.cipher,
          tokenIv: enc.iv,
          tokenTag: enc.tag,
          status: "connected",
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    // El índice único ya impidió el secuestro del número (fails-closed);
    // acá solo se convierte el error crudo de Postgres en uno entendible.
    if (isPhoneUniqueViolation(err)) throw new PhoneNumberInUseError();
    throw err;
  }
}

/** Marca la conexión como vencida (token inválido detectado en runtime). */
export async function markReconnectRequired(
  organizationId: string
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.metaCredentials)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(scoped(schema.metaCredentials.organizationId, organizationId));
}

/** Últimos 4 caracteres del token para mostrar en UI (jamás el token). */
export function tokenLast4(token: string): string {
  return token.slice(-4);
}
