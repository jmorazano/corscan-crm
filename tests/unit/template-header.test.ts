import { describe, expect, it } from "vitest";
import {
  HEADER_IMAGE_MAX_BYTES,
  validateHeaderImage,
} from "@/lib/template-header";

const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from("resto-jpeg"),
]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("resto-png"),
]);

describe("validateHeaderImage", () => {
  it("acepta JPEG y PNG con MIME coincidente", () => {
    expect(validateHeaderImage(JPEG, "image/jpeg")).toEqual({
      ok: true,
      mime: "image/jpeg",
    });
    expect(validateHeaderImage(PNG, "image/png")).toEqual({
      ok: true,
      mime: "image/png",
    });
  });

  it("acepta el alias image/jpg del navegador", () => {
    expect(validateHeaderImage(JPEG, "image/jpg")).toEqual({
      ok: true,
      mime: "image/jpeg",
    });
  });

  it("rechaza contenido que no es imagen aunque el MIME mienta", () => {
    const fake = Buffer.from("no soy una imagen");
    const res = validateHeaderImage(fake, "image/jpeg");
    expect(res.ok).toBe(false);
  });

  it("rechaza MIME declarado que no coincide con el contenido", () => {
    const res = validateHeaderImage(PNG, "image/jpeg");
    expect(res.ok).toBe(false);
  });

  it("rechaza vacío y sobrepeso (>5MB)", () => {
    expect(validateHeaderImage(Buffer.alloc(0), "image/png").ok).toBe(false);
    const big = Buffer.concat([
      JPEG,
      Buffer.alloc(HEADER_IMAGE_MAX_BYTES),
    ]);
    const res = validateHeaderImage(big, "image/jpeg");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/5MB/);
  });
});
