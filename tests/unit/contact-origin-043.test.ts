import { describe, expect, it } from "vitest";
import {
  META_ADS_TAG,
  adTag,
  matchOriginRules,
  opensConversation,
  originMonth,
  originRuleInput,
  originTag,
  sanitizeRuleTag,
} from "@/lib/contact-origin";
import { MAX_TAG_LENGTH } from "@/lib/tags";
import { normalizeArrivedMinDays } from "@/server/campaigns/recipients";

/** 043: etiquetas de origen en el contacto — reglas puras. */
describe("043 · mes y etiqueta", () => {
  it("corta el mes en hora de Argentina, no en UTC", () => {
    // 1-nov 01:30 UTC = 31-oct 22:30 en Córdoba.
    expect(originMonth(new Date("2026-11-01T01:30:00Z"))).toBe("2026-10");
    expect(originMonth(new Date("2026-11-01T03:00:00Z"))).toBe("2026-11");
    expect(originTag(META_ADS_TAG, new Date("2026-10-11T12:00:00Z"))).toBe("meta-ads-2026-10");
  });

  it("una fecha inválida no rompe (usa ahora)", () => {
    expect(originMonth(new Date("x"))).toMatch(/^\d{4}-\d{2}$/);
  });

  it("sin mes, la base sola", () => {
    expect(originTag("qr-local", new Date(), false)).toBe("qr-local");
  });
});

describe("043 · etiqueta base de una regla", () => {
  it("minúsculas, sin tildes ni símbolos, espacios a guiones", () => {
    expect(sanitizeRuleTag("  #Google Ads ")).toBe("google-ads");
    expect(sanitizeRuleTag("Promoción Día!")).toBe("promocion-dia");
    expect(sanitizeRuleTag("--qr__")).toBe("qr");
    expect(sanitizeRuleTag("¡¡!!")).toBeNull();
  });

  it("con el mes entra en el tope de 004", () => {
    const base = sanitizeRuleTag("x".repeat(100))!;
    expect(originTag(base, new Date()).length).toBeLessThanOrEqual(MAX_TAG_LENGTH);
  });

  it("el formulario valida frase y etiqueta", () => {
    expect(originRuleInput.safeParse({ phrase: "vi el anuncio en Google", tag: "Google Ads" }).data).toEqual({
      phrase: "vi el anuncio en Google",
      tag: "google-ads",
      appendMonth: true,
    });
    expect(originRuleInput.safeParse({ phrase: "ab", tag: "x" }).success).toBe(false);
    expect(originRuleInput.safeParse({ phrase: "!!!!", tag: "x" }).success).toBe(false);
    expect(originRuleInput.safeParse({ phrase: "hola qr", tag: "???" }).success).toBe(false);
  });
});

describe("043 · coincidencia de reglas", () => {
  const at = new Date("2026-10-22T21:20:00-03:00");
  const rules = [
    { phrase: "vi el anuncio en Google", tag: "google-ads", appendMonth: true },
    { phrase: "QR del local", tag: "qr-local", appendMonth: false },
  ];

  it("sin mayúsculas, tildes ni signos", () => {
    expect(
      matchOriginRules("Hola, VÍ el anuncio en google, y quiero ver el CRM funcionando.", rules, at)
    ).toEqual(["google-ads-2026-10"]);
    expect(matchOriginRules("vengo por el qr  del LOCAL!!", rules, at)).toEqual(["qr-local"]);
  });

  it("por palabras completas y sin texto no hay nada", () => {
    expect(matchOriginRules("vi el anuncio en googleplay", rules, at)).toEqual([]);
    expect(matchOriginRules("", rules, at)).toEqual([]);
    expect(matchOriginRules(null, rules, at)).toEqual([]);
  });

  it("varias reglas suman varias etiquetas, sin repetir", () => {
    const twice = [...rules, { phrase: "anuncio en google", tag: "google ads", appendMonth: true }];
    expect(matchOriginRules("vi el anuncio en Google por el QR del local", twice, at)).toEqual([
      "google-ads-2026-10",
      "qr-local",
    ]);
  });
});

describe("043 · el mensaje que abre la charla", () => {
  const at = new Date("2026-10-28T12:00:00Z");
  it("primero de la conversación o tras 24 h", () => {
    expect(opensConversation(null, at)).toBe(true);
    expect(opensConversation(new Date("2026-10-27T11:59:00Z"), at)).toBe(true);
    expect(opensConversation(new Date("2026-10-28T11:00:00Z"), at)).toBe(false);
  });
});

describe("043 · días del filtro de campaña", () => {
  it("1–365 enteros; lo demás es sin filtro", () => {
    expect(normalizeArrivedMinDays(15)).toBe(15);
    expect(normalizeArrivedMinDays("30")).toBe(30);
    for (const v of [0, -1, 366, 1.5, "", "abc", null, undefined]) {
      expect(normalizeArrivedMinDays(v)).toBeNull();
    }
  });
});

describe("043 · etiqueta por anuncio", () => {
  it("título abreviado, sin emojis ni tildes", () => {
    expect(adTag({ detail: "🌲 Suite Premium para Parejas", ref: "120254979031180427" })).toBe(
      "meta-suite-premium-para-parejas"
    );
    expect(adTag({ detail: "🍃 Descanso en las Sierras de Córdoba", ref: "120254979031180427" })).toBe(
      "meta-descanso-en-las-sierras-de-cordoba"
    );
  });

  it("entra en 40 caracteres sin cortar una palabra al medio", () => {
    const tag = adTag({ detail: "Relevamiento con dron y fotogrametría para obras en Córdoba capital", ref: "1" })!;
    expect(tag.length).toBeLessThanOrEqual(MAX_TAG_LENGTH);
    expect(tag).toBe("meta-relevamiento-con-dron-y");
  });

  it("sin título (o solo emojis), el id; sin nada, null", () => {
    expect(adTag({ detail: null, ref: "120254979031180427" })).toBe("meta-anuncio-31180427");
    expect(adTag({ detail: "🌲🌲", ref: "120254979031180427" })).toBe("meta-anuncio-31180427");
    expect(adTag({ detail: null, ref: null })).toBeNull();
  });

  it("un título que imitaría la del mes cae al id", () => {
    expect(adTag({ detail: "ADS 2026 10", ref: "999" })).toBe("meta-anuncio-999");
  });
});
