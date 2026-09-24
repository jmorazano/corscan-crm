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
  Bell,
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
import { type Branding, resolveInitials } from "@/lib/branding";
import { cn, initials } from "@/lib/utils";
import { modifierLabel, workspaceShortcut } from "@/lib/gestures";
import { signOut } from "@/lib/auth/client";
import {
  getCurrentSubscription,
  getRegistration,
  isPushSupported,
  serializeSubscription,
} from "@/lib/push-client";
import { AppNav } from "@/components/app-nav";
import { Dialog } from "@/components/ui/dialog";
import { useUnreadBadge } from "@/components/use-unread-badge";
import {
  useWorkspaces,
  type WorkspaceDto,
  type WorkspacesState,
} from "@/components/workspaces/use-workspaces";
import { WorkspaceRail } from "@/components/workspaces/workspace-rail";
import {
  formatUnread,
  WorkspaceAvatar,
} from "@/components/workspaces/workspace-tiles";

type MobileChrome = { setTabBarHidden: (hidden: boolean) => void };

/**
 * 018: espacios de trabajo del usuario, para pantallas que necesitan saber
 * si hay más de uno (p. ej. Ajustes → Notificaciones explica que las push
 * siguen a la última empresa usada en el dispositivo).
 */
const WorkspacesContext = createContext<{
  workspaces: WorkspaceDto[];
  activeId: string;
}>({ workspaces: [], activeId: "" });

export function useWorkspacesContext() {
  return useContext(WorkspacesContext);
}

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
  // 013: acceso directo a las push desde el celular.
  { href: "/settings/notifications", label: "Notificaciones", icon: Bell },
  { href: "/settings", label: "Ajustes", icon: Settings },
];

/**
 * Web Push (013, FR-010): registra el service worker, re-sincroniza en
 * silencio la suscripción cuando el permiso ya está concedido (BD nueva,
 * cambio de empresa), atiende el «abrir esta conversación» que manda el SW
 * al tocar una notificación y refleja los no leídos en el badge del ícono.
 */
