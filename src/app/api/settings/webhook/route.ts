import { withSuperAdmin } from "@/lib/api";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Datos del webhook para pegar en Meta o en el backend de la agencia (FR-043).
 *
 * SOLO super admin (US2): el verify token es un secreto DE PLATAFORMA — con él
 * cualquiera puede hacer POST al webhook e inyectar mensajes en la bandeja de
 * cualquier empresa (la firma de META_APP_SECRET es opcional). Los miembros de
 * una organización no lo necesitan: el webhook se configura una vez por
 * instancia. La UI degrada limpio (la card no se muestra sin acceso).
 */
export const GET = withSuperAdmin(async () => {
  const env = getEnv();
  const url = `${env.APP_BASE_URL.replace(/\/$/, "")}/api/webhooks/wa/${env.META_WEBHOOK_VERIFY_TOKEN}`;
  return Response.json({
    url,
    verifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
    isHttps: url.startsWith("https://"),
    signatureLayer: Boolean(env.META_APP_SECRET),
  });
});
