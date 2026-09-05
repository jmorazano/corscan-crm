import { asc, count, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { isSuperAdminEmail } from "@/server/auth/super-admin";

/**
 * Aprovisionamiento de empresas (research D3): ÚNICO lugar que siembra una
 * organización — org + slug único + etapas del pipeline + perfil de agente.
 * Lo usan el registro en instancia vacía (on-signup) y la Administración.
 */

/** Subconjunto de la conexión que necesita el aprovisionamiento: sirve
 * tanto la conexión normal como la transacción de on-signup. */
type DbConn = Pick<ReturnType<typeof getDb>, "select" | "insert">;

/** Conexión completa que necesita la Administración (rollback incluido). */
type AdminDbConn = Pick<
  ReturnType<typeof getDb>,
  "select" | "insert" | "update" | "delete"
>;

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

/* ============================================================
 * Administración (US1): crear empresa + admin inicial, listar empresas
 * ============================================================ */

export type CreateOrganizationWithAdminInput = {
  organizationName: string;
  admin: { name: string; email: string; password: string };
};

export type CreateOrganizationWithAdminResult =
  | { ok: true; organizationId: string; slug: string }
  | {
      ok: false;
      code: "duplicate_email" | "reserved_email" | "invalid";
      message: string;
    };

/**
 * Crea empresa + usuario admin inicial en un solo flujo (contrato
 * admin-api.md, FR-002). Orden: validar email → org → usuario → membresía.
 * Sin transacción global posible (el usuario se escribe vía el adapter de
 * Better Auth): el camino de error hace rollback compensatorio de la org
 * creada en la request, y un crash deja a lo sumo una huérfana sin miembros
 * que el reintento homónimo reutiliza (provisionOrganization).
 */
export async function createOrganizationWithAdmin(
  input: CreateOrganizationWithAdminInput,
  db: AdminDbConn = getDb()
): Promise<CreateOrganizationWithAdminResult> {
  const email = input.admin.email.trim().toLowerCase();

  // FR-016: los correos de SUPER_ADMIN_EMAILS están reservados para la
  // plataforma — nunca son el admin de una empresa (los sombreros no se
  // mezclan, research D10; el contrato lo fija también para este endpoint).
  if (isSuperAdminEmail(email)) {
    return {
      ok: false,
      code: "reserved_email",
      message:
        "Ese correo está reservado para la administración de la plataforma",
    };
  }

  // Validar email ANTES de tocar la base: el duplicado no deja efectos.
  const existing = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email));
  if (existing.length > 0) {
    return {
      ok: false,
      code: "duplicate_email",
      message: "Ya existe una cuenta con ese correo",
    };
  }

  const { organizationId, slug, reused } = await provisionOrganization(
    { name: input.organizationName },
    db
  );

  // Import diferido: @/lib/auth → on-signup → este módulo (ciclo en eval).
  const { getAuth, runInternalSignup } = await import("@/lib/auth");
  let newUserId: string;
  try {
    const result = await runInternalSignup(() =>
      getAuth().api.signUpEmail({
        body: { name: input.admin.name, email, password: input.admin.password },
      })
    );
    newUserId = result.user.id;
  } catch (err) {
    // Rollback compensatorio: solo la org creada en ESTA request (una
    // huérfana reusada ya existía y sigue siendo recuperable).
    if (!reused) {
      try {
        await db
          .delete(schema.organization)
          .where(eq(schema.organization.id, organizationId));
      } catch (rollbackErr) {
        console.error("[admin] rollback de org falló:", rollbackErr);
      }
    }
    const message =
      err instanceof Error ? err.message : "No se pudo crear la cuenta";
    // Carrera contra el pre-chequeo: el UNIQUE de email manda.
    if (/exist/i.test(message)) {
      return {
        ok: false,
        code: "duplicate_email",
        message: "Ya existe una cuenta con ese correo",
      };
    }
    return { ok: false, code: "invalid", message };
  }

  await db
    .insert(schema.member)
    .values({
      id: newId("organization"),
      organizationId,
      userId: newUserId,
      role: "owner",
    })
    .onConflictDoNothing();

  // Contraseña temporal (FR-017): el admin nuevo debe cambiarla al estrenar
  // la cuenta — corta el acceso del super admin que la generó.
  await db
    .update(schema.user)
    .set({ mustChangePassword: true, updatedAt: new Date() })
    .where(eq(schema.user.id, newUserId));

  return { ok: true, organizationId, slug };
}

export type AdminOrganization = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  whatsappConnected: boolean;
  aiConfigured: boolean;
  members: { userId: string; name: string; email: string; role: string }[];
};

/**
 * Listado de plataforma para Administración (FR-014): empresas con sus
 * usuarios y estados. Deliberadamente SIN scoped(): es el sombrero super
 * admin, y solo expone metadatos (nunca datos de dominio — research D10).
 */
export async function listOrganizations(
  db: AdminDbConn = getDb()
): Promise<AdminOrganization[]> {
  const orgs = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
      createdAt: schema.organization.createdAt,
    })
    .from(schema.organization)
    .orderBy(asc(schema.organization.createdAt), asc(schema.organization.id));

  const members = await db
    .select({
      organizationId: schema.member.organizationId,
      userId: schema.member.userId,
      role: schema.member.role,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .orderBy(asc(schema.member.createdAt), asc(schema.member.id));

  const creds = await db
    .select({
      organizationId: schema.metaCredentials.organizationId,
      status: schema.metaCredentials.status,
    })
    .from(schema.metaCredentials);
  const connected = new Set(
    creds.filter((c) => c.status === "connected").map((c) => c.organizationId)
  );

  // Config de IA por empresa (US3): existe fila en ai_credentials = activa.
  const aiRows = await db
    .select({ organizationId: schema.aiCredentials.organizationId })
    .from(schema.aiCredentials);
  const aiConfiguredOrgs = new Set(aiRows.map((r) => r.organizationId));

  return orgs.map((org) => ({
    id: org.id,
    name: org.name,
    slug: org.slug ?? "",
    createdAt: org.createdAt.toISOString(),
    whatsappConnected: connected.has(org.id),
    aiConfigured: aiConfiguredOrgs.has(org.id),
    members: members
      .filter((m) => m.organizationId === org.id)
      .map((m) => ({
        userId: m.userId,
        name: m.name,
        email: m.email,
        role: m.role,
      })),
  }));
}
