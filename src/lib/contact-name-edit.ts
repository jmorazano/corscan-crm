/**
 * Quién le puso el nombre a mano a un contacto (PURO, compartido por la ficha
 * de la Bandeja y el diálogo de Contactos). Sin imports, sin I/O.
 *
 * `name_edited_at` sin autor = edición anterior al registro de quién (todas
 * las de antes de la migración 0040): se dice tal cual, sin adivinar.
 */

export type NameEdit = { at: string; by: string | null };

/** Lee la marca del DTO del contacto (lo que venga del API). */
export function nameEditFrom(contact: unknown): NameEdit | null {
  if (!contact || typeof contact !== "object") return null;
  const c = contact as { nameEditedAt?: unknown; nameEditedByName?: unknown };
  if (typeof c.nameEditedAt !== "string" || !c.nameEditedAt) return null;
  const by = typeof c.nameEditedByName === "string" ? c.nameEditedByName.trim() : "";
  return { at: c.nameEditedAt, by: by || null };
}

function defaultFormat(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function nameEditedLabel(edit: NameEdit, format: (iso: string) => string = defaultFormat): string {
  const when = format(edit.at);
  const suffix = when ? ` · ${when}` : "";
  return edit.by
    ? `Nombre puesto a mano por ${edit.by}${suffix}`
    : `Nombre puesto a mano${suffix} (sin registro de quién)`;
}
