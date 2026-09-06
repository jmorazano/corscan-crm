import { getEnv } from "@/lib/env";
import { expectedGoogleVerificationFile } from "@/lib/site-verification";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ file: string }> };

/**
 * Archivo de verificación de Google Search Console (método "HTML file"):
 * Google descarga `https://<dominio>/google<token>.html` y espera EXACTAMENTE
 * `google-site-verification: google<token>.html` como cuerpo, sin
 * autenticación ni redirecciones. La URL raíz la resuelve el rewrite de
 * next.config.ts; acá solo se responde si el nombre coincide con
 * GOOGLE_SITE_VERIFICATION. Cualquier otro nombre → 404 indistinguible.
 */
export async function GET(_req: Request, ctx: Params): Promise<Response> {
  const { file } = await ctx.params;
  const expected = expectedGoogleVerificationFile(getEnv().GOOGLE_SITE_VERIFICATION);
  if (!expected || file !== expected) {
    return new Response(null, { status: 404 });
  }
  return new Response(`google-site-verification: ${expected}`, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
