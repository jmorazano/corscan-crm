import { count, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/**
 * Aprovisionamiento de empresas (research D3): ÚNICO lugar que siembra una
 * organización — org + slug único + etapas del pipeline + perfil de agente.
 * Lo usan el registro en instancia vacía (on-signup) y la Administración.
 */

/** Subconjunto de la conexión que necesita el aprovisionamiento: sirve
 * tanto la conexión normal como la transacción de on-signup. */
type DbConn = Pick<ReturnType<typeof getDb>, "select" | "insert">;

/** Etapas sembradas del pipeline (paridad con la primera empresa). */
const SEED_STAGES: { name: string; kind: "open" | "won" | "lost" }[] = [
  { name: "Nuevo", kind: "open" },
  { name: "En conversación", kind: "open" },
  { name: "Interesado", kind: "open" },
  { name: "Cliente", kind: "won" },
  { name: "Perdido", kind: "lost" },
];

/** Slug interno a partir del nombre visible (D11): ascii, minúsculas, guiones. */
export function slugify(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "empresa";
}

export type ProvisionResult = {
  organizationId: string;
  slug: string;
  /** true si se reutilizó una org homónima vacía (reintento post-crash). */
  reused: boolean;
};

/**
 * Crea (o recupera) una organización sembrada.
 *
 * - Slug único: `slugify(nombre)` + sufijo numérico en colisión (D11).
 * - Recuperación post-crash: una org homónima SIN miembros es una huérfana
 *   de un intento anterior — se reutiliza (y se completan sus seeds) en vez
 *   de crear otra (idempotencia recuperable, contrato admin-api.md).
 * - Sin transacción global posible (el alta de usuario escribe vía el
 *   adapter de Better Auth): las constraints únicas de slug respaldan la
 *   concurrencia.
 */
export async function provisionOrganization(
  { name, slug: preferredSlug }: { name: string; slug?: string },
  db: DbConn = getDb()
): Promise<ProvisionResult> {
  const trimmedName = name.trim();

  const homonyms = await db
    .select({ id: schema.organization.id, slug: schema.organization.slug })
    .from(schema.organization)
    .where(eq(schema.organization.name, trimmedName));
  for (const org of homonyms) {
    const [members] = await db
      .select({ n: count() })
      .from(schema.member)
      .where(eq(schema.member.organizationId, org.id));
    if ((members?.n ?? 0) === 0) {
      await ensureSeeds(db, org.id);
      return { organizationId: org.id, slug: org.slug ?? "", reused: true };
    }
  }

  const slug = await uniqueSlug(db, preferredSlug ?? slugify(trimmedName));
  const organizationId = newId("organization");
  await db.insert(schema.organization).values({
    id: organizationId,
    name: trimmedName,
    slug,
  });
  await ensureSeeds(db, organizationId);
  return { organizationId, slug, reused: false };
}

async function uniqueSlug(db: DbConn, base: string): Promise<string> {
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    const existing = await db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.slug, candidate));
    if (existing.length === 0) return candidate;
  }
}

/** Seeds re-ejecutables: solo inserta lo que falte (reuso de huérfana). */
async function ensureSeeds(db: DbConn, organizationId: string): Promise<void> {
  const [stages] = await db
    .select({ n: count() })
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, organizationId));
  if ((stages?.n ?? 0) === 0) {
    await db.insert(schema.pipelineStage).values(
      SEED_STAGES.map((s, i) => ({
        id: newId("stage"),
        organizationId,
        name: s.name,
        position: i,
        kind: s.kind,
      }))
    );
  }
  const [profiles] = await db
    .select({ n: count() })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId));
  if ((profiles?.n ?? 0) === 0) {
    await db.insert(schema.agentProfile).values({
      id: newId("agentProfile"),
      organizationId,
    });
  }
}
