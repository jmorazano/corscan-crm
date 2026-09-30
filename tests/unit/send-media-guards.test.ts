import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 026: las guardas del envío de adjuntos corren ANTES de escribir nada y
 * antes de tocar a Meta — mismo contrato que el texto (FR-031 de 001): el
 * Laboratorio y el Entrenador jamás llegan a un canal, y con la ventana
 * cerrada no se guarda un mensaje «fantasma».
 */

const uploadWhatsAppMedia = vi.fn();
const graphRequest = vi.fn();
const sendInstagramAttachment = vi.fn();
const transaction = vi.fn();
const getCredentialsByOrg = vi.fn();

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest, uploadWhatsAppMedia };
});
vi.mock("@/lib/instagram/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/instagram/client")>();
  return { ...original, sendInstagramAttachment };
});
vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg,
  markReconnectRequired: vi.fn(),
}));

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "leftJoin", "where", "orderBy"]) {
    chain[m] = () => chain;
  }
  chain.limit = () => Promise.resolve(rows);
  return chain;
}

const selectRows: unknown[][] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => makeChain(selectRows.shift() ?? []),
    transaction,
  }),
  schema: {
    conversation: { contactId: "contactId", id: "id", organizationId: "organizationId" },
    contact: { id: "id" },
    message: {},
    messageMedia: {},
  },
}));

const FILE = {
  bytes: Buffer.from("%PDF-1.4"),
  kind: "document" as const,
  mime: "application/pdf",
  fileName: "presupuesto.pdf",
};

function conv(over: Record<string, unknown>) {
  return {
    conversation: {
      id: "cv_1",
      organizationId: "org_1",
      kind: "whatsapp",
      isTest: false,
      lastInboundAt: new Date(),
      ...over,
    },
    contact: { id: "ct_1", phone: "5493511111111" },
  };
}

async function send() {
  const { sendMedia } = await import("@/server/inbox/send-media");
  return sendMedia({ organizationId: "org_1", conversationId: "cv_1", file: FILE, caption: "hola" });
}

describe("guardas del envío de adjuntos", () => {
  beforeEach(() => {
    uploadWhatsAppMedia.mockReset();
    graphRequest.mockReset();
    sendInstagramAttachment.mockReset();
    transaction.mockReset();
    getCredentialsByOrg.mockReset();
    selectRows.length = 0;
  });

  it("Laboratorio (is_test) → sandbox_violation sin guardar ni subir", async () => {
    selectRows.push([conv({ isTest: true })]);
    await expect(send()).rejects.toMatchObject({ code: "sandbox_violation" });
    expect(transaction).not.toHaveBeenCalled();
    expect(uploadWhatsAppMedia).not.toHaveBeenCalled();
  });

  it("Entrenador → sandbox_violation", async () => {
    selectRows.push([conv({ kind: "trainer" })]);
    await expect(send()).rejects.toMatchObject({ code: "sandbox_violation" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("WhatsApp con la ventana cerrada → window_closed sin guardar", async () => {
    selectRows.push([conv({ lastInboundAt: new Date(Date.now() - 25 * 3600 * 1000) })]);
    await expect(send()).rejects.toMatchObject({ code: "window_closed" });
    expect(transaction).not.toHaveBeenCalled();
    expect(getCredentialsByOrg).not.toHaveBeenCalled();
  });

  it("WhatsApp sin número conectado → not_connected sin guardar", async () => {
    selectRows.push([conv({})]);
    getCredentialsByOrg.mockResolvedValueOnce(null);
    await expect(send()).rejects.toMatchObject({ code: "not_connected" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("Instagram pasados los 7 días → window_closed sin guardar ni mandar", async () => {
    selectRows.push([
      conv({ kind: "instagram", lastInboundAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) }),
    ]);
    await expect(send()).rejects.toMatchObject({ code: "window_closed" });
    expect(transaction).not.toHaveBeenCalled();
    expect(sendInstagramAttachment).not.toHaveBeenCalled();
  });
});
