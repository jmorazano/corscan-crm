import { z } from "zod";

/**
 * 054: tarjeta de contacto de WhatsApp (`type: "contacts"`), PURO.
 *
 * Una sola forma para las que manda el cliente, las que el negocio manda
 * desde el celular (coexistence) y las que el equipo manda desde el CRM:
 * `message.details.contacts`. Del payload de Meta se guarda lo mínimo que
 * sirve para llamar o escribirle a la persona — nombre, teléfonos, correo y
 * empresa —; direcciones, cumpleaños y URLs se descartan.
 *
 * El nombre y la empresa los escribió un tercero: son DATO. Se guardan en una
 * línea, sin caracteres de control ni comillas angulares (no pueden cerrar
 * la cita «…» del prompt del agente) y con tope.
 */

export type SharedContactPhone = {
  /** Como lo ve una persona: `+5493516882234` o lo que vino en la tarjeta. */
  phone: string;
  /** Identificador de WhatsApp (dígitos). Con él la tarjeta ofrece «Enviar mensaje». */
  waId?: string | null;
};

export type SharedContact = {
  name: string;
  phones: SharedContactPhone[];
  emails?: string[];
  org?: string | null;
};

export const CONTACT_CARD_MAX = 10;
export const CONTACT_NAME_MAX = 120;
export const CONTACT_PHONES_MAX = 5;
export const CONTACT_EMAILS_MAX = 3;
const PHONE_MAX = 40;
const EMAIL_MAX = 160;
const ORG_MAX = 120;
export const UNNAMED_CONTACT = "Contacto";

