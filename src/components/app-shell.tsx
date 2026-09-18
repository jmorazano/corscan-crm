"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Ellipsis,
  FlaskConical,
  Inbox,
  Kanban,
  LogOut,
  Megaphone,
  Plug,
  Settings,
  Shield,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Branding } from "@/lib/branding";
import { cn, initials } from "@/lib/utils";
import { signOut } from "@/lib/auth/client";
import { AppNav } from "@/components/app-nav";
import { Dialog } from "@/components/ui/dialog";
import { useUnreadBadge } from "@/components/use-unread-badge";

type MobileChrome = { setTabBarHidden: (hidden: boolean) => void };

const MobileChromeContext = createContext<MobileChrome>({
  setTabBarHidden: () => {},
});

/**
 * Oculta la barra de pestañas mientras `hidden` sea true (p. ej. con un
 * hilo abierto, como WhatsApp). Se restaura al desmontar.
 */
export function useHideTabBar(hidden: boolean) {
  const { setTabBarHidden } = useContext(MobileChromeContext);
  useEffect(() => {
    setTabBarHidden(hidden);
    return () => setTabBarHidden(false);
  }, [hidden, setTabBarHidden]);
}

/**
 * iOS no redimensiona el layout al abrir el teclado (solo el visual
 * viewport) y desplaza la página; medimos el visual viewport y fijamos esa
 * altura al shell para que el compositor quede sobre el teclado. En Android,
 * `interactive-widget=resizes-content` ya achica `100dvh`, así que no
 * intervenimos.
 */
function useKeyboardAwareHeight(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const vv = window.visualViewport;
    const el = ref.current;
    if (!vv || !el) return;
    const apply = () => {
      const keyboardOpen = window.innerHeight - vv.height > 100;
      if (keyboardOpen) {
        el.style.height = `${vv.height}px`;
        window.scrollTo(0, 0);
      } else {
        el.style.height = "";
      }
    };
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      el.style.height = "";
    };
  }, [ref]);
}

const TABS: ReadonlyArray<{
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: boolean;
}> = [
  { href: "/inbox", label: "Bandeja", icon: Inbox, badge: true },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/contacts", label: "Contactos", icon: Users },
  { href: "/campaigns", label: "Campañas", icon: Megaphone },
];

const MORE: ReadonlyArray<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/agent", label: "Agente", icon: Sparkles },
  { href: "/lab", label: "Laboratorio", icon: FlaskConical },
  { href: "/integrations", label: "Integraciones", icon: Plug },
  { href: "/settings", label: "Ajustes", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Shell autenticado (012, FR-001): sidebar en escritorio, barra de
 * pestañas inferior en móvil (Bandeja · Pipeline · Contactos · Campañas ·
 * Más). Una sola suscripción SSE para el badge de no leídos.
 */
export function AppShell({
  branding,
  userName,
  role,
  isSuperAdmin = false,
  children,
}: {
  branding: Branding;
  userName: string;
  role: string;
  isSuperAdmin?: boolean;
  children: ReactNode;
}) {
  const [tabBarHidden, setTabBarHiddenState] = useState(false);
  const setTabBarHidden = useCallback((h: boolean) => setTabBarHiddenState(h), []);
  const ctx = useMemo(() => ({ setTabBarHidden }), [setTabBarHidden]);
  const unread = useUnreadBadge();
  const shellRef = useRef<HTMLDivElement>(null);
  useKeyboardAwareHeight(shellRef);

  return (
    <MobileChromeContext.Provider value={ctx}>
      <div
        ref={shellRef}
        className="flex h-screen h-dvh flex-col overflow-hidden bg-background md:flex-row"
      >
        <AppNav
          branding={branding}
          userName={userName}
          role={role}
          isSuperAdmin={isSuperAdmin}
          unread={unread}
        />
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
        <MobileTabBar
          unread={unread}
          hidden={tabBarHidden}
          userName={userName}
          role={role}
          isSuperAdmin={isSuperAdmin}
        />
      </div>
    </MobileChromeContext.Provider>
  );
}

function MobileTabBar({
  unread,
  hidden,
  userName,
  role,
  isSuperAdmin,
}: {
  unread: number;
  hidden: boolean;
  userName: string;
  role: string;
  isSuperAdmin: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);

  // Navegar cierra la hoja.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  const moreActive =
    MORE.some((m) => isActive(pathname, m.href)) || isActive(pathname, "/admin");

  const itemClass = (active: boolean) =>
    cn(
      "flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium leading-none transition-colors",
      active ? "text-brand" : "text-text-3"
    );

  return (
    <>
      <nav
        aria-label="Secciones"
        data-testid="mobile-tabbar"
        className={cn(
          "safe-bottom shrink-0 border-t bg-background md:hidden",
          hidden && "hidden"
        )}
      >
        <ul className="flex items-stretch">
          {TABS.map((t) => {
            const active = isActive(pathname, t.href);
            return (
              <li key={t.href} className="min-w-0 flex-1">
                <Link
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={itemClass(active)}
                >
                  <span className="relative">
                    <t.icon className="h-[22px] w-[22px]" strokeWidth={active ? 2 : 1.7} />
                    {t.badge && unread > 0 && (
                      <span
                        data-testid="tabbar-unread"
                        className="absolute -right-2.5 -top-1.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white ring-2 ring-background"
                      >
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </span>
                  {t.label}
                </Link>
              </li>
            );
          })}
          <li className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={itemClass(moreActive)}
            >
              <Ellipsis className="h-[22px] w-[22px]" strokeWidth={moreActive ? 2 : 1.7} />
              Más
            </button>
          </li>
        </ul>
      </nav>

      <Dialog
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="Más"
        size="sm"
        testId="more-sheet"
      >
        <ul className="-mx-1 flex flex-col">
          {[
            ...MORE,
            ...(isSuperAdmin
              ? [{ href: "/admin", label: "Administración", icon: Shield }]
              : []),
          ].map((m) => {
            const active = isActive(pathname, m.href);
            return (
              <li key={m.href}>
                <Link
                  href={m.href}
                  // La hoja ya tiene su entrada en el historial (misma URL):
                  // navegar con replace la reutiliza y «atrás» vuelve limpio.
                  // La hoja se cierra sola al cambiar el pathname.
                  onClick={(e) => {
                    e.preventDefault();
                    if (active) {
                      setMoreOpen(false);
                      return;
                    }
                    router.replace(m.href);
                  }}
                  className={cn(
                    "flex min-h-[48px] items-center gap-3 rounded-md px-3 py-2.5 text-[15px] transition-colors",
                    active ? "bg-brand-tint font-semibold text-brand-text" : "hover:bg-accent"
                  )}
                >
                  <m.icon
                    className={cn("h-5 w-5", active ? "text-brand" : "text-text-3")}
                    strokeWidth={1.7}
                  />
                  {m.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex items-center gap-3 border-t pt-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-text">
            {initials(userName)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold">{userName}</span>
            <span className="block text-[11px] text-text-3">
              {role === "owner" ? "Propietario" : "Equipo"} · En línea
            </span>
          </span>
          <button
            type="button"
            onClick={async () => {
              await signOut();
              router.push("/login");
              router.refresh();
            }}
            className="flex min-h-[44px] items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium text-text-2 hover:bg-accent"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.7} />
            Salir
          </button>
        </div>
      </Dialog>
    </>
  );
}
