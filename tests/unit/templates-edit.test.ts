import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Edición de plantillas (052). Lo que se protege:
 * (1) Meta-primero: `POST /{wa_template_id}` con TODOS los componentes y,
 *     recién después, la fila local (si Meta falla, nada cambia);
 * (2) la imagen que se conserva vuelve a subir como ejemplo;
 * (3) la categoría de una aprobada no viaja ni se cambia;
 * (4) topes, en revisión, sin cambios y campañas cortan ANTES de Meta;
 * (5) el estado guardado es el que informa Meta después de la edición.
 */

type GraphCall = { path: string; method?: string; body?: unknown };
const graphCalls: GraphCall[] = [];
const uploads: { mime: string; size: number }[] = [];
let editImpl: () => Promise<unknown> = () => Promise.resolve({ success: true });
let statusImpl: () => Promise<unknown> = () => Promise.resolve({ status: "PENDING" });
let templateRow: Record<string, unknown>;
let media: { id: string; mime: string; bytes: Buffer } | null;
let campaigns: { id: string; name: string; status: string }[];
const updates: Record<string, unknown>[] = [];
const mediaOps: string[] = [];
const scopedOrgs: unknown[] = [];

vi.mock("@/lib/env", () => ({ getEnv: () => ({ META_APP_ID: "app_1" }) }));

vi.mock("@/lib/meta/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/meta/client")>(
    "@/lib/meta/client"
  );
  return {
    ...actual,
    uploadResumable: (input: { mime: string; bytes: Buffer }) => {
      uploads.push({ mime: input.mime, size: input.bytes.byteLength });
      return Promise.resolve("HANDLE_1");
    },
    graphRequest: (path: string, opts: { method?: string; body?: unknown }) => {
      graphCalls.push({ path, method: opts.method, body: opts.body });
      if ((opts.method ?? "GET") === "POST") return editImpl();
      return statusImpl();
    },
  };
});

vi.mock("@/lib/db/tenant", () => ({
  scoped: (...args: unknown[]) => {
    scopedOrgs.push(args[1]);
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
  const limitable = (rows: () => unknown[]) => {
    const p = Promise.resolve().then(rows) as Promise<unknown> & {
      limit: () => Promise<unknown>;
    };
    p.limit = () => Promise.resolve(rows());
    return p;
  };
  const tx = {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            updates.push(values);
            return Promise.resolve([{ ...templateRow, ...values }]);
          },
        }),
      }),
    }),
    delete: () => ({
      where: () => {
        mediaOps.push("delete");
        return Promise.resolve();
      },
    }),
    insert: () => ({
      values: (v: { mime: string }) => {
        mediaOps.push(`insert:${v.mime}`);
        return Promise.resolve();
      },
    }),
  };
  const db = {
    select: () => ({
      from: (table: { __name: string }) => ({
        leftJoin: () => ({
          where: () =>
            limitable(() => [
              {
                template: templateRow,
                mediaId: media?.id ?? null,
                mediaMime: media?.mime ?? null,
                mediaBytes: media?.bytes ?? null,
              },
            ]),
        }),
        where: () => limitable(() => (table.__name === "campaign" ? campaigns : [])),
      }),
    }),
    transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  return {
    getDb: () => db,
    schema: {
      template: { __name: "template", id: "t.id", organizationId: "t.org" },
      templateMedia: { __name: "template_media", id: "tm.id", templateId: "tm.tpl" },
      campaign: { __name: "campaign", organizationId: "c.org", templateId: "c.tpl", status: "c.status" },
    },
  };
});

const NOW = new Date("2026-11-12T15:00:00.000Z");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

beforeEach(() => {
  vi.resetModules();
  graphCalls.length = 0;
  uploads.length = 0;
  updates.length = 0;
  mediaOps.length = 0;
  scopedOrgs.length = 0;
  editImpl = () => Promise.resolve({ success: true });
  statusImpl = () => Promise.resolve({ status: "PENDING" });
  campaigns = [];
  media = null;
  templateRow = {
    id: "tpl_1",
    organizationId: "org_1",
    name: "seguimiento",
    language: "es_AR",
    category: "UTILITY",
    body: "Hola {{1}}, ¿seguimos?",
    status: "approved",
    rejectionReason: null,
    waTemplateId: "123",
    variableBindings: ["contact_name"],
    approvedEdits: [],
  };
});

async function edit(input: Partial<Parameters<typeof import("@/server/whatsapp/templates")["editTemplate"]>[2]> = {}) {
  const { editTemplate } = await import("@/server/whatsapp/templates");
  return editTemplate(
    "org_1",
    "tpl_1",
    {
      category: "UTILITY",
      body: "Hola {{1}}, ¿retomamos tu cotización?",
      variables: ["contact_name"],
      header: { mode: "keep" },
      ...input,
    },
    NOW
  );
}

