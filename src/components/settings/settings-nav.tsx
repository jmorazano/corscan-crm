"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/components/use-media";
import { navItemsFor } from "@/lib/roles";

const TABS = [
  { href: "/settings/whatsapp", label: "WhatsApp" },
  { href: "/settings/ai", label: "Inteligencia artificial" },
  { href: "/settings/sending", label: "Envíos y campañas" },
  { href: "/settings/branding", label: "Marca" },
  { href: "/settings/templates", label: "Plantillas" },
  { href: "/settings/team", label: "Equipo" },
  // 013: push por dispositivo.
  { href: "/settings/notifications", label: "Notificaciones" },
  // 014: claves y guía de la API pública de envíos.
  { href: "/settings/api", label: "API" },
  // Cambio de contraseña propio (FR-017): disponible siempre, no solo en el
  // primer login forzado. Vive en el grupo (auth), fuera del shell.
  { href: "/change-password", label: "Mi contraseña" },
] as const;

/**
 * La pestaña Datos solo existe con DEMO_TOOLS_ENABLED (lo resuelve el layout).
 * 012 (FR-015): bajo 768 px la columna se vuelve una tira horizontal
 * desplazable; en escritorio sigue siendo la columna de siempre.
 */
export function SettingsNav({
  demoTools = false,
  role = "owner",
}: {
  demoTools?: boolean;
  /** 022: un miembro solo ve Notificaciones y Mi contraseña. */
  role?: string;
}) {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const activeRef = useRef<HTMLAnchorElement>(null);
  const tabs = navItemsFor(
    role,
    demoTools ? [...TABS, { href: "/settings/datos", label: "Datos" } as const] : TABS
  );

  // En la tira, la pestaña activa entra en vista al montar y al cambiar de
  // ruta (solo móvil: en escritorio la columna se ve entera).
  useEffect(() => {
    if (!isMobile) return;
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [isMobile, pathname]);

  return (
    <nav className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 scrollbar-none md:w-44 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:p-3">
      {tabs.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            ref={active ? activeRef : undefined}
            className={cn(
              "block shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-brand-tint text-brand-text"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
