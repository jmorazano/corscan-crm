import { apiError, withOwner } from "@/lib/api";
import { grantIncludesOrganization, grantOwnerId, revokeGrant } from "@/server/assistants/grants";

export const dynamic = "force-dynamic";

/**
 * Revoca una conexión entera (040, contracts/settings-api.md). Solo si
 * incluye ESTA empresa; idempotente (ya revocada → 200).
 */
export const DELETE = withOwner(
  async (session, _req: Request, ctx: { params: Promise<{ grantId: string }> }) => {
    const { grantId } = await ctx.params;
    if (!(await grantIncludesOrganization(grantId, session.organizationId))) {
      return apiError(404, "not_found", "Conexión no encontrada");
    }
    const ownerId = await grantOwnerId(grantId);
    await revokeGrant(grantId, ownerId === session.userId ? "user" : "owner", session.userId);
    return Response.json({ ok: true });
  }
);
