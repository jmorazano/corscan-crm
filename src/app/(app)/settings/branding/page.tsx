import { requireOwnerPage } from "@/lib/auth/owner-page";
import { BrandingClient } from "@/components/settings/branding-client";

export const dynamic = "force-dynamic";

export default async function BrandingSettingsPage() {
  // 022: configuración de la empresa — solo el propietario.
  await requireOwnerPage();
  return <BrandingClient />;
}
