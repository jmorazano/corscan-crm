import { requireOwnerPage } from "@/lib/auth/owner-page";
import { SendingSettingsClient } from "@/components/settings/sending-client";

export const dynamic = "force-dynamic";

export default async function SendingSettingsPage() {
  // 022: configuración de la empresa — solo el propietario.
  await requireOwnerPage();
  return <SendingSettingsClient />;
}
