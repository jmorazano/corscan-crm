"use client";

import { useCallback, useEffect, useState } from "react";
import { useEvents } from "@/components/use-events";

/**
 * Total de mensajes no leídos de la empresa para el badge de «Bandeja»
 * (sidebar y barra inferior comparten UNA suscripción SSE vía AppShell).
 * La lista está paginada; el agregado del servidor cubre todas las
 * conversaciones, no solo la primera página.
 */
export function useUnreadBadge(): number {
  const [unread, setUnread] = useState(0);

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
    onReconnect: () => void refetch(),
  });

  return unread;
}
