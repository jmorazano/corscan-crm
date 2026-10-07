import { MCP_MOCK_PROPERTIES, MCP_MOCK_SITE_BASE, type McpMockProperty } from "./data";
import type { McpMockResult } from "./engine";

/**
 * Reservas del mcp-mock (032), calcadas del servidor real 2.0.0 de Altos
 * (relevado el 7-oct-2026): `start-booking` → `set-guest-details` (las veces
 * que haga falta) → `show-booking-draft` → `confirm-booking`, con los mismos
 * códigos de error estables y los mismos campos de respuesta
 * (`summary.lines`, `terms.url`, `guest.missing_labels`, `can_confirm`,
 * `payment_url`, `expires_at`).
 *
 * Los borradores viven en memoria (`globalThis`, como el resto del mock). La
 * bitácora de reservas CONFIRMADAS es lo que el guion E2E usa para probar que
 * una confirmación repetida NO registra dos reservas.
 */

type Draft = {
  id: string;
  property: McpMockProperty;
  checkIn: string;
  checkOut: string;
  guests: number;
  detail: string | null;
  guest: Partial<Record<GuestField, string>>;
  termsAccepted: boolean;
  confirmedBookingId: string | null;
};

type GuestField = "fullname" | "email" | "pid" | "phone" | "city" | "state";

const REQUIRED: { field: GuestField; label: string }[] = [
  { field: "fullname", label: "nombre y apellido" },
  { field: "email", label: "correo electrónico" },
  { field: "pid", label: "documento (DNI)" },
  { field: "phone", label: "celular" },
  { field: "city", label: "ciudad donde vive" },
  { field: "state", label: "provincia" },
];

type BookingState = {
  drafts: Map<string, Draft>;
  confirmed: { bookingId: string; draftId: string; property: string; at: string }[];
  seq: number;
};

const g = globalThis as unknown as { __voceroMcpBooking?: BookingState };

function state(): BookingState {
  if (!g.__voceroMcpBooking) {
    g.__voceroMcpBooking = { drafts: new Map(), confirmed: [], seq: 0 };
  }
  return g.__voceroMcpBooking;
}

export function resetBookingState(): void {
  g.__voceroMcpBooking = { drafts: new Map(), confirmed: [], seq: 0 };
}

export function confirmedBookings(): BookingState["confirmed"] {
  return state().confirmed;
}

export const TERMS_URL = `${MCP_MOCK_SITE_BASE}/terminos-y-condiciones`;

function pesos(n: number): string {
  return `$ ${n.toLocaleString("es-AR")}`;
}

function nights(checkIn: string, checkOut: string): number {
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

function pricing(d: Draft): { total: number; deposit: number } {
  const total = d.property.pricePerNight * nights(d.checkIn, d.checkOut) + d.property.services;
  return { total, deposit: Math.round(total * d.property.depositRate) };
}

function summary(d: Draft) {
  const { total, deposit } = pricing(d);
  return {
    title: d.property.name,
    check_in: d.checkIn,
    check_out: d.checkOut,
    nights: nights(d.checkIn, d.checkOut),
    guests: d.guests,
    total,
    deposit,
    currency: "ARS",
    lines: [
      `Alojamiento: ${d.property.name}`,
      `Llegada: ${d.checkIn}`,
      `Partida: ${d.checkOut}`,
      `Huéspedes: ${d.guests}`,
      `Total de la reserva: ${pesos(total)}`,
      `Seña requerida: ${pesos(deposit)}`,
    ],
  };
}

function view(d: Draft): Record<string, unknown> {
  const missing = REQUIRED.filter((r) => !d.guest[r.field]);
  const canConfirm = missing.length === 0 && d.termsAccepted;
  return {
    draft_id: d.id,
    status: "draft",
    summary: summary(d),
    terms: { url: TERMS_URL, accepted: d.termsAccepted },
    guest: {
      provided: { ...d.guest },
      missing: missing.map((m) => m.field),
      missing_labels: missing.map((m) => m.label),
    },
    can_confirm: canConfirm,
    next_step: canConfirm
      ? "Mostrale el resumen y pedile su conformidad antes de confirm-booking."
      : missing.length > 0
        ? `Pedile: ${missing.map((m) => m.label).join(", ")}.`
        : "Pasale el enlace de los términos y preguntale si los acepta.",
  };
}

function err(code: string, message: string, extra: Record<string, unknown> = {}): McpMockResult {
  return { ok: false, error: { code, message, ...extra } };
}

function findProperty(ref: string): McpMockProperty | undefined {
  const r = ref.trim().toLowerCase();
  return MCP_MOCK_PROPERTIES.find(
    (p) =>
      p.code.toLowerCase() === r ||
      p.slug === r ||
      r.includes(`/${p.slug}`) ||
      r.endsWith(p.slug)
  );
}

function getDraft(args: Record<string, unknown>): Draft | McpMockResult {
  const id = typeof args.draft_id === "string" ? args.draft_id : "";
  const d = state().drafts.get(id);
  if (!d) {
    return err(
      "draft_not_found",
      "La reserva en preparación no existe o expiró. Volvé a empezar con start-booking."
    );
  }
  return d;
}

function isDraft(v: Draft | McpMockResult): v is Draft {
  return (v as Draft).property !== undefined;
}

export function startBooking(args: Record<string, unknown>): McpMockResult {
  const ref = typeof args.property === "string" ? args.property : "";
  const property = findProperty(ref);
  if (!property) return err("property_not_found", "No encontré ese alojamiento.");
  const checkIn = typeof args.check_in === "string" ? args.check_in : "";
  const checkOut = typeof args.check_out === "string" ? args.check_out : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) {
    return err("invalid_date", "Las fechas van en formato AAAA-MM-DD.");
  }
  if (nights(checkIn, checkOut) <= 0) {
    return err("invalid_date_range", "La salida tiene que ser posterior al ingreso.");
  }
  const guests = typeof args.guests === "number" ? args.guests : Number(args.guests);
  if (!Number.isInteger(guests) || guests < 1 || guests > property.capacity) {
    return err("invalid_guests", "La cantidad de huéspedes no es válida para ese alojamiento.", {
      max: property.capacity,
    });
  }
  if (property.minStay !== null && nights(checkIn, checkOut) < property.minStay) {
    return err("min_stay_not_met", "La estadía no alcanza la mínima vigente.", {
      min_nights: property.minStay,
    });
  }
  const s = state();
  s.seq += 1;
  const draft: Draft = {
    id: `drf_${String(s.seq).padStart(4, "0")}`,
    property,
    checkIn,
    checkOut,
    guests,
    detail: typeof args.detail === "string" ? args.detail : null,
    guest: {},
    termsAccepted: false,
    confirmedBookingId: null,
  };
  s.drafts.set(draft.id, draft);
  return { ok: true, data: view(draft) };
}

