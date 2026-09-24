import { requireOwnerPage } from "@/lib/auth/owner-page";
import { AiCard } from "@/components/settings/ai-card";

export const dynamic = "force-dynamic";

export default async function AiSettingsPage() {
  // 022: configuración de la empresa — solo el propietario.
  await requireOwnerPage();
  return <AiCard />;
}
