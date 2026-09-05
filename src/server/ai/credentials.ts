import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";
import type { AiConfig } from "@/lib/ai";

/**
 * Config de IA POR EMPRESA (US3, contrato ai-settings.md) — patrón calcado de
 * whatsapp/credentials.ts: token cifrado en reposo (AES-256-GCM), a la UI solo
 * viajan los últimos 4 caracteres, y todo acceso va scoped por organización.
 */

/**
 * Defaults de PRODUCTO (research D8): tras la migración de los envs
 * OPENROUTER_MODEL/OPENROUTER_JUDGE_MODEL a Ajustes, el default ya no es de
 * instancia sino del producto — constantes deliberadamente hardcodeadas.
 * Una empresa que no elige modelo usa estos.
 */
export const DEFAULT_AGENT_MODEL = "anthropic/claude-sonnet-4.5";
export const DEFAULT_JUDGE_MODEL = "anthropic/claude-haiku-4.5";

/** Lo que la UI puede ver de la config (jamás el token completo). */
export type AiSettings = {
  tokenLast4: string;
  /** Modelo elegido por la empresa; null = usa el default de producto. */
  model: string | null;
  judgeModel: string | null;
};

/**
 * Config resuelta para runtime (defaults de producto aplicados): lo que
 * consume chatJson. `null` = la empresa no configuró IA → agente y
 * Laboratorio cortan ANTES de llamar al proveedor (FR-010).
 *
 * Resolución del juez (data-model): judge_model explícito → ese; sin juez
 * pero con modelo de agente propio → el del agente (mismo criterio que la
 * era de envs); sin nada → el default de producto del juez (más barato).
 */
export async function getAiConfig(
  organizationId: string
): Promise<AiConfig | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.aiCredentials)
    .where(scoped(schema.aiCredentials.organizationId, organizationId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    token: decryptSecret({
      cipher: row.tokenCipher,
      iv: row.tokenIv,
      tag: row.tokenTag,
    }),
    model: row.model ?? DEFAULT_AGENT_MODEL,
    judgeModel: row.judgeModel ?? row.model ?? DEFAULT_JUDGE_MODEL,
  };
}

/** ¿La empresa tiene IA configurada? (sin descifrar el token). */
export async function isAiConfigured(
  organizationId: string
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.aiCredentials.id })
    .from(schema.aiCredentials)
    .where(scoped(schema.aiCredentials.organizationId, organizationId))
    .limit(1);
  return rows.length > 0;
}

/** Vista para la UI de Ajustes (GET del contrato): last4 + modelos crudos. */
export async function getAiSettings(
  organizationId: string
): Promise<AiSettings | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.aiCredentials)
    .where(scoped(schema.aiCredentials.organizationId, organizationId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    tokenLast4: tokenLast4(
      decryptSecret({
        cipher: row.tokenCipher,
        iv: row.tokenIv,
        tag: row.tokenTag,
      })
    ),
    model: row.model,
    judgeModel: row.judgeModel,
  };
}

/** Upsert por organización (rotación de token incluida). */
export async function saveAiConfig(input: {
  organizationId: string;
  token: string;
  model?: string | null;
  judgeModel?: string | null;
}): Promise<void> {
  const db = getDb();
  const enc = encryptSecret(input.token);
  await db
    .insert(schema.aiCredentials)
    .values({
      id: newId("aiCredentials"),
      organizationId: input.organizationId,
      tokenCipher: enc.cipher,
      tokenIv: enc.iv,
      tokenTag: enc.tag,
      model: input.model ?? null,
      judgeModel: input.judgeModel ?? null,
    })
    .onConflictDoUpdate({
      target: [schema.aiCredentials.organizationId],
      set: {
        tokenCipher: enc.cipher,
        tokenIv: enc.iv,
        tokenTag: enc.tag,
        model: input.model ?? null,
        judgeModel: input.judgeModel ?? null,
        updatedAt: new Date(),
      },
    });
}

/**
 * Borra la config (DELETE físico, data-model): el agente y el Laboratorio de
 * la empresa quedan inactivos con aviso. Idempotente: borrar lo que no existe
 * no es error.
 */
export async function deleteAiConfig(organizationId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.aiCredentials)
    .where(scoped(schema.aiCredentials.organizationId, organizationId));
}

/** Últimos 4 caracteres del token para mostrar en UI (jamás el token). */
export function tokenLast4(token: string): string {
  return token.slice(-4);
}
