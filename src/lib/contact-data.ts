import { normalizeToWaId } from "@/lib/phone";

/**
 * Validación PURA del email y el teléfono que el agente aprende del chat
 * (030, US7). Misma filosofía que el nombre (021): el modelo propone, esto
 * decide, y lo que no parece un dato válido se descarta en silencio.
 */

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,24}$/i;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().replace(/^mailto:/i, "").toLowerCase();
  if (value.length < 6 || value.length > 254) return null;
  if (!EMAIL_RE.test(value)) return null;
  return value;
}

/** Teléfono → wa_id (regla AR del 9), o null si no es un teléfono. */
export function normalizeContactPhone(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const n = normalizeToWaId(raw);
  return n.ok ? n.waId : null;
}

/**
 * ¿Se puede guardar lo aprendido? Solo si el campo está vacío o lo había
 * puesto el propio agente antes: lo que cargó una persona del equipo no se
 * pisa (no hay marca por campo, así que se aplica «solo si está vacío»).
 */
export function canFillContactField(current: string | null | undefined): boolean {
  return !current?.trim();
}
