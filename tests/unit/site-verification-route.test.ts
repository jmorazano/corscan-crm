import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Verificación de dominio para Google (Search Console, método "archivo
 * HTML"): `/google<token>.html` responde EXACTAMENTE
 * `google-site-verification: google<token>.html` sin auth; cualquier otro
 * nombre (o sin variable) → 404.
 */

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});

beforeEach(() => {
  delete process.env.GOOGLE_SITE_VERIFICATION;
});

async function get(file: string): Promise<Response> {
  // getEnv memoiza: forzar re-lectura por test vía módulo fresco.
  const { GET } = await import("@/app/api/site-verification/google/[file]/route");
  return GET(new Request(`http://localhost/api/site-verification/google/${file}`), {
    params: Promise.resolve({ file }),
  });
}

describe("expectedGoogleVerificationFile", () => {
  it("normaliza token pelado, con prefijo y con .html", async () => {
    const { expectedGoogleVerificationFile: expectedFileName } = await import("@/lib/site-verification");
    expect(expectedFileName("1234abcd")).toBe("google1234abcd.html");
    expect(expectedFileName("google1234abcd")).toBe("google1234abcd.html");
    expect(expectedFileName(" google1234abcd.html ")).toBe("google1234abcd.html");
    expect(expectedFileName("")).toBeNull();
    expect(expectedFileName(undefined)).toBeNull();
    expect(expectedFileName("google../etc")).toBeNull();
  });
});

describe("GET /google<token>.html", () => {
  it("con la variable puesta: cuerpo exacto de Google, 200, sin redirección", async () => {
    // El env se memoiza en el primer getEnv(): este test corre primero con
    // la variable presente para fijar el valor del proceso de test.
    process.env.GOOGLE_SITE_VERIFICATION = "googleabc123def456.html";
    const res = await get("googleabc123def456.html");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("google-site-verification: googleabc123def456.html");
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("otro nombre → 404 (indistinguible de ruta inexistente)", async () => {
    process.env.GOOGLE_SITE_VERIFICATION = "googleabc123def456.html";
    const res = await get("googleotracosa.html");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });
});
