"use client";

import Link from "next/link";
import { Settings2, Zap } from "lucide-react";
import type { QuickPick } from "@/lib/quick-replies";
import { cn } from "@/lib/utils";

/**
 * Selector de respuestas rápidas (012, FR-008), como en WhatsApp Business:
 * filtrado por lo tipeado tras `/`. 047: primero las respuestas propias de
 * la empresa, después las plantillas aprobadas (marcadas). Solo
 * presentación; el compositor maneja teclado y selección.
 */
export function QuickReplies({
  items,
  query,
  activeIndex,
  onPick,
  onHover,
}: {
  items: QuickPick[];
  query: string;
  activeIndex: number;
  onPick: (p: QuickPick) => void;
  onHover: (index: number) => void;
}) {
  return (
    <div
      role="listbox"
      aria-label="Respuestas rápidas"
      data-testid="quick-replies"
      className="mb-2 overflow-hidden rounded-md border bg-background shadow-pop"
    >
      <p className="flex items-center gap-1.5 border-b px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
        <Zap className="h-3 w-3" strokeWidth={2} />
        Respuestas rápidas
        {query && (
          <span className="normal-case tracking-normal text-text-2">· «{query}»</span>
        )}
      </p>
      <div className="max-h-60 overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-3 py-3 text-sm text-text-3" data-testid="quick-replies-none">
            {query
              ? "Sin coincidencias."
              : "Todavía no hay respuestas rápidas. Creá textos con un atajo y usalos escribiendo /."}
          </p>
        ) : (
          <ul>
            {items.map((p, i) => (
              <li key={`${p.kind}-${p.id}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === activeIndex}
                  data-testid={`quick-reply-${p.key}`}
                  onMouseEnter={() => onHover(i)}
                  // El mousedown no le saca el foco a la caja de texto.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPick(p)}
                  className={cn(
                    "flex min-h-[48px] w-full flex-col items-start gap-0.5 px-3 py-2 text-left md:min-h-0",
                    i === activeIndex ? "bg-brand-tint" : "hover:bg-accent"
                  )}
                >
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                    /{p.key}
                    {p.kind === "template" && (
                      <span className="rounded bg-subtle px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-text-3">
                        Plantilla
                      </span>
                    )}
                  </span>
                  <span className="line-clamp-2 whitespace-pre-wrap text-[12.5px] text-text-3">
                    {p.body}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Link
        href="/settings/quick-replies"
        data-testid="quick-replies-manage"
        className="flex items-center gap-1.5 border-t px-3 py-2 text-xs font-medium text-brand-text hover:bg-accent"
      >
        <Settings2 className="h-3.5 w-3.5" strokeWidth={2} />
        {items.length === 0 && !query ? "Crear respuestas rápidas" : "Administrar respuestas rápidas"}
      </Link>
    </div>
  );
}
