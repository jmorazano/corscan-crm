import {
  addDaysToKey,
  isValidTimeZone,
  localDateKey,
  parseDateKey,
  toLocalParts,
  zonedToUtc,
} from "@/lib/time";

/**
 * Reglas PURAS de la sección Métricas (024), compartidas por el servidor
 * (ventanas y relleno de la serie) y la UI (etiquetas y formatos). Un
 * único selector de período recorta tarjetas e histograma, así los números
 * siempre coinciden:
 *
 * - `day`  → últimos 30 días, una barra por día.
 * - `week` → últimas 12 semanas (lunes a domingo), una barra por semana.
 * - `year` → últimos 12 meses, una barra por mes.
 *
 * Las barras se cortan en la hora LOCAL del propietario; la última es el
 * período en curso.
 */

export const METRICS_RANGES = ["day", "week", "year"] as const;
export type MetricsRange = (typeof METRICS_RANGES)[number];
/** Unidad de `date_trunc` de Postgres (y de las claves de la serie). */
export type BucketUnit = "day" | "week" | "month";

export const DEFAULT_METRICS_TIMEZONE = "America/Argentina/Buenos_Aires";

export const RANGE_SPECS: Record<
  MetricsRange,
  { unit: BucketUnit; buckets: number; label: string; period: string; previous: string }
> = {
  day: {
    unit: "day",
    buckets: 30,
    label: "Diario",
    period: "Últimos 30 días",
    previous: "los 30 días anteriores",
  },
  week: {
    unit: "week",
    buckets: 12,
    label: "Semanal",
    period: "Últimas 12 semanas",
    previous: "las 12 semanas anteriores",
  },
  year: {
    unit: "month",
    buckets: 12,
    label: "Anual",
    period: "Últimos 12 meses",
    previous: "los 12 meses anteriores",
  },
};

export function isMetricsRange(value: string): value is MetricsRange {
  return (METRICS_RANGES as readonly string[]).includes(value);
}

/**
 * Query de `GET /api/metrics`: rango (default `day`) y zona horaria del
 * navegador (inválida o ausente → Buenos Aires). Un rango desconocido es
 * error del cliente, no un default silencioso.
 */
export function parseMetricsQuery(
  params: URLSearchParams
): { ok: true; range: MetricsRange; timeZone: string } | { ok: false } {
  const rawRange = params.get("range") ?? "day";
  if (!isMetricsRange(rawRange)) return { ok: false };
  const rawTz = (params.get("tz") ?? "").trim();
  const timeZone =
    rawTz && rawTz.length <= 64 && isValidTimeZone(rawTz) ? rawTz : DEFAULT_METRICS_TIMEZONE;
  return { ok: true, range: rawRange, timeZone };
}

