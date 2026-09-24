import { requireOwnerPage } from "@/lib/auth/owner-page";
import { TemplatesClient } from "@/components/settings/templates-client";

export const dynamic = "force-dynamic";

export default async function TemplatesSettingsPage() {
  // 022: configuración de la empresa — solo el propietario.
  await requireOwnerPage();
  return <TemplatesClient />;
}
