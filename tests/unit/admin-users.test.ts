import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { schema } from "@/lib/db";
import {
  createOrganizationUser,
  resetUserPassword,
} from "@/server/admin/users";

/**
 * US5/contrato admin-api.md: usuario adicional en una empresa (404 org
 * inexistente, 409 duplicado, 403 reserved_email, rol owner|member,
 * must_change_password) y reset de contraseña sin la vieja (hash vía
 * $context de better-auth, must_change_password, invalidación de TODAS las
 * sesiones, 404 usuario inexistente, 403 super admin ajeno). BD en memoria
 * que interpreta los WHERE de igualdad del módulo.
 */

type Row = Record<string, unknown>;

type State = {
  organization: Row[];
  member: Row[];
  user: Row[];
  session: Row[];
};

let state: State;

const signUpEmailMock = vi.fn();
const hashMock = vi.fn();
const findAccountsMock = vi.fn();
const updatePasswordMock = vi.fn();
const createAccountMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({
    api: { signUpEmail: signUpEmailMock },
    $context: Promise.resolve({
      password: { hash: hashMock },
      internalAdapter: {
        findAccounts: findAccountsMock,
        updatePassword: updatePasswordMock,
        createAccount: createAccountMock,
      },
    }),
  }),
  runInternalSignup: <T,>(fn: () => Promise<T>) => fn(),
}));

const COLUMN_TO_KEY: Record<string, string> = {
  id: "id",
  email: "email",
  user_id: "userId",
};

function tableKey(table: unknown): keyof State {
  if (table === schema.organization) return "organization";
  if (table === schema.member) return "member";
  if (table === schema.user) return "user";
  if (table === schema.session) return "session";
  throw new Error("tabla inesperada en el stub");
}

function parseWhere(cond: unknown): { key: string; value: unknown } {
  const { sql, params } = new PgDialect().sqlToQuery(cond as SQL);
  const column = sql.match(/"\w+"\."(\w+)"/)?.[1] ?? "";
  const key = COLUMN_TO_KEY[column];
  if (!key) throw new Error(`columna inesperada en WHERE: ${sql}`);
  return { key, value: params[0] };
}

