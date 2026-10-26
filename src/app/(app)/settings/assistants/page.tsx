import { requireOwnerPage } from "@/lib/auth/owner-page";
import { AssistantsSettingsClient } from "@/components/settings/assistants-client";

export const dynamic = "force-dynamic";

export default async function AssistantsSettingsPage() {
  // 040: quién puede leer la empresa desde un asistente — solo el propietario.
  await requireOwnerPage();
  return <AssistantsSettingsClient />;
}
