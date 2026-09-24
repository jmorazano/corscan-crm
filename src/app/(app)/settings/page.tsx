import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { settingsHomeFor } from "@/lib/roles";

/** 022: el propietario cae en WhatsApp; el miembro, en sus Notificaciones. */
export default async function SettingsPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  redirect(settingsHomeFor(session.role));
}
