import { describe, expect, it } from "vitest";
import { aiMockCompletion, MOCK_TRANSCRIPTION } from "@/server/dev/ai-mock";

/** 015 (US3): el ai-mock transcribe (texto plano) y sigue tolerando strings. */
describe("ai-mock · audio", () => {
  it("input_audio → transcripción fija en texto plano", () => {
    const out = aiMockCompletion([
      { role: "system", content: "Sos un transcriptor." },
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribí este audio." },
          { type: "input_audio", input_audio: { data: "AAAA", format: "wav" } },
        ],
      },
    ]);
    expect(out).toBe(MOCK_TRANSCRIPTION);
    expect(() => JSON.parse(out)).toThrow();
  });
  it("format flac → sentinel de audio sin contenido", () => {
    const out = aiMockCompletion([
      { role: "user", content: [{ type: "input_audio", input_audio: { data: "AAAA", format: "flac" } }] },
    ]);
    expect(out).toBe("[SIN_CONTENIDO]");
  });
  it("contenido en partes de texto se despacha como string", () => {
    const out = aiMockCompletion([
      { role: "system", content: [{ type: "text", text: "Eres el asistente" }] },
      { role: "user", content: [{ type: "text", text: "quiero un asesor" }] },
    ]);
    expect(JSON.parse(out)).toMatchObject({ action: "handoff" });
  });
});
