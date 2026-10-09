/**
 * Estado en memoria del google-mock (research D10): OAuth + Calendar
 * simulados para el self-test. Como el wa-mock, un reinicio lo borra.
 * JAMÁS es fallback en runtime: solo responde tras el gate de mocks y si
 * las URLs de Google apuntan explícitamente a él.
 */

export type MockEvent = {
  id: string;
  calendarId: string;
  summary: string;
  description?: string;
  start: string; // ISO
  end: string; // ISO
};

export type MockBusy = { start: string; end: string };

/** 034: planilla simulada. `granted` = la app tiene acceso por `drive.file`. */
export type MockSpreadsheet = {
  id: string;
  title: string;
  tabs: Record<string, string[][]>;
  granted: boolean;
};

type State = {
  n: number;
  events: MockEvent[];
  /** Ocupados "externos" (eventos que no creó el CRM) por calendario. */
  busy: MockBusy[];
  revoked: Set<string>;
  /** Próxima autorización termina en access_denied (camino infeliz). */
  nextAuthError: string | null;
  /** El próximo refresh_token emitido termina en -invalid. */
  issueInvalidRefresh: boolean;
  /** La próxima llamada a la API de Calendar devuelve 500. */
  failNextApi: boolean;
  /** Emails de la "cuenta" que autoriza. */
  accountEmail: string;
  /** 034: planillas de la "cuenta" (las creadas por la app nacen con acceso). */
  spreadsheets: Map<string, MockSpreadsheet>;
  /** 034: el próximo «agregar fila» devuelve 500 (la lectura ya pasó). */
  failNextAppend: boolean;
};

const globalForMock = globalThis as unknown as { __googleMock?: State };

function fresh(): State {
  return {
    n: 0,
    events: [],
    busy: [],
    revoked: new Set(),
    nextAuthError: null,
    issueInvalidRefresh: false,
    failNextApi: false,
    accountEmail: "agenda@negocio.test",
    spreadsheets: seedSpreadsheets(),
    failNextAppend: false,
  };
}

/**
 * 034: dos planillas que existen en el Drive de la cuenta pero a las que la
 * app NO tiene acceso hasta que se eligen con el selector (`drive.file`).
 */
function seedSpreadsheets(): Map<string, MockSpreadsheet> {
  const list: MockSpreadsheet[] = [
    {
      id: "mock-sheet-precios-0001",
      title: "Precios 2026",
      granted: false,
      tabs: {
        Temporadas: [
          ["Cabaña", "Temporada", "Precio por noche", "Capacidad"],
          ["Arroyo", "Alta", "$ 120.000", "4"],
          ["Arroyo", "Baja", "$ 90.000", "4"],
          ["Bosque", "Alta", "$ 150.000", "6"],
          ["Bosque", "Baja", "$ 110.000", "6"],
        ],
        Notas: [["Nota"], ["Seña del 30% para confirmar"]],
      },
    },
    {
      id: "mock-sheet-conciliacion-0002",
      title: "Conciliación de pagos",
      granted: false,
      tabs: {
        Pagos: [["Fecha", "Cliente", "Importe", "Banco", "Operación", "Observaciones"]],
        Vacía: [],
      },
    },
  ];
  return new Map(list.map((s) => [s.id, s]));
}

export function getGoogleMockState(): State {
  if (!globalForMock.__googleMock) globalForMock.__googleMock = fresh();
  return globalForMock.__googleMock;
}

export function resetGoogleMockState(): void {
  globalForMock.__googleMock = fresh();
}

export function nextMockN(): number {
  const s = getGoogleMockState();
  s.n += 1;
  return s.n;
}

export const MOCK_CALENDARS = [
  { id: "agenda@negocio.test", summary: "Agenda del negocio", primary: true },
  { id: "turnos@group.calendar.google.com", summary: "Turnos", primary: false },
] as const;

/** Bearer válido: emitido por el mock y no revocado. */
export function isValidAccessToken(bearer: string): boolean {
  const s = getGoogleMockState();
  return bearer.startsWith("mock-access-") && !s.revoked.has(bearer);
}

/** id_token mínimo (header.payload.sig) con el email de la cuenta. */
export function mockIdToken(email: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ email, sub: "mock-sub" })}.sig`;
}
