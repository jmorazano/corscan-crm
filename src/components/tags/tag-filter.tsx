"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { sanitizeTags, type TagMode } from "@/lib/tags";
import type { TagFilterState } from "@/components/use-query-filters";
import { Dropdown } from "./dropdown";
import { TagChip } from "./tag-chip";
import type { TagFacet } from "./use-tag-facets";

/**
 * Filtro multi-etiqueta (006, FR-002): disparador + panel con casillas y
 * modo (cualquiera/todas), más los chips activos removibles. El estado vive
 * afuera (en la URL); acá solo se edita.
 */
export function TagFilter({
  facets,
  value,
  onChange,
  compact = false,
  className,
}: {
  facets: TagFacet[];
  value: TagFilterState;
  onChange: (next: TagFilterState) => void;
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const active = new Set(value.tags);

  // Etiquetas activas que ya no existen en el catálogo siguen listadas para
  // poder destildarlas.
  const options = useMemo(() => {
    const known = new Set(facets.map((f) => f.tag));
    const extra = value.tags
      .filter((t) => !known.has(t))
      .map((tag) => ({ tag, count: 0 }));
    const all = [...extra, ...facets];
    const q = sanitizeTags([query])[0] ?? "";
    return q ? all.filter((o) => o.tag.includes(q)) : all;
  }, [facets, value.tags, query]);

  function toggle(tag: string) {
    const tags = active.has(tag)
      ? value.tags.filter((t) => t !== tag)
      : [...value.tags, tag];
    onChange({ tags, mode: value.mode });
  }

  function setMode(mode: TagMode) {
    onChange({ tags: value.tags, mode });
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <Dropdown
        open={open}
        onOpenChange={setOpen}
        trigger={
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-[5px] text-[12.5px] font-medium transition-colors",
              value.tags.length > 0
                ? "border-brand bg-brand-tint text-brand-text"
                : "bg-background text-text-2 hover:bg-accent"
            )}
          >
            <Tag className="h-3.5 w-3.5" strokeWidth={1.8} />
            {compact ? "Etiquetas" : "Filtrar por etiqueta"}
            {value.tags.length > 0 && (
              <span className="rounded-full bg-brand px-1.5 text-[11px] text-white">
                {value.tags.length}
              </span>
            )}
            <ChevronDown className="h-3.5 w-3.5 opacity-70" strokeWidth={1.8} />
          </button>
        }
        panelClassName="w-72"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar etiqueta…"
          aria-label="Buscar etiqueta para filtrar"
          className="mb-1.5 h-8 w-full rounded-md border bg-transparent px-2 text-[13px] outline-none placeholder:text-text-3 focus:border-brand"
        />
        <ul className="max-h-56 overflow-y-auto">
          {options.length === 0 && (
            <li className="px-2 py-1.5 text-[12px] text-text-3">
              {facets.length === 0
                ? "Todavía no hay etiquetas."
                : "Sin coincidencias."}
            </li>
          )}
          {options.map((o) => (
            <li key={o.tag}>
              <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] hover:bg-accent">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={active.has(o.tag)}
                  onChange={() => toggle(o.tag)}
                />
                <span className="min-w-0 flex-1 truncate">#{o.tag}</span>
                <span className="shrink-0 text-[11px] text-text-3">{o.count}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
          <div
            role="radiogroup"
            aria-label="Modo del filtro"
            className="flex rounded-md border p-0.5 text-[11.5px]"
          >
            {(
              [
                { id: "any", label: "Cualquiera" },
                { id: "all", label: "Todas" },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={value.mode === m.id}
                onClick={() => setMode(m.id)}
                className={cn(
                  "rounded-sm px-2 py-0.5 font-medium transition-colors",
                  value.mode === m.id
                    ? "bg-brand text-white"
                    : "text-text-2 hover:bg-accent"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={value.tags.length === 0}
            onClick={() => {
              onChange({ tags: [], mode: "any" });
              setOpen(false);
            }}
            className="text-[12px] text-text-2 underline-offset-2 hover:underline disabled:opacity-40"
          >
            Limpiar
          </button>
        </div>
      </Dropdown>

      {value.tags.map((t) => (
        <TagChip
          key={t}
          tag={t}
          active
          onRemove={() => toggle(t)}
          title="Quitar del filtro"
        />
      ))}
      {value.tags.length > 1 && (
        <span className="text-[11px] text-text-3">
          {value.mode === "all" ? "todas" : "cualquiera"}
        </span>
      )}
    </div>
  );
}
