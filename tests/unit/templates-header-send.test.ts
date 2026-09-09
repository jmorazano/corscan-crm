import { describe, expect, it } from "vitest";
import { buildTemplateSendPayload } from "@/server/whatsapp/templates";

describe("buildTemplateSendPayload", () => {
  it("sin imagen ni variable produce el payload histórico (sin components)", () => {
    expect(
      buildTemplateSendPayload({
        name: "hola",
        language: "es_AR",
        bodyParams: [],
        headerLink: null,
      })
    ).toEqual({ name: "hola", language: { code: "es_AR" } });
  });

  it("con variable y sin imagen solo lleva el body (comportamiento actual)", () => {
    expect(
      buildTemplateSendPayload({
        name: "hola",
        language: "es_AR",
        bodyParams: ["Juan"],
        headerLink: null,
      })
    ).toEqual({
      name: "hola",
      language: { code: "es_AR" },
      components: [
        { type: "body", parameters: [{ type: "text", text: "Juan" }] },
      ],
    });
  });

  it("con imagen antepone el header con el link público", () => {
    const payload = buildTemplateSendPayload({
      name: "promo",
      language: "es_AR",
      bodyParams: ["Juan"],
      headerLink: "https://crm.example/api/template-media/tm_abc",
    });
    expect(payload.components).toEqual([
      {
        type: "header",
        parameters: [
          {
            type: "image",
            image: { link: "https://crm.example/api/template-media/tm_abc" },
          },
        ],
      },
      { type: "body", parameters: [{ type: "text", text: "Juan" }] },
    ]);
  });

  it("con imagen y sin variable lleva solo el header", () => {
    const payload = buildTemplateSendPayload({
      name: "promo",
      language: "es_AR",
      bodyParams: [],
      headerLink: "https://crm.example/api/template-media/tm_abc",
    });
    expect(payload.components).toHaveLength(1);
    expect(payload.components?.[0]?.type).toBe("header");
  });
});
