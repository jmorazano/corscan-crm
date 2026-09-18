"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/components/use-media";

const SIZES = {
  sm: "md:max-w-sm",
  md: "md:max-w-md",
  lg: "md:max-w-lg",
  xl: "md:max-w-2xl",
} as const;

/**
 * Diálogo compartido (012, FR-013): hoja inferior en móvil (asa, 90dvh,
 * scroll interno, animación desde abajo, safe-area) y modal centrado en
 * escritorio. Portal a <body>, Escape, click en el fondo, bloqueo del scroll
 * del documento, foco inicial y —en móvil— una entrada propia en el
 * historial para que el botón «atrás» del teléfono lo cierre.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  hideClose = false,
  className,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof SIZES;
  hideClose?: boolean;
  className?: string;
  testId?: string;
}) {
  const isMobile = useIsMobile();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Escape + bloqueo de scroll + foco inicial.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = panelRef.current;
    const auto = panel?.querySelector<HTMLElement>("[autofocus], [data-autofocus]");
    (auto ?? panel)?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // «Atrás» cierra (solo móvil): entrada propia en el historial.
  // Los refs sobreviven al montar→desmontar→montar de React Strict Mode
  // (dev): la entrada no se duplica y la vuelta atrás del cleanup se
  // difiere un tick para cancelarla si el efecto se vuelve a montar.
  const tokenRef = useRef<string | null>(null);
  const pendingBackRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !isMobile) return;
    pendingBackRef.current = null;
    const owned =
      tokenRef.current !== null &&
      window.history.state?.__dialog === tokenRef.current;
    const token = owned ? tokenRef.current! : Math.random().toString(36).slice(2);
    if (!owned) {
      tokenRef.current = token;
      window.history.pushState(
        { ...(window.history.state ?? {}), __dialog: token },
        ""
      );
    }
    const onPop = () => {
      if (tokenRef.current && window.history.state?.__dialog !== tokenRef.current) {
        tokenRef.current = null;
        onCloseRef.current();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Cerrado desde la UI: retirar nuestra entrada para no dejar un
      // «atrás» vacío.
      pendingBackRef.current = token;
      window.setTimeout(() => {
        if (pendingBackRef.current !== token) return; // remount: sigue abierto
        pendingBackRef.current = null;
        if (tokenRef.current === token && window.history.state?.__dialog === token) {
          tokenRef.current = null;
          window.history.back();
        }
      }, 0);
    };
  }, [open, isMobile]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 md:items-center md:p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid={testId}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          "flex max-h-[90dvh] w-full flex-col rounded-t-2xl border bg-card text-card-foreground shadow-xl outline-none",
          "animate-in slide-in-from-bottom duration-200 md:max-h-[85vh] md:rounded-lg md:fade-in-0 md:slide-in-from-bottom-2",
          SIZES[size],
          className
        )}
      >
        <div
          className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border-strong md:hidden"
          aria-hidden
        />
        {(title || !hideClose) && (
          <div className="flex items-start justify-between gap-3 px-4 pb-2 pt-3 md:px-5 md:pt-5">
            <div className="min-w-0">
              {title && (
                <h3 id={titleId} className="text-base font-semibold leading-tight">
                  {title}
                </h3>
              )}
              {description && (
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              )}
            </div>
            {!hideClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar"
                className="-mr-2 -mt-1 shrink-0 rounded-md p-2 text-text-3 hover:bg-accent hover:text-foreground"
              >
                <X className="h-5 w-5" strokeWidth={1.7} />
              </button>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 md:px-5 md:pb-5">
          {children}
        </div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t px-4 py-3 md:flex-row md:justify-end md:px-5">
            {footer}
          </div>
        )}
        <div className="h-[env(safe-area-inset-bottom)] shrink-0 md:hidden" />
      </div>
    </div>,
    document.body
  );
}
