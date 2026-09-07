"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Chip `#etiqueta` con variantes: clicable (filtrar) y/o removible. */
export function TagChip({
  tag,
  onClick,
  onRemove,
  active = false,
  size = "sm",
  title,
  className,
}: {
  tag: string;
  onClick?: () => void;
  onRemove?: () => void;
  active?: boolean;
  size?: "xs" | "sm";
  title?: string;
  className?: string;
}) {
  const base = cn(
    "inline-flex max-w-full items-center gap-1 rounded-full border font-medium transition-colors",
    size === "xs" ? "px-1.5 py-px text-[10.5px]" : "px-2 py-0.5 text-[11.5px]",
    active
      ? "border-brand bg-brand text-white"
      : "border-border bg-secondary text-text-2",
    onClick && !active && "cursor-pointer hover:border-brand hover:text-brand-text",
    onClick && active && "cursor-pointer hover:bg-brand-hover",
    className
  );
  const label = <span className="truncate">#{tag}</span>;

  const inner = onClick ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      className="inline-flex min-w-0 items-center"
    >
      {label}
    </button>
  ) : (
    label
  );

  return (
    <span className={base} title={title} data-tag={tag}>
      {inner}
      {onRemove && (
        <button
          type="button"
          aria-label={`Quitar ${tag}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className={cn(
            "-mr-0.5 rounded-full p-px",
            active ? "hover:bg-white/25" : "hover:bg-border-strong"
          )}
        >
          <X className="h-3 w-3" strokeWidth={2} />
        </button>
      )}
    </span>
  );
}
