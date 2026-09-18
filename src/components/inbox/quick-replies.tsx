"use client";

import { Zap } from "lucide-react";
import type { TemplateDto } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Selector de respuestas rápidas (012, FR-008): plantillas aprobadas
 * filtradas por lo tipeado tras `/`, como en WhatsApp Business. Solo
 * presentación; el compositor maneja teclado y selección.
 */
export function QuickReplies({
  items,
  query,
  activeIndex,
  onPick,
  onHover,
}: {
  items: TemplateDto[];
  query: string;
  activeIndex: number;
  onPick: (t: TemplateDto) => void;
  onHover: (index: number) => void;
}) {
  return (
    <div
      role="listbox"
      aria-label="Respuestas rápidas"
      data-testid="quick-replies"
      className="mb-2 max-h-60 overflow-y-auto rounded-md border bg-background shadow-pop"
    >
      <p className="flex items-center gap-1.5 border-b px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
        <Zap className="h-3 w-3" strokeWidth={2} />
        Respuestas rápidas
        {query && (
          <span className="normal-case tracking-normal text-text-2">· «{query}»</span>
        )}
      </p>
      {items.length === 0 ? (
        <p className="px-3 py-3 text-sm text-text-3">Sin coincidencias.</p>
      ) : (
        <ul>
          {items.map((t, i) => (
            <li key={t.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                data-testid={`quick-reply-${t.name}`}
                onMouseEnter={() => onHover(i)}
                onClick={() => onPick(t)}
                className={cn(
                  "flex min-h-[48px] w-full flex-col items-start gap-0.5 px-3 py-2 text-left md:min-h-0",
                  i === activeIndex ? "bg-brand-tint" : "hover:bg-accent"
                )}
              >
                <span className="text-[13px] font-semibold">/{t.name}</span>
                <span className="line-clamp-2 text-[12.5px] text-text-3">{t.body}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
