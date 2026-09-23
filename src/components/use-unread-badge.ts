"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEvents } from "@/components/use-events";

/**
 * Total de mensajes no leídos de la empresa para el badge de «Bandeja»
 * (sidebar y barra inferior comparten UNA suscripción SSE vía AppShell).
 * La lista está paginada; el agregado del servidor cubre todas las
 * conversaciones, no solo la primera página.
 */
export function useUnreadBadge(extra?: {
  /** 018: ping de otra empresa del usuario → refrescar el rail. */
  onWorkspaceUnread?: () => void;
  /** 018: tras reconectar, el rail también hace catch-up. */
  onReconnect?: () => void;
}): number {
  const [unread, setUnread] = useState(0);
  const extraRef = useRef(extra);
  extraRef.current = extra;

  const refetch = useCallback(async () => {
    const res = await fetch("/api/conversations?limit=1").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { unreadMessages?: number };
    setUnread(data.unreadMessages ?? 0);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEvents({
    onMessageNew: () => void refetch(),
    onConversationUpdated: () => void refetch(),
    onConversationsUpdated: () => void refetch(),
    // Borrar una conversación con no leídos debe descontarlos del badge.
    onConversationDeleted: () => void refetch(),
    onWorkspaceUnread: () => extraRef.current?.onWorkspaceUnread?.(),
    onReconnect: () => {
      void refetch();
      extraRef.current?.onReconnect?.();
    },
  });

  return unread;
}
