"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, PanelRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { serializeTagsParam, type TagOps } from "@/lib/tags";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@/lib/pagination";
import { inboxShortcut, neighborIndex } from "@/lib/gestures";
import { ContactAvatar } from "@/components/avatar";
import type { ConversationDto, MessageDto } from "@/lib/types";
import { useEvents } from "@/components/use-events";
import {
  readTagFilter,
  tagFilterPatch,
  useQueryFilters,
} from "@/components/use-query-filters";
import { useTagFacets } from "@/components/tags/use-tag-facets";
import { useIsMobile } from "@/components/use-media";
import { useHideTabBar } from "@/components/app-shell";
import { useSwipeBack } from "@/components/gestures";
import {
  ConversationList,
  type ListFilter,
  type RowActions,
} from "./conversation-list";
import { MessageThread } from "./message-thread";
import { Composer } from "./composer";
import { ContactPanel } from "./contact-panel";
import { ChannelIcon } from "@/components/channel-icon";
import { contactHandle } from "@/lib/instagram/messaging";
import { TrainerPanel } from "./trainer-panel";
import { TrainerAvatar } from "./trainer-row";

type ConversationPage = {
  conversations: ConversationDto[];
  /** 015: la conversación fija con el agente (null si no aplica). */
  trainer?: ConversationDto | null;
  total: number;
  unreadTotal: number;
  nextCursor: string | null;
  /** 023: la empresa usa Instagram (conexión o conversaciones): filtro por canal. */
  hasInstagram?: boolean;
};

const JSON_HEADERS = { "content-type": "application/json" };

/** Tras este plazo sin respuesta, el «está pensando…» se apaga solo. */
const TRAINER_THINKING_TIMEOUT_MS = 90_000;

