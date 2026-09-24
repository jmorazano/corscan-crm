"use client";

import { cn } from "@/lib/utils";
import { resolveInitials } from "@/lib/branding";
import type { WorkspaceDto } from "@/components/workspaces/use-workspaces";

export function formatUnread(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/**
 * Avatar (no interactivo) de un espacio: iniciales sobre su acento y marca
 * de activo. Lo usan el mosaico del rail (dentro de un botón) y las filas
 * de la hoja «Más» del móvil (la fila entera es el botón: un botón dentro
 * de otro no es HTML válido).
 */
export function WorkspaceAvatar({
  workspace,
  active,
  size = "md",
  className,
}: {
  workspace: Pick<WorkspaceDto, "name" | "accent" | "initials">;
  active: boolean;
  size?: "md" | "sm";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg font-semibold text-white",
        size === "md" ? "h-10 w-10 text-[14px]" : "h-9 w-9 text-[13px]",
        active && "ring-2 ring-foreground ring-offset-2 ring-offset-subtle",
        className
      )}
      style={{ backgroundColor: workspace.accent }}
    >
      {resolveInitials(workspace)}
    </span>
  );
}

/**
 * Mosaico de un espacio de trabajo (018, FR-004): iniciales de la empresa
 * sobre su acento, marca de activo y globo ROJO con los no leídos cuando
 * no es el activo (el badge de «Bandeja» ya cubre al activo).
 */
export function WorkspaceTile({
  workspace,
  active,
  shortcut,
  onSelect,
  size = "md",
  className,
}: {
  workspace: WorkspaceDto;
  active: boolean;
  /** Texto del atajo para el tooltip («⌘2», «Ctrl+2»); vacío si no hay. */
  shortcut?: string;
  onSelect: (id: string) => void;
  size?: "md" | "sm";
  className?: string;
}) {
  const label = shortcut ? `${workspace.name} · ${shortcut}` : workspace.name;
  const showBadge = !active && workspace.unread > 0;
  return (
    <button
      type="button"
      onClick={() => onSelect(workspace.id)}
      title={label}
      aria-label={
        showBadge
          ? `${label} (${workspace.unread} sin leer)`
          : active
            ? `${label} (activo)`
            : label
      }
      aria-current={active ? "true" : undefined}
      data-testid="workspace-tile"
      data-workspace-id={workspace.id}
      data-active={active ? "true" : "false"}
      className={cn(
        "relative flex shrink-0 rounded-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2",
        !active && "opacity-90 hover:opacity-100",
        className
      )}
    >
      <WorkspaceAvatar workspace={workspace} active={active} size={size} />
      {showBadge && (
        <span
          data-testid="workspace-unread"
          className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#d64545] px-1 text-[10px] font-bold leading-none text-white ring-2 ring-subtle"
        >
          {formatUnread(workspace.unread)}
        </span>
      )}
    </button>
  );
}
