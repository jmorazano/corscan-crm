import { z } from "zod";

/**
 * Entradas de la UI/API de los calendarios (051). Puro y compartido: los
 * topes viven acá para que el formulario y el servidor digan lo mismo.
 */

export const MAX_UNITS = 50;
export const UNIT_NAME_MAX = 60;
export const UNIT_DESCRIPTION_MAX = 300;
export const UNIT_CAPACITY_MAX = 30;

const trimmed = (max: number) => z.string().trim().max(max);

export const unitCreateSchema = z.object({
  name: trimmed(UNIT_NAME_MAX).min(1, "Poné un nombre"),
  capacity: z.coerce.number().int().min(1).max(UNIT_CAPACITY_MAX),
  description: trimmed(UNIT_DESCRIPTION_MAX).optional().nullable(),
  bookingUrl: trimmed(500).optional().nullable(),
  icalUrl: z.string().trim().min(1, "Pegá el enlace del calendario").max(600),
});
export type UnitCreateInput = z.infer<typeof unitCreateSchema>;

/** Edición: el enlace es opcional — vacío = se conserva el guardado. */
export const unitUpdateSchema = unitCreateSchema.extend({
  icalUrl: z.string().trim().max(600).optional().nullable(),
});
export type UnitUpdateInput = z.infer<typeof unitUpdateSchema>;

export const icalSettingsSchema = z.object({
  agentEnabled: z.boolean().optional(),
  bookingUrl: trimmed(500).optional().nullable(),
});
export type IcalSettingsInput = z.infer<typeof icalSettingsSchema>;

export const unitOrderSchema = z.object({ ids: z.array(z.string().min(1)).max(MAX_UNITS) });

/** Códigos de lectura del feed (nunca texto del proveedor). */
export type IcalSyncError = "link_revoked" | "blocked" | "unreachable" | "invalid" | "blocked_host";

export function syncErrorText(code: string | null): string | null {
  switch (code) {
    case null:
      return null;
    case "link_revoked":
      return "Airbnb dice que este enlace ya no existe: si lo regeneraste, copiá el nuevo del Paso 1.";
    case "blocked":
      return "Airbnb rechazó la lectura. Volvemos a intentar solos en unos minutos.";
    case "unreachable":
      return "Airbnb no respondió a tiempo. Volvemos a intentar solos en unos minutos.";
    case "invalid":
      return "Lo que devolvió el enlace no es un calendario válido.";
    case "blocked_host":
      return "El enlace apunta a un destino no permitido.";
    default:
      return "No se pudo leer el calendario.";
  }
}
