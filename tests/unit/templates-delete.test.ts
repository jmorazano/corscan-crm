import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Borrado de plantillas. Lo que se protege aquí:
 * (1) el SELECT y el DELETE van filtrados por organización;
 * (2) con campañas activas asociadas se rechaza (409 in_use) SIN llamar a
 *     Meta (las terminadas no bloquean: FK set null + snapshot del nombre);
 * (3) en Meta se borra acotado por hsm_id + name; y
 * (4) si Meta ya no la tiene (404) se limpia localmente igual.
 */

const graphCalls: { path: string; method?: string }[] = [];
let graphImpl: () => Promise<unknown> = () => Promise.resolve({ success: true });
let selectRows: Record<string, unknown>[] = [];
let campaignCount = 0;
const deleteCalls: unknown[] = [];
const whereArgs: unknown[] = [];

vi.mock("@/lib/meta/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/meta/client")>(
    "@/lib/meta/client"
  );
  return {
    ...actual,
    graphRequest: (path: string, opts: { method?: string }) => {
      graphCalls.push({ path, method: opts.method });
      return graphImpl();
    },
  };
});

vi.mock("@/lib/db/tenant", () => ({
  scoped: (...args: unknown[]) => {
    whereArgs.push(args);
    return { __scoped: args };
  },
}));

vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: () =>
    Promise.resolve({ wabaId: "waba_1", token: "tok", status: "connected" }),
  getCredentialsListByWabaId: () => Promise.resolve([]),
  markReconnectRequired: () => Promise.resolve(),
}));

vi.mock("@/lib/db", () => {
  const db = {
    select: (proj?: unknown) => ({
      from: (table: { __name: string }) => ({
        where: () => {
          if (table.__name === "campaign") {
            return Promise.resolve([{ n: campaignCount }]);
          }
          const chain = Promise.resolve(selectRows) as Promise<unknown> & {
            limit: () => Promise<unknown>;
          };
          chain.limit = () => Promise.resolve(selectRows);
          void proj;
          return chain;
        },
      }),
    }),
    delete: (table: { __name: string }) => ({
      where: (where: unknown) => {
        deleteCalls.push({ table: table.__name, where });
        return Promise.resolve();
      },
    }),
  };
  return {
    getDb: () => db,
    schema: {
      template: {
        __name: "template",
        id: "template.id",
        organizationId: "template.organization_id",
      },
      campaign: {
        __name: "campaign",
        organizationId: "campaign.organization_id",
        templateId: "campaign.template_id",
      },
    },
  };
});

const row = {
  id: "tpl_1",
  organizationId: "org_1",
  name: "seguimiento",
  language: "es_AR",
  waTemplateId: "123",
  status: "approved",
};

beforeEach(() => {
  vi.resetModules();
  graphCalls.length = 0;
  deleteCalls.length = 0;
  whereArgs.length = 0;
  graphImpl = () => Promise.resolve({ success: true });
  selectRows = [row];
  campaignCount = 0;
});

describe("deleteTemplate", () => {
  it("borra en Meta acotado por hsm_id + name y luego localmente (scoped)", async () => {
    const { deleteTemplate } = await import("@/server/whatsapp/templates");
    const deleted = await deleteTemplate("org_1", "tpl_1");
    expect(deleted.id).toBe("tpl_1");
    expect(graphCalls).toEqual([
      { path: "waba_1/message_templates?name=seguimiento&hsm_id=123", method: "DELETE" },
    ]);
    expect(deleteCalls).toHaveLength(1);
    // Toda query (select + delete) va acotada a la organización.
    for (const args of whereArgs) {
      expect((args as unknown[])[1]).toBe("org_1");
    }
  });

  it("plantilla de otra org (o inexistente) → not_found sin tocar Meta", async () => {
    selectRows = [];
    const { deleteTemplate } = await import("@/server/whatsapp/templates");
    await expect(deleteTemplate("org_2", "tpl_1")).rejects.toMatchObject({
      code: "not_found",
    });
    expect(graphCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });

  it("con campañas ACTIVAS asociadas → in_use (409) sin llamar a Meta ni borrar", async () => {
    campaignCount = 2;
    const { deleteTemplate, templateErrorStatus, TemplateError } = await import(
      "@/server/whatsapp/templates"
    );
    const err = await deleteTemplate("org_1", "tpl_1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect((err as InstanceType<typeof TemplateError>).code).toBe("in_use");
    expect(templateErrorStatus(err as InstanceType<typeof TemplateError>)).toBe(409);
    expect(graphCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });

  it("Meta responde 404 (ya no existe) → se limpia localmente igual", async () => {
    const { MetaApiError } = await import("@/lib/meta/client");
    graphImpl = () =>
      Promise.reject(
        new MetaApiError("Template name does not exist", { status: 404, code: 100 })
      );
    const { deleteTemplate } = await import("@/server/whatsapp/templates");
    await deleteTemplate("org_1", "tpl_1");
    expect(deleteCalls).toHaveLength(1);
  });

  it("Meta caída (5xx) → meta_unavailable y NO se borra localmente", async () => {
    const { MetaApiError } = await import("@/lib/meta/client");
    graphImpl = () => Promise.reject(new MetaApiError("boom", { status: 503 }));
    const { deleteTemplate } = await import("@/server/whatsapp/templates");
    await expect(deleteTemplate("org_1", "tpl_1")).rejects.toMatchObject({
      code: "meta_unavailable",
    });
    expect(deleteCalls).toHaveLength(0);
  });

  it("sin id remoto → borra por name (todos los idiomas, como Meta)", async () => {
    selectRows = [{ ...row, waTemplateId: null }];
    const { deleteTemplate } = await import("@/server/whatsapp/templates");
    await deleteTemplate("org_1", "tpl_1");
    expect(graphCalls[0]?.path).toBe("waba_1/message_templates?name=seguimiento");
  });
});
