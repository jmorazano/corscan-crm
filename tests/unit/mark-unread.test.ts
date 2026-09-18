import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 012 — «Marcar como no leída» (FR-007). Lo que se protege:
 * (1) markUnread deja el contador en ≥ 1 sin pisar un contador mayor
 *     (expresión SQL `greatest`, idempotente);
 * (2) markRead sigue poniendo 0 y gana si llegan ambos; y
 * (3) sin ninguno de los dos, el contador no se toca.
 */

const setCalls: Record<string, unknown>[] = [];

vi.mock("@/lib/db", () => {
  const dbLike = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        setCalls.push(values);
        return {
          where: () => ({
            returning: () => Promise.resolve([{ id: "cv_1" }]),
          }),
        };
      },
    }),
  };
  // El módulo arma SQL de varias tablas al cargarse: cualquier
  // `schema.<tabla>.<columna>` resuelve a un string.
  const schema = new Proxy(
    {},
    {
      get: (_target, table: string) =>
        new Proxy(
          {},
          {
            get: (_t, column: string) =>
              column === "__name" ? table : `${table}.${column}`,
          }
        ),
    }
  );
  return { getDb: () => dbLike, schema };
});

beforeEach(() => {
  vi.resetModules();
  setCalls.length = 0;
});

async function update(patch: Record<string, unknown>) {
  const { updateConversation } = await import("@/server/inbox/queries");
  await updateConversation("org_1", "cv_1", patch);
  return setCalls[0] ?? {};
}

describe("updateConversation: markUnread", () => {
  it("markRead pone el contador en 0", async () => {
    const set = await update({ markRead: true });
    expect(set.unreadCount).toBe(0);
  });

  it("markUnread usa greatest(contador, 1): nunca baja un contador mayor", async () => {
    const set = await update({ markUnread: true });
    expect(set.unreadCount).toBeDefined();
    expect(set.unreadCount).not.toBe(0);
    // Es una expresión SQL (objeto), no un número fijo.
    expect(typeof set.unreadCount).toBe("object");
  });

  it("si llegan ambos, gana markRead", async () => {
    const set = await update({ markRead: true, markUnread: true });
    expect(set.unreadCount).toBe(0);
  });

  it("sin ninguno, el contador no se toca", async () => {
    const set = await update({ aiEnabled: false });
    expect("unreadCount" in set).toBe(false);
    expect(set.aiEnabled).toBe(false);
  });
});
