import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildSignedRequest, parseSignedRequest } from "@/lib/instagram/signed-request";

describe("signed_request de Meta (023)", () => {
  it("valida la firma y devuelve el user_id como texto", () => {
    const sr = buildSignedRequest({ user_id: "17841400000000001", issued_at: 1 }, "ig-secret");
    expect(parseSignedRequest(sr, ["ig-secret"])).toMatchObject({ user_id: "17841400000000001" });
  });

  it("un user_id NUMÉRICO de 17 dígitos no se redondea", () => {
    // Construido a mano: JSON.stringify de un number ya lo habría redondeado.
    const payload = Buffer.from('{"algorithm":"HMAC-SHA256","user_id":17841400000000001}').toString("base64url");
    const sig = createHmac("sha256", "k").update(payload).digest("base64url");
    expect(parseSignedRequest(`${sig}.${payload}`, ["k"])?.user_id).toBe("17841400000000001");
  });
  it("acepta cualquiera de los secretos configurados", () => {
    const sr = buildSignedRequest({ user_id: "u1" }, "meta-secret");
    expect(parseSignedRequest(sr, ["ig-secret", "meta-secret"])?.user_id).toBe("u1");
    expect(parseSignedRequest(sr, [undefined, null, "ig-secret"])).toBeNull();
  });
  it("rechaza firma alterada, payload alterado y formato inválido", () => {
    const sr = buildSignedRequest({ user_id: "u1" }, "k");
    const [sig, payload] = sr.split(".");
    expect(parseSignedRequest(`${sig}x.${payload}`, ["k"])).toBeNull();
    const forged = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "otro" })).toString("base64url");
    expect(parseSignedRequest(`${sig}.${forged}`, ["k"])).toBeNull();
    expect(parseSignedRequest("basura", ["k"])).toBeNull();
  });
});