/** Texto ajeno → una línea limpia y recortada (`""` si no queda nada). */
function cleanLine(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/g, " ")
    .replace(/[«»]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

/** Un teléfono tal como se muestra: solo `+`, dígitos y separadores comunes. */
export function cleanCardPhone(raw: unknown): string {
  if (typeof raw !== "string" && typeof raw !== "number") return "";
  const value = String(raw)
    .replace(/[^\d+()\-.\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PHONE_MAX)
    .trim();
  // Sin dígitos suficientes no es un teléfono (un «+» suelto, «--»).
  return value.replace(/\D/g, "").length >= 5 ? value : "";
}

function cleanWaId(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const digits = String(raw).trim();
  return /^\d{7,15}$/.test(digits) ? digits : null;
}

function cleanEmail(raw: unknown): string {
  const value = cleanLine(raw, EMAIL_MAX);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : "";
}

/** Forma tolerante de lo que manda Meta: cada campo puede faltar o venir mal. */
const rawContact = z
  .object({
    name: z
      .object({
        formatted_name: z.unknown().optional(),
        first_name: z.unknown().optional(),
        last_name: z.unknown().optional(),
      })
      .partial()
      .optional()
      .catch(undefined),
    phones: z
      .array(z.object({ phone: z.unknown().optional(), wa_id: z.unknown().optional() }).partial())
      .optional()
      .catch(undefined),
    emails: z
      .array(z.object({ email: z.unknown().optional() }).partial())
      .optional()
      .catch(undefined),
    org: z.object({ company: z.unknown().optional() }).partial().optional().catch(undefined),
  })
  .partial();

/**
 * Lee `message.contacts` del webhook de WhatsApp. Nunca lanza: lo ilegible
 * se descarta y una tarjeta sin nombre ni teléfono no se guarda.
 */
export function parseWhatsAppContacts(raw: unknown): SharedContact[] {
  if (!Array.isArray(raw)) return [];
  const out: SharedContact[] = [];
  for (const item of raw) {
    if (out.length >= CONTACT_CARD_MAX) break;
    const parsed = rawContact.safeParse(item);
    if (!parsed.success) continue;
    const c = parsed.data;
    const phones: SharedContactPhone[] = [];
    for (const p of c.phones ?? []) {
      if (phones.length >= CONTACT_PHONES_MAX) break;
      const waId = cleanWaId(p.wa_id);
      const phone = cleanCardPhone(p.phone) || (waId ? `+${waId}` : "");
      if (!phone) continue;
      if (phones.some((x) => digitsOf(x.phone) === digitsOf(phone))) continue;
      phones.push(waId ? { phone, waId } : { phone });
    }
    const emails: string[] = [];
    for (const e of c.emails ?? []) {
      if (emails.length >= CONTACT_EMAILS_MAX) break;
      const email = cleanEmail(e.email);
      if (email && !emails.includes(email)) emails.push(email);
    }
    const fullName = [cleanLine(c.name?.first_name, CONTACT_NAME_MAX), cleanLine(c.name?.last_name, CONTACT_NAME_MAX)]
      .filter(Boolean)
      .join(" ");
    const name =
      cleanLine(c.name?.formatted_name, CONTACT_NAME_MAX) ||
      fullName.slice(0, CONTACT_NAME_MAX).trim() ||
      phones[0]?.phone ||
      "";
    if (!name && phones.length === 0 && emails.length === 0) continue;
    const org = cleanLine(c.org?.company, ORG_MAX);
    out.push({
      name: name || UNNAMED_CONTACT,
      phones,
      ...(emails.length > 0 ? { emails } : {}),
      ...(org ? { org } : {}),
    });
  }
  return out;
}

function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Sanea tarjetas que ya tienen nuestra forma (las de `details.contacts` de
 * otro mensaje, al reenviar; las que arma el servidor). Devuelve solo las
 * que se pueden enviar: con nombre y al menos un teléfono.
 */
export function sendableContacts(cards: readonly SharedContact[] | null | undefined): SharedContact[] {
  const out: SharedContact[] = [];
  for (const card of cards ?? []) {
    if (out.length >= CONTACT_CARD_MAX) break;
    const phones: SharedContactPhone[] = [];
    for (const p of card?.phones ?? []) {
      if (phones.length >= CONTACT_PHONES_MAX) break;
      const phone = cleanCardPhone(p?.phone);
      if (!phone) continue;
      const waId = cleanWaId(p?.waId);
      phones.push(waId ? { phone, waId } : { phone });
    }
    if (phones.length === 0) continue;
    const name = cleanLine(card?.name, CONTACT_NAME_MAX) || phones[0]!.phone;
    const emails = (card?.emails ?? []).map(cleanEmail).filter(Boolean).slice(0, CONTACT_EMAILS_MAX);
    const org = cleanLine(card?.org, ORG_MAX);
    out.push({
      name,
      phones,
      ...(emails.length > 0 ? { emails } : {}),
      ...(org ? { org } : {}),
    });
  }
  return out;
}

/** Lo que escribe el equipo en «Otro contacto». */
export const manualContactInput = z.object({
  name: z.string().trim().min(1, "Falta el nombre").max(CONTACT_NAME_MAX),
  phone: z.string().trim().min(5, "Falta el teléfono").max(PHONE_MAX),
});
export type ManualContactInput = z.infer<typeof manualContactInput>;

/** Cuerpo de `POST …/messages/contacts`. */
export const sendContactsInput = z
  .object({
    contactIds: z.array(z.string().min(1).max(64)).max(CONTACT_CARD_MAX).default([]),
    manual: z.array(manualContactInput).max(CONTACT_CARD_MAX).default([]),
  })
  .refine((v) => v.contactIds.length + v.manual.length >= 1, {
    message: "Elegí al menos un contacto",
  })
  .refine((v) => v.contactIds.length + v.manual.length <= CONTACT_CARD_MAX, {
    message: `Hasta ${CONTACT_CARD_MAX} contactos por mensaje`,
  });

/**
 * Arma una tarjeta desde un nombre y un teléfono. `waId` = el número ya
 * normalizado (dígitos con código de país), si se pudo: la tarjeta muestra
 * el número internacional y WhatsApp ofrece «Enviar mensaje». Sin él viaja
 * el teléfono como se escribió. `null` si no hay teléfono utilizable.
 */
export function buildContactCard(input: {
  name: string;
  phone: string;
  waId?: string | null;
}): SharedContact | null {
  const waId = cleanWaId(input.waId);
  const phone = waId ? `+${waId}` : cleanCardPhone(input.phone);
  if (!phone) return null;
  const name = cleanLine(input.name, CONTACT_NAME_MAX) || phone;
  return { name, phones: [waId ? { phone, waId } : { phone }] };
}

/** `contacts` de la Cloud API para enviar las tarjetas. */
export function toWhatsAppContactsPayload(cards: readonly SharedContact[]): Record<string, unknown>[] {
  return cards.map((card) => ({
    // Meta exige `formatted_name` y al menos otro campo del nombre.
    name: { formatted_name: card.name, first_name: card.name },
    phones: card.phones.map((p) => ({
      phone: p.phone,
      type: "CELL",
      ...(p.waId ? { wa_id: p.waId } : {}),
    })),
    ...(card.emails?.length
      ? { emails: card.emails.map((email) => ({ email, type: "WORK" })) }
      : {}),
    ...(card.org ? { org: { company: card.org } } : {}),
  }));
}

/** «Nombre (+54…, +54…)» — una tarjeta en una línea. */
export function contactLine(card: SharedContact): string {
  const reach = [...card.phones.map((p) => p.phone), ...(card.emails ?? [])];
  return reach.length > 0 ? `${card.name} (${reach.join(", ")})` : card.name;
}

/** Varias tarjetas en una línea, para el historial del agente y los avisos. */
export function contactsLine(cards: readonly SharedContact[]): string {
  return cards.map(contactLine).join("; ");
}

/**
 * Instagram no tiene tarjetas de contacto: sale como texto. Una línea por
 * contacto, «Contacto: Nombre — +54…».
 */
export function contactCardText(cards: readonly SharedContact[]): string {
  return cards
    .map((card) => {
      const reach = [...card.phones.map((p) => p.phone), ...(card.emails ?? [])].join(" · ");
      const label = card.name === card.phones[0]?.phone ? "" : card.name;
      return ["Contacto:", [label, reach].filter(Boolean).join(" — ")].join(" ");
    })
    .join("\n");
}

/** «Juan Pérez» o «Juan Pérez y 2 contactos más» (título de la tarjeta, avisos). */
export function contactsTitle(cards: readonly SharedContact[]): string {
  const first = cards[0];
  if (!first) return UNNAMED_CONTACT;
  if (cards.length === 1) return first.name;
  const rest = cards.length - 1;
  return `${first.name} y ${rest} ${rest === 1 ? "contacto más" : "contactos más"}`;
}

/** Solo dígitos, para copiar o comparar un teléfono de la tarjeta. */
export function cardPhoneDigits(phone: SharedContactPhone): string {
  return phone.waId ?? digitsOf(phone.phone);
}
