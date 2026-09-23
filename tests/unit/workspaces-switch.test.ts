import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * 018 (FR-002/FR-009): cambiar de espacio solo a empresas de las que el
 * usuario es miembro; actualiza la sesión ACTUAL y recuerda la última
 * empresa en el usuario. Ajena o inexistente → not_member (mismo código).
 */

type Row = Record<string, unknown>;
const state: { member: Row[]; session: Row[]; user: Row[] } = {
  member: [],
  session: [],
  user: [],
};

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

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const tableOf = (t: unknown): keyof typeof state => {
    if (t === actual.schema.member) return "member";
    if (t === actual.schema.session) return "session";
    if (t === actual.schema.user) return "user";
    throw new Error("tabla inesperada");
  };
  return {
    ...actual,
    getDb: () => ({
      select: () => ({
        from: (table: unknown) => ({
          where: (cond: unknown) => ({
            limit: (n: number) =>
              Promise.resolve(state[tableOf(table)].filter(whereFilter(cond)).slice(0, n)),
          }),
        }),
      }),
      update: (table: unknown) => ({
        set: (patch: Row) => ({
          where: (cond: unknown) => {
            for (const row of state[tableOf(table)]) {
              if (whereFilter(cond)(row)) Object.assign(row, patch);
            }
            return Promise.resolve();
          },
        }),
      }),
    }),
  };
});

import { switchWorkspace } from "@/server/workspaces/switch";

beforeEach(() => {
  state.member = [
    { id: "mem_a", userId: "u_1", organizationId: "org_a" },
    { id: "mem_b", userId: "u_1", organizationId: "org_b" },
    { id: "mem_x", userId: "u_2", organizationId: "org_x" },
  ];
  state.session = [
    { id: "ses_1", userId: "u_1", activeOrganizationId: "org_a" },
    { id: "ses_2", userId: "u_1", activeOrganizationId: "org_a" },
  ];
  state.user = [{ id: "u_1", lastOrganizationId: null }];
});

describe("switchWorkspace", () => {
  it("miembro → ok, cambia SOLO esa sesión y recuerda la última empresa", async () => {
    await expect(
      switchWorkspace({ userId: "u_1", sessionId: "ses_1", organizationId: "org_b" })
    ).resolves.toEqual({ ok: true, organizationId: "org_b" });
    expect(state.session[0]?.activeOrganizationId).toBe("org_b");
    // la otra sesión del usuario converge sola al volver a primer plano
    expect(state.session[1]?.activeOrganizationId).toBe("org_a");
    expect(state.user[0]?.lastOrganizationId).toBe("org_b");
  });

  it("empresa ajena → not_member y nada cambia", async () => {
    const result = await switchWorkspace({
      userId: "u_1",
      sessionId: "ses_1",
      organizationId: "org_x",
    });
    expect(result).toMatchObject({ ok: false, code: "not_member" });
    expect(state.session[0]?.activeOrganizationId).toBe("org_a");
    expect(state.user[0]?.lastOrganizationId).toBeNull();
  });

  it("empresa inexistente → el MISMO not_member (no revela existencia)", async () => {
    const result = await switchWorkspace({
      userId: "u_1",
      sessionId: "ses_1",
      organizationId: "org_nope",
    });
    expect(result).toMatchObject({ ok: false, code: "not_member" });
  });

  it("idempotente: cambiar a la que ya es activa → ok", async () => {
    await expect(
      switchWorkspace({ userId: "u_1", sessionId: "ses_1", organizationId: "org_a" })
    ).resolves.toEqual({ ok: true, organizationId: "org_a" });
  });
});
