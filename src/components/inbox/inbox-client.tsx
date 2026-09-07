"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { serializeTagsParam, type TagOps } from "@/lib/tags";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@/lib/pagination";
import { ContactAvatar } from "@/components/avatar";
import type { ConversationDto, MessageDto } from "@/lib/types";
import { useEvents } from "@/components/use-events";
import {
  readTagFilter,
  tagFilterPatch,
  useQueryFilters,
} from "@/components/use-query-filters";
import { useTagFacets } from "@/components/tags/use-tag-facets";
import { ConversationList, type ListFilter } from "./conversation-list";
import { MessageThread } from "./message-thread";
import { Composer } from "./composer";
import { ContactPanel } from "./contact-panel";

type ConversationPage = {
  conversations: ConversationDto[];
  total: number;
  unreadTotal: number;
  nextCursor: string | null;
};

export function InboxClient() {
  const [conversations, setConversations] = useState<ConversationDto[] | null>(
    null
  );
  const [pageMeta, setPageMeta] = useState<{
    total: number;
    unreadTotal: number;
    nextCursor: string | null;
  }>({ total: 0, unreadTotal: 0, nextCursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Hilo abierto que no está en la página cargada (enlace directo, filtro
  // que lo excluye, más allá de "Cargar más"): se trae por id.
  const [selectedFallback, setSelectedFallback] =
    useState<ConversationDto | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [panelOpen, setPanelOpen] = useState(true);
  // Se incrementa con cada evento SSE que puede cambiar la etapa/lead o el
  // estado del agente: el panel de detalles lo observa y refetch en vivo.
  const [detailRev, setDetailRev] = useState(0);

  // 006: búsqueda, "No leídas" y etiquetas persistidos en la URL (FR-003) y
  // resueltos en el servidor junto con la paginación por cursor (FR-009).
  const { params, set: setParams } = useQueryFilters();
  const tagFilter = useMemo(() => readTagFilter(params), [params]);
  const tagsKey = serializeTagsParam(tagFilter.tags);
  const listQuery = params.get("q") ?? "";
  const listFilter: ListFilter =
    params.get("filter") === "unread" ? "unread" : "all";
  const filterRef = useRef({
    tagsKey,
    mode: tagFilter.mode,
    q: listQuery,
    filter: listFilter,
  });
  filterRef.current = {
    tagsKey,
    mode: tagFilter.mode,
    q: listQuery,
    filter: listFilter,
  };
  const [facetsRev, setFacetsRev] = useState(0);
  const { facets } = useTagFacets("conversations", facetsRev);

  useEffect(() => {
    setPanelOpen(localStorage.getItem("vocero.panelOpen") !== "false");
  }, []);
  const togglePanel = useCallback((open: boolean) => {
    setPanelOpen(open);
    localStorage.setItem("vocero.panelOpen", String(open));
  }, []);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const loadedCountRef = useRef(0);
  loadedCountRef.current = conversations?.length ?? 0;

  // Secuencia de refetch: una respuesta vieja que resuelva tarde no puede
  // pisar a una nueva — sin esto, un snapshot previo a un borrado podía
  // "resucitar" la conversación eliminada en el sidebar.
  const conversationsSeqRef = useRef(0);

  const buildListQuery = useCallback((extra?: Record<string, string>) => {
    const f = filterRef.current;
    const qs = new URLSearchParams();
    if (f.tagsKey) {
      qs.set("tags", f.tagsKey);
      if (f.mode === "all") qs.set("mode", "all");
    }
    if (f.q.trim()) qs.set("q", f.q.trim());
    if (f.filter === "unread") qs.set("filter", "unread");
    for (const [k, v] of Object.entries(extra ?? {})) qs.set(k, v);
    return `/api/conversations?${qs}`;
  }, []);

  // Refetch de la primera página con el tamaño ya cargado (acotado), así lo
  // que el operador tenía a la vista sigue a la vista tras cada evento.
  const refetchConversations = useCallback(async () => {
    const seq = ++conversationsSeqRef.current;
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(DEFAULT_PAGE_SIZE, loadedCountRef.current)
    );
    const res = await fetch(buildListQuery({ limit: String(limit) })).catch(
      () => null
    );
    if (!res?.ok) return;
    const data = (await res.json()) as ConversationPage;
    if (seq !== conversationsSeqRef.current) return; // llegó una más nueva
    setConversations(data.conversations);
    setPageMeta({
      total: data.total,
      unreadTotal: data.unreadTotal,
      nextCursor: data.nextCursor,
    });
  }, [buildListQuery]);

  const loadMore = useCallback(async () => {
    const cursor = pageMeta.nextCursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const seq = conversationsSeqRef.current;
    const res = await fetch(buildListQuery({ cursor })).catch(() => null);
    setLoadingMore(false);
    if (!res?.ok) return;
    const data = (await res.json()) as ConversationPage;
    if (seq !== conversationsSeqRef.current) return; // hubo un refetch en el medio
    setConversations((prev) => {
      const seen = new Set((prev ?? []).map((c) => c.id));
      return [
        ...(prev ?? []),
        ...data.conversations.filter((c) => !seen.has(c.id)),
      ];
    });
    setPageMeta((m) => ({ ...m, nextCursor: data.nextCursor }));
  }, [buildListQuery, pageMeta.nextCursor, loadingMore]);

  const refetchMessages = useCallback(async (conversationId: string) => {
    const res = await fetch(
      `/api/conversations/${conversationId}/messages`
    ).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { messages: MessageDto[] };
    if (selectedIdRef.current === conversationId) setMessages(data.messages);
  }, []);

  // Cambio de filtros: la búsqueda se debounce-a; el resto va al instante.
  useEffect(() => {
    const t = setTimeout(
      () => void refetchConversations(),
      listQuery ? 250 : 0
    );
    return () => clearTimeout(t);
  }, [refetchConversations, tagsKey, tagFilter.mode, listFilter, listQuery]);

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      setMessages([]);
      void refetchMessages(id);
      void fetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markRead: true }),
      });
    },
    [refetchMessages]
  );

  const inList = conversations?.find((c) => c.id === selectedId) ?? null;
  const needsFallback = selectedId !== null && conversations !== null && !inList;
  useEffect(() => {
    if (!needsFallback || !selectedId) {
      setSelectedFallback(null);
      return;
    }
    let cancelled = false;
    void fetch(`/api/conversations/${selectedId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { conversation?: ConversationDto } | null) => {
        if (!cancelled && data?.conversation) setSelectedFallback(data.conversation);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [needsFallback, selectedId, detailRev]);

  const selected =
    inList ?? (selectedFallback?.id === selectedId ? selectedFallback : null);
  const selectedRef = useRef<ConversationDto | null>(null);
  selectedRef.current = selected;

  // Enlace directo desde Contactos/Pipeline: /inbox?contact=<id>. Si la
  // conversación no está en la página cargada, se busca por contacto.
  const contactParam = params.get("contact");
  useEffect(() => {
    if (!contactParam || selectedIdRef.current || conversations === null) return;
    const match = conversations.find((c) => c.contact.id === contactParam);
    if (match) {
      select(match.id);
      return;
    }
    let cancelled = false;
    void fetch(
      `/api/conversations?contactId=${encodeURIComponent(contactParam)}&limit=1`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ConversationPage | null) => {
        const found = data?.conversations[0];
        if (!cancelled && found && !selectedIdRef.current) select(found.id);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [contactParam, conversations, select]);

  useEvents({
    onMessageNew: ({ conversationId, message }) => {
      if (selectedIdRef.current === conversationId) {
        const m = message as MessageDto;
        setMessages((prev) =>
          prev.some((x) => x.id === m.id) ? prev : [...prev, m]
        );
        void fetch(`/api/conversations/${conversationId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ markRead: true }),
        });
      }
      void refetchConversations();
      // Un entrante nuevo puede crear/mover el lead: refresca el panel.
      setDetailRev((v) => v + 1);
    },
    onMessageStatus: ({ conversationId, messageId, status }) => {
      if (selectedIdRef.current !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, status: status as MessageDto["status"] } : m
        )
      );
    },
    onConversationUpdated: () => {
      void refetchConversations();
      // El agente movió de etapa o cambió el handoff: refresca el panel en vivo.
      setDetailRev((v) => v + 1);
      setFacetsRev((v) => v + 1);
    },
    onConversationsUpdated: () => {
      // Etiquetado en bloque desde otra pestaña/operador (FR-007).
      void refetchConversations();
      setDetailRev((v) => v + 1);
      setFacetsRev((v) => v + 1);
    },
    onConversationDeleted: ({ conversationId }) => {
      // Si otro operador (u otra pestaña) la borró, soltar la selección para
      // no dejar un hilo fantasma en pantalla.
      if (selectedIdRef.current === conversationId) {
        setSelectedId(null);
        setMessages([]);
      }
      void refetchConversations();
    },
    onReconnect: () => {
      // Catch-up tras reconexión (contrato sse.md): refetch completo.
      void refetchConversations();
      if (selectedIdRef.current) void refetchMessages(selectedIdRef.current);
      setDetailRev((v) => v + 1);
    },
  });

  const sendText = useCallback(
    async (text: string): Promise<string | null> => {
      if (!selectedIdRef.current) return "Sin conversación seleccionada";
      const res = await fetch(
        `/api/conversations/${selectedIdRef.current}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        }
      ).catch(() => null);
      if (!res) return "Sin conexión con el servidor";
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        return data?.error?.message ?? "No se pudo enviar el mensaje";
      }
      if (selectedIdRef.current) void refetchMessages(selectedIdRef.current);
      void refetchConversations();
      return null;
    },
    [refetchMessages, refetchConversations]
  );

  const patchConversation = useCallback(
    async (patch: {
      aiEnabled?: boolean;
      reactivate?: boolean;
      tags?: string[];
    }) => {
      if (!selectedIdRef.current) return;
      await fetch(`/api/conversations/${selectedIdRef.current}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => null);
      if (patch.tags) setFacetsRev((v) => v + 1);
      setDetailRev((v) => v + 1);
      void refetchConversations();
    },
    [refetchConversations]
  );

  // Etiquetado en bloque (006, FR-004): un request; devuelve el error o null.
  const bulkTags = useCallback(
    async (ids: string[], ops: TagOps): Promise<string | null> => {
      const res = await fetch("/api/conversations/bulk-tags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, ...ops }),
      }).catch(() => null);
      if (!res) return "Sin conexión con el servidor: no se aplicó el cambio.";
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        return data?.error?.message ?? "No se pudo aplicar el cambio; reintentá.";
      }
      setFacetsRev((v) => v + 1);
      setDetailRev((v) => v + 1);
      void refetchConversations();
      return null;
    },
    [refetchConversations]
  );

  // Borrado local al CRM (la Cloud API no tiene noción de borrar chats).
  const deleteSelected = useCallback(
    async (target: "conversation" | "contact"): Promise<string | null> => {
      const conversationId = selectedIdRef.current;
      const contactId = selectedRef.current?.contact.id;
      if (!conversationId) return "Sin conversación seleccionada";
      const url =
        target === "contact" && contactId
          ? `/api/contacts/${contactId}`
          : `/api/conversations/${conversationId}`;
      const res = await fetch(url, { method: "DELETE" }).catch(() => null);
      if (!res) return "Sin conexión con el servidor";
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        return data?.error?.message ?? "No se pudo borrar";
      }
      setSelectedId(null);
      setMessages([]);
      void refetchConversations();
      return null;
    },
    [refetchConversations]
  );

  return (
    <div className="flex h-full">
      <section className="w-[360px] shrink-0 overflow-hidden border-r">
        <ConversationList
          conversations={conversations}
          selectedId={selectedId}
          onSelect={select}
          onSeeded={() => void refetchConversations()}
          query={listQuery}
          onQueryChange={(q) => setParams({ q: q || null })}
          filter={listFilter}
          onFilterChange={(f) => setParams({ filter: f === "unread" ? "unread" : null })}
          tagFilter={tagFilter}
          onTagFilterChange={(next) => setParams(tagFilterPatch(next))}
          facets={facets}
          onBulkTags={bulkTags}
          total={pageMeta.total}
          unreadTotal={pageMeta.unreadTotal}
          hasMore={pageMeta.nextCursor !== null}
          loadingMore={loadingMore}
          onLoadMore={() => void loadMore()}
        />
      </section>

      <section className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <>
            <header className="flex items-center justify-between border-b bg-background px-4 py-2.5">
              <div className="flex items-center gap-3">
                <ContactAvatar
                  name={selected.contact.name}
                  seed={selected.contact.id}
                  size="md"
                />
                <div>
                  <p className="text-[15px] font-[650] leading-tight">
                    {selected.contact.name}
                  </p>
                  <p
                    className={
                      selected.windowOpen
                        ? "text-xs font-medium text-success"
                        : "text-xs text-text-3"
                    }
                  >
                    {selected.windowOpen
                      ? "ventana abierta"
                      : `+${selected.contact.phone}`}
                  </p>
                </div>
              </div>
              {!panelOpen && (
                <button
                  onClick={() => togglePanel(true)}
                  aria-label="Mostrar detalles"
                  className="rounded-sm border p-1.5 text-text-3 hover:bg-accent hover:text-foreground"
                >
                  <PanelRight className="h-4 w-4" strokeWidth={1.7} />
                </button>
              )}
            </header>
            <MessageThread messages={messages} />
            <Composer
              conversation={selected}
              onSend={sendText}
              onSent={() => {
                if (selectedIdRef.current)
                  void refetchMessages(selectedIdRef.current);
                void refetchConversations();
              }}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center bg-chat text-sm text-text-3">
            Elige una conversación para ver el hilo
          </div>
        )}
      </section>

      <section
        className={cn(
          "shrink-0 overflow-hidden border-l transition-[width] duration-[220ms]",
          panelOpen && selected ? "w-[320px]" : "w-0 border-l-0"
        )}
      >
        {selected && (
          <div className="h-full w-[320px]">
            <ContactPanel
              conversation={selected}
              refreshKey={detailRev}
              conversationFacets={facets}
              onPatchConversation={patchConversation}
              onDelete={deleteSelected}
              onClose={() => togglePanel(false)}
            />
          </div>
        )}
      </section>
    </div>
  );
}
