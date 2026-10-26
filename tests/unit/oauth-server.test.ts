import { describe, expect, it } from "vitest";
import {
  generateAccessToken,
  generateAuthCode,
  generateRefreshToken,
  hashSecret,
  isIdle,
  looksLikeAccessToken,
  looksLikeAuthCode,
  looksLikeRefreshToken,
} from "@/lib/oauth-server/tokens";
import { isValidCodeVerifier, s256Challenge, verifyS256 } from "@/lib/oauth-server/pkce";
import {
  clientLabelFor,
  isAllowedRedirectUri,
  redirectMatchesRegistered,
} from "@/lib/oauth-server/redirect-uris";
import { safeNextPath } from "@/lib/oauth-server/next-path";
import {
  authorizationServerMetadata,
  protectedResourceMetadata,
  resourceUrl,
  wwwAuthenticate,
} from "@/lib/oauth-server/metadata";
import {
  buildRedirect,
  fieldsFromBody,
  parseRegisterRequest,
  parseTokenRequest,
  validateAuthorizeRequest,
} from "@/lib/oauth-server/params";

const BASE = "https://crm.example.com";
const RESOURCE = `${BASE}/api/mcp`;
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";

describe("tokens (040 D5)", () => {
  it("genera secretos con su forma y prefijo", () => {
    expect(looksLikeAccessToken(generateAccessToken())).toBe(true);
    expect(looksLikeRefreshToken(generateRefreshToken())).toBe(true);
    expect(looksLikeAuthCode(generateAuthCode())).toBe(true);
    expect(looksLikeAccessToken(generateRefreshToken())).toBe(false);
    expect(generateAccessToken()).not.toBe(generateAccessToken());
  });

  it("hashea con SHA-256 hex determinista", () => {
    expect(hashSecret("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("una conexión sin uso por más de 90 días está inactiva", () => {
    const created = new Date("2026-01-01T00:00:00Z");
    expect(isIdle(null, created, new Date("2026-03-31T00:00:00Z"))).toBe(false);
    expect(isIdle(null, created, new Date("2026-04-02T00:00:00Z"))).toBe(true);
    expect(
      isIdle(new Date("2026-03-30T00:00:00Z"), created, new Date("2026-04-02T00:00:00Z"))
    ).toBe(false);
  });
});

describe("PKCE S256 (RFC 7636)", () => {
  // Vector del apéndice B del RFC 7636.
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

  it("calcula y verifica el vector del RFC", () => {
    expect(s256Challenge(verifier)).toBe(challenge);
    expect(verifyS256(verifier, challenge)).toBe(true);
  });

  it("rechaza verifier distinto o mal formado", () => {
    expect(verifyS256(`${verifier.slice(0, -1)}A`, challenge)).toBe(false);
    expect(verifyS256("corto", challenge)).toBe(false);
    expect(isValidCodeVerifier("a".repeat(129))).toBe(false);
    expect(isValidCodeVerifier("a b".repeat(20))).toBe(false);
  });
});

describe("direcciones de retorno (040 D4)", () => {
  it.each([
    CLAUDE,
    "https://claude.com/api/mcp/auth_callback",
    "http://localhost:33418/callback",
    "http://127.0.0.1:5173/oauth/callback?x=1",
    "http://[::1]:8080/cb",
  ])("permite %s", (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(true);
  });

  it.each([
    "https://claude.ai.evil.com/api/mcp/auth_callback",
    "https://claude.ai/api/mcp/auth_callback/",
    "https://claude.ai/api/mcp/auth_callback?x=1",
    "http://claude.ai/api/mcp/auth_callback",
    "http://localhost@evil.com/cb",
    "http://user:pw@localhost:3000/cb",
    "https://localhost:3000/cb",
    "http://localhost:3000/cb#frag",
    "http://10.0.0.1:3000/cb",
    "javascript:alert(1)",
    "",
  ])("rechaza %s", (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(false);
  });

  it("exige la registrada, salvo el puerto de loopback", () => {
    expect(redirectMatchesRegistered(CLAUDE, [CLAUDE])).toBe(true);
    expect(redirectMatchesRegistered("https://claude.com/api/mcp/auth_callback", [CLAUDE])).toBe(
      false
    );
    expect(
      redirectMatchesRegistered("http://localhost:4001/callback", ["http://localhost:3999/callback"])
    ).toBe(true);
    expect(
      redirectMatchesRegistered("http://localhost:4001/otro", ["http://localhost:3999/callback"])
    ).toBe(false);
    expect(
      redirectMatchesRegistered("http://127.0.0.1:4001/callback", ["http://localhost:3999/callback"])
    ).toBe(false);
  });

  it("la etiqueta sale del retorno, no del nombre registrado", () => {
    expect(clientLabelFor(CLAUDE)).toBe("Claude (claude.ai)");
    expect(clientLabelFor("http://localhost:1/cb")).toMatch(/esta computadora/);
  });
});

describe("safeNextPath (040 D6)", () => {
  it("acepta solo el consentimiento del mismo sitio", () => {
    expect(safeNextPath("/oauth/authorize?client_id=acl_1&state=x")).toBe(
      "/oauth/authorize?client_id=acl_1&state=x"
    );
  });

  it.each([
    "/inbox",
    "//evil.com/oauth/authorize?x=1",
    "https://evil.com/oauth/authorize?x=1",
    "/oauth/authorize",
    "/oauth/authorizeX?x=1",
    "/oauth/authorize?\\evil",
    "/oauth/authorize? x",
    null,
    42,
  ])("rechaza %s", (raw) => {
    expect(safeNextPath(raw)).toBeNull();
  });
});

describe("metadatos (contracts/oauth.md §1–2)", () => {
  it("arma los JSON de descubrimiento", () => {
    const as = authorizationServerMetadata(`${BASE}/`);
    expect(as.issuer).toBe(BASE);
    expect(as.token_endpoint).toBe(`${BASE}/api/oauth/token`);
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    const pr = protectedResourceMetadata(BASE);
    expect(pr.resource).toBe(RESOURCE);
    expect(pr.authorization_servers).toEqual([BASE]);
    expect(resourceUrl(`${BASE}//`)).toBe(RESOURCE);
  });

  it("el 401 apunta a los metadatos del recurso", () => {
    expect(wwwAuthenticate(BASE, { invalidToken: false })).toBe(
      `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/api/mcp"`
    );
    expect(wwwAuthenticate(BASE, { invalidToken: true })).toMatch(/error="invalid_token"$/);
  });
});

describe("registro dinámico (contracts/oauth.md §3)", () => {
  it("acepta un cliente público de Claude", () => {
    const r = parseRegisterRequest({
      client_name: "Claude",
      redirect_uris: [CLAUDE, CLAUDE],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      extra: true,
    });
    expect(r.ok && r.value.redirectUris).toEqual([CLAUDE]);
  });

  it("rechaza retornos ajenos, clientes confidenciales y grants raros", () => {
    const bad = (body: unknown) => {
      const r = parseRegisterRequest(body);
      return r.ok ? null : r.error.error;
    };
    expect(bad({ redirect_uris: ["https://evil.com/cb"] })).toBe("invalid_redirect_uri");
    expect(bad({})).toBe("invalid_redirect_uri");
    expect(bad({ redirect_uris: [CLAUDE], token_endpoint_auth_method: "client_secret_post" })).toBe(
      "invalid_client_metadata"
    );
    expect(bad({ redirect_uris: [CLAUDE], grant_types: ["client_credentials"] })).toBe(
      "invalid_client_metadata"
    );
  });
});

describe("validateAuthorizeRequest (contracts/oauth.md §4)", () => {
  const client = { id: "acl_1", redirectUris: [CLAUDE] };
  const good = {
    response_type: "code",
    client_id: "acl_1",
    redirect_uri: CLAUDE,
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    state: "st",
    resource: RESOURCE,
  };

  it("ok con todo en orden", () => {
    const v = validateAuthorizeRequest(good, { resource: RESOURCE, client });
    expect(v.kind).toBe("ok");
  });

  it("cliente o retorno desconocidos: error SIN redirigir", () => {
    expect(validateAuthorizeRequest(good, { resource: RESOURCE, client: null }).kind).toBe("fatal");
    expect(
      validateAuthorizeRequest(
        { ...good, redirect_uri: "https://claude.com/api/mcp/auth_callback" },
        { resource: RESOURCE, client }
      ).kind
    ).toBe("fatal");
  });

  it("el resto vuelve al cliente con error y state", () => {
    for (const params of [
      { ...good, response_type: "token" },
      { ...good, code_challenge_method: "plain" },
      { ...good, code_challenge: "x" },
      { ...good, resource: "https://otro.com/api/mcp" },
    ]) {
      const v = validateAuthorizeRequest(params, { resource: RESOURCE, client });
      expect(v.kind).toBe("redirect");
      if (v.kind === "redirect") expect(v.state).toBe("st");
    }
  });

  it("buildRedirect agrega parámetros y state", () => {
    expect(buildRedirect(CLAUDE, { code: "c" }, "s t")).toBe(`${CLAUDE}?code=c&state=s+t`);
  });
});

describe("parseTokenRequest (contracts/oauth.md §5)", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

  it("canje de código y renovación", () => {
    const code = parseTokenRequest(
      {
        grant_type: "authorization_code",
        code: "c",
        redirect_uri: CLAUDE,
        client_id: "acl_1",
        code_verifier: verifier,
      },
      { resource: RESOURCE }
    );
    expect(code.ok && code.value.grantType).toBe("authorization_code");
    const refresh = parseTokenRequest(
      { grant_type: "refresh_token", refresh_token: "vrt_x", client_id: "acl_1" },
      { resource: RESOURCE }
    );
    expect(refresh.ok && refresh.value.grantType).toBe("refresh_token");
  });

  it("errores estándar", () => {
    const err = (f: Record<string, string>) => {
      const r = parseTokenRequest(f, { resource: RESOURCE });
      return r.ok ? null : r.error.error;
    };
    expect(err({ grant_type: "client_credentials" })).toBe("unsupported_grant_type");
    expect(err({ grant_type: "authorization_code", code: "c", client_id: "a" })).toBe(
      "invalid_request"
    );
    expect(
      err({
        grant_type: "authorization_code",
        code: "c",
        redirect_uri: CLAUDE,
        client_id: "a",
        code_verifier: "corto",
      })
    ).toBe("invalid_grant");
  });

  it("lee form y JSON", () => {
    expect(fieldsFromBody("application/x-www-form-urlencoded", "a=1&b=x%20y")).toEqual({
      a: "1",
      b: "x y",
    });
    expect(fieldsFromBody("application/json", '{"a":"1","n":2}')).toEqual({ a: "1" });
    expect(fieldsFromBody("application/json", "{")).toEqual({});
  });
});
