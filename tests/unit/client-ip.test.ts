import { describe, expect, it } from "vitest";
import {
  CLIENT_IP_HEADER,
  clientIp,
  normalizeIp,
  withClientIp,
} from "@/lib/client-ip";

/**
 * IP del cliente para los limitadores por IP (FR-062). Las formas de los
 * headers son las verificadas en producción (Railway, 4-oct-2026): el edge
 * descarta el `X-Forwarded-For` del cliente y escribe `<cliente>, <edge CDN>`.
 */

const h = (init: Record<string, string>) => new Headers(init);

describe("clientIp: de qué header sale la IP", () => {
  it("Railway: «cliente, edge del CDN» → el cliente (la izquierda)", () => {
    expect(
      clientIp(h({ "x-forwarded-for": "203.0.113.7, 152.233.10.20" }))
    ).toBe("203.0.113.7");
  });

  it("jamás la entrada de la derecha: el edge del CDN lo comparten todos", () => {
    const edge = "152.233.10.20";
    const a = clientIp(h({ "x-forwarded-for": `198.51.100.1, ${edge}` }));
    const b = clientIp(h({ "x-forwarded-for": `198.51.100.2, ${edge}` }));
    expect(a).not.toBe(b);
    expect(a).not.toBe(edge);
  });

  it("el mismo cliente por edges distintos cae en el mismo balde", () => {
    expect(
      clientIp(h({ "x-forwarded-for": "203.0.113.7, 152.233.10.20" }))
    ).toBe(clientIp(h({ "x-forwarded-for": "203.0.113.7,152.233.99.1" })));
  });

  it("un solo valor (Caddy/Traefik reescriben el header) → ese valor", () => {
    expect(clientIp(h({ "x-forwarded-for": " 203.0.113.7 " }))).toBe(
      "203.0.113.7"
    );
  });

  it("X-Forwarded-For gana sobre X-Real-IP (en la Ruta B X-Real-IP lo pone el cliente)", () => {
    expect(
      clientIp(
        h({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "198.51.100.66" })
      )
    ).toBe("203.0.113.7");
  });

  it("sin X-Forwarded-For válido → X-Real-IP", () => {
    expect(clientIp(h({ "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(
      clientIp(h({ "x-forwarded-for": "unknown", "x-real-ip": "203.0.113.7" }))
    ).toBe("203.0.113.7");
  });

  it("sin nada utilizable → null (el llamador elige el balde compartido)", () => {
    expect(clientIp(undefined)).toBeNull();
    expect(clientIp(null)).toBeNull();
    expect(clientIp(h({}))).toBeNull();
    expect(clientIp(h({ "x-forwarded-for": "" }))).toBeNull();
    expect(clientIp(h({ "x-forwarded-for": "nope, 203.0.113.7" }))).toBeNull();
    expect(clientIp(h({ "x-real-ip": "<script>" }))).toBeNull();
  });
});

describe("normalizeIp: la misma máquina no puede caer en dos baldes", () => {
  it("IPv4 válida tal cual; inválidas → null", () => {
    expect(normalizeIp("8.8.8.8")).toBe("8.8.8.8");
    expect(normalizeIp("255.255.255.255")).toBe("255.255.255.255");
    expect(normalizeIp("256.1.1.1")).toBeNull();
    expect(normalizeIp("1.2.3")).toBeNull();
    expect(normalizeIp("01.2.3.4")).toBeNull();
    expect(normalizeIp("1.2.3.4.5")).toBeNull();
  });

  it("quita el puerto que escriben algunos proxies", () => {
    expect(normalizeIp("203.0.113.7:51234")).toBe("203.0.113.7");
    expect(normalizeIp("[2001:db8::1]:443")).toBe(
      "2001:0db8:0000:0000:0000:0000:0000:0000"
    );
    expect(normalizeIp("[2001:db8::1]")).toBe(
      "2001:0db8:0000:0000:0000:0000:0000:0000"
    );
  });

  it("IPv6 se agrupa por /64: rotar la dirección dentro del prefijo no sirve", () => {
    const a = normalizeIp("2001:db8:aa:bb:1111:2222:3333:4444");
    const b = normalizeIp("2001:db8:aa:bb::9");
    expect(a).toBe("2001:0db8:00aa:00bb:0000:0000:0000:0000");
    expect(b).toBe(a);
    expect(normalizeIp("2001:db8:aa:bc::9")).not.toBe(a);
  });

  it("misma forma que Better Auth (mayúsculas, compresión)", () => {
    expect(normalizeIp("2001:DB8::1")).toBe(
      "2001:0db8:0000:0000:0000:0000:0000:0000"
    );
    expect(normalizeIp("::1")).toBe("0000:0000:0000:0000:0000:0000:0000:0000");
  });

  it("IPv4 mapeada en IPv6 → IPv4 (decimal o hex)", () => {
    expect(normalizeIp("::ffff:198.51.100.7")).toBe("198.51.100.7");
    expect(normalizeIp("::FFFF:c633:6407")).toBe("198.51.100.7");
    expect(normalizeIp("0:0:0:0:0:ffff:198.51.100.7")).toBe("198.51.100.7");
  });

  it("IPv6 inválidas → null", () => {
    expect(normalizeIp("2001:db8::1::2")).toBeNull();
    expect(normalizeIp("12345::1")).toBeNull();
    expect(normalizeIp("fe80::1%eth0")).toBeNull();
    expect(normalizeIp("1:2:3:4:5:6:7")).toBeNull();
    expect(normalizeIp("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(normalizeIp("1:2:3:4:5:6:7::8")).toBeNull();
    expect(normalizeIp("::ffff:999.1.1.1")).toBeNull();
    expect(normalizeIp("g::1")).toBeNull();
  });
});

describe("withClientIp: la IP que lee el limitador interno de Better Auth", () => {
  it("fija el header con la IP del cliente", () => {
    const req = withClientIp(
      new Request("http://x/api/auth/sign-in/email", {
        headers: { "x-forwarded-for": "203.0.113.7, 152.233.10.20" },
      })
    );
    expect(req.headers.get(CLIENT_IP_HEADER)).toBe("203.0.113.7");
  });

  it("pisa el valor que mande el cliente", () => {
    const req = withClientIp(
      new Request("http://x/api/auth/sign-in/email", {
        headers: {
          "x-forwarded-for": "203.0.113.7, 152.233.10.20",
          [CLIENT_IP_HEADER]: "198.51.100.66",
        },
      })
    );
    expect(req.headers.get(CLIENT_IP_HEADER)).toBe("203.0.113.7");
  });

  it("sin IP utilizable, borra el del cliente en vez de confiarlo", () => {
    const req = withClientIp(
      new Request("http://x/api/auth/sign-in/email", {
        headers: { [CLIENT_IP_HEADER]: "198.51.100.66" },
      })
    );
    expect(req.headers.get(CLIENT_IP_HEADER)).toBeNull();
  });

  it("conserva método, URL, body y el resto de los headers", async () => {
    const req = withClientIp(
      new Request("http://x/api/auth/sign-in/email?y=1", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://x",
          "x-forwarded-for": "203.0.113.7",
        },
        body: JSON.stringify({ email: "a@b.c" }),
      })
    );
    expect(req.method).toBe("POST");
    expect(req.url).toBe("http://x/api/auth/sign-in/email?y=1");
    expect(req.headers.get("origin")).toBe("http://x");
    expect(await req.json()).toEqual({ email: "a@b.c" });
  });
});
