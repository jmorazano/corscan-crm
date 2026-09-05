import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { ChangePasswordForm } from "@/components/change-password-form";

export const dynamic = "force-dynamic";

/**
 * Cambio de contraseña (FR-017). Vive fuera del shell de (app) porque el
 * shell redirige aquí mientras `must_change_password` esté activo — dentro
 * del grupo (app) sería un bucle de redirecciones.
 */
export default async function ChangePasswordPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  return <ChangePasswordForm />;
}
