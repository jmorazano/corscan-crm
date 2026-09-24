import { requireOwnerPage } from "@/lib/auth/owner-page";
import { WhatsappWizard } from "@/components/settings/whatsapp-wizard";

export const dynamic = "force-dynamic";

export default async function WhatsappSettingsPage() {
  // 022: configuración de la empresa — solo el propietario.
  await requireOwnerPage();
  return <WhatsappWizard />;
}
