import { z } from "zod";
import { checkBookingEngineUrl } from "@/lib/minihotel/booking-link";
import type { ProviderConfig } from "@/server/mcp/profiles/types";

/**
 * Configuración NO secreta de MiniHotel (028), guardada en
 * `mcp_integration.provider_config`. PURA.
 *
 * Dos dueños distintos, igual que la URL y la credencial en 016:
 * - el SUPER ADMIN fija lo que es una DIRECCIÓN: la de la API (en
 *   `endpoint_url`) y el enlace del motor de reservas al que se manda al
 *   huésped (Constitución II, cat. 5, letra b). Al habilitar carga también el
 *   código de hotel y la tarifa iniciales;
 * - la EMPRESA decide su regla comercial (si el asistente informa precios
 *   y si menciona la tarifa no reembolsable) y, desde el 1-oct-2026, el
 *   código de hotel y la tarifa: no son direcciones, y MiniHotel solo
 *   contesta por los hoteles que habilitó para la credencial cargada.
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

/**
 * Lo que decide la empresa: su regla comercial. La TARIFA también es suya
 * (con qué tarifa —y por lo tanto en qué moneda— cotiza el asistente); no es
 * una dirección ni un enlace, así que no toca la letra (b) de la categoría 5.
 */
export const miniHotelOwnerSettingsSchema = z.object({
  showPrices: z.boolean().optional(),
  showNonRefundable: z.boolean().optional(),
  rateCode: z.string().trim().regex(CODE_RE, "Código de tarifa inválido.").optional(),
  /** Pedido del dueño (1-oct-2026): el hotel también se configura desde la empresa. */
  hotelId: z.string().trim().regex(CODE_RE, "Código de hotel inválido.").optional(),
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
      // Solo se muestra si sigue siendo del mismo hotel y tarifa.
      ...(prev[VERIFIED_QUOTE_KEY] !== undefined
        ? { [VERIFIED_QUOTE_KEY]: prev[VERIFIED_QUOTE_KEY] }
        : {}),
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
  if (patch.rateCode !== undefined) next.rateCode = patch.rateCode;
  if (patch.hotelId !== undefined) next.hotelId = patch.hotelId;
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

/* ============================================================
 * Moneda verificada
 * ============================================================ */

/**
 * Dónde guarda «Verificar» lo que contestó MiniHotel con la consulta de
 * prueba: la moneda de la tarifa. La moneda la define la tarifa dentro de
 * MiniHotel (no hay forma de pedirla aparte), así que es la única manera de
 * que la empresa vea, antes del primer huésped, si cotiza en pesos.
 */
export const VERIFIED_QUOTE_KEY = "verifiedQuote";

export type MiniHotelVerifiedQuote = {
  hotelId: string;
  rateCode: string;
  currency: string | null;
};

/** ISO 4217 de tres letras o `null`: el atributo es texto del proveedor. */
export function cleanCurrency(raw: unknown): string | null {
  const c = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(c) ? c : null;
}

/**
 * La moneda verificada, SOLO si se verificó con el hotel y la tarifa de hoy:
 * otro hotel u otra tarifa pueden cotizar en otra moneda.
 */
export function verifiedCurrencyOf(
  raw: ProviderConfig | undefined,
  config: Pick<MiniHotelProviderConfig, "hotelId" | "rateCode">
): string | null {
  const quote = asRecord(asRecord(raw)[VERIFIED_QUOTE_KEY] as ProviderConfig | undefined);
  if (quote.hotelId !== config.hotelId || quote.rateCode !== config.rateCode) return null;
  return cleanCurrency(quote.currency);
}
