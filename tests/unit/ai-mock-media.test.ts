import { describe, expect, it } from "vitest";
import {
  aiMockCompletion,
  MOCK_IMAGE_SUMMARY,
  MOCK_INBOUND_TRANSCRIPTION,
} from "@/server/dev/ai-mock";
import { ATTACHMENT_MARKER } from "@/lib/inbound-media";

/** 020: el ai-mock ve imágenes y reacciona a los adjuntos del cliente. */
describe("ai-mock · adjuntos entrantes", () => {
  it("image_url → descripción fija en texto plano", () => {
    const out = aiMockCompletion([
      { role: "system", content: "Describís en UNA sola oración." },
      {
        role: "user",
        content: [
          { type: "text", text: "¿Qué es esta imagen?" },
          { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
        ],
      },
    ]);
    expect(out).toBe(MOCK_IMAGE_SUMMARY);
    expect(() => JSON.parse(out)).toThrow();
  });

  it("un PNG dispara el sentinel de imagen ilegible (camino infeliz)", () => {
    const out = aiMockCompletion([
      {
        role: "user",
        content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }],
      },
    ]);
    expect(out).toBe("[SIN_CONTENIDO]");
  });

  it("un audio ogg es un cliente consultando, no el dueño enseñando", () => {
    const out = aiMockCompletion([
      {
        role: "user",
        content: [{ type: "input_audio", input_audio: { data: "AAAA", format: "ogg" } }],
      },
    ]);
    expect(out).toBe(MOCK_INBOUND_TRANSCRIPTION);
  });

  it("ante un comprobante acusa recibo SIN prometer la reserva", () => {
    const out = aiMockCompletion([
      { role: "system", content: "Eres el asistente" },
      {
        role: "user",
        content: `${ATTACHMENT_MARKER} El cliente mandó una imagen: un comprobante de transferencia bancaria`,
      },
    ]);
    const action = JSON.parse(out);
    expect(action.action).toBe("reply");
    expect(action.text).toMatch(/recib/i);
    // La guarda de 016 tiene su propio test; acá se cuida que el guion E2E
    // no dependa de un texto que la guarda vaya a reemplazar.
    expect(action.text).not.toMatch(/te confirmamos la reserva/i);
  });

  it("ante un audio ilegible pide que lo escriban", () => {
    const out = aiMockCompletion([
      { role: "system", content: "Eres el asistente" },
      {
        role: "user",
        content: `${ATTACHMENT_MARKER} El cliente mandó una nota de voz que no se pudo transcribir. Pedile amablemente que te lo escriba.`,
      },
    ]);
    expect(JSON.parse(out).text).toMatch(/escrib/i);
  });
});