export function InboxClient() {
  const isMobile = useIsMobile();
  const [conversations, setConversations] = useState<ConversationDto[] | null>(
    null
  );
  // 015: fila fija del entrenador (fuera de la paginación) y su indicador
  // de «pensando» (estado del cliente: POST ok → respuesta o timeout).
  const [trainer, setTrainer] = useState<ConversationDto | null>(null);
  const [trainerThinking, setTrainerThinking] = useState(false);
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pageMeta, setPageMeta] = useState<{
    total: number;
    unreadTotal: number;
    nextCursor: string | null;
    hasInstagram: boolean;
  }>({ total: 0, unreadTotal: 0, nextCursor: null, hasInstagram: false });
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
  // 012: la conversación abierta (`c`) y la ficha en móvil (`d`) también
  // viven en la URL: refrescar conserva el hilo y «atrás» deshace.
  const { params, set: setParams } = useQueryFilters();
  const tagFilter = useMemo(() => readTagFilter(params), [params]);
  const tagsKey = serializeTagsParam(tagFilter.tags);
  const listQuery = params.get("q") ?? "";
  const listFilter: ListFilter =
    params.get("filter") === "unread" ? "unread" : "all";
  // 023: filtro por canal (Todos / WhatsApp / Instagram) en la URL.
  const channelParam = params.get("channel");
  const listChannel: "whatsapp" | "instagram" | null =
    channelParam === "whatsapp" || channelParam === "instagram" ? channelParam : null;
  const urlConversationId = params.get("c");
  const detailsOpen = params.get("d") === "1";
  const filterRef = useRef({
    tagsKey,
    mode: tagFilter.mode,
    q: listQuery,
    filter: listFilter,
    channel: listChannel,
  });
  filterRef.current = {
    tagsKey,
    mode: tagFilter.mode,
    q: listQuery,
    filter: listFilter,
    channel: listChannel,
  };
  const [facetsRev, setFacetsRev] = useState(0);
  const { facets } = useTagFacets("conversations", facetsRev);
  const searchRef = useRef<HTMLInputElement>(null);
  // Entradas de historial creadas por nosotros (móvil): al cerrar desde la
  // UI se retiran con `history.back()`; si «atrás» ya las sacó, no.
  const pushedThreadRef = useRef(false);
  const pushedDetailsRef = useRef(false);

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
    if (f.channel) qs.set("channel", f.channel);
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
    setTrainer(data.trainer ?? null);
    setPageMeta({
      total: data.total,
      unreadTotal: data.unreadTotal,
      nextCursor: data.nextCursor,
      hasInstagram: data.hasInstagram ?? false,
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

  const patchById = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      await fetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      }).catch(() => null);
    },
    []
  );

  // Cambio de filtros: la búsqueda se debounce-a; el resto va al instante.
  useEffect(() => {
    const t = setTimeout(
      () => void refetchConversations(),
      listQuery ? 250 : 0
    );
    return () => clearTimeout(t);
  }, [refetchConversations, tagsKey, tagFilter.mode, listFilter, listQuery, listChannel]);

  // ---- Navegación por URL (012, FR-005) -----------------------------------

  const openThread = useCallback(
    (id: string, opts?: { push?: boolean }) => {
      if (id === selectedIdRef.current) {
        // Re-tocar el hilo abierto (escritorio): refresca y marca leído.
        void refetchMessages(id);
        void patchById(id, { markRead: true });
        return;
      }
      const push = opts?.push ?? isMobile;
      setParams({ c: id, contact: null, d: null }, { push });
      pushedThreadRef.current = push;
    },
    [isMobile, setParams, refetchMessages, patchById]
  );

  /** Vuelve a la lista retirando las entradas de historial que creamos. */
  const goToList = useCallback(() => {
    const steps =
      (pushedDetailsRef.current ? 1 : 0) + (pushedThreadRef.current ? 1 : 0);
    pushedDetailsRef.current = false;
    pushedThreadRef.current = false;
    if (steps > 0) {
      window.history.go(-steps);
      return;
    }
    setParams({ c: null, d: null });
  }, [setParams]);

  const closeThread = useCallback(() => {
    if (pushedThreadRef.current && !pushedDetailsRef.current) {
      pushedThreadRef.current = false;
      window.history.back();
      return;
    }
    goToList();
  }, [goToList]);

  const openDetails = useCallback(() => {
    if (!isMobile) {
      togglePanel(true);
      return;
    }
    if (detailsOpen) return;
    setParams({ d: "1" }, { push: true });
    pushedDetailsRef.current = true;
  }, [isMobile, detailsOpen, setParams, togglePanel]);

  const closeDetails = useCallback(() => {
    if (!isMobile) {
      togglePanel(false);
      return;
    }
    if (pushedDetailsRef.current) {
      pushedDetailsRef.current = false;
      window.history.back();
      return;
    }
    setParams({ d: null });
  }, [isMobile, setParams, togglePanel]);

  // «Atrás» del navegador ya sacó la entrada: no volver a retirarla.
  useEffect(() => {
    if (!detailsOpen) pushedDetailsRef.current = false;
  }, [detailsOpen]);
  useEffect(() => {
    if (!urlConversationId) pushedThreadRef.current = false;
  }, [urlConversationId]);

  // La URL manda: `?c=` abre (carga mensajes y marca leído) o cierra el hilo.
  useEffect(() => {
    const c = urlConversationId;
    if (c === selectedIdRef.current) return;
    if (c) {
      setSelectedId(c);
      setMessages([]);
      void refetchMessages(c);
      void patchById(c, { markRead: true });
    } else {
      setSelectedId(null);
      setMessages([]);
    }
  }, [urlConversationId, refetchMessages, patchById]);

  const inList =
    conversations?.find((c) => c.id === selectedId) ??
    (trainer && trainer.id === selectedId ? trainer : null);
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
        if (cancelled) return;
        if (data?.conversation) setSelectedFallback(data.conversation);
        // Enlace a una conversación que ya no existe: volver a la lista sin
        // colgarse (borde de la spec).
        else if (data !== null && !data.conversation) goToList();
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [needsFallback, selectedId, detailRev, goToList]);

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
      openThread(match.id, { push: false });
      return;
    }
    let cancelled = false;
    void fetch(
      `/api/conversations?contactId=${encodeURIComponent(contactParam)}&limit=1`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ConversationPage | null) => {
        const found = data?.conversations[0];
        if (!cancelled && found && !selectedIdRef.current)
          openThread(found.id, { push: false });
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [contactParam, conversations, openThread]);

  const stopThinking = useCallback(() => {
    if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current);
    thinkingTimerRef.current = null;
    setTrainerThinking(false);
  }, []);
  const startThinking = useCallback(() => {
    if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current);
    setTrainerThinking(true);
    thinkingTimerRef.current = setTimeout(() => {
      thinkingTimerRef.current = null;
      setTrainerThinking(false);
    }, TRAINER_THINKING_TIMEOUT_MS);
  }, []);
  useEffect(() => stopThinking, [selectedId, stopThinking]);

  useEvents({
    onMessageNew: ({ conversationId, message }) => {
      if (selectedIdRef.current === conversationId) {
        const m = message as MessageDto;
        setMessages((prev) =>
          prev.some((x) => x.id === m.id) ? prev : [...prev, m]
        );
        // 015: llegó la respuesta del agente al hilo del entrenador.
        if (m.direction === "in" && selectedRef.current?.kind === "trainer") {
          stopThinking();
        }
        void patchById(conversationId, { markRead: true });
      }
      void refetchConversations();
      // Un entrante nuevo puede crear/mover el lead: refresca el panel.
      setDetailRev((v) => v + 1);
    },
    onMessageUpdated: ({ conversationId, message }) => {
      if (selectedIdRef.current !== conversationId) return;
      const m = message as MessageDto;
      setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)));
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
      if (selectedIdRef.current === conversationId) goToList();
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
          headers: JSON_HEADERS,
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
      if (selectedRef.current?.kind === "trainer") startThinking();
      return null;
    },
    [refetchMessages, refetchConversations, startThinking]
  );

  // 015: nota de voz al entrenador (multipart). El mensaje llega por SSE en
  // `pending` y su transcripción por `message.updated`.
  const sendVoiceNote = useCallback(
    async (file: File, meta: { durationMs: number | null }): Promise<string | null> => {
      if (!selectedIdRef.current) return "Sin conversación seleccionada";
      const form = new FormData();
      form.append("file", file);
      if (meta.durationMs !== null) form.append("durationMs", String(meta.durationMs));
      const res = await fetch(
        `/api/conversations/${selectedIdRef.current}/messages/audio`,
        { method: "POST", body: form }
      ).catch(() => null);
      if (!res) return "Sin conexión con el servidor";
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        return data?.error?.message ?? "No se pudo enviar la nota de voz";
      }
      if (selectedIdRef.current) void refetchMessages(selectedIdRef.current);
      void refetchConversations();
      if (selectedRef.current?.kind === "trainer") startThinking();
      return null;
    },
    [refetchMessages, refetchConversations, startThinking]
  );

  // 022: imagen al entrenador (multipart). Mismo circuito que la nota de
  // voz: llega por SSE en `pending` y su lectura por `message.updated`.
  const sendTrainerImage = useCallback(
    async (file: File, meta: { caption: string | null }): Promise<string | null> => {
      if (!selectedIdRef.current) return "Sin conversación seleccionada";
      const form = new FormData();
      form.append("file", file);
      if (meta.caption) form.append("caption", meta.caption);
      const res = await fetch(
        `/api/conversations/${selectedIdRef.current}/messages/image`,
        { method: "POST", body: form }
      ).catch(() => null);
      if (!res) return "Sin conexión con el servidor";
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        return data?.error?.message ?? "No se pudo enviar la imagen";
      }
      if (selectedIdRef.current) void refetchMessages(selectedIdRef.current);
      void refetchConversations();
      if (selectedRef.current?.kind === "trainer") startThinking();
      return null;
    },
    [refetchMessages, refetchConversations, startThinking]
  );

  const patchConversation = useCallback(
    async (patch: {
      aiEnabled?: boolean;
      reactivate?: boolean;
      tags?: string[];
    }) => {
      if (!selectedIdRef.current) return;
      await patchById(selectedIdRef.current, patch);
      if (patch.tags) setFacetsRev((v) => v + 1);
      setDetailRev((v) => v + 1);
      void refetchConversations();
    },
    [patchById, refetchConversations]
  );

  // Etiquetado en bloque (006, FR-004): un request; devuelve el error o null.
  const bulkTags = useCallback(
    async (ids: string[], ops: TagOps): Promise<string | null> => {
      const res = await fetch("/api/conversations/bulk-tags", {
        method: "POST",
        headers: JSON_HEADERS,
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

  const deleteConversationById = useCallback(
    async (conversationId: string): Promise<string | null> => {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "DELETE",
      }).catch(() => null);
      if (!res) return "Sin conexión con el servidor";
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        return data?.error?.message ?? "No se pudo borrar";
      }
      if (selectedIdRef.current === conversationId) goToList();
      void refetchConversations();
      return null;
    },
    [goToList, refetchConversations]
  );

  // Borrado local al CRM (la Cloud API no tiene noción de borrar chats).
  const deleteSelected = useCallback(
    async (target: "conversation" | "contact"): Promise<string | null> => {
      const conversationId = selectedIdRef.current;
      const contactId = selectedRef.current?.contact.id;
      if (!conversationId) return "Sin conversación seleccionada";
      if (target === "conversation" || !contactId)
        return deleteConversationById(conversationId);
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: "DELETE",
      }).catch(() => null);
      if (!res) return "Sin conexión con el servidor";
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        return data?.error?.message ?? "No se pudo borrar";
      }
      goToList();
      void refetchConversations();
      return null;
    },
    [deleteConversationById, goToList, refetchConversations]
  );

  const markUnread = useCallback(
    async (id: string) => {
      await patchById(id, { markUnread: true });
      void refetchConversations();
    },
    [patchById, refetchConversations]
  );

  // Acciones por fila (012): gesto de deslizar y hoja «Más».
  const rowActions = useMemo<RowActions>(
    () => ({
      markRead: (id) => {
        void patchById(id, { markRead: true }).then(() => refetchConversations());
      },
      markUnread: (id) => void markUnread(id),
      toggleAi: (c) => {
        void patchById(c.id, { aiEnabled: !c.aiEnabled }).then(() =>
          refetchConversations()
        );
      },
      openDetails: (id) => {
        openThread(id);
        openDetails();
      },
      deleteConversation: deleteConversationById,
    }),
    [
      patchById,
      refetchConversations,
      markUnread,
      openThread,
      openDetails,
      deleteConversationById,
    ]
  );

  // ---- Vista móvil apilada + gestos + atajos ------------------------------

  const view: "list" | "thread" | "details" = !selectedId
    ? "list"
    : detailsOpen
      ? "details"
      : "thread";
  useHideTabBar(selectedId !== null);
  const threadRef = useSwipeBack<HTMLElement>(closeThread, isMobile && view === "thread");
  const detailsRef = useSwipeBack<HTMLElement>(
    closeDetails,
    isMobile && view === "details"
  );

  // Atajos de teclado (012, FR-011): ⌘K buscar · Alt+↓/↑ cambiar de chat ·
  // Esc cerrar ficha/deseleccionar · ⌘⇧U marcar no leída.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const sc = inboxShortcut(e);
      if (!sc) return;
      // Un diálogo abierto se maneja solo (Escape lo cierra a él).
      if (document.querySelector('[aria-modal="true"]')) return;
      switch (sc) {
        case "search":
          e.preventDefault();
          searchRef.current?.focus();
          searchRef.current?.select();
          break;
        case "escape": {
          if (e.target === searchRef.current) {
            searchRef.current?.blur();
            break;
          }
          if (isMobile) {
            if (view === "details") closeDetails();
            else if (view === "thread") closeThread();
          } else if (selectedIdRef.current && panelOpen) {
            togglePanel(false);
          } else if (selectedIdRef.current) {
            closeThread();
          }
          break;
        }
        case "next":
        case "prev": {
          e.preventDefault();
          const ids = [
            ...(trainer ? [trainer.id] : []),
            ...(conversations ?? []).map((c) => c.id),
          ];
          const idx = neighborIndex(ids, selectedIdRef.current, sc === "next" ? 1 : -1);
          const id = ids[idx];
          if (id) openThread(id);
          break;
        }
        case "markUnread": {
          e.preventDefault();
          if (selectedIdRef.current) void markUnread(selectedIdRef.current);
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    conversations,
    trainer,
    isMobile,
    view,
    panelOpen,
    closeDetails,
    closeThread,
    openThread,
    togglePanel,
    markUnread,
  ]);

  return (
    <div className="flex h-full" data-view={view}>
      <section
        className={cn(
          "w-full shrink-0 overflow-hidden md:w-[360px] md:border-r",
          view !== "list" && "hidden md:block"
        )}
        data-testid="inbox-list"
      >
        <ConversationList
          conversations={conversations}
          trainer={trainer}
          selectedId={selectedId}
          onSelect={openThread}
          onSeeded={() => void refetchConversations()}
          query={listQuery}
          onQueryChange={(q) => setParams({ q: q || null })}
          filter={listFilter}
          onFilterChange={(f) => setParams({ filter: f === "unread" ? "unread" : null })}
          channel={listChannel}
          onChannelChange={(ch) => setParams({ channel: ch })}
          showChannelFilter={pageMeta.hasInstagram || listChannel !== null}
          tagFilter={tagFilter}
          onTagFilterChange={(next) => setParams(tagFilterPatch(next))}
          facets={facets}
          onBulkTags={bulkTags}
          total={pageMeta.total}
          unreadTotal={pageMeta.unreadTotal}
          hasMore={pageMeta.nextCursor !== null}
          loadingMore={loadingMore}
          onLoadMore={() => void loadMore()}
          rowActions={rowActions}
          searchRef={searchRef}
        />
      </section>

      <section
        ref={threadRef}
        className={cn(
          "min-w-0 flex-1 flex-col bg-background",
          view === "thread" ? "flex" : "hidden md:flex"
        )}
        data-testid="inbox-thread"
      >
        {selected ? (
          <>
            <header className="flex items-center gap-1 border-b bg-background px-2 py-1.5 md:gap-2 md:px-4 md:py-2.5">
              <button
                type="button"
                onClick={closeThread}
                aria-label="Volver a la bandeja"
                data-testid="thread-back"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text-2 hover:bg-accent md:hidden"
              >
                <ChevronLeft className="h-6 w-6" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onClick={openDetails}
                aria-label={
                  selected.kind === "trainer"
                    ? "Ver panel del entrenador"
                    : `Ver ficha de ${selected.contact.name}`
                }
                data-testid="thread-contact"
                className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-1 pr-2 text-left transition-colors hover:bg-accent/60 md:px-1"
              >
                {selected.kind === "trainer" ? (
                  <TrainerAvatar />
                ) : (
                  <ContactAvatar
                    name={selected.contact.name}
                    seed={selected.contact.id}
                    size="md"
                  />
                )}
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-[15px] font-[650] leading-tight">
                    <span className="truncate">{selected.contact.name}</span>
                    {selected.kind === "instagram" && (
                      <ChannelIcon channel="instagram" className="shrink-0" />
                    )}
                    {selected.kind === "trainer" && (
                      <span
                        data-testid="trainer-badge"
                        className="shrink-0 rounded-full border border-brand-soft bg-brand-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-text"
                      >
                        Tu agente
                      </span>
                    )}
                    {selected.contact.optedOut && (
                      <span
                        data-testid="optout-badge"
                        title="Respondió BAJA/STOP: no recibe más envíos iniciados por el negocio (se puede revertir desde su ficha)."
                        className="shrink-0 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive"
                      >
                        Dado de baja
                      </span>
                    )}
                  </span>
                  {selected.kind === "trainer" ? (
                    <span className="block truncate text-xs text-text-3">
                      Tu asistente de WhatsApp · lo que le digas se aplica al instante
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "block truncate text-xs",
                        selected.windowOpen ? "font-medium text-success" : "text-text-3"
                      )}
                    >
                      {selected.kind === "instagram"
                        ? `${contactHandle(selected.contact)} · Instagram${selected.windowOpen ? " · ventana abierta" : ""}`
                        : selected.windowOpen
                          ? "ventana abierta"
                          : `+${selected.contact.phone}`}
                    </span>
                  )}
                </span>
              </button>
              {!panelOpen && (
                <button
                  onClick={() => togglePanel(true)}
                  aria-label="Mostrar detalles"
                  className="hidden rounded-sm border p-1.5 text-text-3 hover:bg-accent hover:text-foreground md:inline-flex"
                >
                  <PanelRight className="h-4 w-4" strokeWidth={1.7} />
                </button>
              )}
            </header>
            <MessageThread
              messages={messages}
              kind={selected.kind}
              thinkingLabel={
                selected.kind === "trainer" && trainerThinking
                  ? `${selected.contact.name} está pensando…`
                  : null
              }
            />
            <Composer
              conversation={selected}
              onSend={sendText}
              onSendAudio={selected.kind === "trainer" ? sendVoiceNote : undefined}
              onSendImage={selected.kind === "trainer" ? sendTrainerImage : undefined}
              onSent={() => {
                if (selectedIdRef.current)
                  void refetchMessages(selectedIdRef.current);
                void refetchConversations();
              }}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center bg-chat text-sm text-text-3">
            {selectedId ? "Cargando conversación…" : "Elige una conversación para ver el hilo"}
          </div>
        )}
      </section>

      <section
        ref={detailsRef}
        className={cn(
          "shrink-0 overflow-hidden bg-background",
          view === "details" ? "flex w-full flex-col" : "hidden",
          "md:block md:border-l md:transition-[width] md:duration-200",
          panelOpen && selected ? "md:w-[320px]" : "md:w-0 md:border-l-0"
        )}
        data-testid="inbox-details"
      >
        {selected && (
          <div className="h-full w-full md:w-[320px]">
            {selected.kind === "trainer" ? (
              <TrainerPanel
                conversation={selected}
                refreshKey={detailRev}
                onClose={closeDetails}
              />
            ) : (
              <ContactPanel
                conversation={selected}
                refreshKey={detailRev}
                conversationFacets={facets}
                onPatchConversation={patchConversation}
                onDelete={deleteSelected}
                onClose={closeDetails}
              />
            )}
          </div>
        )}
      </section>
    </div>
  );
}
