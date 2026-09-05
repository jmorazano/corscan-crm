import { exchangeCodeForToken, MetaApiError } from "@/lib/meta/client";
import {
  listWabaPhoneNumbers,
  subscribeAppToWaba,
  testConnection,
} from "@/server/whatsapp/connect";
import {
  PhoneNumberInUseError,
  saveCredentials,
} from "@/server/whatsapp/credentials";

export type EmbeddedSignupResult =
  | {
      ok: true;
      wabaId: string;
      phoneNumberId: string;
      displayPhoneNumber: string;
      verifiedName: string | null;
    }
  | {
      ok: false;
      code:
        | "exchange_failed"
        | "invalid_assets"
        | "meta_unavailable"
        | "phone_in_use";
      message: string;
    };

/**
 * Completa el Embedded Signup: intercambia el `code` por un token, verifica
 * que ese token realmente da acceso al número que el popup reportó, y recién
 * entonces persiste.
 *
 * El popup corre en el browser, así que waba_id y phone_number_id llegan del
 * cliente y NO son de fiar por sí solos. La validación contra Meta con el
 * token recién obtenido es lo que los convierte en confiables: si el token no
 * puede leer ese número, se rechaza y no se guarda nada.
 *
 * Con coexistence (el negocio sigue usando la app del celular) el popup emite
 * FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING, que trae SOLO waba_id: no hay
 * phone_number_id que validar. En ese caso se omite y el número se descubre
 * acá. Lo que NO se hace —ni acá ni en ningún lado— es registrar el número:
 * ese paso es exactamente el que deja al celular fuera de servicio.
 */
export async function completeEmbeddedSignup(input: {
  organizationId: string;
  code: string;
  wabaId: string;
  phoneNumberId?: string;
}): Promise<EmbeddedSignupResult> {
  let token: string;
  try {
    token = await exchangeCodeForToken(input.code);
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.status === 0 || err.status >= 500) {
        return {
          ok: false,
          code: "meta_unavailable",
          message:
            "Meta no está disponible en este momento; vuelve a intentar la conexión",
        };
      }
      return {
        ok: false,
        code: "exchange_failed",
        message: `No se pudo completar la conexión con Meta: ${err.message}`,
      };
    }
    throw err;
  }

  const resolved = input.phoneNumberId
    ? await verifyReportedNumber(input.phoneNumberId, token)
    : await discoverSingleNumber(input.wabaId, token);
  if (!resolved.ok) return resolved;

  try {
    await saveCredentials({
      organizationId: input.organizationId,
      wabaId: input.wabaId,
      phoneNumberId: resolved.phoneNumberId,
      token,
      displayPhoneNumber: resolved.displayPhoneNumber,
      verifiedName: resolved.verifiedName,
    });
  } catch (err) {
    // El code ya se gastó contra Meta, pero el número pertenece a otra org:
    // degradar con un 409 entendible en vez del 500 genérico (US2).
    if (err instanceof PhoneNumberInUseError) {
      return { ok: false, code: "phone_in_use", message: err.message };
    }
    throw err;
  }

  // Best-effort: sin esto no llegan webhooks, pero la conexión ya es válida y
  // la suscripción se puede reintentar desde el panel de Meta.
  await subscribeAppToWaba(input.wabaId, token);

  return {
    ok: true,
    wabaId: input.wabaId,
    phoneNumberId: resolved.phoneNumberId,
    displayPhoneNumber: resolved.displayPhoneNumber,
    verifiedName: resolved.verifiedName,
  };
}

type ResolvedNumber =
  | {
      ok: true;
      phoneNumberId: string;
      displayPhoneNumber: string;
      verifiedName: string | null;
    }
  | Extract<EmbeddedSignupResult, { ok: false }>;

/** Flujo estándar: el popup dijo qué número es; el token debe poder leerlo. */
async function verifyReportedNumber(
  phoneNumberId: string,
  token: string
): Promise<ResolvedNumber> {
  const check = await testConnection(phoneNumberId, token);
  if (!check.ok) {
    if (check.code === "meta_unavailable") {
      return { ok: false, code: "meta_unavailable", message: check.message };
    }
    return {
      ok: false,
      code: "invalid_assets",
      message:
        "El token obtenido no da acceso al número seleccionado. Vuelve a ejecutar la conexión y elige el número correcto.",
    };
  }
  return {
    ok: true,
    phoneNumberId,
    displayPhoneNumber: check.displayPhoneNumber,
    verifiedName: check.verifiedName,
  };
}

/**
 * Coexistence: el número se descubre desde la WABA. Se exige que haya
 * exactamente uno — con más de uno no hay forma de saber cuál eligió el
 * negocio en el popup, y adivinar significaría conectar el número equivocado.
 */
async function discoverSingleNumber(
  wabaId: string,
  token: string
): Promise<ResolvedNumber> {
  const found = await listWabaPhoneNumbers(wabaId, token);
  if (!found.ok) {
    if (found.code === "meta_unavailable") {
      return { ok: false, code: "meta_unavailable", message: found.message };
    }
    return { ok: false, code: "invalid_assets", message: found.message };
  }

  const [only] = found.numbers;
  if (!only) {
    return {
      ok: false,
      code: "invalid_assets",
      message:
        "La cuenta de WhatsApp autorizada no tiene ningún número. Completá el alta del número en el popup de Meta y volvé a intentar.",
    };
  }
  if (found.numbers.length > 1) {
    return {
      ok: false,
      code: "invalid_assets",
      message:
        "La cuenta autorizada tiene más de un número y Meta no informó cuál elegiste. Conectalo desde la opción manual indicando el Phone Number ID.",
    };
  }

  return {
    ok: true,
    phoneNumberId: only.id,
    displayPhoneNumber: only.displayPhoneNumber,
    verifiedName: only.verifiedName,
  };
}
