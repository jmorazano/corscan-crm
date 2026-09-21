"use client";

import { Sparkles } from "lucide-react";
import type { ConversationDto } from "@/lib/types";
import { trainerTitle } from "@/lib/trainer";
import { cn } from "@/lib/utils";
import { formatTime, previewText } from "./helpers";

/** Avatar del agente: distinto del de un contacto (no es una persona). */
export function TrainerAvatar({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-text ring-1 ring-brand-soft",
        size === "lg" ? "h-12 w-12" : "h-9 w-9"
      )}
      aria-hidden
    >
      <Sparkles className={size === "lg" ? "h-5 w-5" : "h-4 w-4"} strokeWidth={1.7} />
    </span>
  );
}

/**
 * Fila fija de la Bandeja (015): la conversación del dueño con su propio
 * agente. Va arriba de la lista, fuera de la paginación, sin gestos de fila.
 */
export function TrainerRow({
  conversation: c,
  active,
  onActivate,
}: {
  conversation: ConversationDto;
  active: boolean;
  onActivate: () => void;
}) {
  const unread = c.unreadCount > 0;
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="trainer-row"
      data-conversation-id={c.id}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
      className={cn(
        "relative flex w-full cursor-pointer items-start gap-[11px] border-b border-border/70 px-4 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand md:py-[var(--row-py)]",
        active ? "bg-[var(--bg-active)]" : "bg-brand-tint/40 hover:bg-brand-tint/70"
      )}
    >
      {active && <span className="absolute inset-y-0 left-0 w-[3px] bg-brand" />}
      <TrainerAvatar size="lg" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className={cn("truncate text-sm", unread ? "font-[680]" : "font-semibold")}>
            {trainerTitle(c.contact.name)}
          </span>
          <span
            className={cn(
              "shrink-0 text-[11.5px]",
              unread ? "font-semibold text-brand" : "text-text-3"
            )}
          >
            {formatTime(c.lastMessageAt)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span
            className={cn(
              "truncate text-[13px]",
              unread ? "font-medium text-text-2" : "text-text-3"
            )}
          >
            {c.preview ? previewText(c.preview) : "Contale cómo tiene que responder"}
          </span>
          {unread && (
            <span
              data-testid="row-unread"
              className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[10.5px] font-semibold text-white"
            >
              {c.unreadCount}
            </span>
          )}
        </span>
      </span>
    </div>
  );
}
