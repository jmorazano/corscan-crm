/**
 * Estado en memoria del harness wa-mock (solo dev/test). Vive en globalThis
 * porque Next recarga módulos en dev; una instancia = un proceso, así que el
 * outbox en memoria es suficiente para las aserciones del self-test.
 */

export type OutboxEntry = {
  n: string;
  /** wamid literal de la respuesta del mock (004): evita que los guiones lo
   * reconstruyan a mano como `wamid.mock.out.<n>`. */
  waMessageId: string;
  phoneNumberId: string;
  to: string;
  type: string;
  body: unknown;
  at: string;
};

export type MockTemplate = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  body: string;
  /** Components crudos del alta (008): el guion E2E verifica el HEADER. */
  components?: unknown;
};

type WaMockState = {
  outbox: OutboxEntry[];
  templates: MockTemplate[];
  counter: number;
  /** Knob 008: el próximo upload resumable falla con 500 (camino infeliz). */
  failUploads: boolean;
  /** Knob 014: el próximo `POST …/messages` falla con 500 (Meta caída). */
  failNextSend: boolean;
  /** 017: solicitudes `smb_app_data` recibidas (sync_type + fecha). */
  syncRequests: { phoneNumberId: string; syncType: string; at: string }[];
  /** Knob 017: el próximo sync de historial devuelve «rechazado» (2593109). */
  historyDeclined: boolean;
};

const globalForMock = globalThis as unknown as { __waMockState?: WaMockState };

export function getWaMockState(): WaMockState {
  if (!globalForMock.__waMockState) {
    globalForMock.__waMockState = {
      outbox: [],
      templates: [],
      counter: 0,
      failUploads: false,
      failNextSend: false,
      syncRequests: [],
      historyDeclined: false,
    };
  }
  // Migración suave del estado en caliente (dev recarga módulos).
  if (globalForMock.__waMockState.syncRequests === undefined) {
    globalForMock.__waMockState.syncRequests = [];
  }
  if (globalForMock.__waMockState.historyDeclined === undefined) {
    globalForMock.__waMockState.historyDeclined = false;
  }
  if (globalForMock.__waMockState.failUploads === undefined) {
    globalForMock.__waMockState.failUploads = false;
  }
  if (globalForMock.__waMockState.failNextSend === undefined) {
    globalForMock.__waMockState.failNextSend = false;
  }
  return globalForMock.__waMockState;
}

export function resetWaMockState(): void {
  // El contador NO se reinicia: los wamid ya emitidos siguen persistidos y
  // repetirlos hacía que la dedup descartara en silencio los "nuevos"
  // entrantes de un guion que limpia el outbox entre pasos.
  const counter = globalForMock.__waMockState?.counter ?? 0;
  globalForMock.__waMockState = {
    outbox: [],
    templates: [],
    counter,
    failUploads: false,
    failNextSend: false,
    syncRequests: [],
    historyDeclined: false,
  };
}

// Prefijo único por arranque del proceso: el contador vive en memoria y al
// reiniciar el dev server volvería a emitir wamid ya persistidos — la dedup
// (por diseño) los descartaría en silencio y los guiones E2E fallan raro.
const bootTag = Date.now().toString(36);

export function nextN(): string {
  return `${bootTag}.${++getWaMockState().counter}`;
}
