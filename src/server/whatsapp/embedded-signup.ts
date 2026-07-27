import { exchangeCodeForToken, MetaApiError } from "@/lib/meta/client";
import { subscribeAppToWaba, testConnection } from "@/server/whatsapp/connect";
import { saveCredentials } from "@/server/whatsapp/credentials";

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
      code: "exchange_failed" | "invalid_assets" | "meta_unavailable";
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
 */
export async function completeEmbeddedSignup(input: {
  organizationId: string;
  code: string;
  wabaId: string;
  phoneNumberId: string;
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

  const check = await testConnection(input.phoneNumberId, token);
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

  await saveCredentials({
    organizationId: input.organizationId,
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    token,
    displayPhoneNumber: check.displayPhoneNumber,
    verifiedName: check.verifiedName,
  });

  // Best-effort: sin esto no llegan webhooks, pero la conexión ya es válida y
  // la suscripción se puede reintentar desde el panel de Meta.
  await subscribeAppToWaba(input.wabaId, token);

  return {
    ok: true,
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    displayPhoneNumber: check.displayPhoneNumber,
    verifiedName: check.verifiedName,
  };
}