function makeStubDb() {
  return {
    select: () => ({
      from: (table: unknown) => {
        const query = {
          where(cond: unknown) {
            const { key, value } = parseWhere(cond);
            return Promise.resolve(
              state[tableKey(table)].filter((r) => r[key] === value)
            );
          },
        };
        return query;
      },
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
    update: (table: unknown) => ({
      set: (patch: Row) => ({
        where: (cond: unknown) => {
          const { key, value } = parseWhere(cond);
          for (const row of state[tableKey(table)]) {
            if (row[key] === value) Object.assign(row, patch);
          }
          return Promise.resolve();
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: (cond: unknown) => {
        const { key, value } = parseWhere(cond);
        const rows = state[tableKey(table)];
        for (let i = rows.length - 1; i >= 0; i--) {
          const row = rows[i];
          if (row && row[key] === value) rows.splice(i, 1);
        }
        return Promise.resolve();
      },
    }),
  };
}

type DbParam = NonNullable<Parameters<typeof createOrganizationUser>[1]>;

function stubDb(): DbParam {
  return makeStubDb() as unknown as DbParam;
}

const CREATE_INPUT = {
  organizationId: "org_a",
  name: "Compa",
  email: "compa@empresa.com",
  password: "temporal123",
  role: "member" as const,
};

beforeEach(() => {
  state = {
    organization: [{ id: "org_a", name: "Corscan", slug: "principal" }],
    member: [],
    user: [],
    session: [],
  };
  signUpEmailMock.mockReset();
  // El signup real escribe el usuario vía el adapter de Better Auth: el mock
  // replica ese efecto para poder verificar must_change_password.
  signUpEmailMock.mockImplementation(
    async ({ body }: { body: { name: string; email: string } }) => {
      state.user.push({ id: "u_nuevo", name: body.name, email: body.email });
      return { user: { id: "u_nuevo" } };
    }
  );
  hashMock.mockReset();
  hashMock.mockImplementation(async (pw: string) => `hashed(${pw})`);
  findAccountsMock.mockReset();
  findAccountsMock.mockResolvedValue([
    { id: "acc_1", providerId: "credential", userId: "u_1" },
  ]);
  updatePasswordMock.mockReset();
  createAccountMock.mockReset();
  vi.stubEnv("SUPER_ADMIN_EMAILS", "duena@agencia.com,otra@agencia.com");
});

afterEach(() => vi.unstubAllEnvs());

describe("createOrganizationUser", () => {
  it("feliz: usuario con must_change_password + membresía con el rol pedido", async () => {
    const result = await createOrganizationUser(CREATE_INPUT, stubDb());
    expect(result).toEqual({ ok: true, userId: "u_nuevo" });
    expect(state.member[0]).toMatchObject({
      organizationId: "org_a",
      userId: "u_nuevo",
      role: "member",
    });
    expect(state.user[0]).toMatchObject({ mustChangePassword: true });
  });

  it("rol owner: la membresía respeta el rol elegido", async () => {
    const result = await createOrganizationUser(
      { ...CREATE_INPUT, role: "owner" },
      stubDb()
    );
    expect(result.ok).toBe(true);
    expect(state.member[0]).toMatchObject({ role: "owner" });
  });

  it("normaliza el email a minúsculas antes del alta", async () => {
    const result = await createOrganizationUser(
      { ...CREATE_INPUT, email: " COMPA@Empresa.com " },
      stubDb()
    );
    expect(result.ok).toBe(true);
    expect(signUpEmailMock).toHaveBeenCalledWith({
      body: expect.objectContaining({ email: "compa@empresa.com" }),
    });
  });

  it("org inexistente → not_found sin efectos", async () => {
    const result = await createOrganizationUser(
      { ...CREATE_INPUT, organizationId: "org_fantasma" },
      stubDb()
    );
    expect(result).toMatchObject({ ok: false, code: "not_found" });
    expect(signUpEmailMock).not.toHaveBeenCalled();
    expect(state.member).toHaveLength(0);
  });

  it("email duplicado (pre-chequeo) → duplicate_email sin efectos", async () => {
    state.user.push({ id: "u_prev", email: "compa@empresa.com" });
    const result = await createOrganizationUser(CREATE_INPUT, stubDb());
    expect(result).toMatchObject({ ok: false, code: "duplicate_email" });
    expect(signUpEmailMock).not.toHaveBeenCalled();
    expect(state.member).toHaveLength(0);
  });

  it("carrera de duplicado en el signup (UNIQUE manda) → duplicate_email", async () => {
    signUpEmailMock.mockRejectedValue(new Error("User already exists"));
    const result = await createOrganizationUser(CREATE_INPUT, stubDb());
    expect(result).toMatchObject({ ok: false, code: "duplicate_email" });
    expect(state.member).toHaveLength(0);
  });

  it("email reservado (FR-016) → reserved_email sin efectos", async () => {
    const result = await createOrganizationUser(
      { ...CREATE_INPUT, email: "Duena@Agencia.com" },
      stubDb()
    );
    expect(result).toMatchObject({ ok: false, code: "reserved_email" });
    expect(signUpEmailMock).not.toHaveBeenCalled();
  });

  it("fallo genérico del signup → invalid sin membresía colgada", async () => {
    signUpEmailMock.mockRejectedValue(new Error("boom"));
    const result = await createOrganizationUser(CREATE_INPUT, stubDb());
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(state.member).toHaveLength(0);
  });
});

describe("resetUserPassword", () => {
  const RESET_INPUT = {
    userId: "u_1",
    password: "temporal456",
    operatorEmail: "duena@agencia.com",
  };

  beforeEach(() => {
    state.user.push({
      id: "u_1",
      email: "compa@empresa.com",
      mustChangePassword: false,
    });
    state.session.push(
      { id: "s_1", userId: "u_1", token: "t1" },
      { id: "s_2", userId: "u_1", token: "t2" },
      { id: "s_ajena", userId: "u_otro", token: "t3" }
    );
  });

  it("feliz: hashea con el hasher de better-auth, setea el flag e invalida TODAS sus sesiones", async () => {
    const result = await resetUserPassword(RESET_INPUT, stubDb());
    expect(result).toEqual({ ok: true });
    expect(hashMock).toHaveBeenCalledWith("temporal456");
    expect(updatePasswordMock).toHaveBeenCalledWith(
      "u_1",
      "hashed(temporal456)"
    );
    expect(createAccountMock).not.toHaveBeenCalled();
    expect(state.user[0]).toMatchObject({ mustChangePassword: true });
    // Sesiones del usuario fuera; las ajenas intactas.
    expect(state.session).toEqual([
      expect.objectContaining({ id: "s_ajena", userId: "u_otro" }),
    ]);
  });

  it("usuario sin cuenta credential → la crea (patrón del plugin admin)", async () => {
    findAccountsMock.mockResolvedValue([]);
    const result = await resetUserPassword(RESET_INPUT, stubDb());
    expect(result).toEqual({ ok: true });
    expect(updatePasswordMock).not.toHaveBeenCalled();
    expect(createAccountMock).toHaveBeenCalledWith({
      userId: "u_1",
      providerId: "credential",
      accountId: "u_1",
      password: "hashed(temporal456)",
    });
  });

  it("usuario inexistente → not_found sin efectos", async () => {
    const result = await resetUserPassword(
      { ...RESET_INPUT, userId: "u_fantasma" },
      stubDb()
    );
    expect(result).toMatchObject({ ok: false, code: "not_found" });
    expect(hashMock).not.toHaveBeenCalled();
    expect(state.session).toHaveLength(3);
  });

  it("super admin AJENO → forbidden sin efectos (contrato admin-api.md)", async () => {
    state.user.push({
      id: "u_sa2",
      email: "otra@agencia.com",
      mustChangePassword: false,
    });
    state.session.push({ id: "s_sa2", userId: "u_sa2", token: "t4" });
    const result = await resetUserPassword(
      { ...RESET_INPUT, userId: "u_sa2" },
      stubDb()
    );
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
    expect(hashMock).not.toHaveBeenCalled();
    expect(updatePasswordMock).not.toHaveBeenCalled();
    expect(state.session).toHaveLength(4);
    expect(state.user[1]).toMatchObject({ mustChangePassword: false });
  });

  it("el propio super admin SÍ puede resetear su cuenta", async () => {
    state.user.push({ id: "u_sa", email: "duena@agencia.com" });
    const result = await resetUserPassword(
      { ...RESET_INPUT, userId: "u_sa", operatorEmail: "Duena@Agencia.com " },
      stubDb()
    );
    expect(result).toEqual({ ok: true });
    expect(updatePasswordMock).toHaveBeenCalledWith(
      "u_sa",
      "hashed(temporal456)"
    );
  });
});