/** Ventana de un pedido de métricas: claves de las barras + bordes en UTC. */
export type MetricsWindow = {
  unit: BucketUnit;
  /** Inicio LOCAL de cada barra ("YYYY-MM-DD"), de la más vieja a la actual. */
  keys: string[];
  /** Instante UTC del inicio de la primera barra. */
  start: Date;
  /** Instante UTC del inicio de la barra SIGUIENTE a la actual (futuro). */
  end: Date;
  /**
   * Inicio del período de comparación: la misma DURACIÓN transcurrida,
   * justo antes de `start`. Comparar 29 días y medio contra 30 días
   * completos haría que el período en curso siempre pareciera en baja.
   */
  previousStart: Date;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Suma meses a una clave "YYYY-MM-01". */
export function addMonthsToKey(key: string, months: number): string {
  const d = parseDateKey(key);
  if (!d) throw new Error(`fecha inválida: ${key}`);
  const t = new Date(Date.UTC(d.year, d.month - 1 + months, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-01`;
}

function keyToUtc(timeZone: string, key: string): Date {
  const d = parseDateKey(key);
  if (!d) throw new Error(`fecha inválida: ${key}`);
  return zonedToUtc(timeZone, d.year, d.month, d.day, 0, 0);
}

/** Calcula la ventana del rango en la zona dada, relativa a `now`. */
export function metricsWindow(range: MetricsRange, timeZone: string, now: Date): MetricsWindow {
  const { unit, buckets } = RANGE_SPECS[range];
  const today = localDateKey(timeZone, now);

  let current: string;
  let step: (key: string, n: number) => string;
  if (unit === "day") {
    current = today;
    step = addDaysToKey;
  } else if (unit === "week") {
    // Lunes de esta semana (date_trunc('week') de Postgres también es lunes).
    const weekday = toLocalParts(timeZone, now).weekday; // 0 = domingo
    current = addDaysToKey(today, -((weekday + 6) % 7));
    step = (key, n) => addDaysToKey(key, n * 7);
  } else {
    current = `${today.slice(0, 7)}-01`;
    step = addMonthsToKey;
  }

  const keys: string[] = [];
  for (let i = buckets - 1; i >= 0; i--) keys.push(step(current, -i));

  const start = keyToUtc(timeZone, keys[0]!);
  const end = keyToUtc(timeZone, step(current, 1));
  const elapsed = Math.max(0, now.getTime() - start.getTime());
  return { unit, keys, start, end, previousStart: new Date(start.getTime() - elapsed) };
}

export type SeriesPoint = { key: string; whatsapp: number; instagram: number };

/**
 * Serie completa del histograma: una barra por clave, en 0 donde no hubo
 * mensajes (la BD solo devuelve las barras con datos). Filas con claves
 * fuera de la ventana o canales desconocidos se ignoran.
 */
export function fillSeries(
  keys: readonly string[],
  rows: ReadonlyArray<{ bucket: string; channel: string; count: number }>
): SeriesPoint[] {
  const byKey = new Map<string, SeriesPoint>(
    keys.map((key) => [key, { key, whatsapp: 0, instagram: 0 }])
  );
  for (const row of rows) {
    const point = byKey.get(row.bucket);
    if (!point) continue;
    if (row.channel === "whatsapp") point.whatsapp += row.count;
    else if (row.channel === "instagram") point.instagram += row.count;
  }
  return keys.map((key) => byKey.get(key)!);
}

/** Lo que devuelve `GET /api/metrics` (contrato de la UI). */
export type MetricsOverview = {
  range: MetricsRange;
  timeZone: string;
  unit: BucketUnit;
  received: { total: number; whatsapp: number; instagram: number; previous: number };
  agentSent: {
    total: number;
    previous: number;
    /** Todo lo que envió la empresa en el período (agente + equipo + campañas + celular). */
    allSent: number;
  };
  responseTime: {
    avgMs: number | null;
    medianMs: number | null;
    count: number;
    previousAvgMs: number | null;
    /** Espera configurada antes de responder (022): va incluida en el tiempo. */
    replyDelayMs: number;
  };
  series: SeriesPoint[];
};

/* ------------------------------------------------------------------
 * Formatos (UI)
 * ------------------------------------------------------------------ */

const COUNT_FORMAT = new Intl.NumberFormat("es-AR");

export function formatCount(n: number): string {
  return COUNT_FORMAT.format(n);
}

/** Cambio relativo contra el período anterior; sin base no hay cambio. */
export function deltaRatio(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous <= 0) return null;
  return (current - previous) / previous;
}

/** "+12 %", "−8 %", "0 %" (signo menos tipográfico). */
export function formatDelta(ratio: number): string {
  const pct = Math.round(ratio * 100);
  if (pct === 0) return "0 %";
  return `${pct > 0 ? "+" : "−"}${formatCount(Math.abs(pct))} %`;
}

/** Duración legible: "24 s", "3 min 12 s", "18 min", "2 h 5 min", "1 d 3 h". */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const s = totalSeconds % 60;
    return totalMinutes >= 10 || s === 0 ? `${totalMinutes} min` : `${totalMinutes} min ${s} s`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const m = totalMinutes % 60;
    return m === 0 ? `${totalHours} h` : `${totalHours} h ${m} min`;
  }
  const days = Math.floor(totalHours / 24);
  const h = totalHours % 24;
  return h === 0 ? `${days} d` : `${days} d ${h} h`;
}

const MONTHS_SHORT = [
  "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic",
] as const;
const MONTHS_LONG = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;
const WEEKDAYS_LONG = [
  "domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado",
] as const;

function partsOf(key: string): { year: number; month: number; day: number } {
  const d = parseDateKey(key);
  if (!d) throw new Error(`fecha inválida: ${key}`);
  return d;
}

/** Etiqueta corta del eje X: "26/9" (día y semana) o "sep" (mes; enero lleva el año). */
export function bucketAxisLabel(key: string, unit: BucketUnit): string {
  const { year, month, day } = partsOf(key);
  if (unit === "month") {
    return month === 1 ? `ene ${String(year).slice(2)}` : MONTHS_SHORT[month - 1]!;
  }
  return `${day}/${month}`;
}

/** Etiqueta del tooltip: "viernes 26 de septiembre", "22 al 28 de septiembre", "septiembre 2026". */
export function bucketLongLabel(key: string, unit: BucketUnit): string {
  const { year, month, day } = partsOf(key);
  if (unit === "month") return `${MONTHS_LONG[month - 1]} ${year}`;
  if (unit === "day") {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return `${WEEKDAYS_LONG[weekday]} ${day} de ${MONTHS_LONG[month - 1]}`;
  }
  const last = partsOf(addDaysToKey(key, 6));
  if (last.month === month) return `${day} al ${last.day} de ${MONTHS_LONG[month - 1]}`;
  return `${day} de ${MONTHS_LONG[month - 1]} al ${last.day} de ${MONTHS_LONG[last.month - 1]}`;
}

/** Rango visible del período: "28 ago – 26 sep 2026". */
export function periodLabel(keys: readonly string[], unit: BucketUnit, now: Date, timeZone: string): string {
  const first = keys[0];
  if (!first) return "";
  const a = partsOf(first);
  const b = partsOf(localDateKey(timeZone, now));
  const left =
    unit === "month" ? `${MONTHS_SHORT[a.month - 1]}` : `${a.day} ${MONTHS_SHORT[a.month - 1]}`;
  const leftYear = a.year !== b.year ? ` ${a.year}` : "";
  return `${left}${leftYear} – ${b.day} ${MONTHS_SHORT[b.month - 1]} ${b.year}`;
}

/**
 * Marcas del eje Y con valores redondos (paso 1·2·5 × 10ⁿ, ~4 marcas).
 * Sin datos → [0, 1] para que el eje no colapse.
 */
export function niceTicks(max: number, target = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  const safeStep = Math.max(1, step);
  const top = Math.ceil(max / safeStep) * safeStep;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += safeStep) ticks.push(v);
  return ticks;
}
