import { and, asc, count, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { provisionOrganization } from "@/server/admin/organizations";

/**
 * Primer registro de la instancia: crea la organización, deja al usuario como
 * propietario y siembra pipeline + perfil del agente (vía
 * provisionOrganization, el único lugar que siembra empresas).
 *
 * Solo actúa si NO existe ninguna organización (las cuentas de equipo las crea
 * el propietario y reciben su membresía explícita). Un advisory lock evita que
 * dos registros simultáneos en instancia vacía creen dos organizaciones.
 */
export async function onUserCreated(userId: string, userName: string) {
  const db = getDb();
  await db.transaction(async (tx) => {
    // Lock transaccional de "primer arranque" (clave arbitraria fija):
    // dos registros simultáneos en instancia vacía → solo uno crea la org.
    await tx.execute(sql`select pg_advisory_xact_lock(874201)`);
    const [orgs] = await tx
      .select({ n: count() })
      .from(schema.organization);
    if ((orgs?.n ?? 0) > 0) return;

    // El slug de la primera empresa sigue siendo "principal" (D11).
    const { organizationId } = await provisionOrganization(
      {
        name: userName ? `Negocio de ${userName}` : "Mi negocio",
        slug: "principal",
      },
      tx
    );
    await tx.insert(schema.member).values({
      id: newId("organization"),
      organizationId,
      userId,
      role: "owner",
    });
  });
}

export type Membership = { organizationId: string; role: string };

/**
 * Organización activa al CREAR la sesión (login): la última usada por el
 * usuario (018, FR-009) si sigue siendo miembro; si no, la más antigua.
 */
export async function resolveLoginOrganizationId(
  userId: string
): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ last: schema.user.lastOrganizationId })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  const resolved = await resolveActiveMembership(userId, rows[0]?.last ?? null);
  return resolved?.organizationId ?? null;
}

/** Organización activa de un usuario (su primera membresía). */
export async function resolveActiveOrganizationId(
  userId: string
): Promise<string | null> {
  return (await resolveMembership(userId))?.organizationId ?? null;
}

/**
 * Membresía activa (018, FR-001): la que pide la sesión
 * (`preferredOrganizationId`) si el usuario ES miembro de esa empresa; si
 * no (empresa removida, sesión vieja sin empresa, id ajeno), la más
 * antigua — determinismo de FR-012 (003). `matchedPreferred` le dice al
 * llamador si la sesión hay que repararla.
 */
export async function resolveActiveMembership(
  userId: string,
  preferredOrganizationId: string | null | undefined
): Promise<(Membership & { matchedPreferred: boolean }) | null> {
  if (preferredOrganizationId) {
    const db = getDb();
    const rows = await db
      .select({
        organizationId: schema.member.organizationId,
        role: schema.member.role,
      })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.userId, userId),
          eq(schema.member.organizationId, preferredOrganizationId)
        )
      )
      .limit(1);
    const match = rows[0];
    if (match) return { ...match, matchedPreferred: true };
  }
  const oldest = await resolveMembership(userId);
  return oldest ? { ...oldest, matchedPreferred: false } : null;
}

export async function resolveMembership(
  userId: string
): Promise<Membership | null> {
  const db = getDb();
  const rows = await db
    .select({
      organizationId: schema.member.organizationId,
      role: schema.member.role,
    })
    .from(schema.member)
    .where(eq(schema.member.userId, userId))
    // Determinismo (FR-012): con más de una membresía, siempre gana la más
    // antigua — sin ORDER BY el resultado dependería del plan de la query.
    .orderBy(asc(schema.member.createdAt), asc(schema.member.id))
    .limit(1);
  return rows[0] ?? null;
}
