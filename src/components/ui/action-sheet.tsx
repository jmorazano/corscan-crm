"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/components/use-media";
import { Dialog } from "./dialog";

export type SheetAction = {
  key: string;
  label: string;
  hint?: string;
  icon?: LucideIcon;
  destructive?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

/**
 * Hoja de acciones (012): lista de acciones a pantalla completa en móvil
 * (con «Cancelar», como WhatsApp/iOS) y menú compacto en escritorio.
 * Reemplaza los menús que en el celular no tienen hover.
 */
export function ActionSheet({
  open,
  onClose,
  title,
  description,
  actions,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  actions: SheetAction[];
  testId?: string;
}) {
  const isMobile = useIsMobile();

  /**
   * En móvil, cerrar la hoja retira su entrada del historial con
   * `history.back()` (asíncrono). Una acción que navegue o haga pushState
   * ANTES de que esa vuelta termine quedaría pisada por ella: por eso la
   * acción corre recién tras el popstate (o a los 300 ms como respaldo).
   */
  function run(action: SheetAction) {
    onClose();
    if (!isMobile) {
      action.onSelect();
      return;
    }
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      window.removeEventListener("popstate", go);
      action.onSelect();
    };
    window.addEventListener("popstate", go);
    window.setTimeout(go, 300);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      hideClose
      testId={testId}
    >
      <ul className="-mx-1 flex flex-col" role="menu">
        {actions.map((a) => (
          <li key={a.key} role="none">
            <button
              type="button"
              role="menuitem"
              disabled={a.disabled}
              data-testid={`sheet-action-${a.key}`}
              onClick={() => run(a)}
              className={cn(
                "flex min-h-[48px] w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-[15px] transition-colors md:min-h-[40px] md:text-sm",
                a.destructive
                  ? "text-destructive hover:bg-destructive/10"
                  : "hover:bg-accent",
                a.disabled && "cursor-not-allowed opacity-40"
              )}
            >
              {a.icon && (
                <a.icon
                  className={cn(
                    "h-5 w-5 shrink-0 md:h-4 md:w-4",
                    a.destructive ? "text-destructive" : "text-text-3"
                  )}
                  strokeWidth={1.7}
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{a.label}</span>
                {a.hint && (
                  <span className="block truncate text-xs text-text-3">{a.hint}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onClose}
        className="mt-2 w-full rounded-md border py-3 text-[15px] font-medium hover:bg-accent md:hidden"
      >
        Cancelar
      </button>
    </Dialog>
  );
}
