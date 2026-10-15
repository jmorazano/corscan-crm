import { describe, expect, it } from "vitest";
import {
  collapseRepetitions,
  isDegenerateTranscription,
  isEmptyTranscription,
  isPlausibleTranscription,
  isSilentRecording,
} from "@/lib/transcription";

/** Incidente de oct-2026: notas de voz claras que quedaban «sin transcribir». */
describe("isEmptyTranscription", () => {
  it("el sentinel en sus variantes y el vacío", () => {
    for (const t of ["[SIN_CONTENIDO]", "  [sin contenido] ", "SIN_CONTENIDO", "[SIN_CONTENIDO].", ""]) {
      expect(isEmptyTranscription(t)).toBe(true);
    }
  });
  it("solo marcas de «no se entiende» = no se entendió nada", () => {
    expect(isEmptyTranscription("[…] […]")).toBe(true);
    expect(isEmptyTranscription("[...] , [inaudible]")).toBe(true);
  });
  it("una palabra real alcanza", () => {
    expect(isEmptyTranscription("Hola")).toBe(false);
    expect(isEmptyTranscription("[…] de número, hablame")).toBe(false);
  });
});

describe("isDegenerateTranscription / collapseRepetitions", () => {
  const loop = `No, con el número de ${"no, ".repeat(40)}no`;

  it("una palabra repetida en bucle (lo que hizo Gemini con temperatura 0)", () => {
    expect(isDegenerateTranscription(loop)).toBe(true);
  });
  it("un bucle de varias palabras también", () => {
    expect(isDegenerateTranscription(`Hola ${"te llamo mañana ".repeat(10)}`)).toBe(true);
  });
  it("una repetición humana no es un bucle", () => {
    expect(isDegenerateTranscription("No, no, no, no, eso no es lo que te pedí")).toBe(false);
    expect(isDegenerateTranscription("Hola, buenas noches, ¿qué tal? ¿Cómo estás?")).toBe(false);
  });
  it("recorta el bucle a tres repeticiones y conserva lo de antes y después", () => {
    expect(collapseRepetitions(loop)).toBe("No, con el número de no, no, no,");
    expect(collapseRepetitions(`Hola ${"te llamo ".repeat(9)}chau`)).toBe(
      "Hola te llamo te llamo te llamo chau"
    );
    expect(collapseRepetitions("No, no, no, eso no")).toBe("No, no, no, eso no");
  });
});

describe("isPlausibleTranscription (lo que se puede decir en lo que dura el audio)", () => {
  it("un audio de 1,1 s: «Che, hola.» sí, una consulta de 200 caracteres no", () => {
    expect(isPlausibleTranscription("Che, hola.", 1100)).toBe(true);
    expect(isPlausibleTranscription("Hola, ¿qué tal? Te hago una consulta. ".repeat(5), 1100)).toBe(false);
  });
  it("la nota de 3 minutos del incidente (1.600 caracteres) es verosímil", () => {
    expect(isPlausibleTranscription("x".repeat(1600), 178_400)).toBe(true);
  });
  it("sin duración conocida no se descarta nada", () => {
    expect(isPlausibleTranscription("x".repeat(4000), null)).toBe(true);
  });
});

describe("isSilentRecording", () => {
  it("silencio digital (micrófono muteado) sí; pausas sueltas de una nota real no", () => {
    expect(isSilentRecording({ packets: 150, silentPackets: 150 })).toBe(true);
    expect(isSilentRecording({ packets: 46, silentPackets: 8 })).toBe(false);
    expect(isSilentRecording({ packets: 0, silentPackets: 0 })).toBe(false);
  });
});
