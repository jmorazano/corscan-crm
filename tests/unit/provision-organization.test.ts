import { beforeEach, describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { schema } from "@/lib/db";
import {
  provisionOrganization,
  slugify,
} from "@/server/admin/organizations";

/**
 * D3/D11: provisionOrganization es el único lugar que siembra empresas —
 * slug único con sufijo, seeds re-ejecutables y reuso de la org homónima
 * VACÍA que deja un crash entre org y usuario (idempotencia recuperable).
 * BD en memoria: interpreta los WHERE de igualdad que usa el módulo.
 */

type Row = Record<string, unknown>;

type State = {
  organization: Row[];
  member: Row[];
  pipelineStage: Row[];
  agentProfile: Row[];
};

let state: State;

const COLUMN_TO_KEY: Record<string, string> = {
  name: "name",
  slug: "slug",
  organization_id: "organizationId",
};

function tableKey(table: unknown): keyof State {
  if (table === schema.organization) return "organization";
  if (table === schema.member) return "member";
  if (table === schema.pipelineStage) return "pipelineStage";
  if (table === schema.agentProfile) return "agentProfile";
  throw new Error("tabla inesperada en el stub");
}

function makeStubDb() {
  return {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const { sql, params } = new PgDialect().sqlToQuery(cond as SQL);
          const column = sql.match(/"\w+"\."(\w+)"/)?.[1] ?? "";
          const key = COLUMN_TO_KEY[column];
          if (!key) throw new Error(`columna inesperada en WHERE: ${sql}`);
          const rows = state[tableKey(table)].filter(
            (r) => r[key] === params[0]
          );
          // el módulo solo usa count() bajo la clave `n`
          if (fields && "n" in fields) {
            return Promise.resolve([{ n: rows.length }]);
          }
          return Promise.resolve(rows);
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: Row | Row[]) => {
        const rows = Array.isArray(v) ? v : [v];
        state[tableKey(table)].push(...rows);
        return Promise.resolve();
      },
    }),
  };
}

type DbParam = Parameters<typeof provisionOrganization>[1];

beforeEach(() => {
  state = { organization: [], member: [], pipelineStage: [], agentProfile: [] };
});

describe("slugify (D11)", () => {
  it("normaliza acentos, minúsculas y separadores", () => {
    expect(slugify("Río Cuarto S.A.")).toBe("rio-cuarto-s-a");
    expect(slugify("  Masterbrand  ")).toBe("masterbrand");
  });

  it("nombre sin caracteres útiles → fallback", () => {
    expect(slugify("¡¡¡")).toBe("empresa");
  });
});

describe("provisionOrganization", () => {
  it("crea la org sembrada: slug del nombre + 5 etapas + perfil de agente", async () => {
    const db = makeStubDb() as unknown as DbParam;
    const result = await provisionOrganization({ name: "Masterbrand" }, db);
    expect(result.reused).toBe(false);
    expect(result.slug).toBe("masterbrand");
    expect(state.organization).toHaveLength(1);
    expect(state.pipelineStage).toHaveLength(5);
    expect(state.pipelineStage.map((s) => s.name)).toEqual([
      "Nuevo",
      "En conversación",
      "Interesado",
      "Cliente",
      "Perdido",
    ]);
    expect(state.agentProfile).toHaveLength(1);
    expect(
      state.pipelineStage.every(
        (s) => s.organizationId === result.organizationId
      )
    ).toBe(true);
  });

  it("respeta el slug preferido (instancia vacía → 'principal', D11)", async () => {
    const db = makeStubDb() as unknown as DbParam;
    const result = await provisionOrganization(
      { name: "Negocio de Juan", slug: "principal" },
      db
    );
    expect(result.slug).toBe("principal");
  });

  it("slug único: la colisión agrega sufijo numérico", async () => {
    state.organization.push({
      id: "org_prev",
      name: "Masterbrand Córdoba",
      slug: "masterbrand",
    });
    state.member.push({ id: "m1", organizationId: "org_prev", userId: "u1" });
    const db = makeStubDb() as unknown as DbParam;
    const result = await provisionOrganization({ name: "Masterbrand" }, db);
    expect(result.slug).toBe("masterbrand-2");
    expect(state.organization).toHaveLength(2);
  });

  it("reuso de huérfana: org homónima SIN miembros se recupera sin duplicar seeds", async () => {
    const db = makeStubDb() as unknown as DbParam;
    const first = await provisionOrganization({ name: "Masterbrand" }, db);
    // crash simulado: quedó la org sembrada pero sin usuario/membresía
    const retry = await provisionOrganization({ name: "Masterbrand" }, db);
    expect(retry.reused).toBe(true);
    expect(retry.organizationId).toBe(first.organizationId);
    expect(retry.slug).toBe(first.slug);
    expect(state.organization).toHaveLength(1);
    expect(state.pipelineStage).toHaveLength(5);
    expect(state.agentProfile).toHaveLength(1);
  });

  it("la huérfana a medio sembrar completa sus seeds al reusarse", async () => {
    state.organization.push({
      id: "org_huerfana",
      name: "Masterbrand",
      slug: "masterbrand",
    });
    const db = makeStubDb() as unknown as DbParam;
    const result = await provisionOrganization({ name: "Masterbrand" }, db);
    expect(result.reused).toBe(true);
    expect(result.organizationId).toBe("org_huerfana");
    expect(state.pipelineStage).toHaveLength(5);
    expect(state.agentProfile).toHaveLength(1);
  });

  it("la homónima CON miembros NO se reutiliza: nombre repetible, org nueva", async () => {
    const db = makeStubDb() as unknown as DbParam;
    const first = await provisionOrganization({ name: "Masterbrand" }, db);
    state.member.push({
      id: "m1",
      organizationId: first.organizationId,
      userId: "u1",
    });
    const second = await provisionOrganization({ name: "Masterbrand" }, db);
    expect(second.reused).toBe(false);
    expect(second.organizationId).not.toBe(first.organizationId);
    expect(second.slug).toBe("masterbrand-2");
    expect(state.organization).toHaveLength(2);
    // cada org con sus propias 5 etapas
    expect(state.pipelineStage).toHaveLength(10);
  });
});
