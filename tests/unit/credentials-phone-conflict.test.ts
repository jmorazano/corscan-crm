import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * US2: si la org B intenta conectar un phone_number_id que ya pertenece a la
 * org A, el índice único meta_credentials_phone_uq lo impide (fails-closed) —
 * pero el error crudo de Postgres debe convertirse en PhoneNumberInUseError
 * para que la API responda 409 accionable (sin revelar de qué org es el
 * número) en vez de un 500 genérico.
 */

let insertError: unknown = null;

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: () =>
            insertError ? Promise.reject(insertError) : Promise.resolve(),
        }),
      }),
    }),
  };
});

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});

const INPUT = {
  organizationId: "org_b",
  wabaId: "waba_b",
  phoneNumberId: "pn_ya_conectado",
  token: "EAAG-token",
};

function pgUniqueViolation(constraint: string): Error {
  const err = new Error(
    `duplicate key value violates unique constraint "${constraint}"`
  ) as Error & { code: string; constraint_name: string };
  err.code = "23505";
  err.constraint_name = constraint;
  return err;
}

describe("saveCredentials: choque de phone_number_id entre orgs (US2)", () => {
  it("violación de meta_credentials_phone_uq → PhoneNumberInUseError", async () => {
    const { PhoneNumberInUseError, saveCredentials } = await import(
      "@/server/whatsapp/credentials"
    );
    insertError = pgUniqueViolation("meta_credentials_phone_uq");
    await expect(saveCredentials(INPUT)).rejects.toBeInstanceOf(
      PhoneNumberInUseError
    );
    // el mensaje es accionable y NO nombra a la otra organización
    await expect(saveCredentials(INPUT)).rejects.toThrow(/otra empresa/);
  });

  it("también cuando drizzle envuelve el error de Postgres en cause", async () => {
    const { PhoneNumberInUseError, saveCredentials } = await import(
      "@/server/whatsapp/credentials"
    );
    const wrapped = new Error("Failed query") as Error & { cause?: unknown };
    wrapped.cause = pgUniqueViolation("meta_credentials_phone_uq");
    insertError = wrapped;
    await expect(saveCredentials(INPUT)).rejects.toBeInstanceOf(
      PhoneNumberInUseError
    );
  });

  it("otros errores (incluido otro unique) se propagan tal cual", async () => {
    const { PhoneNumberInUseError, saveCredentials } = await import(
      "@/server/whatsapp/credentials"
    );
    insertError = pgUniqueViolation("meta_credentials_org_uq");
    const caught = await saveCredentials(INPUT).catch((e: unknown) => e);
    expect(caught).not.toBeInstanceOf(PhoneNumberInUseError);
    expect(String(caught)).toContain("meta_credentials_org_uq");

    insertError = new Error("connection refused");
    await expect(saveCredentials(INPUT)).rejects.toThrow("connection refused");
  });
});
