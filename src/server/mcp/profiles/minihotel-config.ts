import { z } from "zod";
import { checkBookingEngineUrl } from "@/lib/minihotel/booking-link";
import type { ProviderConfig } from "@/server/mcp/profiles/types";

/**
 * Configuración NO secreta de MiniHotel (028), guardada en
 * `mcp_integration.provider_config`. PURA.
 *
 * Dos dueños distintos, igual que la URL y la credencial en 016:
 * - el SUPER ADMIN fija lo que define a dónde se consulta y a dónde se manda
 *   al huésped: código de hotel, código de tarifa y enlace del motor de
 *   reservas (Constitución II, cat. 5, letra b);
 * - la EMPRESA decide su regla comercial: si el asistente informa precios
 *   por WhatsApp y si menciona la tarifa no reembolsable.
 */

export type MiniHotelProviderConfig = {
  hotelId: string;
  /** Código de tarifa de MiniHotel: define la moneda. Una por empresa (Fase 1). */
  rateCode: string;
  /** Base del motor de reservas, ya validada y normalizada. */
  bookingEngineUrl: string | null;
  showPrices: boolean;
  showNonRefundable: boolean;
};

const CODE_RE = /^[A-Za-z0-9_.-]{1,64}$/;

/** Lo que carga el super admin. */
export const miniHotelAdminConfigSchema = z.object({
  hotelId: z.string().trim().regex(CODE_RE, "Código de hotel inválido."),
  rateCode: z.string().trim().regex(CODE_RE, "Código de tarifa inválido."),
  bookingEngineUrl: z.string().trim().max(512).nullable().optional(),
});

export type MiniHotelAdminConfigInput = z.infer<typeof miniHotelAdminConfigSchema>;

/** Lo que decide la empresa. */
export const miniHotelOwnerSettingsSchema = z.object({
  showPrices: z.boolean().optional(),
  showNonRefundable: z.boolean().optional(),
});

export type MiniHotelOwnerSettings = z.infer<typeof miniHotelOwnerSettingsSchema>;

function asRecord(raw: ProviderConfig | undefined): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

/**
 * Arma la config del super admin conservando lo que ya decidió la empresa.
 * El enlace del motor que no sea de MiniHotel se rechaza ACÁ, antes de
 * guardarse: es un enlace que va a recibir un cliente real.
 */
export function buildMiniHotelAdminConfig(
  input: MiniHotelAdminConfigInput,
  previous: ProviderConfig | undefined
):
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; reason: "invalid_booking_url" } {
  let booking: string | null = null;
  const raw = input.bookingEngineUrl?.trim() ?? "";
  if (raw !== "") {
    const check = checkBookingEngineUrl(raw);
    if (!check.ok) return { ok: false, reason: "invalid_booking_url" };
    booking = check.base;
  }
  // Lo que decidió la empresa se conserva aunque la config anterior estuviera
  // incompleta: no es del super admin y no se le pisa al reconfigurar.
  const prev = asRecord(previous);
  return {
    ok: true,
    config: {
      hotelId: input.hotelId,
      rateCode: input.rateCode,
      bookingEngineUrl: booking,
      showPrices: prev.showPrices !== false,
      showNonRefundable: prev.showNonRefundable === true,
    },
  };
}

/** Aplica la decisión comercial de la empresa sobre la config existente. */
export function withMiniHotelOwnerSettings(
  raw: ProviderConfig | undefined,
  patch: MiniHotelOwnerSettings
): Record<string, unknown> {
  const current = asRecord(raw);
  const next: Record<string, unknown> = { ...current };
  if (patch.showPrices !== undefined) next.showPrices = patch.showPrices;
  if (patch.showNonRefundable !== undefined) next.showNonRefundable = patch.showNonRefundable;
  return next;
}

/**
 * Lee la config de la fila. `null` si falta lo indispensable (hotel o
 * tarifa): sin eso no se puede consultar y la integración no se ofrece como
 * conectada. Un enlace del motor inválido se descarta (sin enlace es mejor
 * que con uno roto), no invalida todo lo demás.
 */
export function readMiniHotelConfig(raw: ProviderConfig | undefined): MiniHotelProviderConfig | null {
  const o = asRecord(raw);
  const hotelId = typeof o.hotelId === "string" ? o.hotelId.trim() : "";
  const rateCode = typeof o.rateCode === "string" ? o.rateCode.trim() : "";
  if (!CODE_RE.test(hotelId) || !CODE_RE.test(rateCode)) return null;
  let bookingEngineUrl: string | null = null;
  if (typeof o.bookingEngineUrl === "string" && o.bookingEngineUrl.trim() !== "") {
    const check = checkBookingEngineUrl(o.bookingEngineUrl);
    bookingEngineUrl = check.ok ? check.base : null;
  }
  return {
    hotelId,
    rateCode,
    bookingEngineUrl,
    showPrices: o.showPrices !== false,
    showNonRefundable: o.showNonRefundable === true,
  };
}
