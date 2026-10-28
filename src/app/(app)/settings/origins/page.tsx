import { requireOwnerPage } from "@/lib/auth/owner-page";
import { OriginsSettingsClient } from "@/components/settings/origins-client";

export const dynamic = "force-dynamic";

export default async function OriginsSettingsPage() {
  // 043: configuración de la empresa — solo el propietario.
  await requireOwnerPage();
  return <OriginsSettingsClient />;
}
