import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { schema } from "@/lib/db";
import {
  createOrganizationWithAdmin,
  listOrganizations,
} from "@/server/admin/organizations";

/**
 * US1/contrato admin-api.md: creación de empresa + admin inicial con orden
 * validar email → org → usuario, rollback compensatorio de la org creada en
 * la request, reuso de huérfana, 409 duplicate_email y 403 reserved_email
 * (FR-016); listado de plataforma con miembros y estados. BD en memoria que
 * interpreta los WHERE de igualdad del módulo.
 */

type Row = Record<string, unknown>;

type State = {
  organization: Row[];
  member: Row[];
  user: Row[];
  pipelineStage: Row[];
  agentProfile: Row[];
  metaCredentials: Row[];
};

let state: State;

const signUpEmailMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { signUpEmail: signUpEmailMock } }),
  runInternalSignup: <T,>(fn: () => Promise<T>) => fn(),
}));

const COLUMN_TO_KEY: Record<string, string> = {
  id: "id",
  name: "name",
  slug: "slug",
  email: "email",
  organization_id: "organizationId",
  user_id: "userId",
};

function tableKey(table: unknown): keyof State {
  if (table === schema.organization) return "organization";
  if (table === schema.member) return "member";
  if (table === schema.user) return "user";
  if (table === schema.pipelineStage) return "pipelineStage";
  if (table === schema.agentProfile) return "agentProfile";
  if (table === schema.metaCredentials) return "metaCredentials";
  throw new Error("tabla inesperada en el stub");
}

function parseWhere(cond: unknown): { key: string; value: unknown } {
  const { sql, params } = new PgDialect().sqlToQuery(cond as SQL);
  const column = sql.match(/"\w+"\."(\w+)"/)?.[1] ?? "";
  const key = COLUMN_TO_KEY[column];
  if (!key) throw new Error(`columna inesperada en WHERE: ${sql}`);
  return { key, value: params[0] };
}

function makeQuery(table: unknown, fields?: Record<string, unknown>) {
  const ctx: { where: unknown; joined: boolean } = {
    where: null,
    joined: false,
  };
  const run = (): Row[] => {
    let rows: Row[];
    if (ctx.joined) {
      // Único join del módulo: member ⋈ user (listado de miembros).
      rows = state.member.map((m) => {
        const u = state.user.find((x) => x.id === m.userId);
        return {
          organizationId: m.organizationId,
          userId: m.userId,
          role: m.role,
          name: u?.name,
          email: u?.email,
        };
      });
    } else {
      rows = [...state[tableKey(table)]];
      if (ctx.where) {
        const { key, value } = parseWhere(ctx.where);
        rows = rows.filter((r) => r[key] === value);
      }
    }
    if (fields && "n" in fields) return [{ n: rows.length }];
    return rows;
  };
  const query = {
    where(cond: unknown) {
      ctx.where = cond;
      return query;
    },
    innerJoin() {
      ctx.joined = true;
      return query;
    },
    orderBy() {
      return query;
    },
    then(
      resolve: (rows: Row[]) => unknown,
      reject?: (err: unknown) => unknown
    ) {
      return Promise.resolve().then(run).then(resolve, reject);
    },
  };
  return query;
}

