import { requireOwnerPage } from "@/lib/auth/owner-page";
import { notFound } from "next/navigation";
import { DemoDataClient } from "@/components/settings/demo-data-client";
import { isDemoToolsEnabled } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Sin DEMO_TOOLS_ENABLED la ruta no existe: 404, igual que la pestaña. */
export default async function DemoDataSettingsPage() {
  // 022: configuración de la empresa — solo el propietario.
  await requireOwnerPage();
  if (!isDemoToolsEnabled()) notFound();
  return <DemoDataClient />;
}
