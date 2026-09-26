import { requireOwnerPage } from "@/lib/auth/owner-page";
import { InstagramSettings } from "@/components/settings/instagram-settings";

export const dynamic = "force-dynamic";

export default async function InstagramSettingsPage() {
  // 022: configuración de la empresa — solo el propietario.
  await requireOwnerPage();
  return <InstagramSettings />;
}
