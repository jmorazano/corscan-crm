import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth";
import { getSessionOrNull } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { getBranding } from "@/server/branding";
import { AppNav } from "@/components/app-nav";

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

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppNav
        branding={branding}
        userName={authSession?.user.name ?? "Usuario"}
        role={session.role}
      />
      <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
