import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/** CRM-6: `lastTeamMessageAt` con `skipFailed` filtra `status <> 'failed'` en la consulta. */

const captured: unknown[] = [];

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({
      select: () => ({
        from: () => ({
          where: (w: unknown) => {
            captured.push(w);
            const c: Record<string, unknown> = {};
            c.orderBy = () => c;
            c.limit = async () => [];
            return c;
          },
        }),
      }),
    }),
  };
});

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = ["postgresql://u", "p@localhost:5432/t"].join(":");
  process.env.BETTER_AUTH_SECRET = "s".repeat(32);
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "v".repeat(8);
});

beforeEach(() => {
  captured.length = 0;
});

const render = (c: unknown) => new PgDialect().sqlToQuery(c as SQL);

describe("lastTeamMessageAt", () => {
  it("con skipFailed excluye los envíos fallidos; sin él, no", async () => {
    const { lastTeamMessageAt } = await import("@/server/ai/events");
    await lastTeamMessageAt("org1", "c1", { skipFailed: true });
    await lastTeamMessageAt("org1", "c1");
    const withFilter = render(captured[0]);
    const without = render(captured[1]);
    expect(withFilter.sql).toContain('"status" <> $');
    expect(withFilter.params).toContain("failed");
    expect(without.params).not.toContain("failed");
  });
});
