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

export type SeriesPoint = {
  key: string;
  whatsapp: number;
  instagram: number;
  /**
   * Recibidos del historial de WhatsApp IMPORTADO del celular
   * (`source='history'`, 017) en esa barra: el volumen que manejaba el
   * teléfono antes de conectar el CRM. Se dibuja aparte («Pasado») y NO suma
   * a `whatsapp`. El de Instagram (023) no entra: Meta solo da los 20
   * últimos mensajes por conversación y el volumen sería engañoso.
   */
  past: number;
  /**
   * Conversaciones DISTINTAS con algún recibido en vivo en esa barra
   * (WhatsApp + Instagram; el pasado importado no suma). Una conversación
   * que escribió en dos barras cuenta en ambas, pero una sola vez en el
   * total del período (`received.conversations`).
   */
  conversations: number;
};

/**
 * Serie completa del histograma: una barra por clave, en 0 donde no hubo
 * mensajes (la BD solo devuelve las barras con datos). Filas con claves
 * fuera de la ventana o canales desconocidos se ignoran; las del historial
 * importado (`past`) van a su propia cuenta.
 */
export function fillSeries(
  keys: readonly string[],
  rows: ReadonlyArray<{
    bucket: string;
    channel: string;
    count: number;
    past?: boolean;
    /** Conversaciones distintas del grupo (bucket, canal): los canales no se pisan. */
    conversations?: number;
  }>
): SeriesPoint[] {
  const byKey = new Map<string, SeriesPoint>(
    keys.map((key) => [key, { key, whatsapp: 0, instagram: 0, past: 0, conversations: 0 }])
  );
  for (const row of rows) {
    const point = byKey.get(row.bucket);
    if (!point) continue;
    if (row.channel !== "whatsapp" && row.channel !== "instagram") continue;
    if (row.past) point.past += row.count;
    else {
      point[row.channel] += row.count;
      point.conversations += row.conversations ?? 0;
    }
  }
  return keys.map((key) => byKey.get(key)!);
}

/** Total de recibidos del historial importado en la serie. */
export function pastTotal(series: ReadonlyArray<SeriesPoint>): number {
  return series.reduce((sum, p) => sum + p.past, 0);
}

/**
 * En cuántas conversaciones DISTINTAS se dieron los mensajes de una
 * tarjeta, con los mismos filtros que esos mensajes. Una conversación es de
 * un solo canal, así que `total = whatsapp + instagram`.
 */
export type ConversationCounts = {
  total: number;
  whatsapp: number;
  instagram: number;
  previous: number;
};

