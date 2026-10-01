/**
 * Estado del simulador de MiniHotel (028) para el self-test.
 *
 * Vive en `globalThis` porque Next recarga módulos en caliente (mismo patrón
 * que `mcp-mock/state.ts`). Nunca guarda contraseñas: la bitácora del
 * simulador registra QUÉ se pidió, no con qué credencial.
 */

export type MiniHotelMockKnobs = {
  /** Persistente: todo pedido responde `ERR A01` (IP no autorizada). */
  ipNotAuthorized: boolean;
  /** UNA vez: credencial rechazada (`ERR 863` / error de contenido). */
  nextUnauthorized: boolean;
  /** UNA vez: 500 con una página HTML (servicio caído). */
  failNext: boolean;
  /** UNA vez: 200 con HTML de error (respuesta ilegible). */
  garbageNext: boolean;
  /** Persistente: demora de cada respuesta, en ms. */
  delayMs: number;
  /** Persistente: noches SIN lugar para ningún tipo (YYYY-MM-DD, inclusive). */
  soldOut: { from: string; to: string } | null;
  /** Persistente: si no es null, solo acepta ese usuario. */
  expectUser: string | null;
};

export type MiniHotelMockCall = {
  at: string;
  op: "immediate" | "bulk" | "getRoomTypes" | "getRooms" | "unknown";
  user: string | null;
  hotel: string | null;
  from: string | null;
  to: string | null;
  adults: number | null;
  children: number | null;
  babies: number | null;
  rateCode: string | null;
};

type MiniHotelMockState = { knobs: MiniHotelMockKnobs; calls: MiniHotelMockCall[] };

export const DEFAULT_MINIHOTEL_KNOBS: MiniHotelMockKnobs = {
  ipNotAuthorized: false,
  nextUnauthorized: false,
  failNext: false,
  garbageNext: false,
  delayMs: 0,
  soldOut: null,
  expectUser: null,
};

const g = globalThis as unknown as { __voceroMiniHotelMock?: MiniHotelMockState };

export function miniHotelMockState(): MiniHotelMockState {
  return (g.__voceroMiniHotelMock ??= { knobs: { ...DEFAULT_MINIHOTEL_KNOBS }, calls: [] });
}

export function resetMiniHotelMock(): void {
  g.__voceroMiniHotelMock = { knobs: { ...DEFAULT_MINIHOTEL_KNOBS }, calls: [] };
}

export function recordMiniHotelCall(call: MiniHotelMockCall): void {
  const state = miniHotelMockState();
  state.calls.push(call);
  if (state.calls.length > 200) state.calls.splice(0, state.calls.length - 200);
}
