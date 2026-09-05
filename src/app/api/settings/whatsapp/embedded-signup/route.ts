import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { isEmbeddedSignupConfigured } from "@/lib/env";
import { completeEmbeddedSignup } from "@/server/whatsapp/embedded-signup";

export const dynamic = "force-dynamic";

// phoneNumberId es opcional a propósito: el onboarding con coexistence lo
// omite porque Meta no lo informa, y el servidor lo descubre desde la WABA.
const postSchema = z.object({
  code: z.string().trim().min(1),
  wabaId: z.string().trim().min(1),
  phoneNumberId: z.string().trim().min(1).optional(),
});

/**
 * Cierra el Embedded Signup del lado servidor. El browser nunca ve el token:
 * manda el `code` de un solo uso y aquí se intercambia, valida y cifra.
 */
export const POST = withAuth(async (session, req: Request) => {
  if (!isEmbeddedSignupConfigured()) {
    return apiError(
      503,
      "embedded_signup_unavailable",
      "Embedded Signup no está configurado en esta instancia (faltan META_APP_ID, META_ES_CONFIG_ID o META_APP_SECRET)."
    );
  }

  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;

  const result = await completeEmbeddedSignup({
    organizationId: session.organizationId,
    code: body.data.code,
    wabaId: body.data.wabaId,
    phoneNumberId: body.data.phoneNumberId,
  });

  if (!result.ok) {
    const status =
      result.code === "meta_unavailable"
        ? 503
        : result.code === "phone_in_use"
          ? 409
          : 422;
    return apiError(status, result.code, result.message);
  }

  return Response.json({
    connection: {
      wabaId: result.wabaId,
      phoneNumberId: result.phoneNumberId,
      displayPhoneNumber: result.displayPhoneNumber,
      verifiedName: result.verifiedName,
      status: "connected",
    },
  });
});
