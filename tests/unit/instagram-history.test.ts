import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  customerOf,
  mapInstagramHistoryMessage,
  parseMetaTime,
} from "@/lib/instagram/history";

/**
 * 023: historial de Instagram por la Conversations API. Mismo contrato que
 * el del celular de WhatsApp (017): fecha original, ventana de días, y el
 * cliente se identifica por su IGSID.
 */

const now = new Date("2026-09-25T12:00:00Z");
const account = { igUserId: "17841400000000001", username: "negocio.demo" };

describe("parseMetaTime", () => {
  it("ISO con +0000, epoch en segundos/ms y basura", () => {
    expect(parseMetaTime("2026-09-25T10:00:00+0000")?.toISOString()).toBe("2026-09-25T10:00:00.000Z");
    expect(parseMetaTime("2026-09-25T07:00:00-0300")?.toISOString()).toBe("2026-09-25T10:00:00.000Z");
    expect(parseMetaTime("1790330400")?.getTime()).toBe(1790330400000);
    expect(parseMetaTime(1790330400000)?.getTime()).toBe(1790330400000);
    expect(parseMetaTime("no")).toBeNull();
    expect(parseMetaTime(null)).toBeNull();
  });
});

describe("customerOf", () => {
  it("el participante que no es la cuenta (por id o por usuario)", () => {
    expect(
      customerOf(
        [
          { id: account.igUserId, username: "negocio.demo" },
          { id: "771", username: "sofia" },
        ],
        account
      )
    ).toEqual({ id: "771", username: "sofia" });
    // La cuenta a veces viene con otro id (app-scoped): se reconoce por usuario.
    expect(
      customerOf(
        [
          { id: "otro-id", username: "Negocio.Demo" },
          { id: "771", username: "sofia" },
        ],
        account
      )?.id
    ).toBe("771");
  });
  it("sin cliente claro no adivina", () => {
    expect(customerOf([{ id: account.igUserId, username: null }], account)).toBeNull();
    expect(
      customerOf(
        [
          { id: "1", username: "a" },
          { id: "2", username: "b" },
        ],
        account
      )
    ).toBeNull();
  });
});

describe("mapInstagramHistoryMessage", () => {
  const ctx = { customerId: "771", days: 60, now };
  const base = { attachments: [], isUnsupported: false };
  it("entrante y saliente con su fecha original", () => {
    expect(
      mapInstagramHistoryMessage(
        { ...base, id: "m1", createdTime: "2026-09-24T10:00:00+0000", from: { id: "771", username: "s" }, text: "Hola" },
        ctx
      )
    ).toEqual({
      waMessageId: "m1",
      direction: "in",
      type: "text",
      text: "Hola",
      status: "delivered",
      at: new Date("2026-09-24T10:00:00Z"),
    });
    expect(
      mapInstagramHistoryMessage(
        { ...base, id: "m2", createdTime: "2026-09-24T10:05:00+0000", from: { id: account.igUserId, username: null }, text: "¡Hola!" },
        ctx
      )
    ).toMatchObject({ direction: "out", status: "sent" });
  });
  it("fuera de la ventana, sin fecha o vacío → null", () => {
    const old = { ...base, id: "m3", createdTime: "2026-06-01T10:00:00+0000", from: null, text: "viejo" };
    expect(mapInstagramHistoryMessage(old, ctx)).toBeNull();
    expect(mapInstagramHistoryMessage({ ...old, createdTime: null }, ctx)).toBeNull();
    expect(
      mapInstagramHistoryMessage({ ...old, createdTime: "2026-09-24T10:00:00+0000", text: null }, ctx)
    ).toBeNull();
  });
  it("adjuntos → su tipo (sin texto igual entra)", () => {
    expect(
      mapInstagramHistoryMessage(
        {
          id: "m4",
          createdTime: "2026-09-24T10:00:00+0000",
          from: { id: "771", username: null },
          text: null,
          attachments: [{ type: "image", url: "https://lookaside.fbsbx.com/x" }],
          isUnsupported: false,
        },
        ctx
      )
    ).toMatchObject({ type: "image", text: null, direction: "in" });
  });
});

describe("adaptador de la Conversations API", () => {
  beforeAll(() => {
    process.env.APP_BASE_URL = "https://crm.test";
    process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
    process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lista conversaciones con participantes y cursor solo si hay `next`", async () => {
    const { listInstagramConversations } = await import("@/lib/instagram/client");
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return new Response(
          '{"data":[{"id":"c1","updated_time":"2026-09-24T10:00:00+0000","participants":{"data":[{"id":17841400000000001,"username":"negocio.demo"},{"id":"771","username":"sofia"}]}}],"paging":{"cursors":{"after":"CUR"},"next":"https://x"}}',
          { status: 200 }
        );
      })
    );
    const page = await listInstagramConversations("tok");
    expect(page.next).toBe("CUR");
    expect(page.conversations[0]!.participants[0]!.id).toBe("17841400000000001");
    expect(calls[0]).toContain("me/conversations");
    expect(calls[0]).toContain("platform=instagram");
  });

  it("mensajes: usa la expansión anidada y cae a un pedido por mensaje si viene sin detalle", async () => {
    const { getInstagramConversationMessages } = await import("@/lib/instagram/client");
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        if (String(url).includes("/c1?")) {
          return Response.json({ messages: { data: [{ id: "m1" }, { id: "m2" }] } });
        }
        if (String(url).includes("/m2?")) return new Response("{}", { status: 400 });
        return Response.json({
          id: "m1",
          created_time: "2026-09-24T10:00:00+0000",
          from: { id: "771" },
          message: "hola",
        });
      })
    );
    const msgs = await getInstagramConversationMessages("tok", "c1");
    expect(msgs).toEqual([
      {
        id: "m1",
        createdTime: "2026-09-24T10:00:00+0000",
        from: { id: "771", username: null },
        text: "hola",
        attachments: [],
        isUnsupported: false,
      },
    ]);
    expect(calls[0]).toContain("messages.limit");
    expect(calls).toHaveLength(3);
  });
});

describe("emptyImportNote", () => {
  it("explica por qué no se importó nada", async () => {
    const { emptyImportNote } = await import("@/server/instagram/history");
    const base = { listed: 0, outOfWindow: 0, outOfWindowDays: null, noCustomer: 0, rows: 0 };
    expect(emptyImportNote(base, 60)).toMatch(/no devolvió conversaciones/);
    expect(emptyImportNote({ ...base, listed: 1, outOfWindow: 1, outOfWindowDays: 143 }, 60)).toBe(
      "Instagram devolvió 1 conversación, sin actividad en los últimos 60 días (la más reciente, hace 143 días). Mientras Meta no apruebe el acceso avanzado de la app, solo entrega algunas conversaciones."
    );
    expect(emptyImportNote({ ...base, listed: 3, noCustomer: 3 }, 60)).toBe(
      "Instagram devolvió 3 conversaciones, pero ninguna con mensajes para importar."
    );
  });
});
