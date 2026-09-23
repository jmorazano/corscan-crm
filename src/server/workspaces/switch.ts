import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Cambio de espacio de trabajo (018, FR-002): SOLO a empresas de las que
 * el usuario es miembro. No pasa por los endpoints del plugin organization
 * (siguen negados por el gate de 003): la sesión se actualiza con Drizzle
 * y la última empresa usada queda recordada en el usuario (FR-009).
 */

export type SwitchWorkspaceInput = {
  userId: string;
  sessionId: string;
  organizationId: string;
};

export type SwitchWorkspaceResult =
  | { ok: true; organizationId: string }
  | { ok: false; code: "not_member"; message: string };

export async function switchWorkspace(
  input: SwitchWorkspaceInput
): Promise<SwitchWorkspaceResult> {
  const db = getDb();
  const rows = await db
    .select({ organizationId: schema.member.organizationId })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.userId, input.userId),
        eq(schema.member.organizationId, input.organizationId)
      )
    )
    .limit(1);
  if (!rows[0]) {
    // Mismo código exista o no la empresa: no revela existencia.
    return {
      ok: false,
      code: "not_member",
      message: "No sos miembro de ese espacio de trabajo",
    };
  }
  const now = new Date();
  await db
    .update(schema.session)
    .set({ activeOrganizationId: input.organizationId, updatedAt: now })
    .where(eq(schema.session.id, input.sessionId));
  await db
    .update(schema.user)
    .set({ lastOrganizationId: input.organizationId, updatedAt: now })
    .where(eq(schema.user.id, input.userId));
  return { ok: true, organizationId: input.organizationId };
}
