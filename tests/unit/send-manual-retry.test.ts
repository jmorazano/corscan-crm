import { beforeEach, describe, expect, it, vi } from "vitest";
import { MetaApiError } from "@/lib/meta/client";
import { metaFailureSummary } from "@/lib/meta-errors";

/**
 * Envío manual desde el compositor: el mismo reintento que el agente (036)
 * ante «Meta no disponible», y el motivo en los logs (caso Distrito,
 * 26-nov-2026: un 5xx de Meta dejó el mensaje sin salir).
 */

const { graphRequest } = vi.hoisted(() => ({ graphRequest: vi.fn() }));

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: async () => ({
    organizationId: "org_1",
    phoneNumberId: "pn_1",
    token: "tok",
    status: "connected",
  }),
  markReconnectRequired: vi.fn(),
}));
vi.mock("@/server/inbox/author", () => ({ authorName: async () => "Soraya" }));
vi.mock("@/server/events/bus", () => ({ publish: vi.fn() }));
vi.mock("@/server/inbox/ingest", () => ({ serializeMessage: (m: unknown) => m }));
vi.mock("@/server/instagram/send", () => ({ sendInstagramConversationText: vi.fn() }));

const conversationRow = {
  conversation: {
    id: "cv_1",
    organizationId: "org_1",
    isTest: false,
    kind: "whatsapp",
    lastInboundAt: new Date(),
  },
  contact: { id: "ct_1", phone: "5493511111111" },
};

function selectChain() {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve([conversationRow]);
  return chain;
}

const inserted: unknown[] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => selectChain(),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          inserted.push(v);
          return [{ ...v }];
        },
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }),
  schema: {
    conversation: { contactId: "contactId", id: "id", organizationId: "organizationId" },
    contact: { id: "id" },
    message: {},
  },
}));

const unavailable = () =>
  new MetaApiError("An unknown error has occurred.", {
    status: 500,
    code: 1,
    type: "OAuthException",
    details: { error: { message: "An unknown error has occurred.", fbtrace_id: "Abc123" } },
  });
const ok = { messages: [{ id: "wamid.OK" }], contacts: [{ wa_id: "5493511111111" }] };
const noSleep = async () => undefined;
const input = {
  conversationId: "cv_1",
  organizationId: "org_1",
  text: "hola",
  sentByUserId: "usr_1",
};

describe("sendTextWithRetry", () => {
  beforeEach(() => {
    graphRequest.mockReset();
    inserted.length = 0;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("un 5xx pasajero de Meta se reintenta y el mensaje sale UNA vez", async () => {
    graphRequest.mockRejectedValueOnce(unavailable()).mockResolvedValueOnce(ok);
    const { sendTextWithRetry } = await import("@/server/inbox/send");
    const res = await sendTextWithRetry(input, { sleep: noSleep });
    expect(res.messageId).toBeTruthy();
    expect(graphRequest).toHaveBeenCalledTimes(2);
    expect(inserted).toHaveLength(1);
    const logs = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    expect(logs.some((l) => l.includes("status=500") && l.includes("fbtrace_id=Abc123"))).toBe(true);
    expect(logs.some((l) => l.includes("reintento 1 del envío manual en cv_1"))).toBe(true);
  });

  it("tras dos reintentos fallidos muestra «Meta no está disponible ahora»", async () => {
    graphRequest.mockRejectedValue(unavailable());
    const { sendTextWithRetry } = await import("@/server/inbox/send");
    await expect(sendTextWithRetry(input, { sleep: noSleep })).rejects.toMatchObject({
      code: "meta_unavailable",
    });
    expect(graphRequest).toHaveBeenCalledTimes(3);
    expect(inserted).toHaveLength(0);
  });

  it("un error definitivo de Meta (4xx) NO se reintenta", async () => {
    graphRequest.mockRejectedValue(
      new MetaApiError("Recipient phone number not in allowed list", { status: 400, code: 131030 })
    );
    const { sendTextWithRetry } = await import("@/server/inbox/send");
    await expect(sendTextWithRetry(input, { sleep: noSleep })).rejects.toMatchObject({
      code: "meta_error",
    });
    expect(graphRequest).toHaveBeenCalledTimes(1);
  });
});

describe("metaFailureSummary", () => {
  it("5xx: estado, códigos, mensaje en una línea y fbtrace_id", () => {
    const s = metaFailureSummary(
      {
        status: 503,
        code: 2,
        type: "OAuthException",
        message: "Service temporarily\nunavailable",
        details: { error: { error_subcode: 2494010, fbtrace_id: "AzX_9-q" } },
      },
      10512.4
    );
    expect(s).toBe(
      'status=503 code=2 subcode=2494010 type=OAuthException msg="Service temporarily unavailable" fbtrace_id=AzX_9-q tras 10512 ms'
    );
  });

  it("corte de red: la causa del fetch con su código", () => {
    const cause = Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" });
    const details = new TypeError("fetch failed", { cause });
    const s = metaFailureSummary({
      status: 0,
      code: null,
      type: null,
      message: "No se pudo contactar la API de Meta",
      details,
    });
    expect(s).toBe("status=0 causa=TypeError: fetch failed (UND_ERR_SOCKET)");
  });

  it("timeout: el nombre del error del AbortSignal", () => {
    const details = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    expect(
      metaFailureSummary({ status: 0, code: null, type: null, message: "x", details }, 20001)
    ).toBe("status=0 causa=TimeoutError: The operation was aborted due to timeout tras 20001 ms");
  });

  it("no copia un fbtrace_id raro ni mensajes larguísimos", () => {
    const s = metaFailureSummary({
      status: 500,
      code: null,
      type: null,
      message: "a".repeat(400),
      details: { error: { fbtrace_id: "<script>" } },
    });
    expect(s).not.toContain("fbtrace_id");
    expect(s.length).toBeLessThan(200);
  });
});
