import { requireOwnerPage } from "@/lib/auth/owner-page";
import { ApiSettingsClient } from "@/components/settings/api-client";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Ajustes → API (014): claves por empresa + estado + guía de integración. */
export default async function ApiSettingsPage() {
  // 022: configuración de la empresa — solo el propietario.
  await requireOwnerPage();
  return <ApiSettingsClient baseUrl={getEnv().APP_BASE_URL} />;
}
