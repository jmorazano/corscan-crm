import { z } from "zod";
import { REPLY_DELAY_MAX_MS, REPLY_DELAY_MIN_MS } from "@/lib/agent-timing";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { DbOrTx } from "@/server/kb/service";
import { syncTrainerContactName } from "@/server/trainer/conversation";

/**
 * Servicio del perfil del agente (015, D8): compartido por la página Agente
 * (`PUT /api/agent/profile`) y por el entrenador. Un cambio de nombre se
 * refleja en el contacto sintético de la Bandeja.
 */

export type AgentProfile = typeof schema.agentProfile.$inferSelect;

export const PROFILE_LIMITS = {
  name: 60,
  tone: 500,
  instructions: 8000,
  escalationRules: 4000,
  greeting: 1000,
} as const;

export const profileUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().trim().min(1).max(PROFILE_LIMITS.name).optional(),
  tone: z.string().max(PROFILE_LIMITS.tone).nullable().optional(),
  instructions: z.string().max(PROFILE_LIMITS.instructions).nullable().optional(),
  escalationRules: z.string().max(PROFILE_LIMITS.escalationRules).nullable().optional(),
  greeting: z.string().max(PROFILE_LIMITS.greeting).nullable().optional(),
  /** 022: espera antes de responder (ms); null = default de instancia. */
  replyDelayMs: z
    .number()
    .int()
    .min(REPLY_DELAY_MIN_MS)
    .max(REPLY_DELAY_MAX_MS)
    .nullable()
    .optional(),
});
export type ProfilePatch = z.infer<typeof profileUpdateSchema>;

export class ProfileError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid",
    message: string
  ) {
    super(message);
    this.name = "ProfileError";
  }
}

export async function getProfile(
  organizationId: string,
  db: DbOrTx = getDb()
): Promise<AgentProfile | null> {
  const rows = await db
    .select()
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateProfile(
  organizationId: string,
  patch: ProfilePatch,
  db: DbOrTx = getDb()
): Promise<{ before: AgentProfile; after: AgentProfile }> {
  const before = await getProfile(organizationId, db);
  if (!before) throw new ProfileError("not_found", "Perfil del agente no encontrado");
  const updated = await db
    .update(schema.agentProfile)
    .set({ ...patch, updatedAt: new Date() })
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .returning();
  const after = updated[0];
  if (!after) throw new ProfileError("not_found", "Perfil del agente no encontrado");
  if (patch.name !== undefined && patch.name !== before.name) {
    await syncTrainerContactName(organizationId, after.name, db);
  }
  return { before, after };
}
