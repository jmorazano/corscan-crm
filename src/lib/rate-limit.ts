/**
 * Limitación de tasa in-process por clave (IP) con ventana deslizante
 * (FR-062). Suficiente para el monolito de una instancia; sin Redis
 * (Constitución II).
 */

type Bucket = {
  /** timestamps (ms) de los intentos */
  hits: number[];
  /** ventana de ESTA clave: sin esto no se puede saber cuándo caducó */
  windowMs: number;
};

const globalForRl = globalThis as unknown as {
  __voceroRateLimit?: Map<string, Bucket>;
  __voceroRateLimitSweep?: number;
};

/**
 * Barrido de claves caducadas. Sin esto el Map crece para siempre: cada IP
 * que golpeó el login una vez y no volvió deja su entrada viva hasta que se
 * reinicia el proceso. Con el conector MCP (016) se suma una clave por
 * empresa, así que la fuga deja de ser teórica.
 *
 * Es O(n) sobre las claves, cada 500 llamadas: irrelevante al lado de lo que
 * cuesta la request que lo dispara, y sin timers ni procesos de fondo
 * (Constitución II).
 */
const SWEEP_EVERY = 500;

function sweep(buckets: Map<string, Bucket>, now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.hits.every((t) => t <= now - bucket.windowMs)) {
      buckets.delete(key);
    }
  }
}

function store(): Map<string, Bucket> {
  if (!globalForRl.__voceroRateLimit) {
    globalForRl.__voceroRateLimit = new Map();
  }
  return globalForRl.__voceroRateLimit;
}

export type RateLimitResult = { allowed: boolean; remaining: number };

export function checkRateLimit(
  key: string,
  opts: { windowMs: number; max: number },
  now: number = Date.now()
): RateLimitResult {
  const buckets = store();

  globalForRl.__voceroRateLimitSweep =
    (globalForRl.__voceroRateLimitSweep ?? 0) + 1;
  if (globalForRl.__voceroRateLimitSweep >= SWEEP_EVERY) {
    globalForRl.__voceroRateLimitSweep = 0;
    sweep(buckets, now);
  }

  const cutoff = now - opts.windowMs;
  const hits = (buckets.get(key)?.hits ?? []).filter((t) => t > cutoff);

  if (hits.length >= opts.max) {
    buckets.set(key, { hits, windowMs: opts.windowMs });
    return { allowed: false, remaining: 0 };
  }
  hits.push(now);
  buckets.set(key, { hits, windowMs: opts.windowMs });
  return { allowed: true, remaining: opts.max - hits.length };
}

/** Solo para tests. */
export function resetRateLimit(): void {
  store().clear();
  globalForRl.__voceroRateLimitSweep = 0;
}

/** Solo para tests: cuántas claves vivas hay (verifica que el barrido corre). */
export function rateLimitKeyCount(): number {
  return store().size;
}

/** 10 intentos / 10 minutos por IP en login y registro (FR-062). */
export const AUTH_RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 10 };
