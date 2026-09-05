import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  DEFAULT_BRANDING,
  normalizeBranding,
  type Branding,
} from "@/lib/branding";

/** Marca guardada en organization.metadata (JSON de Better Auth). */

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function getBranding(
  organizationId?: string | null
): Promise<Branding> {
  // Sin organización (login, layout raíz, visitantes anónimos): marca neutra.
  // Con N empresas en la instancia, elegir "una cualquiera" (el viejo
  // `limit 1` sin ORDER BY) filtraría el nombre/color de un tenant hacia
  // los demás y hacia no autenticados (US2: cero fuga cross-tenant).
  if (!organizationId) return DEFAULT_BRANDING;
  const db = getDb();
  const rows = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  if (!rows[0]) return DEFAULT_BRANDING;
  const meta = parseMetadata(rows[0].metadata);
  return normalizeBranding(
    (meta.branding as Partial<Branding> | undefined) ?? null
  );
}

export async function saveBranding(
  organizationId: string,
  branding: Branding
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const meta = parseMetadata(rows[0]?.metadata ?? null);
  meta.branding = normalizeBranding(branding);
  await db
    .update(schema.organization)
    .set({ metadata: JSON.stringify(meta) })
    .where(eq(schema.organization.id, organizationId));
}
