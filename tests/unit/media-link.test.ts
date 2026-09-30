import { describe, expect, it } from "vitest";
import { MEDIA_LINK_TTL_MS, signMediaLinkPath, verifyMediaLink } from "@/lib/media-link";

const SECRET = "s3cret:media-link";
const NOW = 1_790_000_000_000;

function parts(path: string) {
  const url = new URL(path, "https://crm.example");
  return {
    id: decodeURIComponent(url.pathname.split("/").pop()!),
    e: url.searchParams.get("e"),
    s: url.searchParams.get("s"),
  };
}

describe("enlace firmado de adjuntos (Instagram)", () => {
  it("firma y verifica dentro del plazo", () => {
    const p = parts(signMediaLinkPath("mm_abc", SECRET, NOW));
    expect(p.id).toBe("mm_abc");
    expect(verifyMediaLink(p.id, p.e, p.s, SECRET, NOW + 1000)).toBe(true);
  });

  it("vence a las 24 h", () => {
    const p = parts(signMediaLinkPath("mm_abc", SECRET, NOW));
    expect(verifyMediaLink(p.id, p.e, p.s, SECRET, NOW + MEDIA_LINK_TTL_MS + 1)).toBe(false);
  });

  it("la firma no sirve para otro archivo, otro vencimiento ni otro secreto", () => {
    const p = parts(signMediaLinkPath("mm_abc", SECRET, NOW));
    expect(verifyMediaLink("mm_otro", p.e, p.s, SECRET, NOW)).toBe(false);
    expect(verifyMediaLink(p.id, String(Number(p.e) + 1), p.s, SECRET, NOW)).toBe(false);
    expect(verifyMediaLink(p.id, p.e, p.s, "otro-secreto", NOW)).toBe(false);
  });

  it("parámetros faltantes o malformados → false (sin lanzar)", () => {
    const p = parts(signMediaLinkPath("mm_abc", SECRET, NOW));
    expect(verifyMediaLink(p.id, null, p.s, SECRET, NOW)).toBe(false);
    expect(verifyMediaLink(p.id, p.e, null, SECRET, NOW)).toBe(false);
    expect(verifyMediaLink(p.id, "abc", p.s, SECRET, NOW)).toBe(false);
    expect(verifyMediaLink(p.id, p.e, "x", SECRET, NOW)).toBe(false);
  });
});
