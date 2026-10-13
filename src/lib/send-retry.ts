/**
 * Reintento del envío de la respuesta del agente (036), PURO.
 *
 * Un 5xx de Meta, un corte de red o un timeout son transitorios: antes la
 * respuesta quedaba como error en el hilo y el cliente se quedaba sin nada
 * (Gonzalo, 13-oct-2026). Se reintenta dos veces con espera creciente. Los
 * errores definitivos (token vencido, ventana cerrada, 4xx de Meta) salen
 * al primer intento: reintentarlos no cambia nada.
 *
 * Riesgo aceptado: Graph no tiene clave de idempotencia, así que un 5xx que
 * Meta SÍ procesó puede terminar en un duplicado. Excepcional, y mucho mejor
 * que un chat mudo.
 */

export const SEND_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000];

const RETRYABLE_CODES = new Set(["meta_unavailable"]);

export function isRetryableSendCode(code: string | null | undefined): boolean {
  return code !== null && code !== undefined && RETRYABLE_CODES.has(code);
}

export async function withSendRetry<T>(
  fn: () => Promise<T>,
  opts: {
    /** Código del error (o null si no es un error de envío conocido). */
    codeOf: (err: unknown) => string | null;
    delays?: readonly number[];
    sleep?: (ms: number) => Promise<void>;
    onRetry?: (attempt: number, code: string) => void;
  }
): Promise<T> {
  const delays = opts.delays ?? SEND_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const code = opts.codeOf(err);
      const delay = delays[attempt];
      if (!isRetryableSendCode(code) || delay === undefined) throw err;
      opts.onRetry?.(attempt + 1, code as string);
      await sleep(delay);
    }
  }
}
