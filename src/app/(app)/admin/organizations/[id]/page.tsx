import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { isSuperAdminEmail } from "@/server/auth/super-admin";
import { OrganizationDetailClient } from "@/components/admin/organization-detail-client";

export const dynamic = "force-dynamic";

/**
 * Detalle de una empresa en Administración (019, FR-003). Misma protección
 * server-side que /admin (FR-004 de 003): sesión sin exigir membresía +
 * email de plataforma; si no, redirect.
 */
export default async function AdminOrganizationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  if (!isSuperAdminEmail(session.user.email)) redirect("/inbox");
  const { id } = await params;
  return <OrganizationDetailClient organizationId={id} />;
}
