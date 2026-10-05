import { describe, expect, it } from "vitest";
import {
  buildPasswordResetEmail,
  formatExpiry,
  passwordResetLink,
  RESET_TOKEN_TTL_SECONDS,
} from "@/lib/password-reset-email";

/** 029 — correo de recuperación: enlace propio, vencimiento y escape. */

describe("passwordResetLink", () => {
  it("pasa por el endpoint de Better Auth y vuelve a la página propia", () => {
    expect(passwordResetLink("https://crm.ejemplo.com", "AbC123")).toBe(
      "https://crm.ejemplo.com/api/auth/reset-password/AbC123?callbackURL=%2Freset-password"
    );
  });

  it("tolera la barra final de APP_BASE_URL y codifica el token", () => {
    expect(passwordResetLink("https://crm.ejemplo.com/", "a/b")).toBe(
      "https://crm.ejemplo.com/api/auth/reset-password/a%2Fb?callbackURL=%2Freset-password"
    );
  });
});

describe("formatExpiry", () => {
  it("minutos y horas en castellano", () => {
    expect(formatExpiry(1)).toBe("1 minuto");
    expect(formatExpiry(30)).toBe("30 minutos");
    expect(formatExpiry(60)).toBe("1 hora");
    expect(formatExpiry(120)).toBe("2 horas");
  });

  it("el TTL del token es 1 hora", () => {
    expect(formatExpiry(RESET_TOKEN_TTL_SECONDS / 60)).toBe("1 hora");
  });
});

describe("buildPasswordResetEmail", () => {
  const base = {
    appName: "Vocero",
    accent: "#3f5972",
    name: "Ana",
    url: "https://crm.ejemplo.com/api/auth/reset-password/T0K?callbackURL=%2Freset-password",
    expiresInMinutes: 60,
  };

  it("asunto, saludo, enlace y vencimiento en texto y HTML", () => {
    const mail = buildPasswordResetEmail(base);
    expect(mail.subject).toBe("Restablecé tu contraseña de Vocero");
    expect(mail.text).toContain("Hola, Ana:");
    expect(mail.text).toContain(base.url);
    expect(mail.text).toContain("vence en 1 hora");
    expect(mail.text).toContain("ignorá este correo");
    expect(mail.html).toContain('href="https://crm.ejemplo.com/api/auth/reset-password/T0K?callbackURL=%2Freset-password"');
    expect(mail.html).toContain("background:#3f5972");
  });

  it("sin nombre → saludo neutro", () => {
    expect(buildPasswordResetEmail({ ...base, name: "  " }).text.startsWith("Hola:\n")).toBe(true);
    expect(buildPasswordResetEmail({ ...base, name: null }).html).toContain("Hola:");
  });

  it("escapa el nombre y el nombre de la instancia en el HTML", () => {
    const mail = buildPasswordResetEmail({
      ...base,
      name: '<img src=x onerror="alert(1)">',
      appName: "Acme & <Co>",
    });
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(mail.html).toContain("Acme &amp; &lt;Co&gt;");
  });

  it("un acento inválido cae al default (no se inyecta CSS)", () => {
    const mail = buildPasswordResetEmail({ ...base, accent: "red;}body{display:none" });
    expect(mail.html).toContain("background:#3f5972");
    expect(mail.html).not.toContain("display:none");
  });
});
