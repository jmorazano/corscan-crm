import { ApiSettingsClient } from "@/components/settings/api-client";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Ajustes → API (014): claves por empresa + estado + guía de integración. */
export default function ApiSettingsPage() {
  return <ApiSettingsClient baseUrl={getEnv().APP_BASE_URL} />;
}
