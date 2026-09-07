"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { sanitizeTags } from "@/lib/tags";
import { Dropdown } from "./dropdown";

export type TagOption = { tag: string; count?: number };

/**
 * Selector de UNA etiqueta: busca entre las opciones y, si se permite,
 * crea una nueva escribiéndola. Enter elige la primera coincidencia (o crea).
 */
export function TagPicker({
  trigger,
  options,
  allowCreate = false,
  onPick,
  disabled = false,
  emptyText = "Sin etiquetas",
  align = "left",
  placeholder,
}: {
  trigger: (open: boolean) => ReactNode;
  options: TagOption[];
  allowCreate?: boolean;
  onPick: (tag: string) => void | Promise<void>;
  disabled?: boolean;
  emptyText?: string;
  align?: "left" | "right";
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      // El panel se monta en este mismo tick: enfocar en el siguiente.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const normalized = sanitizeTags([query])[0] ?? "";
  const filtered = useMemo(() => {
    if (!normalized) return options;
    return options.filter((o) => o.tag.includes(normalized));
  }, [options, normalized]);
  const canCreate =
    allowCreate && normalized.length > 0 && !options.some((o) => o.tag === normalized);

  function pick(tag: string) {
    setOpen(false);
    void onPick(tag);
  }

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      align={align}
      trigger={
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="disabled:pointer-events-none disabled:opacity-50"
        >
          {trigger(open)}
        </button>
      }
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const first = filtered[0]?.tag;
          if (first) pick(first);
          else if (canCreate) pick(normalized);
        }}
        placeholder={placeholder ?? (allowCreate ? "Buscar o crear…" : "Buscar…")}
        aria-label="Buscar etiqueta"
        className="mb-1.5 h-8 w-full rounded-md border bg-transparent px-2 text-[13px] outline-none placeholder:text-text-3 focus:border-brand"
      />
      <ul className="max-h-56 overflow-y-auto" role="listbox">
        {canCreate && (
          <li>
            <button
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => pick(normalized)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] text-brand-text hover:bg-accent"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              Crear «{normalized}»
            </button>
          </li>
        )}
        {filtered.map((o) => (
          <li key={o.tag}>
            <button
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => pick(o.tag)}
              className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-accent"
            >
              <span className="truncate">#{o.tag}</span>
              {o.count !== undefined && (
                <span className="shrink-0 text-[11px] text-text-3">{o.count}</span>
              )}
            </button>
          </li>
        ))}
        {filtered.length === 0 && !canCreate && (
          <li className={cn("px-2 py-1.5 text-[12px] text-text-3")}>{emptyText}</li>
        )}
      </ul>
    </Dropdown>
  );
}
