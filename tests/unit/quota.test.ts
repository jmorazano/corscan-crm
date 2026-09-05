import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FR-015 (research D4): el mutex FIFO por organización serializa la sección
 * crítica reserva-de-cupo. Estos tests prueban la PROPIEDAD del lock (orden,
 * aislamiento entre orgs, resiliencia a rechazos); la aritmética del cupo
 * (exención por contacto, ventana móvil, límite custom) se conduce en el
 * guion E2E us-cc-4 con límite 2 contra la BD real.
 */

vi.mock("@/lib/db", () => ({
  getDb: () => {
    throw new Error("los tests del lock no tocan la BD");
  },
  schema: {},
}));

import { withOrgSendLock } from "@/server/campaigns/quota";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  (globalThis as { __voceroSendLocks?: unknown }).__voceroSendLocks = undefined;
});

describe("withOrgSendLock", () => {
  it("serializa FIFO dentro de la misma org (nada de TOCTOU)", async () => {
    const order: string[] = [];
    const gate = deferred<void>();

    const first = withOrgSendLock("org_1", async () => {
      order.push("first:start");
      await gate.promise;
      order.push("first:end");
    });
    const second = withOrgSendLock("org_1", async () => {
      order.push("second");
    });

    // El segundo NO arranca hasta que el primero suelta.
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(["first:start"]);

    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("organizaciones distintas no se bloquean entre sí", async () => {
    const order: string[] = [];
    const gate = deferred<void>();

    const a = withOrgSendLock("org_a", async () => {
      await gate.promise;
      order.push("a");
    });
    const b = withOrgSendLock("org_b", async () => {
      order.push("b");
    });

    await b;
    expect(order).toEqual(["b"]); // b no esperó a a
    gate.resolve();
    await a;
    expect(order).toEqual(["b", "a"]);
  });

  it("un rechazo (QuotaError) no rompe la cadena: el siguiente corre igual", async () => {
    const ran: string[] = [];
    const failing = withOrgSendLock("org_1", async () => {
      throw new Error("cupo agotado");
    });
    const next = withOrgSendLock("org_1", async () => {
      ran.push("next");
      return "ok";
    });

    await expect(failing).rejects.toThrow("cupo agotado");
    await expect(next).resolves.toBe("ok");
    expect(ran).toEqual(["next"]);
  });

  it("propaga el valor de retorno del turno", async () => {
    await expect(
      withOrgSendLock("org_1", async () => 42)
    ).resolves.toBe(42);
  });
});
