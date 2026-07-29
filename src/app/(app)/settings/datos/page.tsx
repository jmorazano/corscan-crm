import { notFound } from "next/navigation";
import { DemoDataClient } from "@/components/settings/demo-data-client";
import { isDemoToolsEnabled } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Sin DEMO_TOOLS_ENABLED la ruta no existe: 404, igual que la pestaña. */
export default function DemoDataSettingsPage() {
  if (!isDemoToolsEnabled()) notFound();
  return <DemoDataClient />;
}
