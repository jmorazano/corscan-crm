import { describe, expect, it, vi } from "vitest";

/**
 * US3 (FR-010/FR-012): detección de la palabra de baja y el guard del
 * embudo de envío — el dado de baja NO recibe envíos iniciados (ventana
 * cerrada) pero SÍ se le puede responder dentro de la ventana de servicio.
 */

const insertedMessages: Record<string, unknown>[] = [];

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          insertedMessages.push(v);
          return { returning: () => Promise.resolve([{ ...v, waTimestamp: null, createdAt: new Date() }]) };
        },
      }),
      update: () => ({
        set: () => ({ where: () => Promise.resolve() }),
      }),
      // 008: lookup del media 1:1 de la plantilla (sin imagen en estos casos).
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([]) }),
        }),
      }),
    }),
  };
});

vi.mock("@/server/inbox/send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/inbox/send")>();
  return {
    ...actual,
    callGraphSend: vi.fn(async () => ({
      waMessageId: "wamid.test.1",
      waId: null,
    })),
  };
});

import { isOptOutMessage } from "@/server/inbox/side-effects";
import { sendTemplateCore } from "@/server/whatsapp/templates";
import { SendError } from "@/server/inbox/send";

describe("isOptOutMessage — coincidencia exacta (FR-010)", () => {
  it.each([
    ["BAJA", true],
    ["baja", true],
    ["  Stop  ", true],
    ["STOP", true],
    ["me quiero dar de baja del gimnasio", false],
    ["BAJA por favor", false],
    ["", false],
  ])("%j → %s", (text, expected) => {
    expect(isOptOutMessage("text", text)).toBe(expected);
  });

  it("solo aplica a mensajes de texto", () => {
    expect(isOptOutMessage("image", "BAJA")).toBe(false);
  });
});

const template = {
  id: "tpl_1",
  organizationId: "org_1",
  name: "promo",
  language: "es_AR",
  category: "MARKETING",
  body: "Hola!",
  status: "approved",
  rejectionReason: null,
  waTemplateId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as never;

const creds = {
  organizationId: "org_1",
  wabaId: "waba",
  phoneNumberId: "pn",
  token: "tok",
  status: "connected",
} as never;

function conversationWith(lastInboundAt: Date | null) {
  return {
    id: "cv_1",
    organizationId: "org_1",
    contactId: "ct_1",
    isTest: false,
    lastInboundAt,
    lastMessageAt: null,
  } as never;
}

function contactWith(optedOutAt: Date | null, isTest = false) {
  return {
    id: "ct_1",
    organizationId: "org_1",
    phone: "5493516882200",
    name: "Cliente",
    optedOutAt,
    isTest,
  } as never;
}

describe("sendTemplateCore — guards de baja y sandbox", () => {
  it("dado de baja + ventana CERRADA → SendError opted_out", async () => {
    await expect(
      sendTemplateCore({
        organizationId: "org_1",
        template,
        creds,
        conversation: conversationWith(
          new Date(Date.now() - 25 * 60 * 60 * 1000)
        ),
        contact: contactWith(new Date()),
      })
    ).rejects.toMatchObject({ code: "opted_out" });
  });

  it("dado de baja + ventana ABIERTA → el envío procede (FR-012)", async () => {
    insertedMessages.length = 0;
    const result = await sendTemplateCore({
      organizationId: "org_1",
      template,
      creds,
      conversation: conversationWith(new Date()),
      contact: contactWith(new Date()),
    });
    expect(result.waMessageId).toBe("wamid.test.1");
    expect(insertedMessages).toHaveLength(1);
  });

  it("contacto de prueba del Laboratorio → sandbox_violation aunque la conversación sea real", async () => {
    await expect(
      sendTemplateCore({
        organizationId: "org_1",
        template,
        creds,
        conversation: conversationWith(new Date()),
        contact: contactWith(null, true),
      })
    ).rejects.toBeInstanceOf(SendError);
  });
});
