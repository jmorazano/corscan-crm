import {
  normalizeOperation,
  OPERATION_LABEL,
  type ListingOperation,
  type ListingRecord,
} from "@/lib/meli/listing";

/**
 * Búsqueda PURA sobre el snapshot de publicaciones (025, D5). Sin I/O: la
 * usa el agente en cada turno y los tests la cubren entera.
 *
 * Criterios:
 * - La gente escribe «depto», «dpto», «comprar», «alquilar», «Nueva
 *   Cordoba» sin tilde: sinónimos por familia y comparación sin acentos.
 * - Un filtro numérico sobre un dato que la publicación NO trae la excluye:
 *   ofrecer «2 dormitorios» sobre un aviso que no lo dice sería inventar.
 * - Precio sin moneda: se usa la moneda DOMINANTE de lo que queda (en
 *   Córdoba, alquiler en pesos y venta en dólares). Comparar 1.000.000 de
 *   pesos contra 100.000 dólares no tiene sentido.
 * - Sin coincidencias: se informa qué pasaría soltando cada filtro, para que
 *   el agente ofrezca alternativas reales en vez de un «no hay» seco.
 */

export type ListingFilters = {
  operation?: string | undefined;
  property_type?: string | undefined;
  zone?: string | undefined;
  bedrooms_min?: number | undefined;
  rooms_min?: number | undefined;
  price_min?: number | undefined;
  price_max?: number | undefined;
  currency?: string | undefined;
  query?: string | undefined;
};

export type SearchOutcome = {
  results: ListingRecord[];
  total: number;
  /** Moneda con la que se compararon los precios (si hubo filtro de precio). */
  priceCurrency: string | null;
  /** Solo sin resultados: cuántas habría soltando cada filtro. */
  relaxations: { without: keyof ListingFilters; count: number }[];
  /** Filtros que no se entendieron (se ignoraron). */
  ignored: string[];
};

export const MAX_RESULTS = 5;

