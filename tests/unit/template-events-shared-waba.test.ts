import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * US2: `message_template_status_update` llega a nivel WABA y una WABA puede
 * estar conectada por VARIAS organizaciones (waba_id no es único). El evento
 * debe aplicarse en CADA una de esas orgs (en Meta, (waba, name, language)
 * identifica una sola plantilla) — jamás en "una arbitraria" — y el
 * message_template_id del evento no debe pisar filas que apuntan a OTRO id
 * (plantilla recreada).
 */

const credsListMock = vi.fn();

vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsListByWabaId: (...args: unknown[]) => credsListMock(...args),
  getCredentialsByOrg: () => Promise.resolve(null),
  markReconnectRequired: () => Promise.resolve(),
}));

type CapturedUpdate = { set: Record<string, unknown>; where: unknown };
const updates: CapturedUpdate[] = [];

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          where: (where: unknown) => {
            updates.push({ set, where });
            return Promise.resolve();
          },
        }),
      }),
    }),
  };
});

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});

beforeEach(() => {
  credsListMock.mockReset();
  updates.length = 0;
});

function renderWhere(u: CapturedUpdate) {
  return new PgDialect().sqlToQuery(u.where as SQL);
}

describe("applyTemplateStatusEvent con WABA compartida (US2)", () => {
  it("dos orgs en la misma WABA → el update corre scoped en CADA org", async () => {
    credsListMock.mockResolvedValue([
      { organizationId: "org_a" },
      { organizationId: "org_b" },
    ]);
    const { applyTemplateStatusEvent } = await import(
      "@/server/whatsapp/templates"
    );
    await applyTemplateStatusEvent("waba_compartida", {
      event: "APPROVED",
      message_template_name: "recordatorio",
      message_template_language: "es",
      message_template_id: 987654,
    });

    expect(credsListMock).toHaveBeenCalledWith("waba_compartida");
    expect(updates).toHaveLength(2);
    const [a, b] = updates.map(renderWhere);
    // cada update lleva SU organización + name + language en el WHERE
    expect(a!.sql).toContain("organization_id");
    expect(a!.params).toContain("org_a");
    expect(b!.params).toContain("org_b");
    for (const q of [a!, b!]) {
      expect(q.params).toContain("recordatorio");
      expect(q.params).toContain("es");
      // el id del evento desambigua: solo filas con id nulo o IGUAL
      expect(q.sql).toContain("wa_template_id");
      expect(q.sql.toLowerCase()).toContain("is null");
      expect(q.params).toContain("987654");
    }
    // backfill del id remoto + estado aprobado
    expect(updates[0]!.set.status).toBe("approved");
    expect(updates[0]!.set.waTemplateId).toBe("987654");
  });

  it("sin message_template_id → matchea por (org, name, language) sin condición de id", async () => {
    credsListMock.mockResolvedValue([{ organizationId: "org_a" }]);
    const { applyTemplateStatusEvent } = await import(
      "@/server/whatsapp/templates"
    );
    await applyTemplateStatusEvent("waba_1", {
      event: "REJECTED",
      message_template_name: "promo",
      message_template_language: "es",
      reason: "INVALID_FORMAT",
    });
    expect(updates).toHaveLength(1);
    const q = renderWhere(updates[0]!);
    expect(q.params).toEqual(["org_a", "promo", "es"]);
    expect(updates[0]!.set.status).toBe("rejected");
    expect(updates[0]!.set.rejectionReason).toBe("INVALID_FORMAT");
    expect(updates[0]!.set.waTemplateId).toBeUndefined();
  });

  it("WABA sin credenciales → sin efectos", async () => {
    credsListMock.mockResolvedValue([]);
    const { applyTemplateStatusEvent } = await import(
      "@/server/whatsapp/templates"
    );
    await applyTemplateStatusEvent("waba_desconocida", {
      event: "APPROVED",
      message_template_name: "x",
      message_template_language: "es",
    });
    expect(updates).toHaveLength(0);
  });
});