function makeStubDb() {
  return {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: unknown) => makeQuery(table, fields),
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

type DbParam = NonNullable<Parameters<typeof createOrganizationWithAdmin>[1]>;

function stubDb(): DbParam {
  return makeStubDb() as unknown as DbParam;
}

const INPUT = {
  organizationName: "Masterbrand",
  admin: { name: "Socio", email: "socio@empresa.com", password: "temporal123" },
};

beforeEach(() => {
  state = {
    organization: [],
    member: [],
    user: [],
    pipelineStage: [],
    agentProfile: [],
    metaCredentials: [],
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
  vi.stubEnv("SUPER_ADMIN_EMAILS", "duena@agencia.com");
});

afterEach(() => vi.unstubAllEnvs());

describe("createOrganizationWithAdmin", () => {
  it("feliz: org sembrada + usuario con must_change_password + membresía owner", async () => {
    const result = await createOrganizationWithAdmin(INPUT, stubDb());
    expect(result).toEqual({
      ok: true,
      organizationId: expect.stringMatching(/^org_/),
      slug: "masterbrand",
    });
    expect(state.organization).toHaveLength(1);
    expect(state.pipelineStage).toHaveLength(5);
    expect(state.agentProfile).toHaveLength(1);
    expect(state.member[0]).toMatchObject({
      userId: "u_nuevo",
      role: "owner",
    });
    if (!result.ok) throw new Error("inalcanzable");
    expect(state.member[0]?.organizationId).toBe(result.organizationId);
    expect(state.user[0]).toMatchObject({ mustChangePassword: true });
  });

  it("normaliza el email a minúsculas antes del alta", async () => {
    const result = await createOrganizationWithAdmin(
      { ...INPUT, admin: { ...INPUT.admin, email: " SOCIO@Empresa.com " } },
      stubDb()
    );
    expect(result.ok).toBe(true);
    expect(signUpEmailMock).toHaveBeenCalledWith({
      body: expect.objectContaining({ email: "socio@empresa.com" }),
    });
  });

  it("email duplicado (pre-chequeo) → duplicate_email sin efectos", async () => {
    state.user.push({ id: "u_prev", email: "socio@empresa.com" });
    const result = await createOrganizationWithAdmin(INPUT, stubDb());
    expect(result).toMatchObject({ ok: false, code: "duplicate_email" });
    expect(state.organization).toHaveLength(0);
    expect(signUpEmailMock).not.toHaveBeenCalled();
  });

  it("email reservado (FR-016) → reserved_email sin efectos", async () => {
    const result = await createOrganizationWithAdmin(
      { ...INPUT, admin: { ...INPUT.admin, email: "Duena@Agencia.com" } },
      stubDb()
    );
    expect(result).toMatchObject({ ok: false, code: "reserved_email" });
    expect(state.organization).toHaveLength(0);
    expect(signUpEmailMock).not.toHaveBeenCalled();
  });

  it("fallo del signup → rollback compensatorio de la org creada en la request", async () => {
    signUpEmailMock.mockRejectedValue(new Error("boom"));
    const result = await createOrganizationWithAdmin(INPUT, stubDb());
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(state.organization).toHaveLength(0);
    expect(state.member).toHaveLength(0);
  });

  it("carrera de duplicado en el signup (UNIQUE manda) → duplicate_email + rollback", async () => {
    signUpEmailMock.mockRejectedValue(new Error("User already exists"));
    const result = await createOrganizationWithAdmin(INPUT, stubDb());
    expect(result).toMatchObject({ ok: false, code: "duplicate_email" });
    expect(state.organization).toHaveLength(0);
  });

  it("reintento post-crash: la huérfana homónima se reutiliza", async () => {
    state.organization.push({
      id: "org_huerfana",
      name: "Masterbrand",
      slug: "masterbrand",
    });
    const result = await createOrganizationWithAdmin(INPUT, stubDb());
    expect(result).toEqual({
      ok: true,
      organizationId: "org_huerfana",
      slug: "masterbrand",
    });
    expect(state.organization).toHaveLength(1);
  });

  it("la huérfana reusada NO se borra si el signup falla (sigue recuperable)", async () => {
    state.organization.push({
      id: "org_huerfana",
      name: "Masterbrand",
      slug: "masterbrand",
    });
    signUpEmailMock.mockRejectedValue(new Error("boom"));
    const result = await createOrganizationWithAdmin(INPUT, stubDb());
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(state.organization).toHaveLength(1);
  });
});

describe("listOrganizations", () => {
  it("empresas con miembros y estados; aiConfigured false hasta US3", async () => {
    state.organization.push(
      {
        id: "org_a",
        name: "Corscan",
        slug: "principal",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        id: "org_b",
        name: "Masterbrand",
        slug: "masterbrand",
        createdAt: new Date("2026-02-01T00:00:00Z"),
      }
    );
    state.user.push({ id: "u_1", name: "Juan", email: "juan@corscan.com" });
    state.member.push({
      id: "m_1",
      organizationId: "org_a",
      userId: "u_1",
      role: "owner",
    });
    state.metaCredentials.push(
      { organizationId: "org_a", status: "connected" },
      // Reconexión pendiente NO cuenta como conectado.
      { organizationId: "org_b", status: "reconnect_required" }
    );

    const orgs = await listOrganizations(stubDb());
    expect(orgs).toEqual([
      {
        id: "org_a",
        name: "Corscan",
        slug: "principal",
        createdAt: "2026-01-01T00:00:00.000Z",
        whatsappConnected: true,
        aiConfigured: false,
        members: [
          {
            userId: "u_1",
            name: "Juan",
            email: "juan@corscan.com",
            role: "owner",
          },
        ],
      },
      {
        id: "org_b",
        name: "Masterbrand",
        slug: "masterbrand",
        createdAt: "2026-02-01T00:00:00.000Z",
        whatsappConnected: false,
        aiConfigured: false,
        members: [],
      },
    ]);
  });
});
