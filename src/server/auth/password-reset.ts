import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { sendMail } from "@/lib/mail";
import {
  buildPasswordResetEmail,
  passwordResetLink,
  RESET_TOKEN_TTL_SECONDS,
} from "@/lib/password-reset-email";
import { getPublicBranding } from "@/server/branding";

/**
 * Recuperación de contraseña por correo (029). Better Auth genera, guarda
 * (hasheado) y consume el token; acá vive lo propio: el correo y la
 * limpieza de `must_change_password`.
 */

export type PasswordResetMailInput = {
  email: string;
  name: string | null;
  token: string;
};

/** Arma y manda el correo. Lanza si el SMTP falla. */
export async function deliverPasswordResetEmail(
  input: PasswordResetMailInput
): Promise<void> {
  const branding = getPublicBranding();
  const email = buildPasswordResetEmail({
    appName: branding.name,
    accent: branding.accent,
    name: input.name,
    url: passwordResetLink(getEnv().APP_BASE_URL, input.token),
    expiresInMinutes: RESET_TOKEN_TTL_SECONDS / 60,
  });
  await sendMail({ to: input.email, ...email });
}

/**
 * En segundo plano (AC1.5): Better Auth responde lo mismo exista o no la
 * cuenta; esperar al SMTP solo para las que existen sería un oráculo de
 * timing, y un SMTP caído no debe convertir el pedido en un 500. El fallo
 * queda en el log SIN el correo del destinatario ni la credencial.
 */
export function queuePasswordResetEmail(input: PasswordResetMailInput): void {
  void deliverPasswordResetEmail(input).catch((err: unknown) => {
    console.error(
      "[mail] recuperación de contraseña no enviada:",
      err instanceof Error ? err.message : "error desconocido"
    );
  });
}

/**
 * La contraseña nueva la eligió la persona: si venía con una temporal
 * vigente (FR-017), ya no hace falta cambiarla otra vez.
 */
export async function clearMustChangePassword(
  userId: string,
  db: Pick<ReturnType<typeof getDb>, "update"> = getDb()
): Promise<void> {
  await db
    .update(schema.user)
    .set({ mustChangePassword: false, updatedAt: new Date() })
    .where(eq(schema.user.id, userId));
}
