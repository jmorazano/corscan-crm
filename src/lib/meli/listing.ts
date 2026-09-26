import { sanitizeForeignText } from "@/server/mcp/sanitize";
import type { MeliRawAttribute, MeliRawItem } from "@/lib/meli/client";

/**
 * Normalización PURA de una publicación de Mercado Libre (025, D4).
 *
 * Todo lo que viene de ML es texto AJENO: lo escribió quien publicó y pasó
 * por un tercero. Por eso los textos libres (título, descripción, dirección,
 * nombres de atributos) salen por `sanitizeForeignText` —sin invisibles, sin
 * marcadores del sistema, recortados— y los enlaces solo sobreviven si son
 * https y del dominio de ML del sitio. Lo que no se puede leer queda en
 * `null`: jamás se inventa un número.
 */

export type ListingOperation = "venta" | "alquiler" | "alquiler_temporario";

export type ListingRecord = {
  itemId: string;
  title: string;
  categoryId: string | null;
  operation: ListingOperation | null;
  propertyType: string | null;
  price: number | null;
  currency: string | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  coveredArea: number | null;
  totalArea: number | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  addressLine: string | null;
  permalink: string | null;
  thumbnail: string | null;
  features: string[];
  description: string | null;
  mlUpdatedAt: Date | null;
};

/** Dominio público de cada sitio de ML (los enlaces solo valen ahí). */
const SITE_DOMAINS: Record<string, string> = {
  MLA: "mercadolibre.com.ar",
  MLM: "mercadolibre.com.mx",
  MLB: "mercadolivre.com.br",
  MLC: "mercadolibre.cl",
  MCO: "mercadolibre.com.co",
  MLU: "mercadolibre.com.uy",
  MPE: "mercadolibre.com.pe",
  MEC: "mercadolibre.com.ec",
  MLV: "mercadolibre.com.ve",
};

export function siteDomain(siteId: string | null | undefined): string {
  return SITE_DOMAINS[siteId ?? "MLA"] ?? SITE_DOMAINS.MLA!;
}

export const MAX_TITLE_CHARS = 120;
export const MAX_DESCRIPTION_CHARS = 1500;
const MAX_FEATURES = 20;
const MAX_FEATURE_CHARS = 60;

/** Atributos que ya salen en campos propios (no se repiten como característica). */
const OWN_FIELDS = new Set([
  "OPERATION",
  "OPERATION_SUBTYPE",
  "PROPERTY_TYPE",
  "ROOMS",
  "BEDROOMS",
  "FULL_BATHROOMS",
  "PARKING_LOTS",
  "COVERED_AREA",
  "TOTAL_AREA",
  "MAINTENANCE_FEE",
  "IS_SUITABLE_FOR_PETS",
  "FURNISHED",
]);

/** Atributos con valor que vale la pena mostrar aunque no sean «Sí/No». */
const VALUED_FEATURES = new Set(["PROPERTY_AGE", "FLOORS", "UNIT_FLOOR", "ORIENTATION", "DISPOSITION", "WAREHOUSES"]);

/**
 * Número de un atributo: primero `struct.number` (lo más confiable), después
 * el primer número de `value_name` («30 m²», «1.500 m²», «2»). El punto entre
 * grupos de tres dígitos es separador de miles en español.
 */
export function attributeNumber(attr: MeliRawAttribute | undefined): number | null {
  if (!attr) return null;
  const struct = attr.values?.[0]?.struct?.number;
  if (typeof struct === "number" && Number.isFinite(struct)) return struct;
  return parseLooseNumber(attr.value_name ?? attr.values?.[0]?.name ?? null);
}

export function parseLooseNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = /\d[\d.,]*/.exec(raw);
  if (!m) return null;
  let s = m[0].replace(/[.,]$/, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, "");
  else s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function intOrNull(n: number | null): number | null {
  return n === null ? null : Math.round(n);
}

function attr(item: MeliRawItem, id: string): MeliRawAttribute | undefined {
  return (item.attributes ?? []).find((a) => a.id === id);
}

function attrText(item: MeliRawItem, id: string): string | null {
  const a = attr(item, id);
  const v = a?.value_name ?? a?.values?.[0]?.name ?? null;
  const clean = sanitizeForeignText(v, 60);
  return clean || null;
}

