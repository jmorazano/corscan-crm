"use client";

import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { sanitizeTags } from "@/lib/tags";
import { TagChip } from "./tag-chip";
import type { TagFacet } from "./use-tag-facets";

/**
 * Editor inline de etiquetas: chips removibles + entrada con sugerencias.
 * Enter o coma agregan; Backspace con la entrada vacía quita la última.
 * El padre persiste cada cambio (onChange recibe el juego completo saneado).
 */
export function TagEditor({
  tags,
  suggestions = [],
  onChange,
  disabled = false,
  placeholder = "Agregar etiqueta…",
  ariaLabel = "Etiquetas",
  className,
}: {
  tags: string[];
  suggestions?: TagFacet[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const normalized = sanitizeTags([draft])[0] ?? "";
  const matches = useMemo(() => {
    const present = new Set(tags);
    return suggestions
      .filter((s) => !present.has(s.tag))
      .filter((s) => !normalized || s.tag.includes(normalized))
      .slice(0, 8);
  }, [suggestions, tags, normalized]);

  function add(tag: string) {
    const next = sanitizeTags([...tags, tag]);
    setDraft("");
    if (next.length !== tags.length) onChange(next);
  }

  function remove(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  const showSuggestions = focused && matches.length > 0;

  return (
    <div className={cn("relative", className)}>
      <div
        onClick={() => inputRef.current?.focus()}
        className={cn(
          "flex min-h-9 flex-wrap items-center gap-1 rounded-md border bg-transparent px-2 py-1 transition-colors",
          focused && "border-brand ring-[3px] ring-brand-soft",
          disabled && "opacity-60"
        )}
      >
        {tags.map((t) => (
          <TagChip
            key={t}
            tag={t}
            onRemove={disabled ? undefined : () => remove(t)}
          />
        ))}
        <input
          ref={inputRef}
          value={draft}
          disabled={disabled}
          aria-label={ariaLabel}
          placeholder={tags.length === 0 ? placeholder : ""}
          onChange={(e) => {
            const v = e.target.value;
            if (v.includes(",")) {
              const [first] = v.split(",");
              if (first && sanitizeTags([first]).length) add(first);
              else setDraft("");
              return;
            }
            setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (normalized) add(normalized);
            } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
              const last = tags[tags.length - 1];
              if (last) remove(last);
            } else if (e.key === "Escape") {
              setDraft("");
              inputRef.current?.blur();
            }
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            // Dejar que un click en una sugerencia se procese antes de cerrar.
            setTimeout(() => setFocused(false), 120);
          }}
          className="min-w-[8ch] flex-1 bg-transparent py-0.5 text-[13px] outline-none placeholder:text-text-3"
        />
      </div>
      {showSuggestions && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-44 overflow-y-auto rounded-md border bg-background p-1 shadow-pop"
        >
          {matches.map((m) => (
            <li key={m.tag}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(m.tag)}
                className="flex w-full items-center justify-between rounded-sm px-2 py-1 text-left text-[13px] hover:bg-accent"
              >
                <span className="truncate">#{m.tag}</span>
                <span className="text-[11px] text-text-3">{m.count}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
