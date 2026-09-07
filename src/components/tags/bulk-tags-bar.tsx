"use client";

import { Minus, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TagPicker, type TagOption } from "./tag-picker";

/**
 * Barra de acciones sobre la selección (006, FR-004): agregar una etiqueta
 * (existente o nueva) o quitar una de las presentes en la selección.
 */
export function BulkTagsBar({
  count,
  noun,
  addOptions,
  removeOptions,
  onAdd,
  onRemove,
  onClear,
  busy = false,
  error,
  compact = false,
  className,
}: {
  count: number;
  /** "contactos" | "conversaciones" — para el texto. */
  noun: string;
  addOptions: TagOption[];
  removeOptions: TagOption[];
  onAdd: (tag: string) => Promise<void>;
  onRemove: (tag: string) => Promise<void>;
  onClear: () => void;
  busy?: boolean;
  error?: string | null;
  compact?: boolean;
  className?: string;
}) {
  const triggerClass = (open: boolean) =>
    cn(
      "flex items-center gap-1 rounded-md border px-2.5 py-1 text-[12.5px] font-medium transition-colors",
      open ? "border-brand bg-brand-tint text-brand-text" : "hover:bg-accent"
    );

  return (
    <div
      role="region"
      aria-label="Acciones sobre la selección"
      className={cn(
        "flex flex-wrap items-center gap-2 border-b border-brand/30 bg-brand-tint px-4 py-2",
        className
      )}
    >
      <span className="text-[13px] font-[650] text-brand-text">
        {count} {compact ? "sel." : `${noun} seleccionad${noun.endsWith("as") ? "as" : "os"}`}
      </span>
      <TagPicker
        options={addOptions}
        allowCreate
        disabled={busy}
        onPick={onAdd}
        placeholder="Buscar o crear etiqueta…"
        trigger={(open) => (
          <span className={triggerClass(open)}>
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            {compact ? "Etiqueta" : "Agregar etiqueta"}
          </span>
        )}
      />
      <TagPicker
        options={removeOptions}
        disabled={busy || removeOptions.length === 0}
        onPick={onRemove}
        emptyText="La selección no tiene etiquetas"
        trigger={(open) => (
          <span className={triggerClass(open)}>
            <Minus className="h-3.5 w-3.5" strokeWidth={2} />
            {compact ? "Quitar" : "Quitar etiqueta"}
          </span>
        )}
      />
      {busy && <span className="text-[12px] text-text-3">Aplicando…</span>}
      {error && (
        <span role="alert" className="text-[12px] text-destructive">
          {error}
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-7 px-2"
        onClick={onClear}
        disabled={busy}
        aria-label="Cancelar selección"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
        {!compact && "Cancelar"}
      </Button>
    </div>
  );
}
