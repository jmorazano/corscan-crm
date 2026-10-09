"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  FileSpreadsheet,
  LayoutTemplate,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
  UserPlus,
} from "lucide-react";
import type { ContactDto } from "@/lib/types";
import { formatPhone } from "@/lib/utils";
import { contactHandle } from "@/lib/instagram/messaging";
import { serializeTagsParam, type TagOps } from "@/lib/tags";
import { parsePage } from "@/lib/pagination";
import { ContactAvatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionSheet, type SheetAction } from "@/components/ui/action-sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ImportWizard } from "@/components/contacts/import-wizard";
import { TemplateSender } from "@/components/inbox/template-sender";
import {
  readTagFilter,
  tagFilterPatch,
  useQueryFilters,
} from "@/components/use-query-filters";
import { BulkTagsBar } from "@/components/tags/bulk-tags-bar";
import { TagChip } from "@/components/tags/tag-chip";
import { TagEditor } from "@/components/tags/tag-editor";
import { TagFilter } from "@/components/tags/tag-filter";
import { useTagFacets, type TagFacet } from "@/components/tags/use-tag-facets";

/** Filtro de la lista tal como viaja en el bulk (033, `contactFilterSchema`). */
type ContactFilterBody = {
  q?: string;
  archived?: boolean;
  tags?: string[];
  mode?: "any" | "all";
};

