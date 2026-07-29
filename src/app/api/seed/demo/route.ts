import { apiError, withAuth } from "@/lib/api";
import { getDb } from "@/lib/db";
import { isDemoToolsEnabled } from "@/lib/env";
import { isDomainEmpty, seedDemo } from "@/server/seed/demo";

export const dynamic = "force-dynamic";

/**
 * Carga el negocio demo (FR-075). Por defecto solo con la BD de dominio
 * vacía; con `{ force: true }` recarga aunque ya haya datos — el seed es
 * idempotente sobre sus propios contactos, pero además reemplaza la base de
 * conocimiento y las corridas del Laboratorio de la organización, así que la
 * UI debe confirmarlo explícitamente antes de llamar con force.
 */
export const POST = withAuth(async (session, req: Request) => {
  const db = getDb();
  const body = (await req.json().catch(() => ({}))) as { force?: boolean };
  // La recarga forzada es destructiva (reemplaza KB y corridas del
  // Laboratorio): ocultar la pestaña no basta, el endpoint también la niega.
  const force = body.force === true && isDemoToolsEnabled();

  if (body.force === true && !isDemoToolsEnabled()) {
    return apiError(
      403,
      "demo_tools_disabled",
      "La recarga forzada requiere DEMO_TOOLS_ENABLED en esta instancia"
    );
  }

  if (!force && !(await isDomainEmpty(db, session.organizationId))) {
    return apiError(
      409,
      "not_empty",
      "Ya hay datos en la organización; usá el reinicio desde Ajustes → Datos para recargar la demo"
    );
  }

  const result = await seedDemo(db, session.organizationId);
  return Response.json({ ok: true, ...result });
});
