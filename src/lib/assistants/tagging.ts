import { MAX_TAG_LENGTH, sanitizeTags } from "@/lib/tags";

/**
 * 046: etiquetar contactos desde Claude (`tag_contacts`). PURO: qué
 * etiquetas se aceptan y qué cambió en cada contacto, para devolverle al
 * asistente un resultado que se deshace EXACTO (por etiqueta, los contactos
 * que la ganaron o la perdieron en esta llamada).
 */

/** Contactos por llamada: con filtro, la búsqueda tiene que caber entera. */
export const MAX_TAG_CONTACTS_PER_CALL = 1000;
/** Llamadas aceptadas, por empresa y por hora. */
export const MAX_TAGGING_CALLS_PER_HOUR = 20;
/** Etiquetas por llamada (agregar + quitar). */
export const MAX_TAGS_PER_CALL = 10;

/** Fechas (2026-10, 2026-10-29): las etiquetas automáticas de 043 las llevan. */
const DATE_IN_TAG =
  /(?<!\d)(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])(?:[-/.](?:0?[1-9]|[12]\d|3[01]))?(?!\d)/g;

/**
 * Una etiqueta es un rótulo del negocio, no un dato del cliente: nada con
 * pinta de correo (@) ni de teléfono o documento (siete o más dígitos aun
 * separados por espacios, puntos o guiones, sin contar las fechas).
 */
export function tagRejection(tag: string): string | null {
  if (tag.includes("@")) return "parece un correo o un usuario";
  const digits = tag.replace(DATE_IN_TAG, " ").replace(/[\s.\-–—/()]/g, "");
  if (/\d{7,}/.test(digits)) return "parece un teléfono o un documento";
  return null;
}

export type TagRequest = {
  add: string[];
  remove: string[];
  rejected: { tag: string; reason: string }[];
};

/** Sanea (minúsculas, recorte) y filtra lo que no es un rótulo. */
export function prepareTagRequest(
  add: readonly string[] | undefined,
  remove: readonly string[] | undefined
): TagRequest {
  const rejected: TagRequest["rejected"] = [];
  const keep = (tags: readonly string[] | undefined) =>
    sanitizeTags(tags).filter((tag) => {
      const reason = tagRejection(tag);
      if (reason) rejected.push({ tag, reason });
      return !reason;
    });
  const removeTags = keep(remove);
  // Lo que se pide agregar y quitar a la vez se agrega (regla de applyTagOps):
  // se informa solo como agregado.
  const addTags = keep(add);
  return {
    add: addTags,
    remove: removeTags.filter((t) => !addTags.includes(t)),
    rejected,
  };
}

export type TaggedRow = { id: string; before: readonly string[]; after: readonly string[] };

export type TaggingSummary = {
  /** Por etiqueta, los contactos que la GANARON en esta llamada. */
  added: { tag: string; contactIds: string[] }[];
  /** Por etiqueta, los contactos que la PERDIERON en esta llamada. */
  removed: { tag: string; contactIds: string[] }[];
  /** Contactos que ya tenían el tope de etiquetas y no recibieron alguna. */
  full: string[];
  updated: number;
};

export function summarizeTagging(
  rows: readonly TaggedRow[],
  request: Pick<TagRequest, "add" | "remove">
): TaggingSummary {
  const added = request.add.map((tag) => ({ tag, contactIds: [] as string[] }));
  const removed = request.remove.map((tag) => ({ tag, contactIds: [] as string[] }));
  const full: string[] = [];
  let updated = 0;
  for (const row of rows) {
    const before = new Set(row.before);
    const after = new Set(row.after);
    let changed = false;
    for (const group of added) {
      if (after.has(group.tag) && !before.has(group.tag)) {
        group.contactIds.push(row.id);
        changed = true;
      }
    }
    for (const group of removed) {
      if (before.has(group.tag) && !after.has(group.tag)) {
        group.contactIds.push(row.id);
        changed = true;
      }
    }
    if (request.add.some((t) => !after.has(t))) full.push(row.id);
    if (changed) updated++;
  }
  return {
    added: added.filter((g) => g.contactIds.length > 0),
    removed: removed.filter((g) => g.contactIds.length > 0),
    full,
    updated,
  };
}

export function taggingLabel(request: Pick<TagRequest, "add" | "remove">): string {
  const parts = [
    ...request.add.map((t) => `+${t}`),
    ...request.remove.map((t) => `−${t}`),
  ];
  return parts.join(" ").slice(0, 4 * MAX_TAG_LENGTH);
}
