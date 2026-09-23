import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { brandingFromMetadata } from "@/server/branding";
import { unreadByOrganization } from "@/server/workspaces/unread";

/**
 * Espacios de trabajo (018): las empresas de las que un usuario es
 * miembro, en el orden ESTABLE del rail (antigüedad de la membresía, id)
 * para que los atajos ⌘/Ctrl+N no se corran de un día para otro.
 */

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  role: string;
  /** Color del mosaico: el acento de la marca de esa empresa o, si dejó el
   * acento por defecto, un color estable derivado de su id (para que dos
   * empresas sin marca propia no se vean iguales en el rail). */
  accent: string;
  /** Mensajes sin leer de esa empresa (misma regla que el badge de Bandeja). */
  unread: number;
};

type MembershipRow = {
  organizationId: string;
  role: string;
  name: string;
  slug: string | null;
  metadata: string | null;
};

async function listMembershipRows(userId: string): Promise<MembershipRow[]> {
  const db = getDb();
  return db
    .select({
      organizationId: schema.member.organizationId,
      role: schema.member.role,
      name: schema.organization.name,
      slug: schema.organization.slug,
      metadata: schema.organization.metadata,
    })
    .from(schema.member)
    .innerJoin(
      schema.organization,
      eq(schema.member.organizationId, schema.organization.id)
    )
    .where(eq(schema.member.userId, userId))
    .orderBy(asc(schema.member.createdAt), asc(schema.member.id));
}

/** Paleta sobria (misma familia que los avatares) para empresas sin acento propio. */
const TILE_COLORS = [
  "#5b7291",
  "#6f8378",
  "#8c7d68",
  "#9c7169",
  "#77708c",
  "#4f7d78",
  "#647082",
  "#7a6a8a",
] as const;

export function tileColor(organizationId: string, accent: string): string {
  if (accent.toLowerCase() !== DEFAULT_BRANDING.accent) return accent;
  let hash = 0;
  for (let i = 0; i < organizationId.length; i++) {
    hash = (hash * 31 + organizationId.charCodeAt(i)) >>> 0;
  }
  return TILE_COLORS[hash % TILE_COLORS.length] ?? TILE_COLORS[0];
}

/** Solo los ids, en el orden del rail (para el canal SSE). */
export async function listMembershipOrganizationIds(
  userId: string
): Promise<string[]> {
  const rows = await listMembershipRows(userId);
  return rows.map((r) => r.organizationId);
}

/** Espacios con nombre, acento y no leídos (contrato `GET /api/workspaces`). */
export async function listWorkspaces(userId: string): Promise<Workspace[]> {
  const rows = await listMembershipRows(userId);
  if (rows.length === 0) return [];
  const unread = await unreadByOrganization(rows.map((r) => r.organizationId));
  return rows.map((r) => ({
    id: r.organizationId,
    name: r.name,
    slug: r.slug ?? "",
    role: r.role,
    accent: tileColor(r.organizationId, brandingFromMetadata(r.metadata).accent),
    unread: unread.get(r.organizationId) ?? 0,
  }));
}
