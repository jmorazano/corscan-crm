import { describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * US2: la marca sin organización (login, visitantes anónimos) es la NEUTRA de
 * la instancia — jamás la de "una organización cualquiera" (el viejo
 * `limit 1` sin ORDER BY filtraba nombre y color de un tenant hacia otros
 * tenants y hacia no autenticados). Con organización, la query va por id.
 */

const capturedWheres: unknown[] = [];
let dbTouched = false;

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => {
      dbTouched = true;
      return {
        select: () => ({
          from: () => ({
            where: (cond: unknown) => {
              capturedWheres.push(cond);
              return {
                limit: () =>
                  Promise.resolve([
                    {
                      metadata: JSON.stringify({
                        branding: { name: "Corscan", accent: "#3f6b66" },
                      }),
                    },
                  ]),
              };
            },
          }),
        }),
      };
    },
  };
});

import { DEFAULT_BRANDING } from "@/lib/branding";
import { getBranding } from "@/server/branding";

describe("getBranding multi-tenant (US2)", () => {
  it("sin organizationId → marca neutra SIN tocar la base", async () => {
    dbTouched = false;
    expect(await getBranding()).toEqual(DEFAULT_BRANDING);
    expect(await getBranding(null)).toEqual(DEFAULT_BRANDING);
    expect(dbTouched).toBe(false);
  });

  it("con organizationId → query por id de ESA organización", async () => {
    capturedWheres.length = 0;
    const branding = await getBranding("org_corscan");
    expect(branding).toEqual({ name: "Corscan", accent: "#3f6b66" });
    const query = new PgDialect().sqlToQuery(capturedWheres[0] as SQL);
    expect(query.sql).toContain("id");
    expect(query.params).toContain("org_corscan");
  });
});
