import * as React from "react";
import { cn } from "@/lib/utils";

type SwitchProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "role" | "aria-checked" | "children"
> & {
  checked: boolean;
  /** `sm` para filas compactas (ficha del contacto). */
  size?: "md" | "sm";
};

/**
 * Interruptor único de la app. Apagado se tiene que VER: riel gris con la
 * perilla blanca (antes era gris casi blanco sobre blanco y pasaba
 * desapercibido). Encendido usa el acento de la empresa.
 */
export function Switch({ checked, size = "md", className, type = "button", ...props }: SwitchProps) {
  const sm = size === "sm";
  return (
    <button
      type={type}
      role="switch"
      aria-checked={checked}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        sm ? "h-5 w-9" : "h-6 w-11",
        checked ? "bg-brand enabled:hover:bg-brand-hover" : "bg-text-4 enabled:hover:bg-text-3",
        className
      )}
      {...props}
    >
      <span
        className={cn(
          "rounded-full bg-white shadow-sm transition-transform",
          sm ? "h-4 w-4" : "h-5 w-5",
          checked && (sm ? "translate-x-4" : "translate-x-5")
        )}
      />
    </button>
  );
}
