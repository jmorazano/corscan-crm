"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock3, Search, X } from "lucide-react";
import {
  EMOJI_CATEGORIES,
  parseRecent,
  pushRecent,
  searchEmojis,
} from "@/lib/emoji-catalog";
import { cn } from "@/lib/utils";

const RECENT_KEY = "vocero:emoji-recent";

/** Recientes del navegador (comodidad por usuario: si falla, se arranca vacío). */
function readRecent(): string[] {
  try {
    return parseRecent(window.localStorage.getItem(RECENT_KEY));
  } catch {
    return [];
  }
}

function writeRecent(list: string[]): void {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // modo privado o almacenamiento bloqueado: los recientes no persisten
  }
}

/**
 * Selector de emojis del composer (038). Panel arriba del campo, como las
 * respuestas rápidas: pestañas por categoría, búsqueda en español y los
 * recientes primero. El foco se queda en el campo del mensaje (los botones
 * no lo roban): el emoji entra donde está el cursor y se sigue escribiendo.
 * No se cierra al elegir (se suelen mandar varios); se cierra con Esc, con
 * la X o al tocar el botón otra vez.
 */
export function EmojiPicker({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [tab, setTab] = useState<string>(EMOJI_CATEGORIES[0]!.id);

  useEffect(() => {
    const stored = readRecent();
    setRecent(stored);
    if (stored.length > 0) setTab("recientes");
  }, []);

  const results = useMemo(() => searchEmojis(query), [query]);
  const searching = query.trim().length > 0;
  const shown = searching
    ? results
    : tab === "recientes"
      ? recent
      : (EMOJI_CATEGORIES.find((c) => c.id === tab)?.emojis.map((e) => e[0]) ?? []);

  function pick(emoji: string) {
    const next = pushRecent(recent, emoji);
    setRecent(next);
    writeRecent(next);
    onPick(emoji);
  }

  return (
    <div
      role="dialog"
      aria-label="Emojis"
      data-testid="emoji-picker"
      className="mb-2 rounded-md border bg-background shadow-pop"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-2 border-b px-2.5 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-text-3" strokeWidth={1.8} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Enter elige el primero de la búsqueda (no manda el mensaje).
            if (e.key === "Enter") {
              e.preventDefault();
              const first = results[0];
              if (first) pick(first);
            }
          }}
          placeholder="Buscar emoji (gracias, ok, casa…)"
          aria-label="Buscar emoji"
          data-testid="emoji-search"
          className="min-w-0 flex-1 bg-transparent py-1 text-base outline-none placeholder:text-text-3 md:text-sm"
        />
        <button
          type="button"
          aria-label="Cerrar emojis"
          data-testid="emoji-close"
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-3 transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>
      {!searching && (
        <div role="tablist" aria-label="Categorías" className="flex gap-0.5 overflow-x-auto border-b px-1.5 py-1">
          {recent.length > 0 && (
            <TabButton
              active={tab === "recientes"}
              label="Recientes"
              onClick={() => setTab("recientes")}
            >
              <Clock3 className="h-4 w-4" strokeWidth={1.8} />
            </TabButton>
          )}
          {EMOJI_CATEGORIES.map((c) => (
            <TabButton key={c.id} active={tab === c.id} label={c.label} onClick={() => setTab(c.id)}>
              <span className="text-[17px] leading-none">{c.icon}</span>
            </TabButton>
          ))}
        </div>
      )}
      <div className="h-[184px] overflow-y-auto p-1.5" data-testid="emoji-grid">
        {shown.length === 0 ? (
          <p className="px-1.5 py-3 text-sm text-text-3">
            {searching ? "Sin coincidencias." : "Todavía no usaste emojis."}
          </p>
        ) : (
          <div className="grid grid-cols-8 gap-0.5 sm:grid-cols-10 md:grid-cols-12">
            {shown.map((emoji) => (
              <button
                key={emoji}
                type="button"
                data-testid="emoji-option"
                aria-label={emoji}
                // El campo conserva el foco y el cursor: no se lo roba el botón.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(emoji)}
                className="flex h-9 items-center justify-center rounded-md text-[22px] leading-none transition-colors hover:bg-accent"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex h-8 w-9 shrink-0 items-center justify-center rounded-md text-text-3 transition-colors",
        active ? "bg-brand-tint text-brand-text" : "hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}
