import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { schema } from "@/lib/db";
import { removeOrganizationUser } from "@/server/admin/users";

/**
 * 019 (FR-004): quitar un usuario de una empresa borra la membresía; si
 * queda sin empresas se elimina la cuenta (salvo correos de plataforma);
 * el último propietario no se puede quitar (409); un super admin ajeno no
 * se toca (403); cuenta o membresía inexistente → 404.
 */

type Row = Record<string, unknown>;
type State = { organization: Row[]; member: Row[]; user: Row[]; session: Row[] };
let state: State;

vi.mock("@/server/auth/super-admin", () => ({
  isSuperAdminEmail: (email: string) =>
    ["superadmin@vocero.test", "otro-sa@vocero.test"].includes(email),
}));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: {} }),
  runInternalSignup: <T,>(fn: () => Promise<T>) => fn(),
}));

const COLUMN_TO_KEY: Record<string, string> = {
  id: "id",
  email: "email",
  user_id: "userId",
  organization_id: "organizationId",
  role: "role",
};

function tableKey(table: unknown): keyof State {
  if (table === schema.organization) return "organization";
  if (table === schema.member) return "member";
  if (table === schema.user) return "user";
  if (table === schema.session) return "session";
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
    insert: () => ({ values: () => Promise.resolve() }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    delete: (table: unknown) => ({
      where: (cond: unknown) => {
        const key = tableKey(table);
        const keep = state[key].filter((r) => !whereFilter(cond)(r));
        const removedUsers =
          key === "user" ? state.user.filter(whereFilter(cond)).map((u) => u.id) : [];
        state[key] = keep;
        // Cascada de la BD real: user → member/session.
        if (removedUsers.length > 0) {
          state.member = state.member.filter((m) => !removedUsers.includes(m.userId));
          state.session = state.session.filter((s) => !removedUsers.includes(s.userId));
        }
        return Promise.resolve();
      },
    }),
  } as unknown as NonNullable<Parameters<typeof removeOrganizationUser>[1]>;
}

const OPERATOR = "superadmin@vocero.test";

beforeEach(() => {
  state = {
    organization: [
      { id: "org_a", name: "A" },
      { id: "org_b", name: "B" },
    ],
    user: [
      { id: "u_sa", email: "superadmin@vocero.test" },
      { id: "u_sa2", email: "otro-sa@vocero.test" },
      { id: "u_owner", email: "owner@vocero.test" },
      { id: "u_solo", email: "solo@vocero.test" },
      { id: "u_dos", email: "dos@vocero.test" },
    ],
    member: [
      { id: "m1", organizationId: "org_a", userId: "u_sa", role: "owner" },
      { id: "m2", organizationId: "org_a", userId: "u_owner", role: "owner" },
      { id: "m3", organizationId: "org_a", userId: "u_solo", role: "member" },
      { id: "m4", organizationId: "org_a", userId: "u_dos", role: "member" },
      { id: "m5", organizationId: "org_b", userId: "u_dos", role: "owner" },
      { id: "m6", organizationId: "org_a", userId: "u_sa2", role: "member" },
    ],
    session: [
      { id: "s1", userId: "u_solo" },
      { id: "s2", userId: "u_dos" },
    ],
  };
});

describe("removeOrganizationUser", () => {
  it("miembro con una sola empresa → membresía fuera y cuenta eliminada (sesiones en cascada)", async () => {
    const result = await removeOrganizationUser(
      { organizationId: "org_a", userId: "u_solo", operatorEmail: OPERATOR },
      stubDb()
    );
    expect(result).toEqual({ ok: true, accountDeleted: true });
    expect(state.member.some((m) => m.userId === "u_solo")).toBe(false);
    expect(state.user.some((u) => u.id === "u_solo")).toBe(false);
    expect(state.session.some((s) => s.userId === "u_solo")).toBe(false);
  });

  it("usuario con otra empresa → pierde SOLO esta membresía y conserva la cuenta", async () => {
    const result = await removeOrganizationUser(
      { organizationId: "org_a", userId: "u_dos", operatorEmail: OPERATOR },
      stubDb()
    );
    expect(result).toEqual({ ok: true, accountDeleted: false });
    expect(state.member.filter((m) => m.userId === "u_dos")).toEqual([
      { id: "m5", organizationId: "org_b", userId: "u_dos", role: "owner" },
    ]);
    expect(state.user.some((u) => u.id === "u_dos")).toBe(true);
  });

  it("último propietario → 409 last_owner y nada cambia", async () => {
    const result = await removeOrganizationUser(
      { organizationId: "org_b", userId: "u_dos", operatorEmail: OPERATOR },
      stubDb()
    );
    expect(result).toMatchObject({ ok: false, code: "last_owner" });
    expect(state.member.some((m) => m.id === "m5")).toBe(true);
  });

  it("propietario con otro propietario en la empresa → se puede quitar", async () => {
    const result = await removeOrganizationUser(
      { organizationId: "org_a", userId: "u_owner", operatorEmail: OPERATOR },
      stubDb()
    );
    expect(result).toEqual({ ok: true, accountDeleted: true });
    expect(state.member.some((m) => m.id === "m2")).toBe(false);
  });

  it("super admin ajeno → 403 forbidden", async () => {
    const result = await removeOrganizationUser(
      { organizationId: "org_a", userId: "u_sa2", operatorEmail: OPERATOR },
      stubDb()
    );
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
    expect(state.member.some((m) => m.id === "m6")).toBe(true);
  });

  it("el propio super admin se quita de una empresa: membresía fuera, la cuenta de plataforma NUNCA se elimina", async () => {
    const result = await removeOrganizationUser(
      { organizationId: "org_a", userId: "u_sa", operatorEmail: OPERATOR },
      stubDb()
    );
    expect(result).toEqual({ ok: true, accountDeleted: false });
    expect(state.member.some((m) => m.id === "m1")).toBe(false);
    expect(state.user.some((u) => u.id === "u_sa")).toBe(true);
  });

  it("cuenta inexistente → 404 not_found; no miembro → 404 not_member", async () => {
    await expect(
      removeOrganizationUser(
        { organizationId: "org_a", userId: "u_nope", operatorEmail: OPERATOR },
        stubDb()
      )
    ).resolves.toMatchObject({ ok: false, code: "not_found" });
    await expect(
      removeOrganizationUser(
        { organizationId: "org_b", userId: "u_solo", operatorEmail: OPERATOR },
        stubDb()
      )
    ).resolves.toMatchObject({ ok: false, code: "not_member" });
  });
});
