import { redirect } from "next/navigation";
import { SettingsNav } from "@/components/settings/settings-nav";
import { getSessionOrNull } from "@/lib/auth/session";
import { isDemoToolsEnabled } from "@/lib/env";

export default async function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // 022: la navegación de Ajustes depende del rol (un miembro solo ve lo
  // personal); cada página de empresa además se guarda a sí misma.
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3 md:px-6 md:py-4">
        <h2 className="font-semibold">Configuración</h2>
      </header>
      {/* 012: en móvil la navegación va arriba como tira; en escritorio, columna. */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <SettingsNav demoTools={isDemoToolsEnabled()} role={session.role} />
        <div className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">{children}</div>
      </div>
    </div>
  );
}