function usePushRuntime(unread: number, navigate: (url: string) => void) {
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (!isPushSupported()) return;
    let cancelled = false;
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data as { type?: string; url?: string } | null;
      if (data?.type === "push-navigate" && typeof data.url === "string") {
        try {
          const u = new URL(data.url, window.location.origin);
          if (u.origin === window.location.origin)
            navigateRef.current(u.pathname + u.search);
        } catch {
          // URL inválida: ignorar
        }
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    void (async () => {
      try {
        await getRegistration();
        if (cancelled || Notification.permission !== "granted") return;
        const sub = await getCurrentSubscription();
        if (!sub || cancelled) return;
        await fetch("/api/push/subscriptions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(serializeSubscription(sub)),
        });
      } catch {
        // sin SW o sin red: la página de Ajustes lo muestra
      }
    })();
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);

  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (!nav.setAppBadge) return;
    void (unread > 0 ? nav.setAppBadge(unread) : nav.clearAppBadge?.()).catch(
      () => undefined
    );
  }, [unread]);
}

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
  organizationId,
  workspaces,
  children,
}: {
  branding: Branding;
  userName: string;
  role: string;
  isSuperAdmin?: boolean;
  /** 018: empresa activa de la sesión y espacios del usuario (SSR). */
  organizationId: string;
  workspaces: WorkspaceDto[];
  children: ReactNode;
}) {
  const [tabBarHidden, setTabBarHiddenState] = useState(false);
  const setTabBarHidden = useCallback((h: boolean) => setTabBarHiddenState(h), []);
  const ctx = useMemo(() => ({ setTabBarHidden }), [setTabBarHidden]);
  const ws = useWorkspaces(workspaces, organizationId);
  const unread = useUnreadBadge({
    onWorkspaceUnread: ws.refetch,
    onReconnect: ws.refetch,
  });
  const shellRef = useRef<HTMLDivElement>(null);
  useKeyboardAwareHeight(shellRef);
  const router = useRouter();
  usePushRuntime(unread, (url) => router.push(url));
  const multiWorkspace = ws.workspaces.length >= 2;
  const workspacesCtx = useMemo(
    () => ({ workspaces: ws.workspaces, activeId: ws.activeId }),
    [ws.workspaces, ws.activeId]
  );

  // Etiqueta del modificador (⌘ / Ctrl+) tras montar: en SSR no hay
  // plataforma y un título distinto rompería la hidratación.
  const [modLabel, setModLabel] = useState("");
  useEffect(() => {
    setModLabel(modifierLabel(navigator.platform || navigator.userAgent));
  }, []);

  // 018 (FR-007): ⌘/Ctrl+1…9 salta al espacio N. Solo con dos o más
  // espacios; en fase de captura y con preventDefault para que el
  // navegador no cambie de pestaña. Con un solo espacio no se intercepta.
  const wsRef = useRef(ws);
  wsRef.current = ws;
  useEffect(() => {
    if (!multiWorkspace) return;
    const onKey = (e: KeyboardEvent) => {
      const idx = workspaceShortcut(e);
      if (idx === null) return;
      const target = wsRef.current.workspaces[idx];
      if (!target) return;
      e.preventDefault();
      if (target.id === wsRef.current.activeId) return;
      void wsRef.current.switchTo(target.id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [multiWorkspace]);

  return (
    <MobileChromeContext.Provider value={ctx}>
      <WorkspacesContext.Provider value={workspacesCtx}>
      {/*
        Móvil: el shell se ancla al viewport con `fixed inset-0` en vez de
        medir `100dvh`. En iOS Safari `100dvh` incluye el espacio de la barra
        de botones (la tab bar quedaba escondida detrás) y en la app instalada
        sobra el alto de la barra de estado (la tab bar se cortaba). Un
        elemento fijo al fondo siempre queda sobre la toolbar del navegador y,
        en modo instalado, sobre la zona segura. Escritorio: alto de viewport.
      */}
      <div
        ref={shellRef}
        className="fixed inset-0 flex flex-col overflow-hidden bg-background md:static md:h-screen md:h-dvh md:flex-row"
      >
        <WorkspaceRail
          workspaces={ws.workspaces}
          activeId={ws.activeId}
          modLabel={modLabel}
          onSelect={(id) => void ws.switchTo(id)}
        />
        <AppNav
          branding={branding}
          userName={userName}
          role={role}
          isSuperAdmin={isSuperAdmin}
          unread={unread}
          workspaceName={multiWorkspace ? (ws.active?.name ?? null) : null}
        />
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
        <MobileTabBar
          unread={unread}
          hidden={tabBarHidden}
          userName={userName}
          role={role}
          isSuperAdmin={isSuperAdmin}
          ws={ws}
        />
        {ws.switching && (
          <div
            role="status"
            aria-live="polite"
            data-testid="workspace-switching"
            className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm"
          >
            <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-md">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[13px] font-semibold text-white"
                style={{ backgroundColor: ws.switching.accent }}
                aria-hidden
              >
                {resolveInitials(ws.switching)}
              </span>
              <span className="text-sm">
                Cambiando a <strong>{ws.switching.name}</strong>…
              </span>
            </div>
          </div>
        )}
        {ws.error && (
          <div
            role="alert"
            data-testid="workspace-error"
            className="fixed bottom-20 left-1/2 z-[60] -translate-x-1/2 rounded-md border border-destructive/40 bg-card px-3 py-2 text-sm text-destructive shadow-md md:bottom-6"
          >
            {ws.error}
          </div>
        )}
      </div>
      </WorkspacesContext.Provider>
    </MobileChromeContext.Provider>
  );
}

function MobileTabBar({
  unread,
  hidden,
  userName,
  role,
  isSuperAdmin,
  ws,
}: {
  unread: number;
  hidden: boolean;
  userName: string;
  role: string;
  isSuperAdmin: boolean;
  /** 018: espacios de trabajo (sección en «Más» + punto rojo). */
  ws: WorkspacesState;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const multiWorkspace = ws.workspaces.length >= 2;

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
              <span className="relative">
                <Ellipsis className="h-[22px] w-[22px]" strokeWidth={moreActive ? 2 : 1.7} />
                {multiWorkspace && ws.othersUnread > 0 && (
                  <span
                    data-testid="tabbar-workspaces-dot"
                    aria-label={`${ws.othersUnread} sin leer en otros espacios`}
                    className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-[#d64545] ring-2 ring-background"
                  />
                )}
              </span>
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
        {multiWorkspace && (
          <section
            aria-label="Espacios de trabajo"
            data-testid="more-workspaces"
            className="-mx-1 mb-3 border-b pb-3"
          >
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
              Espacios de trabajo
            </p>
            <ul className="flex flex-col">
              {ws.workspaces.map((w) => {
                const active = w.id === ws.activeId;
                return (
                  <li key={w.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (active) {
                          setMoreOpen(false);
                          return;
                        }
                        void ws.switchTo(w.id);
                      }}
                      aria-current={active ? "true" : undefined}
                      data-testid="workspace-row"
                      data-workspace-id={w.id}
                      className={cn(
                        "flex min-h-[52px] w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors",
                        active ? "bg-brand-tint" : "hover:bg-accent"
                      )}
                    >
                      <WorkspaceAvatar workspace={w} active={active} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">
                          {w.name}
                        </span>
                        <span className="block text-[11px] text-text-3">
                          {active
                            ? "Espacio activo"
                            : w.role === "owner"
                              ? "Propietario"
                              : "Equipo"}
                        </span>
                      </span>
                      {!active && w.unread > 0 && (
                        <span
                          data-testid="workspace-unread"
                          className="flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-[#d64545] px-1.5 text-[11px] font-bold text-white"
                        >
                          {formatUnread(w.unread)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
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