export function ContactsClient({
  canBulkDelete = false,
}: {
  /** 033: «Eliminar» en bloque solo para el propietario. */
  canBulkDelete?: boolean;
}) {
  const router = useRouter();
  const [contacts, setContacts] = useState<ContactDto[]>([]);
  const [total, setTotal] = useState(0);
  // 006: los filtros viven en la URL (FR-003): compartibles y persistentes.
  const { params, set: setParams } = useQueryFilters();
  const query = params.get("q") ?? "";
  const showArchived = params.get("archived") === "true";
  const tagFilter = useMemo(() => readTagFilter(params), [params]);
  const tagsKey = serializeTagsParam(tagFilter.tags);
  // Paginación (FR-009): `page` también vive en la URL.
  const page = parsePage(params.get("page"));
  const [pageInfo, setPageInfo] = useState({ pages: 1, pageSize: 50 });
  const listRef = useRef<HTMLDivElement>(null);
  const [facetsRev, setFacetsRev] = useState(0);
  const { facets } = useTagFacets("contacts", facetsRev);
  // Selección múltiple (FR-004): ids visibles tildados.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // 033: «todos los que coinciden» — la selección pasa a ser el filtro (todas
  // las páginas) menos los destildados a mano.
  const [allMatching, setAllMatching] = useState<ContactFilterBody | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ContactDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [startingTemplate, setStartingTemplate] = useState<ContactDto | null>(
    null
  );
  const [revertingOptOut, setRevertingOptOut] = useState<ContactDto | null>(
    null
  );
  // Id del contacto con confirmación de borrado pendiente (dos pasos).
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // 012 (FR-014): en móvil las acciones por fila viven en una hoja «⋯»; el
  // borrado desde la hoja confirma en un diálogo (el clúster inline está oculto).
  const [sheetContact, setSheetContact] = useState<ContactDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContactDto | null>(null);

  const refetch = useCallback(async () => {
    const qs = new URLSearchParams();
    if (query.trim()) qs.set("q", query.trim());
    if (showArchived) qs.set("archived", "true");
    if (tagsKey) qs.set("tags", tagsKey);
    if (tagsKey && tagFilter.mode === "all") qs.set("mode", "all");
    if (page > 1) qs.set("page", String(page));
    const res = await fetch(`/api/contacts?${qs}`).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as {
      contacts: ContactDto[];
      total: number;
      page: number;
      pageSize: number;
      pages: number;
    };
    setContacts(data.contacts);
    setTotal(data.total);
    setPageInfo({ pages: data.pages, pageSize: data.pageSize });
    // Página fuera de rango (p. ej. tras borrar o filtrar): volver a la última.
    if (data.page > data.pages) {
      setParams({ page: data.pages > 1 ? String(data.pages) : null });
    }
  }, [query, showArchived, tagsKey, tagFilter.mode, page, setParams]);

  useEffect(() => {
    const t = setTimeout(() => void refetch(), 250);
    return () => clearTimeout(t);
  }, [refetch]);

  // Cambiar de filtros vuelve a la página 1 (no en la carga inicial, donde
  // la página viene de la URL) y descarta TODA la selección: «todos los que
  // coinciden» se define por el filtro. Cambiar de página descarta solo lo
  // tildado a mano; «todos los que coinciden» sigue (abarca todas las páginas).
  const filtersKey = `${query}|${showArchived}|${tagsKey}|${tagFilter.mode}`;
  const prevFiltersKeyRef = useRef(filtersKey);
  useEffect(() => {
    if (prevFiltersKeyRef.current !== filtersKey) {
      prevFiltersKeyRef.current = filtersKey;
      setParams({ page: null });
    }
    setSelected(new Set());
    setAllMatching(null);
    setExcluded(new Set());
    setBulkError(null);
  }, [filtersKey, setParams]);
  useEffect(() => {
    setSelected(new Set());
    setBulkError(null);
    listRef.current?.scrollTo({ top: 0 });
  }, [page]);

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/contacts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if ("tags" in body) setFacetsRev((v) => v + 1);
    void refetch();
  }

  function toggleTagInFilter(tag: string) {
    const has = tagFilter.tags.includes(tag);
    setParams(
      tagFilterPatch({
        tags: has ? tagFilter.tags.filter((t) => t !== tag) : [...tagFilter.tags, tag],
        mode: tagFilter.mode,
      })
    );
  }

  const isSelected = (id: string) =>
    allMatching ? !excluded.has(id) : selected.has(id);
  const selectionCount = allMatching
    ? Math.max(0, total - excluded.size)
    : selected.size;
  const allVisibleSelected =
    contacts.length > 0 && contacts.every((c) => isSelected(c.id));
  const someSelected = selectionCount > 0;
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allVisibleSelected;
    }
  }, [someSelected, allVisibleSelected]);

  function toggleInSet(set: Set<string>, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  function toggleSelected(id: string) {
    if (allMatching) setExcluded((prev) => toggleInSet(prev, id));
    else setSelected((prev) => toggleInSet(prev, id));
  }

  function clearSelection() {
    setSelected(new Set());
    setAllMatching(null);
    setExcluded(new Set());
    setBulkError(null);
  }

  function toggleSelectAll() {
    if (allVisibleSelected) {
      clearSelection();
    } else if (allMatching) {
      setExcluded((prev) => {
        const next = new Set(prev);
        for (const c of contacts) next.delete(c.id);
        return next;
      });
    } else {
      setSelected(new Set(contacts.map((c) => c.id)));
    }
  }

  // 033: pasa de «los de esta página» a «todos los que coinciden» con los
  // filtros actuales (foto del filtro: es lo que viaja al servidor).
  function selectAllMatching() {
    setAllMatching({
      ...(query.trim() ? { q: query.trim() } : {}),
      ...(showArchived ? { archived: true } : {}),
      ...(tagFilter.tags.length > 0
        ? { tags: tagFilter.tags, mode: tagFilter.mode }
        : {}),
    });
    setExcluded(new Set());
    setSelected(new Set());
  }

  function selectionBody() {
    return allMatching
      ? { filter: allMatching, excludeIds: [...excluded] }
      : { ids: [...selected] };
  }

  // Etiquetas presentes en la selección (para "Quitar etiqueta"). Con «todos
  // los que coinciden» no están todas a la vista: se ofrece el catálogo.
  const selectedTagOptions = useMemo(() => {
    if (allMatching) return facets;
    const counts = new Map<string, number>();
    for (const c of contacts) {
      if (!selected.has(c.id)) continue;
      for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, count]) => ({ tag, count }));
  }, [allMatching, facets, contacts, selected]);

  // Operación en bloque (FR-004/FR-008): un solo request; ante error la
  // selección se conserva para reintentar.
  async function bulk(ops: TagOps) {
    setBulkBusy(true);
    setBulkError(null);
    setBulkNotice(null);
    const res = await fetch("/api/contacts/bulk-tags", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...selectionBody(), ...ops }),
    }).catch(() => null);
    setBulkBusy(false);
    if (!res) {
      setBulkError("Sin conexión con el servidor: no se aplicó el cambio.");
      return;
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setBulkError(
        data?.error?.message ?? "No se pudo aplicar el cambio; reintentá."
      );
      return;
    }
    clearSelection();
    setFacetsRev((v) => v + 1);
    void refetch();
  }

  // 033: borrado en bloque. Devuelve un mensaje de error (el diálogo lo
  // muestra y la selección se conserva) o null si borró.
  async function removeSelected(): Promise<string | null> {
    setBulkBusy(true);
    setBulkNotice(null);
    const res = await fetch("/api/contacts/bulk-delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...selectionBody(), expectedCount: selectionCount }),
    }).catch(() => null);
    setBulkBusy(false);
    if (!res) return "Sin conexión con el servidor: NO se borró ningún contacto.";
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      // La cantidad cambió: se recarga la lista para que el diálogo muestre
      // la nueva y la persona confirme de nuevo.
      if (data?.error?.code === "selection_changed") void refetch();
      return data?.error?.message ?? "No se pudieron borrar los contactos; reintentá.";
    }
    const data = (await res.json().catch(() => null)) as { deleted?: number } | null;
    const deleted = data?.deleted ?? selectionCount;
    clearSelection();
    setBulkDeleting(false);
    setBulkNotice(
      deleted === 1 ? "Se borró 1 contacto." : `Se borraron ${deleted} contactos.`
    );
    setFacetsRev((v) => v + 1);
    void refetch();
    return null;
  }

  // Borra el contacto y sus conversaciones (solo del CRM; WhatsApp no cambia).
  // Es la vía de los pedidos de eliminación de datos: un fallo jamás puede
  // pasar en silencio como si hubiera borrado.
  async function remove(id: string) {
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch(`/api/contacts/${id}`, { method: "DELETE" }).catch(
      () => null
    );
    setDeleting(false);
    setConfirmingDelete(null);
    if (!res) {
      setDeleteError("Sin conexión con el servidor: el contacto NO se borró.");
      return;
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setDeleteError(
        data?.error?.message ?? "No se pudo borrar el contacto; reintentá."
      );
      return;
    }
    void refetch();
  }

  // Mismas acciones que el clúster de escritorio (la hoja ya espera a que
  // su entrada del historial se retire antes de ejecutar la acción).
  function sheetActionsFor(c: ContactDto): SheetAction[] {
    const actions: SheetAction[] = [
      {
        key: "edit",
        label: "Editar",
        icon: Pencil,
        onSelect: () => setEditing(c),
      },
      {
        key: "open",
        label: "Abrir conversación",
        icon: MessageSquareText,
        onSelect: () => router.push(`/inbox?contact=${c.id}`),
      },
    ];
    // 023: Instagram no tiene plantillas ni permite iniciar conversaciones.
    if (!c.optedOutAt && !c.isTest && !c.archivedAt && c.channel !== "instagram") {
      actions.push({
        key: "template",
        label: "Enviar plantilla",
        icon: LayoutTemplate,
        onSelect: () => setStartingTemplate(c),
      });
    }
    actions.push(
      {
        key: "archive",
        label: c.archivedAt ? "Desarchivar" : "Archivar",
        icon: c.archivedAt ? ArchiveRestore : Archive,
        onSelect: () => void patch(c.id, { archived: !c.archivedAt }),
      },
      {
        key: "delete",
        label: "Eliminar",
        hint: "Borra el contacto y sus conversaciones",
        icon: Trash2,
        destructive: true,
        onSelect: () => setDeleteTarget(c),
      }
    );
    return actions;
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-3 border-b px-4 py-3 md:flex-row md:items-center md:justify-between md:gap-4 md:px-6 md:py-4">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold">Contactos</h2>
          <span className="text-xs text-muted-foreground" data-testid="contacts-count">
            {total}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) =>
                setParams({ archived: e.target.checked ? "true" : null })
              }
              className="accent-primary"
            />
            Ver archivados
          </label>
          <div className="relative order-first w-full md:order-none md:w-auto">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre o teléfono…"
              value={query}
              onChange={(e) => setParams({ q: e.target.value || null })}
              className="w-full pl-8 md:w-72"
            />
          </div>
          <div className="ml-auto flex items-center gap-3 md:ml-0">
            <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />
              Importar
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <UserPlus className="mr-1.5 h-4 w-4" />
              Nuevo contacto
            </Button>
          </div>
        </div>
      </header>

      {/* Filtros (006): etiquetas + seleccionar todos los visibles */}
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2 md:px-6">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            ref={selectAllRef}
            type="checkbox"
            aria-label="Seleccionar todos los visibles"
            checked={allVisibleSelected}
            disabled={contacts.length === 0}
            onChange={toggleSelectAll}
            className="accent-primary"
          />
          Seleccionar todos
        </label>
        <TagFilter
          facets={facets}
          value={tagFilter}
          onChange={(next) => setParams(tagFilterPatch(next))}
        />
      </div>

      {someSelected && (
        <BulkTagsBar
          count={selectionCount}
          noun="contactos"
          addOptions={facets}
          removeOptions={selectedTagOptions}
          onAdd={(tag) => bulk({ add: [tag] })}
          onRemove={(tag) => bulk({ remove: [tag] })}
          onClear={clearSelection}
          busy={bulkBusy}
          error={bulkError}
          className="px-4 md:px-6"
        >
          {canBulkDelete && (
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => setBulkDeleting(true)}
              className="flex items-center gap-1 rounded-md border border-destructive/40 px-2.5 py-1 text-[12.5px] font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              Eliminar
            </button>
          )}
        </BulkTagsBar>
      )}

      {/* 033: de «los de esta página» a «todos los que coinciden» (todas las páginas). */}
      {someSelected && total > contacts.length && (allMatching || allVisibleSelected) && (
        <div
          data-testid="select-all-matching"
          className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b bg-muted/40 px-4 py-2 text-center text-xs text-muted-foreground md:px-6"
        >
          {allMatching ? (
            <>
              <span>
                {excluded.size === 0
                  ? `Están seleccionados los ${total.toLocaleString("es-AR")} contactos que coinciden, en todas las páginas.`
                  : `Seleccionados ${selectionCount.toLocaleString("es-AR")} de ${total.toLocaleString("es-AR")} contactos que coinciden, en todas las páginas.`}
              </span>
              <button
                type="button"
                className="font-medium text-brand-text underline-offset-2 hover:underline"
                onClick={clearSelection}
              >
                Deshacer selección
              </button>
            </>
          ) : (
            <>
              <span>
                Seleccionaste los {contacts.length} contactos de esta página.
              </span>
              <button
                type="button"
                className="font-medium text-brand-text underline-offset-2 hover:underline"
                onClick={selectAllMatching}
              >
                Seleccionar los {total.toLocaleString("es-AR")} que coinciden
              </button>
            </>
          )}
        </div>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto p-4 md:p-6">
        {bulkNotice && (
          <p
            role="status"
            className="mb-4 rounded-md border border-brand/40 bg-brand-tint px-3 py-2 text-sm text-brand-text"
          >
            {bulkNotice}
          </p>
        )}
        {deleteError && (
          <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {deleteError}
          </p>
        )}
        {contacts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            {query || tagsKey || showArchived ? (
              <>
                <p className="text-sm font-medium">
                  Sin contactos para estos filtros
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setParams({ q: null, tag: null, tags: null, mode: null, archived: null, page: null })
                  }
                >
                  Limpiar filtros
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">Sin contactos</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Cada persona que escriba a tu WhatsApp quedará registrada aquí
                  automáticamente.
                </p>
              </>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {contacts.map((c) => (
              <li
                key={c.id}
                data-contact-id={c.id}
                className={`flex items-center gap-3 rounded-lg border bg-card px-4 py-3 md:gap-4 ${
                  isSelected(c.id) ? "border-brand/60 bg-brand-tint/40" : ""
                }`}
              >
                <input
                  type="checkbox"
                  aria-label={`Seleccionar ${c.name}`}
                  checked={isSelected(c.id)}
                  onChange={() => toggleSelected(c.id)}
                  className="accent-primary"
                />
                <ContactAvatar name={c.name} seed={c.id} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {c.name}
                    </span>
                    {c.archivedAt && (
                      <Badge variant="secondary">Archivado</Badge>
                    )}
                    {c.optedOutAt && (
                      <Badge
                        variant="destructive"
                        role="button"
                        tabIndex={0}
                        className="min-h-8 cursor-pointer md:min-h-0"
                        title="Revertir la baja (pide confirmación)"
                        aria-label="Dado de baja. Tocá para revertir la baja (pide confirmación)"
                        onClick={() => setRevertingOptOut(c)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setRevertingOptOut(c);
                          }
                        }}
                      >
                        Dado de baja
                      </Badge>
                    )}
                    {c.tags.map((t) => (
                      <TagChip
                        key={t}
                        tag={t}
                        active={tagFilter.tags.includes(t)}
                        onClick={() => toggleTagInFilter(t)}
                        title={
                          tagFilter.tags.includes(t)
                            ? "Quitar del filtro"
                            : "Filtrar por esta etiqueta"
                        }
                      />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {contactHandle(c)}
                    {c.notes ? ` · ${c.notes.slice(0, 60)}` : ""}
                  </p>
                </div>
                {/* 012: «⋯» solo en móvil; el clúster completo solo en escritorio. */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="-mr-2 shrink-0 md:hidden"
                  aria-label="Más acciones"
                  data-testid="contact-more"
                  onClick={() => setSheetContact(c)}
                >
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
                <div className="hidden shrink-0 items-center gap-1.5 md:flex">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(c)}
                  >
                    Editar
                  </Button>
                  <Link href={`/inbox?contact=${c.id}`}>
                    <Button variant="ghost" size="icon" aria-label="Abrir conversación">
                      <MessageSquareText className="h-4 w-4" />
                    </Button>
                  </Link>
                  {!c.optedOutAt && !c.isTest && !c.archivedAt && c.channel !== "instagram" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setStartingTemplate(c)}
                    >
                      Plantilla
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={c.archivedAt ? "Desarchivar" : "Archivar"}
                    onClick={() => void patch(c.id, { archived: !c.archivedAt })}
                  >
                    {c.archivedAt ? (
                      <ArchiveRestore className="h-4 w-4" />
                    ) : (
                      <Archive className="h-4 w-4" />
                    )}
                  </Button>
                  {confirmingDelete === c.id ? (
                    <>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={deleting}
                        onClick={() => void remove(c.id)}
                      >
                        {deleting ? "Borrando…" : "Borrar todo"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={deleting}
                        onClick={() => setConfirmingDelete(null)}
                      >
                        Cancelar
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Eliminar contacto"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setConfirmingDelete(c.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {pageInfo.pages > 1 && (
          <nav
            aria-label="Paginación"
            className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"
          >
            <span>
              {(page - 1) * pageInfo.pageSize + 1}–
              {Math.min(page * pageInfo.pageSize, total)} de {total}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() =>
                  setParams({ page: page - 1 <= 1 ? null : String(page - 1) })
                }
              >
                ‹ Anterior
              </Button>
              <span>
                Página {page} de {pageInfo.pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageInfo.pages}
                onClick={() => setParams({ page: String(page + 1) })}
              >
                Siguiente ›
              </Button>
            </div>
          </nav>
        )}
      </div>

      {editing && (
        <EditDialog
          contact={editing}
          facets={facets}
          onClose={() => setEditing(null)}
          onSave={async (patchBody) => {
            await patch(editing.id, patchBody);
            setEditing(null);
          }}
        />
      )}

      {creating && (
        <NewContactDialog
          facets={facets}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setFacetsRev((v) => v + 1);
            void refetch();
          }}
        />
      )}

      {importing && (
        <ImportWizard
          onClose={() => setImporting(false)}
          onImported={() => void refetch()}
        />
      )}

      {startingTemplate && (
        <StartTemplateDialog
          contact={startingTemplate}
          onClose={() => setStartingTemplate(null)}
        />
      )}

      {revertingOptOut && (
        <RevertOptOutDialog
          contact={revertingOptOut}
          onClose={() => setRevertingOptOut(null)}
          onReverted={() => {
            setRevertingOptOut(null);
            void refetch();
          }}
        />
      )}

      {sheetContact && (
        <ActionSheet
          open
          onClose={() => setSheetContact(null)}
          title={sheetContact.name}
          description={contactHandle(sheetContact)}
          actions={sheetActionsFor(sheetContact)}
          testId="contact-actions-sheet"
        />
      )}

      {bulkDeleting && (
        <BulkDeleteDialog
          count={selectionCount}
          allMatching={allMatching !== null}
          deleting={bulkBusy}
          onClose={() => setBulkDeleting(false)}
          onConfirm={removeSelected}
        />
      )}

      {deleteTarget && (
        <DeleteContactDialog
          contact={deleteTarget}
          deleting={deleting}
          onClose={() => setDeleteTarget(null)}
          onConfirm={async () => {
            await remove(deleteTarget.id);
            setDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
}

/** Desde cuántos contactos el borrado en bloque pide escribir la cantidad. */
const TYPED_CONFIRM_FROM = 10;

/**
 * Confirmación del borrado en bloque (033). Irreversible: dice cuántos y qué
 * se borra, y desde TYPED_CONFIRM_FROM pide escribir la cantidad. Si el
 * servidor responde que la selección cambió, la cantidad nueva se muestra y
 * hay que volver a escribirla.
 */
function BulkDeleteDialog({
  count,
  allMatching,
  deleting,
  onClose,
  onConfirm,
}: {
  count: number;
  allMatching: boolean;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => Promise<string | null>;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const needsTyping = count >= TYPED_CONFIRM_FROM;
  useEffect(() => setTyped(""), [count]);
  const canConfirm =
    count > 0 && !deleting && (!needsTyping || typed.trim() === String(count));
  const label = count === 1 ? "1 contacto" : `${count.toLocaleString("es-AR")} contactos`;

  async function confirm() {
    setError(null);
    const message = await onConfirm();
    if (message) setError(message);
  }

  return (
    <Dialog
      open
      onClose={deleting ? () => undefined : onClose}
      title={`Eliminar ${label}`}
      size="sm"
      testId="bulk-delete-contacts-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={deleting}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={!canConfirm}
            onClick={() => void confirm()}
          >
            {deleting ? "Borrando…" : `Borrar ${label}`}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        Se borran {label}
        {allMatching ? " (todos los que coinciden con los filtros, en todas las páginas)" : ""}{" "}
        con sus conversaciones y mensajes del CRM. WhatsApp no cambia. No se
        puede deshacer.
      </p>
      {needsTyping && (
        <div className="mt-3 space-y-1.5">
          <label className="text-sm font-medium" htmlFor="bulk-delete-count">
            Escribí {count} para confirmar
          </label>
          <Input
            id="bulk-delete-count"
            inputMode="numeric"
            autoComplete="off"
            value={typed}
            disabled={deleting}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canConfirm) void confirm();
            }}
          />
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
    </Dialog>
  );
}

/** Confirmación de borrado desde la hoja «⋯» (012): mismo `remove` que el clúster. */
function DeleteContactDialog({
  contact,
  deleting,
  onClose,
  onConfirm,
}: {
  contact: ContactDto;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      title="Eliminar contacto"
      size="sm"
      testId="delete-contact-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={deleting}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={deleting}
            onClick={() => void onConfirm()}
          >
            {deleting ? "Borrando…" : "Borrar todo"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        Se borra a {contact.name} ({contactHandle(contact)}) y sus
        conversaciones del CRM. WhatsApp no cambia. No se puede deshacer.
      </p>
    </Dialog>
  );
}

/** Confirmación explícita de la reversión de una baja (FR-011). */
function RevertOptOutDialog({
  contact,
  onClose,
  onReverted,
}: {
  contact: ContactDto;
  onClose: () => void;
  onReverted: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revert() {
    setWorking(true);
    setError(null);
    const res = await fetch(`/api/contacts/${contact.id}/opt-out-revert`, {
      method: "POST",
    }).catch(() => null);
    setWorking(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo revertir la baja.");
      return;
    }
    onReverted();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Revertir la baja"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={working}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={working}
            onClick={() => void revert()}
          >
            {working ? "Revirtiendo…" : "Sí, revertir la baja"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        {contact.name} pidió no recibir más mensajes
        {contact.optedOutAt
          ? ` el ${new Date(contact.optedOutAt).toLocaleDateString()}`
          : ""}
        . Revertí la baja SOLO si te lo pidió explícitamente (p. ej. quiere
        volver a recibir novedades). Volverá a ser elegible para campañas.
      </p>
      {error && (
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </Dialog>
  );
}

/**
 * Inicia una conversación con plantilla hacia un contacto sin conversación
 * (004, US2): POST /api/conversations y navega al hilo recién creado.
 */
function StartTemplateDialog({
  contact,
  onClose,
}: {
  contact: ContactDto;
  onClose: () => void;
}) {
  const router = useRouter();

  return (
    <Dialog
      open
      onClose={onClose}
      title="Enviar plantilla"
      description={`A ${contact.name} (${formatPhone(contact.phone)}). Abre la conversación en la bandeja al enviarse.`}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Cerrar
        </Button>
      }
    >
      <TemplateSender
        onSent={() => router.push(`/inbox?contact=${contact.id}`)}
        submit={async (templateId, values) => {
          const res = await fetch("/api/conversations", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              contactId: contact.id,
              templateId,
              ...values,
            }),
          }).catch(() => null);
          if (!res) return "Sin conexión con el servidor";
          if (!res.ok) {
            const data = (await res.json().catch(() => null)) as {
              error?: { message?: string };
            } | null;
            return data?.error?.message ?? "No se pudo enviar la plantilla";
          }
          return null;
        }}
      />
    </Dialog>
  );
}

function NewContactDialog({
  facets,
  onClose,
  onCreated,
}: {
  facets: TagFacet[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        phone: phone.trim(),
        tags,
        notes: notes.trim() || undefined,
        consent,
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo crear el contacto.");
      return;
    }
    onCreated();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Nuevo contacto"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            disabled={!name.trim() || !phone.trim() || saving}
            onClick={() => void save()}
          >
            {saving ? "Creando…" : "Crear"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="new-name">
            Nombre
          </label>
          <Input
            id="new-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="new-phone">
            Teléfono (con código de país)
          </label>
          <Input
            id="new-phone"
            placeholder="+54 9 351 688 2234"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <span className="text-sm font-medium">Etiquetas</span>
          <TagEditor
            tags={tags}
            suggestions={facets}
            onChange={setTags}
            ariaLabel="Etiquetas del contacto nuevo"
            placeholder="Escribí y Enter (ej. clientes-2025)"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="new-notes">
            Notas
          </label>
          <Textarea
            id="new-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 accent-primary"
          />
          Este contacto dio su consentimiento para recibir mensajes (lo
          habilita para campañas).
        </label>
      </div>
      {error && (
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </Dialog>
  );
}

function EditDialog({
  contact,
  facets,
  onClose,
  onSave,
}: {
  contact: ContactDto;
  facets: TagFacet[];
  onClose: () => void;
  onSave: (patch: {
    name: string;
    notes: string;
    tags: string[];
  }) => Promise<void>;
}) {
  const [name, setName] = useState(contact.name);
  const [notes, setNotes] = useState(contact.notes ?? "");
  const [tags, setTags] = useState<string[]>(contact.tags);

  return (
    <Dialog
      open
      onClose={onClose}
      title="Editar contacto"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={() =>
              void onSave({
                name: name.trim(),
                notes,
                tags,
              })
            }
          >
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="edit-name">
            Nombre
          </label>
          <Input
            id="edit-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <span className="text-sm font-medium">Etiquetas</span>
          <TagEditor
            tags={tags}
            suggestions={facets}
            onChange={setTags}
            ariaLabel="Etiquetas del contacto"
            placeholder="Escribí y Enter (ej. clientes-2025)"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="edit-notes">
            Notas
          </label>
          <Textarea
            id="edit-notes"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
    </Dialog>
  );
}