describe("editTemplate", () => {
  it("aprobada: manda TODOS los componentes sin categoría, guarda el estado de Meta y suma la edición", async () => {
    const { row } = await edit();
    expect(graphCalls[0]).toMatchObject({ path: "123", method: "POST" });
    const body = graphCalls[0]!.body as { category?: string; components: unknown[] };
    expect(body.category).toBeUndefined();
    expect(body.components).toEqual([
      {
        type: "BODY",
        text: "Hola {{1}}, ¿retomamos tu cotización?",
        example: { body_text: [expect.any(Array)] },
      },
    ]);
    expect(graphCalls[1]).toMatchObject({ path: "123?fields=status,rejected_reason" });
    expect(row.status).toBe("pending");
    expect(updates[0]!.approvedEdits).toEqual([NOW.toISOString()]);
    expect(scopedOrgs.every((o) => o === "org_1")).toBe(true);
  });

  it("conservar la imagen: vuelve a subir la guardada y no toca template_media", async () => {
    media = { id: "tm_1", mime: "image/jpeg", bytes: JPEG };
    const { headerMediaId } = await edit();
    expect(uploads).toEqual([{ mime: "image/jpeg", size: JPEG.byteLength }]);
    const body = graphCalls[0]!.body as { components: { type: string }[] };
    expect(body.components[0]).toEqual({
      type: "HEADER",
      format: "IMAGE",
      example: { header_handle: ["HANDLE_1"] },
    });
    expect(mediaOps).toEqual([]);
    expect(headerMediaId).toBe("tm_1");
  });

  it("quitar la imagen: sin HEADER y se borra el binario", async () => {
    media = { id: "tm_1", mime: "image/jpeg", bytes: JPEG };
    const { headerMediaId } = await edit({ header: { mode: "remove" } });
    expect(uploads).toEqual([]);
    const body = graphCalls[0]!.body as { components: { type: string }[] };
    expect(body.components.map((c) => c.type)).toEqual(["BODY"]);
    expect(mediaOps).toEqual(["delete"]);
    expect(headerMediaId).toBeNull();
  });

  it("reemplazar la imagen: sube la nueva y la guarda con id nuevo", async () => {
    media = { id: "tm_1", mime: "image/jpeg", bytes: JPEG };
    const { headerMediaId } = await edit({
      body: "Hola {{1}}, ¿seguimos?",
      header: { mode: "replace", image: { bytes: JPEG, mime: "image/jpeg" } },
    });
    expect(uploads).toHaveLength(1);
    expect(mediaOps).toEqual(["delete", "insert:image/jpeg"]);
    expect(headerMediaId).not.toBe("tm_1");
  });

  it("rechazada: la categoría viaja y puede cambiar; no suma ediciones de aprobada", async () => {
    templateRow.status = "rejected";
    statusImpl = () => Promise.resolve({ status: "REJECTED", rejected_reason: "INVALID_FORMAT" });
    const { row } = await edit({ category: "MARKETING" });
    expect((graphCalls[0]!.body as { category?: string }).category).toBe("MARKETING");
    expect(row.status).toBe("rejected");
    expect(row.rejectionReason).toBe("INVALID_FORMAT");
    expect(updates[0]!.approvedEdits).toEqual([]);
  });

  it("aprobada con otra categoría → invalid sin tocar Meta", async () => {
    await expect(edit({ category: "MARKETING" })).rejects.toMatchObject({ code: "invalid" });
    expect(graphCalls).toEqual([]);
  });

  it("editada hace 2 h → not_editable con nextEditAt, sin tocar Meta", async () => {
    templateRow.approvedEdits = [new Date(NOW.getTime() - 2 * 3600_000).toISOString()];
    await expect(edit()).rejects.toMatchObject({
      code: "not_editable",
      extra: { reason: "daily_limit", nextEditAt: expect.any(String) },
    });
    expect(graphCalls).toEqual([]);
  });

  it("en revisión → not_editable", async () => {
    templateRow.status = "pending";
    await expect(edit()).rejects.toMatchObject({ code: "not_editable" });
    expect(graphCalls).toEqual([]);
  });

  it("sin cambios → invalid (no gasta la edición del día)", async () => {
    await expect(edit({ body: "Hola {{1}}, ¿seguimos?" })).rejects.toMatchObject({
      code: "invalid",
      message: "No cambiaste nada",
    });
    expect(graphCalls).toEqual([]);
  });

  it("campaña en curso → in_use con la campaña; borrador con las mismas variables pasa", async () => {
    campaigns = [{ id: "cmp_1", name: "Noviembre", status: "running" }];
    await expect(edit()).rejects.toMatchObject({
      code: "in_use",
      extra: { campaigns: [{ id: "cmp_1", name: "Noviembre", status: "running" }] },
    });
    expect(graphCalls).toEqual([]);

    campaigns = [{ id: "cmp_2", name: "Borrador", status: "draft" }];
    await expect(edit()).resolves.toBeTruthy();
  });

  it("borrador y cambian las variables → in_use", async () => {
    campaigns = [{ id: "cmp_2", name: "Borrador", status: "draft" }];
    await expect(
      edit({ body: "Hola {{1}}, tu código es {{2}}", variables: ["contact_name", "free_text"] })
    ).rejects.toMatchObject({ code: "in_use" });
  });

  it("Meta rechaza la edición → meta_error y la fila local queda intacta", async () => {
    const { MetaApiError } = await import("@/lib/meta/client");
    editImpl = () =>
      Promise.reject(
        new MetaApiError(
          "Message template has reached the maximum number of edits allowed",
          { status: 400, code: 100, type: "OAuthException" }
        )
      );
    await expect(edit()).rejects.toMatchObject({ code: "meta_error" });
    expect(updates).toEqual([]);
  });

  it("si no se puede leer el estado después, queda pendiente", async () => {
    statusImpl = () => Promise.reject(new Error("timeout"));
    const { row } = await edit();
    expect(row.status).toBe("pending");
  });

  it("sin id de Meta → invalid pidiendo Sincronizar", async () => {
    templateRow.waTemplateId = null;
    await expect(edit()).rejects.toMatchObject({ code: "invalid" });
    expect(graphCalls).toEqual([]);
  });
});
