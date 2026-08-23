import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Borrado de conversaciones y contactos. Lo que se protege aquí:
 * (1) todo DELETE va filtrado por organización — un id de otra org devuelve
 *     "no existe" y no borra nada; y
 * (2) deleteContact devuelve los ids de las conversaciones del contacto para
 *     que la ruta pueda anunciar `conversation.deleted` por SSE.
 */

type WhereCall = { table: string; where: unknown };
const deleteCalls: WhereCall[] = [];

// Filas que el mock devuelve al "borrar"/consultar en el próximo llamado.
let deleteReturns: Record<string, unknown>[] = [];
let selectReturns: Record<string, unknown>[] = [];

vi.mock("@/lib/db", () => {
  const dbLike = {
    delete: (table: { __name: string }) => ({
      where: (where: unknown) => {
        deleteCalls.push({ table: table.__name, where });
        return {
          returning: () => Promise.resolve(deleteReturns),
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(selectReturns),
      }),
    }),
    // deleteContact corre dentro de una transacción: el tx expone la misma
    // superficie que el db.
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(dbLike),
  };
  return {
    getDb: () => dbLike,
    schema: {
      conversation: {
        __name: "conversation",
        id: "conversation.id",
        organizationId: "conversation.organization_id",
        contactId: "conversation.contact_id",
      },
      contact: {
        __name: "contact",
        id: "contact.id",
        organizationId: "contact.organization_id",
      },
    },
  };
});

beforeEach(() => {
  vi.resetModules();
  deleteCalls.length = 0;
  deleteReturns = [];
  selectReturns = [];
});

describe("deleteConversation", () => {
  it("devuelve true cuando la conversación existía en la organización", async () => {
    deleteReturns = [{ id: "cv_1" }];
    const { deleteConversation } = await import("@/server/inbox/queries");
    await expect(deleteConversation("org_1", "cv_1")).resolves.toBe(true);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]?.table).toBe("conversation");
  });

  it("devuelve false cuando el filtro por organización no encuentra nada", async () => {
    deleteReturns = []; // otra org, o id inexistente: el WHERE no matchea
    const { deleteConversation } = await import("@/server/inbox/queries");
    await expect(deleteConversation("org_2", "cv_1")).resolves.toBe(false);
  });

  it("el WHERE incluye la organización (multi-tenancy, Constitución III)", async () => {
    deleteReturns = [{ id: "cv_1" }];
    const { deleteConversation } = await import("@/server/inbox/queries");
    await deleteConversation("org_1", "cv_1");
    // El builder real produce un árbol de condiciones; el mock conserva el
    // objeto tal cual. Basta verificar que ambas columnas participan.
    const serialized = JSON.stringify(deleteCalls[0]?.where);
    expect(serialized).toContain("organization_id");
    expect(serialized).toContain("conversation.id");
  });
});

describe("deleteContact", () => {
  it("devuelve los ids de conversaciones del contacto para el anuncio SSE", async () => {
    selectReturns = [{ id: "cv_a" }, { id: "cv_b" }];
    deleteReturns = [{ id: "ct_1" }];
    const { deleteContact } = await import("@/server/contacts");
    const result = await deleteContact("org_1", "ct_1");
    expect(result).toEqual({ conversationIds: ["cv_a", "cv_b"] });
    expect(deleteCalls.map((c) => c.table)).toEqual(["contact"]);
  });

  it("devuelve null si el contacto no existe en la organización", async () => {
    selectReturns = [];
    deleteReturns = [];
    const { deleteContact } = await import("@/server/contacts");
    await expect(deleteContact("org_1", "ct_ajena")).resolves.toBeNull();
  });

  it("un contacto sin conversaciones borra igual y devuelve lista vacía", async () => {
    selectReturns = [];
    deleteReturns = [{ id: "ct_1" }];
    const { deleteContact } = await import("@/server/contacts");
    await expect(deleteContact("org_1", "ct_1")).resolves.toEqual({
      conversationIds: [],
    });
  });
});
