import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * Normalización de teléfonos al formato wa_id (research 004 D3).
 *
 * El CRM guarda `contact.phone` SIEMPRE como wa_id: dígitos solos, con código
 * de país, y para Argentina con el `9` móvil (549 + área sin 0 + local sin
 * 15). Es el formato que llega en los webhooks — si un import guardara
 * "+54351…" la respuesta del cliente (wa_id "549351…") crearía un contacto
 * duplicado, porque la ingesta upserta por (org, phone).
 *
 * libphonenumber-js resuelve bien los formatos nacionales ("0351 15 688
 * 2234" → +5493516882234) pero deja "+54 351 688 2234" SIN el 9 (lo trata
 * como fijo): el post-proceso AR lo inserta. México legacy (wa_id 521…)
 * queda cubierto por la reconciliación con contacts[0].wa_id post-envío —
 * acá se guarda 52… y el primer send lo corrige si Meta responde 521….
 *
 * Distinto de `normalizeRecipient` (src/lib/meta/client.ts), que es un
 * ajuste de SALIDA sobre wa_id ya almacenados y no se toca.
 */

export type PhoneInvalidReason =
  | "vacio"
  | "caracteres_invalidos"
  | "no_parseable"
  | "longitud_invalida";

export type PhoneNormalization =
  | { ok: true; waId: string }
  | { ok: false; reason: PhoneInvalidReason };

/** Caracteres tolerados en un teléfono tipeado/importado. */
const ALLOWED_INPUT = /^[+\d\s().\- ]+$/;

const MIN_DIGITS = 7;
const MAX_DIGITS = 15;

export function normalizeToWaId(
  input: string,
  defaultCountry: "AR" | "MX" | "BR" | "US" | "ES" = "AR"
): PhoneNormalization {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, reason: "vacio" };
  }
  if (!ALLOWED_INPUT.test(trimmed)) {
    return { ok: false, reason: "caracteres_invalidos" };
  }

  // Un wa_id "crudo" (dígitos solos con código de país) se re-parsea con `+`
  // para validarlo igual que el resto — "5493516882234" y "+549351…" son el
  // mismo caso.
  const digitsOnly = trimmed.replace(/[^\d]/g, "");
  const looksLikeWaId = /^\d+$/.test(trimmed.replace(/[\s ]/g, ""));
  const candidate = looksLikeWaId && !trimmed.startsWith("0")
    ? `+${digitsOnly}`
    : trimmed;

  const parsed = parsePhoneNumberFromString(candidate, defaultCountry);
  if (!parsed || !(parsed.isValid() || parsed.isPossible())) {
    return {
      ok: false,
      reason: digitsOnly.length < MIN_DIGITS ? "longitud_invalida" : "no_parseable",
    };
  }

  // E.164 sin el "+".
  let waId = parsed.number.slice(1);

  // Post-proceso AR: destino de WhatsApp = móvil ⇒ el 9 va siempre.
  if (waId.startsWith("54") && !waId.startsWith("549")) {
    waId = `549${waId.slice(2)}`;
  }

  if (waId.length < MIN_DIGITS || waId.length > MAX_DIGITS) {
    return { ok: false, reason: "longitud_invalida" };
  }
  return { ok: true, waId };
}
