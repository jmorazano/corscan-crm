import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import {
  changeTeamMemberRole,
  removeTeamMember,
  teamErrorStatus,
} from "@/server/team";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ userId: string }> };

const roleSchema = z.object({ role: z.enum(["owner", "member"]) });

/**
 * 045: cambiar el rol de una persona del equipo (solo en esta empresa).
 * 404 `not_member`, 409 `last_owner`, 403 `self`/`platform`.
 */
export const PATCH = withOwner(async (session, req: Request, ctx: Params) => {
  const { userId } = await ctx.params;
  const body = await parseBody(req, roleSchema);
  if (!body.ok) return body.response;
  const result = await changeTeamMemberRole(session, userId, body.data.role);
  if (!result.ok) {
    return apiError(teamErrorStatus(result.code), result.code, result.message);
  }
  return Response.json({ ok: true, changed: result.changed });
});

/**
 * 045: quitar a una persona de la empresa. Si no pertenece a ninguna otra,
 * su cuenta se elimina (`accountDeleted`), como en Administración.
 */
export const DELETE = withOwner(async (session, _req: Request, ctx: Params) => {
  const { userId } = await ctx.params;
  const result = await removeTeamMember(session, userId);
  if (!result.ok) {
    return apiError(teamErrorStatus(result.code), result.code, result.message);
  }
  return Response.json({ ok: true, accountDeleted: result.accountDeleted });
});
