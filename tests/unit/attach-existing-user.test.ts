import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { schema } from "@/lib/db";
import { attachExistingUser } from "@/server/auth/membership";
import { createOrganizationUser } from "@/server/admin/users";

/**
 * 018 (FR-008): sumar una cuenta EXISTENTE a otra empresa — sin
 * contraseña ni must_change_password; 403 reservado, 404 empresa o cuenta
 * inexistente, 409 ya miembro; y el alta normal avisa `canAttach` en el
 * 409 duplicate_email solo si la cuenta NO es ya miembro.
 */

type Row = Record<string, unknown>;
type State = { organization: Row[]; member: Row[]; user: Row[] };
let state: State;

vi.mock("@/server/auth/super-admin", () => ({
  isSuperAdminEmail: (email: string) => email === "superadmin@vocero.test",
}));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { signUpEmail: () => Promise.reject(new Error("no usado")) } }),
  runInternalSignup: <T,>(fn: () => Promise<T>) => fn(),
}));

const COLUMN_TO_KEY: Record<string, string> = {
  id: "id",
  email: "email",
  user_id: "userId",
  organization_id: "organizationId",
};

function tableKey(table: unknown): keyof State {
  if (table === schema.organization) return "organization";
  if (table === schema.member) return "member";
  if (table === schema.user) return "user";
  throw new Error("tabla inesperada en el stub");
}

function whereFilter(cond: unknown): (row: Row) => boolean {
  const { sql, params } = new PgDialect().sqlToQuery(cond as SQL);
  const pairs = [...sql.matchAll(/"\w+"\."(\w+)" = \$(\d+)/g)].map((m) => ({
    key: COLUMN_TO_KEY[m[1]!] ?? m[1]!,
    value: params[Number(m[2]) - 1],
  }));
  if (pairs.length === 0) throw new Error(`WHERE inesperado: ${sql}`);
  return (row) => pairs.every((p) => row[p.key] === p.value);
}

function stubDb() {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: unknown) =>
          Promise.resolve(state[tableKey(table)].filter(whereFilter(cond))),
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: Row | Row[]) => {
        const rows = Array.isArray(v) ? v : [v];
        state[tableKey(table)].push(...rows.map((r) => ({ ...r })));
        return Object.assign(Promise.resolve(), {
          onConflictDoNothing: () => Promise.resolve(),
        });
      },
    }),
    update: () => ({
      set: () => ({ where: () => Promise.resolve() }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  } as unknown as NonNullable<Parameters<typeof attachExistingUser>[1]>;
}

beforeEach(() => {
  state = {
    organization: [
      { id: "org_a", name: "Corscan" },
      { id: "org_b", name: "Inmobiliaria" },
    ],
    user: [{ id: "u_op", email: "operador@vocero.test", name: "Op" }],
    member: [{ id: "mem_1", organizationId: "org_a", userId: "u_op", role: "owner" }],
  };
});

describe("attachExistingUser", () => {
  it("cuenta existente, no miembro → membresía nueva con el rol pedido, sin tocar la cuenta", async () => {
    const result = await attachExistingUser(
      { organizationId: "org_b", email: "Operador@vocero.test ", role: "member" },
      stubDb()
    );
    expect(result).toEqual({ ok: true, userId: "u_op" });
    const added = state.member.find((m) => m.organizationId === "org_b");
    expect(added).toMatchObject({ userId: "u_op", role: "member" });
    expect(String(added?.id)).toMatch(/^mem_/);
    // la membresía original no cambia
    expect(state.member[0]).toMatchObject({ organizationId: "org_a", role: "owner" });
  });

  it("ya miembro → 409 already_member y no duplica", async () => {
    const result = await attachExistingUser(
      { organizationId: "org_a", email: "operador@vocero.test", role: "member" },
      stubDb()
    );
    expect(result).toMatchObject({ ok: false, code: "already_member" });
    expect(state.member).toHaveLength(1);
  });

  it("correo sin cuenta → user_not_found", async () => {
    const result = await attachExistingUser(
      { organizationId: "org_b", email: "nadie@vocero.test", role: "member" },
      stubDb()
    );
    expect(result).toMatchObject({ ok: false, code: "user_not_found" });
  });

  it("empresa inexistente → not_found", async () => {
    const result = await attachExistingUser(
      { organizationId: "org_nope", email: "operador@vocero.test", role: "member" },
      stubDb()
    );
    expect(result).toMatchObject({ ok: false, code: "not_found" });
  });

  it("correo reservado de plataforma → reserved_email", async () => {
    const result = await attachExistingUser(
      { organizationId: "org_b", email: "superadmin@vocero.test", role: "owner" },
      stubDb()
    );
    expect(result).toMatchObject({ ok: false, code: "reserved_email" });
  });
});

describe("createOrganizationUser + canAttach (018)", () => {
  const db = () =>
    stubDb() as unknown as NonNullable<Parameters<typeof createOrganizationUser>[1]>;

  it("duplicado que NO es miembro de esta empresa → canAttach true", async () => {
    const result = await createOrganizationUser(
      {
        organizationId: "org_b",
        name: "Op",
        email: "operador@vocero.test",
        password: "temporal123",
        role: "member",
      },
      db()
    );
    expect(result).toMatchObject({ ok: false, code: "duplicate_email", canAttach: true });
  });

  it("duplicado que YA es miembro → canAttach false y mensaje claro", async () => {
    const result = await createOrganizationUser(
      {
        organizationId: "org_a",
        name: "Op",
        email: "operador@vocero.test",
        password: "temporal123",
        role: "member",
      },
      db()
    );
    expect(result).toMatchObject({ ok: false, code: "duplicate_email", canAttach: false });
    expect((result as { message: string }).message).toMatch(/ya es miembro/i);
  });
});
