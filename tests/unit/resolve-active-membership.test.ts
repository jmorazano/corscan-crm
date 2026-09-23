import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * 018 (FR-001/FR-009): la empresa activa sale de la sesión SI el usuario
 * es miembro de esa empresa; si no (id ajeno, empresa removida, sesión
 * vieja sin empresa) cae a la más antigua (determinismo de 003) y avisa
 * que la sesión hay que repararla. Al iniciar sesión se prefiere la
 * última usada (`user.last_organization_id`).
 */

type Row = Record<string, unknown>;
const state: { member: Row[]; user: Row[] } = { member: [], user: [] };

const COLUMN_TO_KEY: Record<string, string> = {
  user_id: "userId",
  organization_id: "organizationId",
  id: "id",
};

function whereFilter(cond: unknown): (row: Row) => boolean {
  const { sql, params } = new PgDialect().sqlToQuery(cond as SQL);
  const pairs = [...sql.matchAll(/"\w+"\."(\w+)" = \$(\d+)/g)].map((m) => ({
    key: COLUMN_TO_KEY[m[1]!] ?? m[1]!,
    value: params[Number(m[2]) - 1],
  }));
  return (row) => pairs.every((p) => row[p.key] === p.value);
}

function sortOldest(rows: Row[]): Row[] {
  return [...rows].sort(
    (a, b) =>
      (a.createdAt as number) - (b.createdAt as number) ||
      String(a.id).localeCompare(String(b.id))
  );
}

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({
      select: () => ({
        from: (table: unknown) => ({
          where: (cond: unknown) => {
            const rows =
              table === actual.schema.user ? state.user : state.member;
            const filtered = rows.filter(whereFilter(cond));
            return {
              orderBy: () => ({
                limit: (n: number) => Promise.resolve(sortOldest(filtered).slice(0, n)),
              }),
              limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
            };
          },
        }),
      }),
    }),
  };
});

import {
  resolveActiveMembership,
  resolveLoginOrganizationId,
} from "@/server/auth/on-signup";

beforeEach(() => {
  state.member = [
    { id: "mem_a", userId: "u_1", organizationId: "org_a", role: "owner", createdAt: 100 },
    { id: "mem_b", userId: "u_1", organizationId: "org_b", role: "member", createdAt: 200 },
    { id: "mem_x", userId: "u_2", organizationId: "org_x", role: "owner", createdAt: 50 },
  ];
  state.user = [{ id: "u_1", last: null }];
});

describe("resolveActiveMembership", () => {
  it("la sesión pide org_b y el usuario es miembro → org_b con su rol", async () => {
    await expect(resolveActiveMembership("u_1", "org_b")).resolves.toMatchObject({
      organizationId: "org_b",
      role: "member",
      matchedPreferred: true,
    });
  });

  it("la sesión pide una empresa AJENA → la más antigua y matchedPreferred=false", async () => {
    await expect(resolveActiveMembership("u_1", "org_x")).resolves.toMatchObject({
      organizationId: "org_a",
      role: "owner",
      matchedPreferred: false,
    });
  });

  it("sesión sin empresa (null) → la más antigua", async () => {
    await expect(resolveActiveMembership("u_1", null)).resolves.toMatchObject({
      organizationId: "org_a",
      matchedPreferred: false,
    });
  });

  it("sin membresías → null", async () => {
    await expect(resolveActiveMembership("u_9", "org_a")).resolves.toBeNull();
  });
});

describe("resolveLoginOrganizationId", () => {
  it("prefiere la última usada si sigue siendo miembro", async () => {
    state.user = [{ id: "u_1", last: "org_b" }];
    await expect(resolveLoginOrganizationId("u_1")).resolves.toBe("org_b");
  });

  it("última usada ya no es suya → la más antigua", async () => {
    state.user = [{ id: "u_1", last: "org_x" }];
    await expect(resolveLoginOrganizationId("u_1")).resolves.toBe("org_a");
  });

  it("sin última usada → la más antigua", async () => {
    await expect(resolveLoginOrganizationId("u_1")).resolves.toBe("org_a");
  });
});
