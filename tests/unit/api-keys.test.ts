import { describe, expect, it } from "vitest";
import {
  apiKeyPrefix,
  bearerFromHeader,
  generateApiKey,
  hashApiKey,
  looksLikeApiKey,
} from "@/lib/api-keys";

/** 014 (research D1): formato, entropía, hash y prefijo de las claves. */
describe("claves de API (puro)", () => {
  it("genera vk_ + 43 chars base64url, todas distintas", () => {
    const keys = Array.from({ length: 50 }, () => generateApiKey());
    for (const k of keys) {
      expect(k).toMatch(/^vk_[A-Za-z0-9_-]{43}$/);
      expect(looksLikeApiKey(k)).toBe(true);
    }
    expect(new Set(keys).size).toBe(50);
  });

  it("hash SHA-256 hex determinista y distinto por clave", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(hashApiKey(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(a)).toBe(hashApiKey(a));
    expect(hashApiKey(a)).not.toBe(hashApiKey(b));
  });

  it("el prefijo visible no revela la clave", () => {
    const k = generateApiKey();
    const p = apiKeyPrefix(k);
    expect(p).toHaveLength(11);
    expect(k.startsWith(p)).toBe(true);
    expect(looksLikeApiKey(p)).toBe(false);
  });

  it("rechaza formas inválidas", () => {
    expect(looksLikeApiKey("")).toBe(false);
    expect(looksLikeApiKey("vk_corta")).toBe(false);
    expect(looksLikeApiKey("sk_" + "a".repeat(43))).toBe(false);
    expect(looksLikeApiKey("vk_" + "a".repeat(43) + "x")).toBe(false);
  });

  it("extrae el Bearer del header (case-insensitive) o null", () => {
    expect(bearerFromHeader("Bearer vk_abc")).toBe("vk_abc");
    expect(bearerFromHeader("bearer   vk_abc ")).toBe("vk_abc");
    expect(bearerFromHeader("Basic xyz")).toBeNull();
    expect(bearerFromHeader("")).toBeNull();
    expect(bearerFromHeader(null)).toBeNull();
  });
});
