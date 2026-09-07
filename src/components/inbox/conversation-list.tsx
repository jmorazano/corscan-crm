"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckSquare, Search, Sparkles, UserRound } from "lucide-react";
import type { ConversationDto } from "@/lib/types";
import type { TagOps } from "@/lib/tags";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { BulkTagsBar } from "@/components/tags/bulk-tags-bar";
import { TagChip } from "@/components/tags/tag-chip";
import { TagFilter } from "@/components/tags/tag-filter";
import type { TagFacet } from "@/components/tags/use-tag-facets";
import type { TagFilterState } from "@/components/use-query-filters";
import { formatTime, previewText } from "./helpers";

const STAGE_DOT: Record<string, string> = {
  Nuevo: "#9ca3af",
  "En conversación": "#7b93b3",
  Interesado: "#b08b5e",
  Cliente: "#5f8f74",
  Perdido: "#a2504c",
};

/** Chips de etiqueta visibles por fila; el resto se resume como "+n". */
const ROW_TAGS_MAX = 3;

export type ListFilter = "all" | "unread";

function EmptyState({ onSeeded }: { onSeeded: () => void }) {
  const [seeding, setSeeding] = useState(false);
  const [failed, setFailed] = useState(false);

  async function seed() {
    setSeeding(true);
    const res = await fetch("/api/seed/demo", { method: "POST" }).catch(
      () => null
    );
    setSeeding(false);
    if (res?.ok) onSeeded();
    else setFailed(true);
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm font-medium">Sin conversaciones todavía</p>
      <p className="text-xs text-text-3">
        Cuando alguien escriba a tu número de WhatsApp, su conversación
        aparecerá aquí en tiempo real.
      </p>
      {!failed && (
        <Button
          size="sm"
          variant="outline"
          disabled={seeding}
          onClick={() => void seed()}
        >
          <Sparkles className="h-4 w-4" strokeWidth={1.7} />
          {seeding ? "Cargando demo…" : "Cargar datos de demostración"}
        </Button>
      )}
    </div>
  );
}