/** «Venta», «Alquiler», «Alquiler temporario» (o el título, si falta el atributo). */
export function normalizeOperation(raw: string | null | undefined): ListingOperation | null {
  const t = (raw ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (!t) return null;
  if (/temporar/.test(t)) return "alquiler_temporario";
  if (/alquiler|arriendo|renta\b|alquila/.test(t)) return "alquiler";
  if (/venta|vendo|se vende/.test(t)) return "venta";
  return null;
}

export const OPERATION_LABEL: Record<ListingOperation, string> = {
  venta: "Venta",
  alquiler: "Alquiler",
  alquiler_temporario: "Alquiler temporario",
};

/**
 * Enlace seguro de ML: https forzado (ML todavía devuelve `http://` en
 * `permalink`), host del dominio del sitio o un subdominio suyo
 * (`departamento.mercadolibre.com.ar`), sin credenciales en la URL.
 */
export function meliLink(raw: unknown, siteId: string | null | undefined): string | null {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 512) return null;
  let url: URL;
  try {
    url = new URL(raw.trim().replace(/^http:\/\//i, "https://"));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const domain = siteDomain(siteId);
  const host = url.hostname.toLowerCase();
  if (host !== domain && !host.endsWith(`.${domain}`)) return null;
  return url.toString();
}

/** Miniatura: solo imágenes servidas por ML por https. */
function meliImage(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim().replace(/^http:\/\//i, "https://"));
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !(host === "mlstatic.com" || host.endsWith(".mlstatic.com"))) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function placeName(...candidates: ({ name?: string } | null | undefined)[]): string | null {
  for (const c of candidates) {
    const clean = sanitizeForeignText(c?.name, 60);
    if (clean) return clean;
  }
  return null;
}

function yesNo(item: MeliRawItem, id: string, label: string): string | null {
  const v = attrText(item, id);
  if (!v) return null;
  const t = v.toLowerCase();
  if (t.startsWith("s")) return `${label}: Sí`;
  if (t.startsWith("n")) return `${label}: No`;
  return null;
}

function buildFeatures(item: MeliRawItem): string[] {
  const out: string[] = [];
  const fee = attrText(item, "MAINTENANCE_FEE");
  if (fee) out.push(`Expensas: ${fee}`);
  const pets = yesNo(item, "IS_SUITABLE_FOR_PETS", "Apto mascotas");
  if (pets) out.push(pets);
  const furnished = yesNo(item, "FURNISHED", "Amoblado");
  if (furnished) out.push(furnished);
  for (const a of item.attributes ?? []) {
    if (out.length >= MAX_FEATURES) break;
    if (!a.id || OWN_FIELDS.has(a.id)) continue;
    const name = sanitizeForeignText(a.name, MAX_FEATURE_CHARS);
    const value = sanitizeForeignText(a.value_name ?? a.values?.[0]?.name, MAX_FEATURE_CHARS);
    if (!name || !value) continue;
    if (/^s[ií]$/i.test(value)) out.push(name);
    else if (VALUED_FEATURES.has(a.id)) out.push(`${name}: ${value}`);
  }
  return [...new Set(out)].slice(0, MAX_FEATURES);
}

/**
 * Publicación de ML → registro del snapshot. `null` si no se puede usar
 * (sin id válido o sin título legible): mejor omitirla que mostrar basura.
 */
export function normalizeItem(
  item: MeliRawItem,
  description: string | null,
  siteId: string | null | undefined
): ListingRecord | null {
  const itemId = typeof item.id === "string" && /^[A-Z]{3}\d{4,}$/.test(item.id) ? item.id : null;
  if (!itemId) return null;
  const title = sanitizeForeignText(item.title, MAX_TITLE_CHARS);
  if (!title) return null;

  const operation =
    normalizeOperation(attrText(item, "OPERATION")) ?? normalizeOperation(title.slice(0, 40));
  const price = typeof item.price === "number" && Number.isFinite(item.price) && item.price > 0 ? item.price : null;
  const currency =
    typeof item.currency_id === "string" && /^[A-Z]{3}$/.test(item.currency_id) ? item.currency_id : null;
  const updated = item.last_updated ? new Date(item.last_updated) : null;
  const loc = item.location ?? null;
  const search = item.seller_address?.search_location ?? null;

  return {
    itemId,
    title,
    categoryId: typeof item.category_id === "string" ? item.category_id.slice(0, 20) : null,
    operation,
    propertyType: attrText(item, "PROPERTY_TYPE"),
    price,
    currency: price === null ? null : currency,
    rooms: intOrNull(attributeNumber(attr(item, "ROOMS"))),
    bedrooms: intOrNull(attributeNumber(attr(item, "BEDROOMS"))),
    bathrooms: intOrNull(attributeNumber(attr(item, "FULL_BATHROOMS"))),
    parking: intOrNull(attributeNumber(attr(item, "PARKING_LOTS"))),
    coveredArea: attributeNumber(attr(item, "COVERED_AREA")),
    totalArea: attributeNumber(attr(item, "TOTAL_AREA")),
    neighborhood: placeName(loc?.neighborhood, search?.neighborhood),
    city: placeName(loc?.city, search?.city, item.seller_address?.city),
    state: placeName(loc?.state, search?.state, item.seller_address?.state),
    addressLine: sanitizeForeignText(loc?.address_line, 120) || null,
    permalink: meliLink(item.permalink, siteId ?? item.site_id),
    thumbnail:
      meliImage(item.secure_thumbnail) ??
      meliImage(item.pictures?.[0]?.secure_url) ??
      meliImage(item.thumbnail),
    features: buildFeatures(item),
    description: sanitizeForeignText(description, MAX_DESCRIPTION_CHARS) || null,
    mlUpdatedAt: updated && !Number.isNaN(updated.getTime()) ? updated : null,
  };
}
