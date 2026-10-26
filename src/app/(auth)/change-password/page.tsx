import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { ChangePasswordForm } from "@/components/change-password-form";
import { safeNextPath } from "@/lib/oauth-server/next-path";

export const dynamic = "force-dynamic";

/**
 * Cambio de contraseña (FR-017). Vive fuera del shell de (app) porque el
 * shell redirige aquí mientras `must_change_password` esté activo — dentro
 * del grupo (app) sería un bucle de redirecciones.
 */
type Props = { searchParams: Promise<{ next?: string }> };

export default async function ChangePasswordPage({ searchParams }: Props) {
  const next = safeNextPath((await searchParams).next);
  const session = await getSessionOrNull();
  if (!session) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return <ChangePasswordForm next={next} />;
}
