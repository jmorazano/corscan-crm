import { afterEach, describe, expect, it } from "vitest";
import {
  checkEndpointSyntax,
  guardedLookup,
  isBlockedAddress,
  isLoopback,
  safeLink,
} from "@/lib/mcp/ssrf";
import { McpError } from "@/lib/mcp/errors";

/**
 * 016 — Anti-SSRF del conector MCP (design §G.1, correcciones #2, #3, #17).
 * Todo puro salvo `guardedLookup`, que se ejercita contra `localhost`.
 */

function withMocks(on: boolean): void {
  if (on) process.env.WA_MOCK_ENABLED = "true";
  else delete process.env.WA_MOCK_ENABLED;
}

afterEach(() => withMocks(false));

describe("checkEndpointSyntax", () => {
  it("acepta una URL https de un PMS público", () => {
    const res = checkEndpointSyntax("https://altosdecalamuchita.com/mcp/assistant");
    expect(res.ok).toBe(true);
  });

  it("rechaza http fuera de los mocks y lo acepta bajo el gate", () => {
    expect(checkEndpointSyntax("http://localhost:3000/api/dev/mcp-mock")).toEqual({
      ok: false,
      reason: "not_https",
    });
    withMocks(true);
    expect(checkEndpointSyntax("http://localhost:3000/api/dev/mcp-mock").ok).toBe(true);
  });

  it("rechaza userinfo, fragmento, puerto raro y URL larguísima", () => {
    expect(checkEndpointSyntax("https://user:pass@pms.ejemplo.com/mcp")).toEqual({
      ok: false,
      reason: "userinfo",
    });
    expect(checkEndpointSyntax("https://pms.ejemplo.com/mcp#x")).toEqual({
      ok: false,
      reason: "invalid_url",
    });
    expect(checkEndpointSyntax("https://pms.ejemplo.com:8080/mcp")).toEqual({
      ok: false,
      reason: "bad_port",
    });
    expect(checkEndpointSyntax(`https://pms.ejemplo.com/${"a".repeat(3000)}`)).toEqual({
      ok: false,
      reason: "too_long",
    });
    expect(checkEndpointSyntax("no-es-una-url")).toEqual({
      ok: false,
      reason: "invalid_url",
    });
  });

  it("S-1: las IP literales se rechazan SIEMPRE (Node no llama al lookup con una IP)", () => {
    // El parser WHATWG normaliza estas tres formas a IPv4 punteado, así que
    // "tiene al menos un punto" no alcanza como barrera.
    for (const raw of [
      "https://169.254.169.254/mcp",
      "https://2130706433/mcp",
      "https://0x7f.1/mcp",
      "https://0/mcp",
      "https://10.0.0.5/mcp",
      "https://[::1]/mcp",
      "https://[::ffff:169.254.169.254]/mcp",
    ]) {
      expect(checkEndpointSyntax(raw), raw).toEqual({ ok: false, reason: "bad_host" });
    }
  });

  it("bajo mocks solo el loopback literal pasa; 169.254 sigue muerta", () => {
    withMocks(true);
    expect(checkEndpointSyntax("http://127.0.0.1:3000/api/dev/mcp-mock").ok).toBe(true);
    expect(checkEndpointSyntax("http://169.254.169.254/mcp")).toEqual({
      ok: false,
      reason: "bad_host",
    });
  });

  it("rechaza hostname sin punto y FQDN con punto final", () => {
    expect(checkEndpointSyntax("https://postgres/mcp")).toEqual({
      ok: false,
      reason: "bad_host",
    });
    expect(checkEndpointSyntax("https://altosdecalamuchita.com./mcp")).toEqual({
      ok: false,
      reason: "bad_host",
    });
  });
});

describe("isBlockedAddress — IPv4", () => {
  it("bloquea privadas, loopback, link-local, CGNAT, TEST-NET, 6to4 relay y metadata", () => {
    for (const ip of [
      "0.0.0.0",
      "10.1.2.3",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.0.0.1",
      "192.0.2.5",
      "192.88.99.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.51.100.7",
      "203.0.113.7",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
      "100.100.100.200",
    ]) {
      expect(isBlockedAddress(ip, 4), ip).toBe(true);
    }
  });

  it("deja pasar direcciones públicas", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "190.210.1.1", "172.32.0.1", "100.63.255.255"]) {
      expect(isBlockedAddress(ip, 4), ip).toBe(false);
    }
  });

  it("falla CERRADO ante un formato que no parsea", () => {
    expect(isBlockedAddress("no-es-una-ip", 4)).toBe(true);
    expect(isBlockedAddress("999.1.1.1", 4)).toBe(true);
  });
});

