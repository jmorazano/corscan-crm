"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Desplegable mínimo sin dependencias: el disparador y el panel comparten
 * contenedor, así el click en el disparador no cuenta como "afuera".
 * Cierra con click afuera o Escape.
 */
export function Dropdown({
  open,
  onOpenChange,
  trigger,
  children,
  align = "left",
  className,
  panelClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
  panelClassName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={ref} className={cn("relative inline-block", className)}>
      {trigger}
      {open && (
        <div
          role="dialog"
          className={cn(
            "absolute z-40 mt-1 w-64 rounded-md border bg-background p-2 shadow-pop",
            align === "right" ? "right-0" : "left-0",
            panelClassName
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