export function fold(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Familias de tipo de propiedad: lo que dice el cliente → cómo lo publica ML. */
const TYPE_FAMILIES: { key: string; asked: RegExp; published: RegExp }[] = [
  {
    key: "departamento",
    asked: /\b(departamento|depto|dpto|depa|monoambiente|mono ambiente|loft|semipiso|piso)s?\b/,
    published: /\b(departamento|monoambiente|loft|semipiso|piso|duplex|triplex)\b/,
  },
  { key: "casa", asked: /\b(casa|chalet|casita)s?\b/, published: /\b(casa|chalet)\b/ },
  { key: "ph", asked: /\bph\b/, published: /\bph\b/ },
  {
    key: "terreno",
    asked: /\b(terreno|lote|loteo)s?\b/,
    published: /\b(terreno|lote)s?\b/,
  },
  { key: "local", asked: /\b(local|locales|local comercial)\b/, published: /\blocal/ },
  { key: "oficina", asked: /\b(oficina|consultorio)s?\b/, published: /\b(oficina|consultorio)/ },
  { key: "cochera", asked: /\b(cochera|garage|garaje)s?\b/, published: /\b(cochera|garage|garaje)/ },
  { key: "galpon", asked: /\b(galpon|deposito)(es|s)?\b/, published: /\b(galpon|deposito)/ },
  { key: "campo", asked: /\b(campo|quinta)s?\b/, published: /\b(campo|quinta)/ },
];

export function normalizeCurrency(raw: string | null | undefined): string | null {
  const t = fold(raw);
  if (!t) return null;
  if (/^(usd|us\$|u\$s|u\$d|dolar|dolares|dollar|dollars)$/.test(t) || t.includes("dolar")) return "USD";
  if (/^(ars|\$|peso|pesos|ar\$)$/.test(t) || t.includes("peso")) return "ARS";
  if (/^[a-z]{3}$/.test(t)) return t.toUpperCase();
  return null;
}

/** «comprar» → venta, «alquilar» → alquiler, «temporario» → temporario. */
export function operationFromAsk(raw: string | null | undefined): ListingOperation | null {
  const t = fold(raw);
  if (!t) return null;
  if (/temporar|por dia|por noche|vacacion/.test(t)) return "alquiler_temporario";
  if (/compr|venta|vend|adquir/.test(t)) return "venta";
  if (/alquil|rent|arrend/.test(t)) return "alquiler";
  return normalizeOperation(raw);
}

function haystack(l: ListingRecord): string {
  return fold(
    [l.title, l.propertyType, l.neighborhood, l.city, l.state, l.description, ...(l.features ?? [])]
      .filter(Boolean)
      .join(" | ")
  );
}

function matchesType(l: ListingRecord, asked: string): boolean {
  const a = fold(asked);
  const family = TYPE_FAMILIES.find((f) => f.asked.test(a) || f.key === a);
  const published = fold(`${l.propertyType ?? ""} ${l.title}`);
  if (family) return family.published.test(published);
  return published.includes(a);
}

function matchesZone(l: ListingRecord, zone: string): boolean {
  const z = fold(zone).replace(/^(barrio|b°|bo\.?|zona)\s+/, "");
  if (!z) return true;
  const place = fold([l.neighborhood, l.city, l.state, l.addressLine, l.title].filter(Boolean).join(" | "));
  return place.includes(z);
}

function dominantCurrency(list: ListingRecord[]): string | null {
  const counts = new Map<string, number>();
  for (const l of list) {
    if (l.price === null || !l.currency) continue;
    counts.set(l.currency, (counts.get(l.currency) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [c, n] of counts) {
    if (n > bestN) {
      best = c;
      bestN = n;
    }
  }
  return best;
}

type Applied = { list: ListingRecord[]; priceCurrency: string | null; ignored: string[] };

function applyFilters(all: readonly ListingRecord[], f: ListingFilters): Applied {
  const ignored: string[] = [];
  let list = [...all];

  if (f.operation) {
    const op = operationFromAsk(f.operation);
    if (op) list = list.filter((l) => l.operation === op);
    else ignored.push(`operation=${f.operation}`);
  }
  if (f.property_type) {
    const asked = f.property_type;
    list = list.filter((l) => matchesType(l, asked));
  }
  if (f.zone) {
    const zone = f.zone;
    list = list.filter((l) => matchesZone(l, zone));
  }
  if (typeof f.bedrooms_min === "number" && f.bedrooms_min > 0) {
    const n = f.bedrooms_min;
    list = list.filter((l) => l.bedrooms !== null && l.bedrooms >= n);
  }
  if (typeof f.rooms_min === "number" && f.rooms_min > 0) {
    const n = f.rooms_min;
    list = list.filter((l) => l.rooms !== null && l.rooms >= n);
  }

  let priceCurrency: string | null = null;
  const hasMin = typeof f.price_min === "number" && f.price_min > 0;
  const hasMax = typeof f.price_max === "number" && f.price_max > 0;
  if (hasMin || hasMax) {
    priceCurrency = normalizeCurrency(f.currency) ?? dominantCurrency(list);
    list = list.filter((l) => {
      if (l.price === null || l.currency !== priceCurrency) return false;
      if (hasMin && l.price < f.price_min!) return false;
      if (hasMax && l.price > f.price_max!) return false;
      return true;
    });
  }

  if (f.query) {
    const tokens = fold(f.query)
      .split(/[^a-z0-9ñ]+/)
      .filter((t) => t.length >= 3);
    if (tokens.length > 0) {
      list = list.filter((l) => {
        const h = haystack(l);
        return tokens.every((t) => h.includes(t));
      });
    }
  }
  return { list, priceCurrency, ignored };
}

function sortResults(list: ListingRecord[], f: ListingFilters): ListingRecord[] {
  const byPrice = typeof f.price_max === "number" || typeof f.price_min === "number";
  return [...list].sort((a, b) => {
    if (byPrice) return (a.price ?? Infinity) - (b.price ?? Infinity);
    return (b.mlUpdatedAt?.getTime() ?? 0) - (a.mlUpdatedAt?.getTime() ?? 0);
  });
}

export function searchListings(all: readonly ListingRecord[], filters: ListingFilters): SearchOutcome {
  const applied = applyFilters(all, filters);
  const sorted = sortResults(applied.list, filters);
  const relaxations: SearchOutcome["relaxations"] = [];
  if (sorted.length === 0) {
    const keys: (keyof ListingFilters)[] = [
      "price_max",
      "price_min",
      "zone",
      "bedrooms_min",
      "rooms_min",
      "property_type",
      "query",
      "operation",
    ];
    for (const key of keys) {
      if (filters[key] === undefined || filters[key] === null || filters[key] === "") continue;
      const loosened: ListingFilters = { ...filters, [key]: undefined };
      if (key === "price_max" || key === "price_min") {
        loosened.price_max = undefined;
        loosened.price_min = undefined;
      }
      const count = applyFilters(all, loosened).list.length;
      if (count > 0 && !relaxations.some((r) => r.without === key)) relaxations.push({ without: key, count });
    }
  }
  return {
    results: sorted.slice(0, MAX_RESULTS),
    total: sorted.length,
    priceCurrency: applied.priceCurrency,
    relaxations,
    ignored: applied.ignored,
  };
}

/**
 * Resuelve la publicación que nombra el modelo: id de ML («MLA123…»,
 * «MLA-123…»), enlace de la ficha, o un pedazo del título.
 */
export function resolveListing(
  all: readonly ListingRecord[],
  ref: string | null | undefined
): ListingRecord | null {
  const raw = (ref ?? "").trim();
  if (!raw) return null;
  const idMatch = /\b([A-Z]{3})-?(\d{6,})\b/i.exec(raw);
  if (idMatch) {
    const id = `${idMatch[1]!.toUpperCase()}${idMatch[2]}`;
    const byId = all.find((l) => l.itemId === id);
    if (byId) return byId;
  }
  const byLink = all.find((l) => l.permalink && raw.includes(l.permalink));
  if (byLink) return byLink;
  const q = fold(raw);
  if (q.length < 4) return null;
  const byTitle = all.filter((l) => fold(l.title).includes(q));
  return byTitle.length === 1 ? byTitle[0]! : null;
}

/* ---------- resumen del inventario (sección del prompt y «sin resultados») ---------- */

export type InventorySummary = {
  total: number;
  byOperation: { operation: ListingOperation | null; label: string; count: number; types: { type: string; count: number }[]; priceRange: string | null }[];
  zones: { zone: string; count: number }[];
};

function priceRange(list: ListingRecord[]): string | null {
  const cur = dominantCurrency(list);
  if (!cur) return null;
  const prices = list.filter((l) => l.currency === cur && l.price !== null).map((l) => l.price!);
  if (prices.length === 0) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? formatPrice(min, cur) : `${formatPrice(min, cur)} a ${formatPrice(max, cur)}`;
}

export function inventorySummary(all: readonly ListingRecord[], maxZones = 12): InventorySummary {
  const ops = new Map<ListingOperation | null, ListingRecord[]>();
  for (const l of all) {
    const bucket = ops.get(l.operation) ?? [];
    bucket.push(l);
    ops.set(l.operation, bucket);
  }
  const byOperation = [...ops.entries()]
    .map(([operation, list]) => {
      const types = new Map<string, number>();
      for (const l of list) {
        const t = l.propertyType ?? "Otro";
        types.set(t, (types.get(t) ?? 0) + 1);
      }
      return {
        operation,
        label: operation ? OPERATION_LABEL[operation] : "Otras publicaciones",
        count: list.length,
        types: [...types.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
        priceRange: priceRange(list),
      };
    })
    .sort((a, b) => b.count - a.count);

  const zones = new Map<string, number>();
  for (const l of all) {
    const z = l.neighborhood ?? l.city;
    if (!z) continue;
    zones.set(z, (zones.get(z) ?? 0) + 1);
  }
  return {
    total: all.length,
    byOperation,
    zones: [...zones.entries()]
      .map(([zone, count]) => ({ zone, count }))
      .sort((a, b) => b.count - a.count || a.zone.localeCompare(b.zone))
      .slice(0, maxZones),
  };
}

/** «$ 850.000» / «USD 120.000» — separador de miles con punto, sin decimales si no hacen falta. */
export function formatPrice(price: number, currency: string | null): string {
  const rounded = Number.isInteger(price) ? price : Math.round(price * 100) / 100;
  const [int, dec] = String(rounded).split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const amount = dec ? `${grouped},${dec}` : grouped;
  if (!currency || currency === "ARS") return `$ ${amount}`;
  return `${currency} ${amount}`;
}
