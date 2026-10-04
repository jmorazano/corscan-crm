import type { Env } from "@/lib/env";

/**
 * Configuración del SMTP de la instancia (029, constitución II cat. 6).
 * PURO sobre el entorno: lo comparten el envío real y los tests.
 */
export type SmtpConfig = {
  host: string;
  port: number;
  /** TLS directo (465). false = STARTTLS si el servidor lo ofrece (587). */
  secure: boolean;
  auth: { user: string; pass: string } | null;
  from: string;
};

/** Un `REEMPLAZA_…` (convención de `.env`) cuenta como vacío. */
function real(value: string | undefined): string | null {
  const v = value?.trim();
  if (!v || v.startsWith("REEMPLAZA_")) return null;
  return v;
}

/**
 * null si falta lo mínimo para mandar (host + remitente). Usuario sin
 * contraseña (o al revés) también es null: un relay sin auth se configura
 * sin ninguno de los dos, nunca con uno solo.
 */
export function readSmtpConfig(
  env: Pick<
    Env,
    "SMTP_HOST" | "SMTP_PORT" | "SMTP_SECURE" | "SMTP_USER" | "SMTP_PASS" | "SMTP_FROM"
  >
): SmtpConfig | null {
  const host = real(env.SMTP_HOST);
  const from = real(env.SMTP_FROM);
  if (!host || !from) return null;
  const user = real(env.SMTP_USER);
  const pass = real(env.SMTP_PASS);
  if (Boolean(user) !== Boolean(pass)) return null;
  const secureFlag = env.SMTP_SECURE?.trim().toLowerCase();
  const secure =
    secureFlag === "true" || secureFlag === "1"
      ? true
      : secureFlag === "false" || secureFlag === "0"
        ? false
        : env.SMTP_PORT === 465;
  return {
    host,
    port: env.SMTP_PORT,
    secure,
    auth: user && pass ? { user, pass } : null,
    from,
  };
}
