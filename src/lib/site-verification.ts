/**
 * Normaliza GOOGLE_SITE_VERIFICATION a `google<token>.html`: acepta el token
 * pelado, `google<token>` o el nombre completo con `.html`. null si está
 * vacío o tiene caracteres fuera del alfabeto del archivo de Google.
 */
export function expectedGoogleVerificationFile(raw: string | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const base = v.replace(/\.html$/i, "");
  const withPrefix = base.startsWith("google") ? base : `google${base}`;
  if (!/^google[A-Za-z0-9_-]+$/.test(withPrefix)) return null;
  return `${withPrefix}.html`;
}
