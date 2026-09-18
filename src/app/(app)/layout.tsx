import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth";
import { getSessionOrNull } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { getBranding } from "@/server/branding";
import { isSuperAdminEmail } from "@/server/auth/super-admin";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  // Contraseña temporal vigente (FR-017): nada de la app antes de cambiarla.
  const [userRow] = await getDb()
    .select({ mustChangePassword: schema.user.mustChangePassword })
    .from(schema.user)
    .where(eq(schema.user.id, session.userId))
    .limit(1);
  if (userRow?.mustChangePassword) redirect("/change-password");
  const branding = await getBranding(session.organizationId);
  const authSession = await getAuth().api.getSession({
    headers: await headers(),
  });

  // 012: el shell (sidebar en escritorio / barra inferior en móvil) es
  // cliente; el layout solo resuelve sesión y marca.
  return (
    <AppShell
      branding={branding}
      userName={authSession?.user.name ?? "Usuario"}
      role={session.role}
      // El link solo se muestra al super admin; la protección real vive
      // server-side en /admin (FR-004).
      isSuperAdmin={isSuperAdminEmail(session.email)}
    >
      {children}
    </AppShell>
  );
}