/** Lo que devuelve `GET /api/metrics` (contrato de la UI). */
export type MetricsOverview = {
  range: MetricsRange;
  timeZone: string;
  unit: BucketUnit;
  received: {
    total: number;
    whatsapp: number;
    instagram: number;
    previous: number;
    /** 040: el período anterior por canal (los asistentes comparan canal por canal). */
    previousWhatsapp: number;
    previousInstagram: number;
    /**
     * Recibidos del historial de WhatsApp importado del período (los
     * mismos de `series[].past`). Van APARTE: no suman a `total` ni entran en la
     * comparación (conectar el CRM se vería como una suba o una caída que
     * no existió).
     */
    past: number;
    conversations: ConversationCounts & {
      previousWhatsapp: number;
      previousInstagram: number;
    };
  };
  agentSent: {
    total: number;
    whatsapp: number;
    instagram: number;
    previous: number;
    /** Conversaciones en las que respondió el agente. */
    conversations: ConversationCounts;
    /** Todo lo que envió la empresa en el período (agente + equipo + campañas + celular). */
    allSent: number;
  };
  responseTime: {
    /**
     * Mediana: el número principal de la tarjeta. Un mensaje que quedó
     * horas esperando con el agente apagado dispara el promedio; la mediana
     * dice cuánto tarda una respuesta típica.
     */
    medianMs: number | null;
    avgMs: number | null;
    count: number;
    /** Mediana del período anterior (se compara mediana con mediana). */
    previousMedianMs: number | null;
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

/** "1 conversación", "812 conversaciones". */
export function formatConversations(n: number): string {
  return `${formatCount(n)} ${n === 1 ? "conversación" : "conversaciones"}`;
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

/* ============================================================
 * 040 — Períodos que piden los asistentes («la semana pasada», un rango).
 * Mismas definiciones que la pantalla: los tres períodos de Métricas son
 * EXACTAMENTE `metricsWindow(day|week|year)` (paridad con la UI).
 * ============================================================ */

export const ASSISTANT_PERIODS = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "last_30_days",
  "last_12_weeks",
  "last_12_months",
  "this_year",
] as const;
export type AssistantPeriod = (typeof ASSISTANT_PERIODS)[number];

/** Tope de un rango `from`/`to` (días calendario, `to` inclusive). */
export const MAX_CUSTOM_PERIOD_DAYS = 400;

export type PeriodWindow = MetricsWindow & {
  /** Primer día local incluido y último día local incluido (YYYY-MM-DD). */
  fromKey: string;
  toKey: string;
  label: string;
};

const PERIOD_LABELS: Record<AssistantPeriod, string> = {
  today: "Hoy",
  yesterday: "Ayer",
  this_week: "Esta semana",
  last_week: "La semana pasada",
  this_month: "Este mes",
  last_month: "El mes pasado",
  last_30_days: RANGE_SPECS.day.period,
  last_12_weeks: RANGE_SPECS.week.period,
  last_12_months: RANGE_SPECS.year.period,
  this_year: "Este año",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function mondayOf(key: string): string {
  const d = parseDateKey(key)!;
  const weekday = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
  return addDaysToKey(key, -((weekday + 6) % 7));
}

function daysBetween(fromKey: string, toKeyExclusive: string): number {
  const a = parseDateKey(fromKey)!;
  const b = parseDateKey(toKeyExclusive)!;
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY_MS
  );
}

/** Unidad de la serie según el largo: ≤ 62 días → día, ≤ 26 semanas → semana. */
export function unitForDays(days: number): BucketUnit {
  if (days <= 62) return "day";
  if (days <= 26 * 7) return "week";
  return "month";
}

function bucketKeys(fromKey: string, toKeyExclusive: string, unit: BucketUnit): string[] {
  const keys: string[] = [];
  if (unit === "day") {
    for (let k = fromKey; k < toKeyExclusive; k = addDaysToKey(k, 1)) keys.push(k);
  } else if (unit === "week") {
    for (let k = mondayOf(fromKey); k < toKeyExclusive; k = addDaysToKey(k, 7)) keys.push(k);
  } else {
    for (let k = `${fromKey.slice(0, 7)}-01`; k < toKeyExclusive; k = addMonthsToKey(k, 1)) keys.push(k);
  }
  return keys;
}

/** Ventana de [fromKey, toKeyExclusive) local; compara contra la misma duración transcurrida. */
function customWindow(
  fromKey: string,
  toKeyExclusive: string,
  timeZone: string,
  now: Date,
  label: string
): PeriodWindow {
  const unit = unitForDays(daysBetween(fromKey, toKeyExclusive));
  const start = keyToUtc(timeZone, fromKey);
  const end = keyToUtc(timeZone, toKeyExclusive);
  const elapsed = Math.max(0, Math.min(now.getTime(), end.getTime()) - start.getTime());
  return {
    unit,
    keys: bucketKeys(fromKey, toKeyExclusive, unit),
    start,
    end,
    previousStart: new Date(start.getTime() - elapsed),
    fromKey,
    toKey: addDaysToKey(toKeyExclusive, -1),
    label,
  };
}

export function periodWindow(
  input: { period: AssistantPeriod } | { from: string; to: string },
  timeZone: string,
  now: Date
): { ok: true; window: PeriodWindow } | { ok: false; message: string } {
  const today = localDateKey(timeZone, now);
  if ("from" in input) {
    if (!parseDateKey(input.from) || !parseDateKey(input.to)) {
      return { ok: false, message: "Las fechas van como AAAA-MM-DD (por ejemplo 2026-10-01)." };
    }
    if (input.to < input.from) {
      return { ok: false, message: "La fecha «to» no puede ser anterior a «from»." };
    }
    const toExclusive = addDaysToKey(input.to, 1);
    if (daysBetween(input.from, toExclusive) > MAX_CUSTOM_PERIOD_DAYS) {
      return { ok: false, message: `El rango puede tener hasta ${MAX_CUSTOM_PERIOD_DAYS} días.` };
    }
    return {
      ok: true,
      window: customWindow(input.from, toExclusive, timeZone, now, `Del ${input.from} al ${input.to}`),
    };
  }

  const label = PERIOD_LABELS[input.period];
  const tomorrow = addDaysToKey(today, 1);
  switch (input.period) {
    case "last_30_days":
    case "last_12_weeks":
    case "last_12_months": {
      const range: MetricsRange =
        input.period === "last_30_days" ? "day" : input.period === "last_12_weeks" ? "week" : "year";
      const w = metricsWindow(range, timeZone, now);
      return { ok: true, window: { ...w, fromKey: w.keys[0]!, toKey: today, label } };
    }
    case "today":
      return { ok: true, window: customWindow(today, tomorrow, timeZone, now, label) };
    case "yesterday":
      return { ok: true, window: customWindow(addDaysToKey(today, -1), today, timeZone, now, label) };
    case "this_week":
      return { ok: true, window: customWindow(mondayOf(today), tomorrow, timeZone, now, label) };
    case "last_week": {
      const monday = mondayOf(today);
      return { ok: true, window: customWindow(addDaysToKey(monday, -7), monday, timeZone, now, label) };
    }
    case "this_month":
      return { ok: true, window: customWindow(`${today.slice(0, 7)}-01`, tomorrow, timeZone, now, label) };
    case "last_month": {
      const first = `${today.slice(0, 7)}-01`;
      return { ok: true, window: customWindow(addMonthsToKey(first, -1), first, timeZone, now, label) };
    }
    case "this_year":
      return { ok: true, window: customWindow(`${today.slice(0, 4)}-01-01`, tomorrow, timeZone, now, label) };
  }
}
