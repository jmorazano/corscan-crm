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
  };
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
