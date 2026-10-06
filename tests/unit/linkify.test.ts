import { describe, expect, it } from "vitest";
import { linkifyParts } from "@/lib/linkify";

/** 031: los enlaces del hilo se ven y se abren como enlaces. */
describe("linkifyParts", () => {
  it("texto sin enlaces → un solo tramo", () => {
    expect(linkifyParts("Hola, ¿cómo va?")).toEqual([{ type: "text", value: "Hola, ¿cómo va?" }]);
    expect(linkifyParts("")).toEqual([]);
    expect(linkifyParts(null)).toEqual([]);
  });

  it("enlace del agente con query y punto final", () => {
    const text =
      "Me queda esta opción: https://altosdecalamuchita.com/alquiler/casa?in=2026-11-27&out=2026-11-29&c=10&g=0.";
    expect(linkifyParts(text)).toEqual([
      { type: "text", value: "Me queda esta opción: " },
      {
        type: "link",
        value: "https://altosdecalamuchita.com/alquiler/casa?in=2026-11-27&out=2026-11-29&c=10&g=0",
        href: "https://altosdecalamuchita.com/alquiler/casa?in=2026-11-27&out=2026-11-29&c=10&g=0",
      },
      { type: "text", value: "." },
    ]);
  });

  it("varios enlaces, saltos de línea y www.", () => {
    const parts = linkifyParts("Uno: http://a.com/x\nDos: www.b.com/y, listo");
    expect(parts.filter((p) => p.type === "link")).toEqual([
      { type: "link", value: "http://a.com/x", href: "http://a.com/x" },
      { type: "link", value: "www.b.com/y", href: "https://www.b.com/y" },
    ]);
    expect(parts.map((p) => p.value).join("")).toBe("Uno: http://a.com/x\nDos: www.b.com/y, listo");
  });

  it("paréntesis: el que cierra afuera no es del enlace; el balanceado sí", () => {
    expect(linkifyParts("(ver https://a.com/x)")[1]).toEqual({ type: "link", value: "https://a.com/x", href: "https://a.com/x" });
    expect(linkifyParts("https://es.wikipedia.org/wiki/Foo_(bar)")[0]).toMatchObject({
      value: "https://es.wikipedia.org/wiki/Foo_(bar)",
    });
  });

  it("esquemas peligrosos o raros no se convierten", () => {
    expect(linkifyParts("javascript:alert(1)").every((p) => p.type === "text")).toBe(true);
    expect(linkifyParts("data:text/html,hola").every((p) => p.type === "text")).toBe(true);
  });

  it("entre comillas latinas", () => {
    expect(linkifyParts("«https://a.com/x»")[1]).toMatchObject({ type: "link", value: "https://a.com/x" });
  });
});