const VALIDATORS: Record<GuestField, (v: string) => boolean> = {
  fullname: (v) => v.trim().split(/\s+/).length >= 2,
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  pid: (v) => /^\d{6,9}$/.test(v),
  phone: (v) => /^\d{8,15}$/.test(v),
  city: (v) => v.trim().length >= 2,
  state: (v) => v.trim().length >= 2,
};

export function setGuestDetails(args: Record<string, unknown>): McpMockResult {
  const d = getDraft(args);
  if (!isDraft(d)) return d;
  const accepted = [...REQUIRED.map((r) => r.field), "detail", "terms_accepted", "draft_id"];
  for (const key of Object.keys(args)) {
    if (!accepted.includes(key)) {
      return err("unknown_guest_field", `La reserva no pide «${key}».`, { accepted });
    }
  }
  for (const { field, label } of REQUIRED) {
    const v = args[field];
    if (v === undefined || v === null) continue;
    const value = String(v);
    if (!VALIDATORS[field](value)) {
      return err("invalid_guest_field", `El dato «${label}» no tiene un formato válido.`, {
        field,
        label,
      });
    }
    d.guest[field] = value;
  }
  if (typeof args.detail === "string") d.detail = args.detail;
  if (args.terms_accepted === true) d.termsAccepted = true;
  return { ok: true, data: view(d) };
}

export function showBookingDraft(args: Record<string, unknown>): McpMockResult {
  const d = getDraft(args);
  if (!isDraft(d)) return d;
  return { ok: true, data: view(d) };
}

export function confirmBooking(
  args: Record<string, unknown>,
  opts: { unavailable: boolean }
): McpMockResult {
  const d = getDraft(args);
  if (!isDraft(d)) return d;
  const missing = REQUIRED.filter((r) => !d.guest[r.field]);
  if (missing.length > 0) {
    return err("missing_guest_data", "Faltan datos obligatorios. No se creó la reserva.", {
      missing_labels: missing.map((m) => m.label),
    });
  }
  if (!d.termsAccepted) {
    return err("terms_not_accepted", "El interesado no aceptó los términos. No se creó la reserva.", {
      terms_url: TERMS_URL,
    });
  }
  if (args.confirmed !== true) {
    return err("not_confirmed", "Falta la conformidad del interesado. No se creó la reserva.");
  }
  if (opts.unavailable) {
    return err(
      "no_longer_available",
      "El alojamiento dejó de estar disponible para esas fechas. No se creó la reserva."
    );
  }
  const s = state();
  // Fiel al real: una SEGUNDA llamada registraría una segunda reserva. El
  // mock no lo impide a propósito: lo tiene que impedir el CRM.
  const bookingId = `RES-${String(s.confirmed.length + 1).padStart(4, "0")}`;
  d.confirmedBookingId = bookingId;
  s.confirmed.push({
    bookingId,
    draftId: d.id,
    property: d.property.code,
    at: new Date().toISOString(),
  });
  const expires = new Date(Date.now() + 48 * 3_600_000).toISOString();
  return {
    ok: true,
    data: {
      booking_id: bookingId,
      status: "pending_deposit",
      summary: summary(d),
      payment_url: `${MCP_MOCK_SITE_BASE}/reserva/pago/${bookingId.toLowerCase()}`,
      expires_at: expires,
      message: "Reserva registrada, pendiente de seña.",
    },
  };
}
