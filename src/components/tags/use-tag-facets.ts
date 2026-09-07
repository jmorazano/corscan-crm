"use client";

import { useCallback, useEffect, useState } from "react";
import type { TagFacet, TagScope } from "@/server/tags";

export type { TagFacet, TagScope };

/** Catálogo de etiquetas de la empresa por ámbito (`GET /api/tags`). */
export function useTagFacets(scope: TagScope, refreshKey = 0) {
  const [facets, setFacets] = useState<TagFacet[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/tags?scope=${scope}`).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json().catch(() => null)) as {
      tags?: TagFacet[];
    } | null;
    if (data?.tags) setFacets(data.tags);
    setLoaded(true);
  }, [scope]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  return { facets, loaded, reload };
}
