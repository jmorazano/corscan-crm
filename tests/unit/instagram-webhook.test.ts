import { describe, expect, it } from "vitest";
import {
  messageTypeFor,
  parseInstagramWebhook,
  toInstagramDate,
} from "@/lib/instagram/webhook";

/**
 * 023: el webhook de Instagram se valida con Zod y se normaliza a eventos.
 * IDs: `entry.id` = cuenta conectada; en un entrante el cliente es el
 * `sender`, en un eco es el `recipient`.
 */

const ACCOUNT = "17841400000000001";
const CUSTOMER = "998877665544";
const now = new Date("2026-09-25T12:00:00Z");

function payload(messaging: unknown[], account = ACCOUNT) {
  return { object: "instagram", entry: [{ id: account, time: 1, messaging }] };
}

describe("parseInstagramWebhook", () => {
  it("mensaje de texto del cliente", () => {
    const events = parseInstagramWebhook(
      payload([
        {
          sender: { id: CUSTOMER },
          recipient: { id: ACCOUNT },
          timestamp: 1790000000000,
          message: { mid: "m1", text: "Hola, ¿tienen lugar?" },
        },
      ]),
      now
    );
    expect(events).toEqual([
      {
        kind: "message",
        accountId: ACCOUNT,
        customerId: CUSTOMER,
        mid: "m1",
        text: "Hola, ¿tienen lugar?",
        attachments: [],
        isEcho: false,
        isUnsupported: false,
        at: new Date(1790000000000),
      },
    ]);
  });

  it("eco: el cliente es el recipient y queda marcado", () => {
    const [ev] = parseInstagramWebhook(
      payload([
        {
          sender: { id: ACCOUNT },
          recipient: { id: CUSTOMER },
          timestamp: 1790000000000,
          message: { mid: "m2", text: "Te respondo desde el celu", is_echo: true },
        },
      ]),
      now
    )!;
    expect(ev).toMatchObject({ kind: "message", isEcho: true, customerId: CUSTOMER });
  });

  it("adjuntos con URL, borrado, visto, reacción y postback", () => {
    const events = parseInstagramWebhook(
      payload([
        {
          sender: { id: CUSTOMER },
          recipient: { id: ACCOUNT },
          message: {
            mid: "m3",
            attachments: [{ type: "image", payload: { url: "https://lookaside.fbsbx.com/x" } }],
          },
        },
        { sender: { id: CUSTOMER }, recipient: { id: ACCOUNT }, message: { mid: "m1", is_deleted: true } },
        { sender: { id: CUSTOMER }, recipient: { id: ACCOUNT }, timestamp: 5, read: { mid: "m9" } },
        {
          sender: { id: CUSTOMER },
          recipient: { id: ACCOUNT },
          reaction: { mid: "m9", action: "react", emoji: "❤️" },
        },
        {
          sender: { id: CUSTOMER },
          recipient: { id: ACCOUNT },
          postback: { mid: "m10", title: "Ver precios", payload: "PRICES" },
        },
      ]),
      now
    )!;
    expect(events.map((e) => e.kind)).toEqual(["message", "deleted", "read", "reaction", "postback"]);
    expect(events[0]).toMatchObject({
      text: null,
      attachments: [{ type: "image", url: "https://lookaside.fbsbx.com/x" }],
    });
    expect(events[2]).toMatchObject({ mid: "m9", at: new Date(5000) });
    expect(events[3]).toMatchObject({ action: "react", emoji: "❤️" });
    expect(events[4]).toMatchObject({ text: "Ver precios", mid: "m10" });
  });

  it("ignora is_self, eventos desconocidos y payloads que no son de Instagram", () => {
    expect(
      parseInstagramWebhook(
        payload([
          {
            sender: { id: ACCOUNT },
            recipient: { id: ACCOUNT },
            message: { mid: "s", text: "prueba", is_echo: true, is_self: true },
          },
          { sender: { id: CUSTOMER }, recipient: { id: ACCOUNT }, optin: {} },
          { basura: true },
        ]),
        now
      )
    ).toEqual([]);
    expect(parseInstagramWebhook({ object: "whatsapp_business_account", entry: [] })).toBeNull();
    expect(parseInstagramWebhook("no-json")).toBeNull();
  });

  it("la respuesta rápida viaja como texto", () => {
    const [ev] = parseInstagramWebhook(
      payload([
        {
          sender: { id: CUSTOMER },
          recipient: { id: ACCOUNT },
          message: { mid: "q", quick_reply: { payload: "Sí, quiero" } },
        },
      ]),
      now
    )!;
    expect(ev).toMatchObject({ text: "Sí, quiero" });
  });
});

describe("toInstagramDate", () => {
  it("acepta milisegundos, segundos y cae al fallback", () => {
    expect(toInstagramDate(1790000000000, now)).toEqual(new Date(1790000000000));
    expect(toInstagramDate(1790000000, now)).toEqual(new Date(1790000000000));
    expect(toInstagramDate(undefined, now)).toBe(now);
    expect(toInstagramDate("x", now)).toBe(now);
  });
});

describe("messageTypeFor", () => {
  const base = { text: null, isUnsupported: false };
  it.each([
    [[], "text"],
    [[{ type: "image", url: "u" }], "image"],
    [[{ type: "audio", url: "u" }], "audio"],
    [[{ type: "file", url: "u" }], "document"],
    [[{ type: "ig_reel", url: "u" }], "share"],
    [[{ type: "share", url: "u" }], "share"],
    [[{ type: "story_mention", url: "u" }], "story"],
    [[{ type: "ephemeral", url: null }], "unsupported"],
  ])("%j → %s", (attachments, expected) => {
    expect(messageTypeFor({ ...base, attachments })).toBe(expected);
  });
  it("is_unsupported sin adjuntos", () => {
    expect(messageTypeFor({ text: null, attachments: [], isUnsupported: true })).toBe("unsupported");
  });
});

describe("parseMetaJson", () => {
  it("preserva IDs de 17 dígitos que llegan como número", async () => {
    const { parseMetaJson } = await import("@/lib/instagram/json");
    const raw =
      '{"object":"instagram","entry":[{"id":17841400000000001,"messaging":[{"sender":{"id":998877665544332211},"recipient":{"id":17841400000000001},"timestamp":1790000000000,"message":{"mid":"m","text":"id: 12345678901234567"}}]}]}';
    const events = parseInstagramWebhook(parseMetaJson(raw), now)!;
    expect(events[0]).toMatchObject({
      accountId: "17841400000000001",
      customerId: "998877665544332211",
      text: "id: 12345678901234567",
      at: new Date(1790000000000),
    });
  });
});
