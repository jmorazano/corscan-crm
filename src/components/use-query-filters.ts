"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  parseTagMode,
  parseTagsParam,
  serializeTagsParam,
  type TagMode,
} from "@/lib/tags";

export type QueryPatch = Record<string, string | null | undefined>;

/**
 * Estado de filtros en los query params de la URL (006, FR-003).
 *
 * Lee los params una vez (SSR-consistente vía useSearchParams), y después
 * los mantiene en estado local sincronizado con `history.replaceState`:
 * sin roundtrip al servidor por cada tecla y sin ensuciar el historial.
 * Next integra replaceState con su router, así que usePathname/useSearchParams
 * del resto de la página siguen viendo la URL real. Back/forward
 * (popstate) re-lee la URL.
 */
export function useQueryFilters() {
  const initial = useSearchParams();
  const [params, setParams] = useState<URLSearchParams>(
    () => new URLSearchParams(initial.toString())
  );
  const ref = useRef(params);
  ref.current = params;

  useEffect(() => {
    const onPop = () => {
      const next = new URLSearchParams(window.location.search);
      ref.current = next;
      setParams(next);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const set = useCallback((patch: QueryPatch) => {
    const next = new URLSearchParams(ref.current.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined || value === "") {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }
    const qs = next.toString();
    const url = qs
      ? `${window.location.pathname}?${qs}`
      : window.location.pathname;
    window.history.replaceState(null, "", url);
    ref.current = next;
    setParams(next);
  }, []);

  return { params, set };
}

export type TagFilterState = { tags: string[]; mode: TagMode };

/** Lee `tags=a,b&mode=any|all` (con alias `tag=` de 004). */
export function readTagFilter(params: URLSearchParams): TagFilterState {
  return {
    tags: parseTagsParam(params.get("tags"), params.get("tag")),
    mode: parseTagMode(params.get("mode")),
  };
}

/** Serializa el filtro a un patch de params (limpia el alias viejo). */
export function tagFilterPatch(state: TagFilterState): QueryPatch {
  const tags = serializeTagsParam(state.tags);
  return {
    tag: null,
    tags: tags || null,
    mode: tags && state.mode === "all" ? "all" : null,
  };
}