describe("isBlockedAddress — IPv6", () => {
  it("bloquea ::, ::1, ::/96 (IPv4-compatible), ::ffff: desmapeada y NAT64", () => {
    expect(isBlockedAddress("::", 6)).toBe(true);
    expect(isBlockedAddress("::1", 6)).toBe(true);
    // [::a9fe:a9fe] ES 169.254.169.254 — el hueco que cerró la corrección #3.
    expect(isBlockedAddress("::a9fe:a9fe", 6)).toBe(true);
    expect(isBlockedAddress("::ffff:169.254.169.254", 6)).toBe(true);
    expect(isBlockedAddress("::ffff:10.0.0.1", 6)).toBe(true);
    expect(isBlockedAddress("64:ff9b::1.2.3.4", 6)).toBe(true);
  });

  it("bloquea 6to4, únicas locales, link-local, site-local y multicast", () => {
    expect(isBlockedAddress("2002:c0a8:0101::1", 6)).toBe(true);
    expect(isBlockedAddress("fc00::1", 6)).toBe(true);
    expect(isBlockedAddress("fd12:3456::1", 6)).toBe(true);
    expect(isBlockedAddress("fe80::1", 6)).toBe(true);
    expect(isBlockedAddress("fec0::1", 6)).toBe(true);
    expect(isBlockedAddress("ff02::1", 6)).toBe(true);
  });

  it("deja pasar IPv6 públicas y desmapea sin romper", () => {
    expect(isBlockedAddress("2606:4700:4700::1111", 6)).toBe(false);
    expect(isBlockedAddress("::ffff:1.1.1.1", 6)).toBe(false);
    expect(isBlockedAddress("2001:db8::1", 6)).toBe(false);
  });

  it("isLoopback distingue loopback de privada", () => {
    expect(isLoopback("127.0.0.5", 4)).toBe(true);
    expect(isLoopback("10.0.0.1", 4)).toBe(false);
    expect(isLoopback("::1", 6)).toBe(true);
    expect(isLoopback("::ffff:127.0.0.1", 6)).toBe(true);
    expect(isLoopback("fe80::1", 6)).toBe(false);
  });
});

describe("guardedLookup", () => {
  it("#2: con { all: true } valida TODAS las direcciones y devuelve el array", async () => {
    const lookup = guardedLookup(false);
    const result = await new Promise<unknown>((resolve) => {
      lookup("localhost", { all: true } as never, ((err: unknown, value: unknown) =>
        resolve(err ?? value)) as never);
    });
    // localhost resuelve a 127.0.0.1 y/o ::1: ambas prohibidas sin loopback.
    expect(result).toBeInstanceOf(McpError);
    expect((result as McpError).code).toBe("blocked_host");
  });

  it("con loopback permitido (mocks) deja pasar localhost y conserva la forma `all`", async () => {
    const lookup = guardedLookup(true);
    const result = await new Promise<unknown>((resolve, reject) => {
      lookup("localhost", { all: true } as never, ((err: unknown, value: unknown) =>
        err ? reject(err) : resolve(value)) as never);
    });
    expect(Array.isArray(result)).toBe(true);
    expect((result as { address: string }[]).length).toBeGreaterThan(0);
  });

  it("sin `all` responde (address, family) como espera Node", async () => {
    const lookup = guardedLookup(true);
    const result = await new Promise<[unknown, unknown]>((resolve, reject) => {
      lookup("localhost", {} as never, ((err: unknown, address: unknown, family: unknown) =>
        err ? reject(err) : resolve([address, family])) as never);
    });
    expect(typeof result[0]).toBe("string");
    expect([4, 6]).toContain(result[1]);
  });
});

describe("safeLink", () => {
  const hosts = ["altosdecalamuchita.com"];

  it("acepta el dominio exacto y sus subdominios", () => {
    expect(safeLink("https://altosdecalamuchita.com/buscar?in=2026-10-10", hosts)).toBe(
      "https://altosdecalamuchita.com/buscar?in=2026-10-10"
    );
    expect(safeLink("https://www.altosdecalamuchita.com/propiedades/x", hosts)).toBe(
      "https://www.altosdecalamuchita.com/propiedades/x"
    );
  });

  it("#17: corta la trampa del sufijo, el punto final del FQDN y el userinfo", () => {
    expect(safeLink("https://evil-altosdecalamuchita.com/x", hosts)).toBeNull();
    expect(safeLink("https://altosdecalamuchita.com.evil.com/x", hosts)).toBeNull();
    // `new URL()` conserva el punto final: sin strip, `h === d` fallaría.
    // Se acepta y se devuelve normalizado, sin el punto.
    expect(safeLink("https://altosdecalamuchita.com./buscar", hosts)).toBe(
      "https://altosdecalamuchita.com/buscar"
    );
    expect(safeLink("https://a:b@altosdecalamuchita.com/x", hosts)).toBeNull();
  });

  it("rechaza http, javascript:, data:, otro host, vacío y href > 512", () => {
    expect(safeLink("http://altosdecalamuchita.com/x", hosts)).toBeNull();
    expect(safeLink("javascript:alert(1)", hosts)).toBeNull();
    expect(safeLink("data:text/html,<b>x", hosts)).toBeNull();
    expect(safeLink("https://otro.com/x", hosts)).toBeNull();
    expect(safeLink("", hosts)).toBeNull();
    expect(safeLink(null, hosts)).toBeNull();
    expect(safeLink(`https://altosdecalamuchita.com/${"a".repeat(600)}`, hosts)).toBeNull();
  });

  it("sin allowlist no hay enlace posible (perfil `generic`)", () => {
    expect(safeLink("https://altosdecalamuchita.com/x", [])).toBeNull();
  });
});
