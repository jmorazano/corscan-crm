"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Un espacio de trabajo tal como lo devuelve `GET /api/workspaces`. */
export type WorkspaceDto = {
  id: string;
  name: string;
  slug: string;
  role: string;
  accent: string;
  initials?: string;
  unread: number;
};

const CONVERGENCE_POLL_MS = 60_000;

export type WorkspacesState = {
  workspaces: WorkspaceDto[];
  activeId: string;
  active: WorkspaceDto | null;
  /** Suma de no leídos de las OTRAS empresas (punto rojo de «Más»). */
  othersUnread: number;
  /** Espacio al que se está cambiando (overlay) o null. */
  switching: WorkspaceDto | null;
  error: string | null;
  refetch: () => Promise<void>;
  switchTo: (id: string) => Promise<void>;
};

/**
 * Estado de los espacios de trabajo (018). Arranca con la lista que
 * renderizó el servidor (sin parpadeo del rail) y se refresca por API ante
 * el ping SSE `workspace.unread`, al reconectar y al volver a primer
 * plano. Si el servidor dice que la empresa activa de la sesión ya no es
 * la montada (otra pestaña cambió), la página se recarga sola (FR-010):
 * nunca se muestran datos de dos empresas mezclados.
 */
export function useWorkspaces(
  initial: WorkspaceDto[],
  activeId: string
): WorkspacesState {
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>(initial);
  const [switching, setSwitching] = useState<WorkspaceDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const switchingRef = useRef(false);

  const refetch = useCallback(async () => {
    if (switchingRef.current) return;
    const res = await fetch("/api/workspaces").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json().catch(() => null)) as {
      active?: string;
      workspaces?: WorkspaceDto[];
    } | null;
    if (!data?.workspaces) return;
    if (data.active && data.active !== activeId && !switchingRef.current) {
      window.location.reload();
      return;
    }
    setWorkspaces(data.workspaces);
  }, [activeId]);

  useEffect(() => {
    const onFocus = () => void refetch();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refetch]);

  // Red de seguridad con dos o más espacios: aunque un navegador no emita
  // focus/visibilitychange (webviews, PWA en segundo plano), una pestaña
  // vieja converge a la empresa activa de la sesión en menos de un minuto.
  useEffect(() => {
    if (workspaces.length < 2) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refetch();
    }, CONVERGENCE_POLL_MS);
    return () => clearInterval(t);
  }, [workspaces.length, refetch]);

  const switchTo = useCallback(
    async (id: string) => {
      if (id === activeId || switchingRef.current) return;
      const target = workspaces.find((w) => w.id === id);
      if (!target) return;
      switchingRef.current = true;
      setError(null);
      setSwitching(target);
      const res = await fetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId: id }),
      }).catch(() => null);
      if (!res?.ok) {
        const data = (await res?.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        switchingRef.current = false;
        setSwitching(null);
        setError(data?.error?.message ?? "No se pudo cambiar de espacio");
        return;
      }
      // Recarga completa en la misma sección, sin parámetros de la empresa
      // anterior (un `?c=` de A no existe en B) — FR-005.
      window.location.assign(window.location.pathname);
    },
    [activeId, workspaces]
  );

  // El error se disuelve solo.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5_000);
    return () => clearTimeout(t);
  }, [error]);

  const active = useMemo(
    () => workspaces.find((w) => w.id === activeId) ?? null,
    [workspaces, activeId]
  );
  const othersUnread = useMemo(
    () =>
      workspaces.reduce(
        (sum, w) => (w.id === activeId ? sum : sum + w.unread),
        0
      ),
    [workspaces, activeId]
  );

  return {
    workspaces,
    activeId,
    active,
    othersUnread,
    switching,
    error,
    refetch,
    switchTo,
  };
}
