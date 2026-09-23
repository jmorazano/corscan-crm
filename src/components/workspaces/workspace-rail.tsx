"use client";

import { WorkspaceTile } from "@/components/workspaces/workspace-tiles";
import type { WorkspaceDto } from "@/components/workspaces/use-workspaces";

/**
 * Rail de espacios de trabajo (018, FR-003): columna angosta a la
 * izquierda de la barra lateral, SOLO en escritorio y SOLO con dos o más
 * empresas. Un mosaico por empresa en orden estable; el activo lleva una
 * barra al borde (como Slack) y los otros su globo rojo.
 */
export function WorkspaceRail({
  workspaces,
  activeId,
  modLabel,
  onSelect,
}: {
  workspaces: WorkspaceDto[];
  activeId: string;
  /** «⌘» o «Ctrl+» según la plataforma (vacío antes de montar). */
  modLabel: string;
  onSelect: (id: string) => void;
}) {
  if (workspaces.length < 2) return null;
  return (
    <aside
      aria-label="Espacios de trabajo"
      data-testid="workspace-rail"
      className="hidden w-14 shrink-0 flex-col items-center gap-2.5 border-r bg-subtle pb-3 pt-4 md:flex"
    >
      {workspaces.map((w, i) => {
        const active = w.id === activeId;
        return (
          <div key={w.id} className="relative flex w-full justify-center">
            {active && (
              <span
                aria-hidden
                className="absolute left-0 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-r bg-foreground"
              />
            )}
            <WorkspaceTile
              workspace={w}
              active={active}
              shortcut={i < 9 && modLabel ? `${modLabel}${i + 1}` : undefined}
              onSelect={onSelect}
            />
          </div>
        );
      })}
    </aside>
  );
}
