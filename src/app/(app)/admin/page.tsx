import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { isSuperAdminEmail } from "@/server/auth/super-admin";
import { AdminClient } from "@/components/admin/admin-client";

export const dynamic = "force-dynamic";

/**
 * Administración de la plataforma (US1). La protección REAL es esta, en el
 * server (FR-004): ocultar el link de la nav no alcanza. Se resuelve la
 * sesión sin exigir membresía (research D2) — el sombrero de plataforma no
 * depende del de empresa.
 */
export default async function AdminPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  if (!isSuperAdminEmail(session.user.email)) redirect("/inbox");
  return <AdminClient />;
}
