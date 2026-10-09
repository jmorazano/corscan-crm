import { ContactsClient } from "@/components/contacts/contacts-client";
import { getSessionOrNull } from "@/lib/auth/session";
import { canManageConfig } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  // 033: el borrado en bloque es solo del propietario (la API lo exige igual).
  const session = await getSessionOrNull();
  return <ContactsClient canBulkDelete={canManageConfig(session?.role ?? "")} />;
}
