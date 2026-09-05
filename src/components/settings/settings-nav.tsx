"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings/whatsapp", label: "WhatsApp" },
  { href: "/settings/ai", label: "Inteligencia artificial" },
  { href: "/settings/branding", label: "Marca" },
  { href: "/settings/templates", label: "Plantillas" },
  { href: "/settings/team", label: "Equipo" },
  // Cambio de contraseña propio (FR-017): disponible siempre, no solo en el
  // primer login forzado. Vive en el grupo (auth), fuera del shell.
  { href: "/change-password", label: "Mi contraseña" },
] as const;

/** La pestaña Datos solo existe con DEMO_TOOLS_ENABLED (lo resuelve el layout). */
export function SettingsNav({ demoTools = false }: { demoTools?: boolean }) {
  const pathname = usePathname();
  const tabs = demoTools
    ? [...TABS, { href: "/settings/datos", label: "Datos" } as const]
    : TABS;
  return (
    <nav className="w-44 shrink-0 space-y-1 border-r p-3">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "block rounded-md px-3 py-2 text-sm font-medium transition-colors",
            pathname.startsWith(t.href)
              ? "bg-brand-tint text-brand-text"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
