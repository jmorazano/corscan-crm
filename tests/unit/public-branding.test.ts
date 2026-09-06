import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Identidad pública de la instancia: sin sesión, la marca es APP_PUBLIC_NAME
 * (lo que Google compara con el nombre de la app del consent screen) y
 * JAMÁS la de una empresa.
 */

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    }),
  };
});

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
  process.env.APP_PUBLIC_NAME = "Corscan CRM";
});

describe("marca pública de la instancia", () => {
  it("getPublicBranding usa APP_PUBLIC_NAME con el acento neutro", async () => {
    const { getPublicBranding } = await import("@/server/branding");
    const { DEFAULT_BRANDING } = await import("@/lib/branding");
    expect(getPublicBranding()).toEqual({ ...DEFAULT_BRANDING, name: "Corscan CRM" });
  });

  it("getBranding sin organización → marca pública; organización inexistente → también", async () => {
    const { getBranding } = await import("@/server/branding");
    expect((await getBranding()).name).toBe("Corscan CRM");
    expect((await getBranding("org_inexistente")).name).toBe("Corscan CRM");
  });
});
