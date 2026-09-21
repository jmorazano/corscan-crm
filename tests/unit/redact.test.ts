import { describe, expect, it } from "vitest";
import { redactForLog, redactSecrets, redactValue, truncate } from "@/lib/redact";

/**
 * 016 — Redacción por VALOR (corrección #14). La credencial de un PMS es una
 * cadena opaca sin prefijo reconocible: ningún patrón genérico de "bearer" la
 * encuentra. El patrón `sk-…` se conserva como cinturón adicional.
 */

describe("redactValue", () => {
  const credential = "9f3c1d7a5b2e4c8f0a6d3b1e";

  it("borra el valor exacto, cuantas veces aparezca", () => {
    const text = `Authorization: Bearer ${credential} y de nuevo ${credential}`;
    const out = redactValue(text, credential);
    expect(out).not.toContain(credential);
    expect(out).toBe("Authorization: Bearer *** y de nuevo ***");
  });

  it("borra también la forma porcentual y la base64", () => {
    const secret = "cred con espacios/y+signos";
    const text = [
      secret,
      encodeURIComponent(secret),
      Buffer.from(secret, "utf8").toString("base64"),
    ].join(" | ");
    const out = redactValue(text, secret);
    expect(out).toBe("*** | *** | ***");
  });

  it("acepta varios secretos y tolera null/undefined", () => {
    const out = redactValue("a=uno-secreto b=otro-secreto", "uno-secreto", null, undefined, "otro-secreto");
    expect(out).toBe("a=*** b=***");
  });

  it("ignora secretos cortos: borrarlos destruiría el texto", () => {
    expect(redactValue("no toques el a de la frase", "a")).toBe("no toques el a de la frase");
    expect(redactValue("mantiene 1234567", "1234567")).toBe("mantiene 1234567");
  });

  it("no rompe un texto sin el secreto", () => {
    expect(redactValue("todo bien", credential)).toBe("todo bien");
  });
});

describe("redactSecrets", () => {
  it("conserva el cinturón `sk-…` del adaptador de IA", () => {
    expect(redactSecrets("token sk-or-v1-abc123def y listo")).toBe("token sk-*** y listo");
    expect(redactSecrets("sin secretos")).toBe("sin secretos");
  });
});

describe("truncate / redactForLog", () => {
  it("trunca con puntos suspensivos", () => {
    expect(truncate("abcdef", 3)).toBe("abc…");
    expect(truncate("abc", 3)).toBe("abc");
  });

  it("combina valor, forma y tope: es lo que se usa antes de cualquier log", () => {
    const out = redactForLog(
      `respuesta del PMS con ${"x".repeat(400)} y sk-abc123 y 9f3c1d7a5b2e`,
      ["9f3c1d7a5b2e"],
      50
    );
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out).not.toContain("9f3c1d7a5b2e");
  });
});