export function ConversationList({
  conversations: conversationsProp,
  selectedId,
  onSelect,
  onSeeded,
  query,
  onQueryChange,
  filter,
  onFilterChange,
  tagFilter,
  onTagFilterChange,
  facets,
  onBulkTags,
  total,
  unreadTotal,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  conversations: ConversationDto[] | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSeeded: () => void;
  /** Búsqueda y filtros (006): persistidos en la URL por el padre. */
  query: string;
  onQueryChange: (q: string) => void;
  filter: ListFilter;
  onFilterChange: (f: ListFilter) => void;
  tagFilter: TagFilterState;
  onTagFilterChange: (next: TagFilterState) => void;
  facets: TagFacet[];
  /** Operación en bloque; devuelve un mensaje de error o null. */
  onBulkTags: (ids: string[], ops: TagOps) => Promise<string | null>;
  /** Totales del servidor (006, FR-009): la lista es una página. */
  total: number;
  unreadTotal: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  // Modo selección (FR-004): las filas se tildan en vez de abrirse.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const loading = conversationsProp === null;
  // Búsqueda, "No leídas" y etiquetas ya vienen resueltas por el servidor:
  // lo que llega es la página visible.
  const conversations = useMemo(() => conversationsProp ?? [], [conversationsProp]);
  const visible = conversations;
  const filtered =
    query.trim().length > 0 || filter === "unread" || tagFilter.tags.length > 0;

  // Una conversación que desaparece (borrada, o fuera del filtro) sale de la
  // selección para no operar sobre fantasmas.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set(conversations.map((c) => c.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [conversations]);

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
    setBulkError(null);
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allVisibleSelected =
    visible.length > 0 && visible.every((c) => selected.has(c.id));

  const selectedTagOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of conversations) {
      if (!selected.has(c.id)) continue;
      for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, count]) => ({ tag, count }));
  }, [conversations, selected]);

  async function bulk(ops: TagOps) {
    setBulkBusy(true);
    setBulkError(null);
    const err = await onBulkTags([...selected], ops);
    setBulkBusy(false);
    if (err) {
      setBulkError(err); // la selección se conserva para reintentar (FR-008)
      return;
    }
    setSelected(new Set());
  }

  function toggleTagInFilter(tag: string) {
    const has = tagFilter.tags.includes(tag);
    onTagFilterChange({
      tags: has ? tagFilter.tags.filter((t) => t !== tag) : [...tagFilter.tags, tag],
      mode: tagFilter.mode,
    });
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 pb-3 pt-4">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-[17px] font-[650] tracking-tight">Bandeja</h2>
          <span className="text-sm text-text-3" data-testid="inbox-total">
            {total}
          </span>
          <button
            type="button"
            aria-pressed={selectMode}
            aria-label={
              selectMode ? "Salir del modo selección" : "Seleccionar conversaciones"
            }
            title={selectMode ? "Salir del modo selección" : "Seleccionar varias"}
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            disabled={conversations.length === 0}
            className={cn(
              "ml-auto rounded-md border p-1.5 transition-colors disabled:opacity-40",
              selectMode
                ? "border-brand bg-brand-tint text-brand-text"
                : "text-text-3 hover:bg-accent hover:text-foreground"
            )}
          >
            <CheckSquare className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
        <div className="flex items-center gap-2 rounded-md border bg-secondary px-3 py-[7px] transition-colors focus-within:border-brand focus-within:bg-background focus-within:ring-[3px] focus-within:ring-brand-soft">
          <Search className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.7} />
          <input
            placeholder="Buscar conversación…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-text-3"
          />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2.5">
        {(
          [
            { id: "all", label: "Todas", count: total },
            { id: "unread", label: "No leídas", count: unreadTotal },
          ] as const
        ).map((f) => (
          <button
            key={f.id}
            onClick={() => onFilterChange(f.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-[5px] text-[12.5px] font-medium transition-colors",
              filter === f.id
                ? "border-brand bg-brand text-white"
                : "bg-background text-text-2 hover:bg-accent"
            )}
          >
            {f.label}
            <span
              className={cn(
                "rounded-full px-1.5 text-[11px]",
                filter === f.id ? "bg-white/20" : "bg-secondary text-text-3"
              )}
            >
              {f.count}
            </span>
          </button>
        ))}
        <TagFilter
          compact
          facets={facets}
          value={tagFilter}
          onChange={onTagFilterChange}
        />
      </div>

      {selectMode && (
        <div className="flex items-center gap-2 border-b bg-subtle px-4 py-1.5 text-[12px] text-text-2">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              aria-label="Seleccionar todas las visibles"
              className="accent-primary"
              checked={allVisibleSelected}
              disabled={visible.length === 0}
              onChange={() =>
                setSelected(
                  allVisibleSelected
                    ? new Set()
                    : new Set(visible.map((c) => c.id))
                )
              }
            />
            Seleccionar todas
          </label>
          <span className="ml-auto text-text-3">
            {selected.size > 0 ? `${selected.size} seleccionadas` : "Tildá filas"}
          </span>
        </div>
      )}

      {selectMode && selected.size > 0 && (
        <BulkTagsBar
          compact
          count={selected.size}
          noun="conversaciones"
          addOptions={facets}
          removeOptions={selectedTagOptions}
          onAdd={(tag) => bulk({ add: [tag] })}
          onRemove={(tag) => bulk({ remove: [tag] })}
          onClear={exitSelectMode}
          busy={bulkBusy}
          error={bulkError}
        />
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="p-6 text-center text-xs text-text-3">Cargando…</p>
        ) : conversations.length === 0 && !filtered ? (
          <EmptyState onSeeded={onSeeded} />
        ) : visible.length === 0 ? (
          <p className="p-6 text-center text-xs text-text-3">
            Sin resultados para este filtro.
          </p>
        ) : (
          <ul>
            {visible.map((c) => {
              const unread = c.unreadCount > 0;
              const active = selectedId === c.id;
              const checked = selected.has(c.id);
              const extraTags = c.tags.length - ROW_TAGS_MAX;
              return (
                <li
                  key={c.id}
                  data-conversation-id={c.id}
                  className="relative border-b border-border/70"
                >
                  {active && !selectMode && (
                    <span className="absolute inset-y-0 left-0 w-[3px] bg-brand" />
                  )}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => (selectMode ? toggleSelected(c.id) : onSelect(c.id))}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        if (selectMode) toggleSelected(c.id);
                        else onSelect(c.id);
                      }
                    }}
                    aria-pressed={selectMode ? checked : undefined}
                    className={cn(
                      "flex w-full cursor-pointer items-start gap-[11px] px-4 py-[var(--row-py)] text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                      selectMode && checked
                        ? "bg-brand-tint/60"
                        : active && !selectMode
                          ? "bg-[var(--bg-active)]"
                          : "hover:bg-subtle"
                    )}
                  >
                    {selectMode && (
                      <input
                        type="checkbox"
                        tabIndex={-1}
                        readOnly
                        checked={checked}
                        aria-label={`Seleccionar ${c.contact.name}`}
                        className="mt-3 accent-primary"
                      />
                    )}
                    <span className="relative shrink-0">
                      <ContactAvatar name={c.contact.name} seed={c.contact.id} size="lg" />
                      {c.windowOpen && (
                        <span className="absolute bottom-0 right-0 h-[11px] w-[11px] rounded-full border-[2.5px] border-background bg-success" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-sm",
                            unread ? "font-[680]" : "font-semibold"
                          )}
                        >
                          {c.contact.name}
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
                          {previewText(c.preview)}
                        </span>
                        {unread && (
                          <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[10.5px] font-semibold text-white">
                            {c.unreadCount}
                          </span>
                        )}
                      </span>
                      {(c.stageName || c.handoffAt || c.tags.length > 0) && (
                        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {c.stageName && (
                            <span className="inline-flex items-center gap-1.5 rounded-full border bg-secondary px-2 py-0.5 text-[11px] text-text-2">
                              <span
                                className="h-[7px] w-[7px] rounded-full"
                                style={{
                                  background: STAGE_DOT[c.stageName] ?? "#9ca3af",
                                }}
                              />
                              {c.stageName}
                            </span>
                          )}
                          {c.handoffAt && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-[#ece2cf] bg-[#faf7f0] px-2 py-0.5 text-[11px] text-[#8a6d3b]">
                              <UserRound className="h-3 w-3" strokeWidth={1.7} />
                              Atención humana
                            </span>
                          )}
                          {c.tags.slice(0, ROW_TAGS_MAX).map((t) => (
                            <TagChip
                              key={t}
                              tag={t}
                              size="xs"
                              active={tagFilter.tags.includes(t)}
                              onClick={
                                selectMode ? undefined : () => toggleTagInFilter(t)
                              }
                              title={
                                tagFilter.tags.includes(t)
                                  ? "Quitar del filtro"
                                  : "Filtrar por esta etiqueta"
                              }
                            />
                          ))}
                          {extraTags > 0 && (
                            <span className="text-[10.5px] text-text-3">+{extraTags}</span>
                          )}
                        </span>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
            {hasMore && (
              <li className="p-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={loadingMore}
                  onClick={onLoadMore}
                >
                  {loadingMore
                    ? "Cargando…"
                    : `Cargar más (${visible.length} de ${filter === "unread" ? unreadTotal : total})`}
                </Button>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
