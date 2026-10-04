/**
 * Correo de recuperación de contraseña (029). PURO: arma asunto, texto y
 * HTML; no sabe de SMTP ni de Better Auth.
 */

export type PasswordResetEmailInput = {
  /** Nombre visible de la instancia (marca pública, como el login). */
  appName: string;
  /** Acento de la marca (hex); se usa solo para el botón. */
  accent: string;
  /** Nombre de la cuenta; vacío → saludo neutro. */
  name: string | null;
  url: string;
  expiresInMinutes: number;
};

export type BuiltEmail = { subject: string; text: string; html: string };

/** Ruta de la página propia a la que vuelve el enlace (Better Auth valida el token antes). */
export const RESET_PASSWORD_PAGE = "/reset-password";

/** Vencimiento del enlace (segundos): 1 hora, el default de Better Auth. */
export const RESET_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * Enlace del correo: pasa por el endpoint de Better Auth, que valida el
 * token y redirige a la página con `?token=` (o `?error=INVALID_TOKEN`).
 * Se arma acá —y no con el `redirectTo` que manda el navegador— para que el
 * destino no dependa de lo que pida el cliente.
 */
export function passwordResetLink(appBaseUrl: string, token: string): string {
  const base = appBaseUrl.replace(/\/+$/, "");
  return `${base}/api/auth/reset-password/${encodeURIComponent(token)}?callbackURL=${encodeURIComponent(RESET_PASSWORD_PAGE)}`;
}

export function formatExpiry(minutes: number): string {
  if (minutes < 60) return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "1 hora" : `${hours} horas`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const HEX = /^#[0-9a-f]{6}$/i;

export function buildPasswordResetEmail(input: PasswordResetEmailInput): BuiltEmail {
  const appName = input.appName.trim() || "Vocero";
  const name = input.name?.trim() ?? "";
  const expiry = formatExpiry(input.expiresInMinutes);
  const accent = HEX.test(input.accent) ? input.accent : "#3f5972";
  const greeting = name ? `Hola, ${name}:` : "Hola:";

  const subject = `Restablecé tu contraseña de ${appName}`;

  const text = [
    greeting,
    "",
    `Pediste restablecer tu contraseña de ${appName}. Para elegir una nueva, abrí este enlace (vence en ${expiry} y sirve una sola vez):`,
    "",
    input.url,
    "",
    "Si no lo pediste vos, ignorá este correo: tu contraseña no cambia.",
    "",
    `— ${appName}`,
  ].join("\n");

  const url = escapeHtml(input.url);
  const html = `<!doctype html>
<html lang="es">
<body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;">
    <tr><td style="padding:28px 28px 8px;font-size:18px;font-weight:700;">${escapeHtml(appName)}</td></tr>
    <tr><td style="padding:8px 28px;font-size:15px;line-height:1.5;">
      <p style="margin:0 0 12px;">${escapeHtml(greeting)}</p>
      <p style="margin:0 0 20px;">Pediste restablecer tu contraseña. Tocá el botón para elegir una nueva. El enlace vence en ${escapeHtml(expiry)} y sirve una sola vez.</p>
      <p style="margin:0 0 20px;"><a href="${url}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:${accent};color:#ffffff;text-decoration:none;font-weight:600;">Elegir contraseña nueva</a></p>
      <p style="margin:0 0 8px;font-size:13px;color:#4b5563;">Si el botón no anda, copiá este enlace en el navegador:</p>
      <p style="margin:0 0 20px;font-size:13px;word-break:break-all;"><a href="${url}" style="color:#374151;">${url}</a></p>
      <p style="margin:0 0 24px;font-size:13px;color:#4b5563;">Si no lo pediste vos, ignorá este correo: tu contraseña no cambia.</p>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
