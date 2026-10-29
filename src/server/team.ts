import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  teamMemberActions,
  type TeamActionCode,
  type TeamMemberActions,
  type TeamRole,
} from "@/lib/team";
import type { AdminDbConn } from "@/server/admin/organizations";
import {
  removeOrganizationUser,
  resetUserPassword,
} from "@/server/admin/users";
import { isSuperAdminEmail } from "@/server/auth/super-admin";
import { publish } from "@/server/events/bus";

/**
 * 045: el propietario gestiona su equipo desde Ajustes → Equipo — quitar,
 * restablecer la contraseña y cambiar el rol. Las reglas viven en
 * `teamMemberActions` (puro, compartido con la UI); acá se juntan los
 * hechos de la BD y se reutilizan las mismas operaciones que Administración
 * (019), siempre acotadas a la empresa activa del propietario.
 */

export type TeamMemberDto = {
  /** id de la membresía (`member.id`). */
  id: string;
  userId: string;
  role: string;
  name: string;
  email: string;
  createdAt: string;
  isSelf: boolean;
  /** Otras empresas de la cuenta (la UI lo explica al quitar). */
  otherOrganizations: number;
  actions: TeamMemberActions;
};

type MemberRow = {
  id: string;
  userId: string;
  role: string;
  name: string;
  email: string;
  createdAt: Date;
  memberships: number;
};

async function memberRows(
  organizationId: string,
  db: AdminDbConn,
  userId?: string
): Promise<MemberRow[]> {
  return db
    .select({
      id: schema.member.id,
      userId: schema.member.userId,
      role: schema.member.role,
      name: schema.user.name,
      email: schema.user.email,
      createdAt: schema.member.createdAt,
      memberships: sql<number>`(select count(*)::int from ${schema.member} m2 where m2.user_id = ${schema.member.userId})`,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(
      scoped(
        schema.member.organizationId,
        organizationId,
        userId ? eq(schema.member.userId, userId) : undefined
      )
    );
}

async function ownerCount(
  organizationId: string,
  db: AdminDbConn
): Promise<number> {
  const rows = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(scoped(schema.member.organizationId, organizationId, eq(schema.member.role, "owner")));
  return rows.length;
}

function toDto(
  row: MemberRow,
  operatorUserId: string,
  owners: number
): TeamMemberDto {
  const isSelf = row.userId === operatorUserId;
  const otherOrganizations = Math.max(0, Number(row.memberships) - 1);
  return {
    id: row.id,
    userId: row.userId,
    role: row.role,
    name: row.name,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
    isSelf,
    otherOrganizations,
    actions: teamMemberActions({
      role: row.role,
      isSelf,
      isPlatform: isSuperAdminEmail(row.email),
      otherOrganizations,
      ownerCount: owners,
    }),
  };
}

export async function listTeam(
  organizationId: string,
  operatorUserId: string
): Promise<TeamMemberDto[]> {
  const db = getDb();
  const [rows, owners] = await Promise.all([
    memberRows(organizationId, db),
    ownerCount(organizationId, db),
  ]);
  return rows
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((r) => toDto(r, operatorUserId, owners));
}

export type TeamOperator = {
  organizationId: string;
  userId: string;
  email: string;
};

export type TeamActionError = {
  ok: false;
  code: TeamActionCode | "not_member" | "forbidden";
  message: string;
};

/** Estado HTTP de cada rechazo (lo comparten las tres rutas). */
export function teamErrorStatus(code: TeamActionError["code"]): number {
  if (code === "not_member") return 404;
  if (code === "last_owner" || code === "shared_account") return 409;
  return 403;
}

/**
 * Hechos de la persona en ESTA empresa + la regla. Corre dentro de la
 * transacción con el candado del equipo: la cuenta de propietarios que ve
 * es la definitiva (dos propietarios que se degradan o quitan mutuamente a
 * la vez no dejan la empresa sin dueño).
 */
async function checkTarget(
  op: TeamOperator,
  targetUserId: string,
  action: keyof TeamMemberActions,
  db: AdminDbConn
): Promise<{ ok: true; member: TeamMemberDto } | TeamActionError> {
  const [rows, owners] = await Promise.all([
    memberRows(op.organizationId, db, targetUserId),
    ownerCount(op.organizationId, db),
  ]);
  const row = rows[0];
  if (!row) {
    return {
      ok: false,
      code: "not_member",
      message: "Esa persona no es parte de esta empresa",
    };
  }
  const member = toDto(row, op.userId, owners);
  const check = member.actions[action];
  if (!check.ok) return { ok: false, code: check.code, message: check.reason };
  return { ok: true, member };
}

function withTeamLock<T>(
  organizationId: string,
  fn: (tx: AdminDbConn) => Promise<T>
): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`team:${organizationId}`}))`
    );
    return fn(tx);
  });
}

export async function changeTeamMemberRole(
  op: TeamOperator,
  targetUserId: string,
  role: TeamRole
): Promise<{ ok: true; changed: boolean } | TeamActionError> {
  return withTeamLock(op.organizationId, async (tx) => {
    const checked = await checkTarget(op, targetUserId, "changeRole", tx);
    if (!checked.ok) return checked;
    if (checked.member.role === role) return { ok: true, changed: false };
    await tx
      .update(schema.member)
      .set({ role })
      .where(
        and(
          eq(schema.member.id, checked.member.id),
          eq(schema.member.organizationId, op.organizationId)
        )
      );
    return { ok: true, changed: true };
  });
}

export async function removeTeamMember(
  op: TeamOperator,
  targetUserId: string
): Promise<{ ok: true; accountDeleted: boolean } | TeamActionError> {
  const result = await withTeamLock(
    op.organizationId,
    async (tx): Promise<{ ok: true; accountDeleted: boolean } | TeamActionError> => {
      const checked = await checkTarget(op, targetUserId, "remove", tx);
      if (!checked.ok) return checked;
      const removed = await removeOrganizationUser(
        {
          organizationId: op.organizationId,
          userId: targetUserId,
          operatorEmail: op.email,
        },
        tx
      );
      if (!removed.ok) {
        return {
          ok: false,
          code: removed.code === "not_found" ? "not_member" : removed.code,
          message: removed.message,
        };
      }
      return removed;
    }
  );
  if (result.ok) announceMemberRemoved(op.organizationId, targetUserId);
  return result;
}

/**
 * Temporal nueva sin conocer la vieja: `must_change_password`, sesiones
 * cerradas y asistentes revocados (mismo camino que Administración). Solo
 * cuentas que usan ÚNICAMENTE esta empresa (`shared_account` si no).
 */
export async function resetTeamMemberPassword(
  op: TeamOperator,
  targetUserId: string,
  password: string
): Promise<{ ok: true } | TeamActionError> {
  const checked = await checkTarget(op, targetUserId, "resetPassword", getDb());
  if (!checked.ok) return checked;
  const result = await resetUserPassword({
    userId: targetUserId,
    password,
    operatorEmail: op.email,
  });
  if (!result.ok) {
    return {
      ok: false,
      code: result.code === "not_found" ? "not_member" : result.code,
      message: result.message,
    };
  }
  return { ok: true };
}

/**
 * Después del commit: el stream SSE abierto de esa persona se cierra en el
 * acto (si no, una pestaña abierta seguiría recibiendo la bandeja hasta el
 * tope de vida del stream). Lo usan Equipo y Administración.
 */
export function announceMemberRemoved(
  organizationId: string,
  userId: string
): void {
  publish(organizationId, { type: "team.member_removed", data: { userId } });
}
