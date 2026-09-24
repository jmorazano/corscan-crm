import { describe, expect, it } from "vitest";
import {
  looksLikeTrainerImage,
  TRAINER_IMAGE_MARKER,
  TRAINER_IMAGE_MAX_BYTES,
  trainerImageContext,
  validateTrainerImage,
} from "@/lib/trainer-image";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(4)]);

/** Imágenes del Entrenador (022): validación por firma binaria y contexto para el turno. */
describe("validateTrainerImage", () => {
  it("acepta JPEG, PNG y WebP por su firma, no por el MIME declarado", () => {
    expect(validateTrainerImage(JPEG, "application/octet-stream")).toEqual({ ok: true, mime: "image/jpeg" });
    expect(validateTrainerImage(PNG, "image/jpeg")).toEqual({ ok: true, mime: "image/png" });
    expect(validateTrainerImage(WEBP, "")).toEqual({ ok: true, mime: "image/webp" });
  });

  it("rechaza vacío (422), enorme (413) y no-imagen (415)", () => {
    expect(validateTrainerImage(new Uint8Array(0), "image/jpeg")).toMatchObject({ ok: false, status: 422 });
    const huge = new Uint8Array(TRAINER_IMAGE_MAX_BYTES + 1);
    huge.set(JPEG);
    expect(validateTrainerImage(huge, "image/jpeg")).toMatchObject({ ok: false, status: 413, code: "too_large" });
    expect(validateTrainerImage(Buffer.from("hola mundo, soy un txt"), "image/png")).toMatchObject({
      ok: false,
      status: 415,
      code: "unsupported_media",
    });
  });
});

describe("looksLikeTrainerImage", () => {
  it("usa el tipo del navegador y cae a la extensión", () => {
    expect(looksLikeTrainerImage({ type: "image/jpeg", name: "x" })).toBe(true);
    expect(looksLikeTrainerImage({ type: "image/gif", name: "x.gif" })).toBe(false);
    expect(looksLikeTrainerImage({ type: "", name: "lista.PNG" })).toBe(true);
    expect(looksLikeTrainerImage({ type: "audio/mp4", name: "nota.m4a" })).toBe(false);
  });
});

describe("trainerImageContext", () => {
  it("pendiente → null (la lee el turno forzado)", () => {
    expect(trainerImageContext({ mediaState: "pending", mediaSummary: null, text: null, error: null })).toBeNull();
  });

  it("leída → marcador + lectura + epígrafe", () => {
    const ctx = trainerImageContext({
      mediaState: "ready",
      mediaSummary: "Lista de precios: mensura $150.000",
      text: "esta es la lista de este mes",
      error: null,
    });
    expect(ctx).toContain(TRAINER_IMAGE_MARKER);
    expect(ctx).toContain("Lista de precios: mensura $150.000");
    expect(ctx).toContain("Epígrafe: esta es la lista de este mes");
  });

  it("fallida → el agente se entera igual y pide el texto", () => {
    const ctx = trainerImageContext({
      mediaState: "failed",
      mediaSummary: null,
      text: null,
      error: "No se pudo leer la imagen",
    });
    expect(ctx).toContain("no se pudo leer");
    expect(ctx).toContain("No se pudo leer la imagen");
    expect(ctx).toContain("por texto");
  });
});
