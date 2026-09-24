import { requireOwnerPage } from "@/lib/auth/owner-page";
import { TeamClient } from "@/components/settings/team-client";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage() {
  // 022: configuración de la empresa — solo el propietario.
  await requireOwnerPage();
  return <TeamClient />;
}
