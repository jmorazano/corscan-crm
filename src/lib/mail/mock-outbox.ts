/**
 * Bandeja del mail-mock (029): con el entorno de pruebas activo
 * (`isMockEnabled()`) NINGÚN correo sale a un SMTP real — queda acá y el
 * E2E lo lee por GET /api/dev/mail-mock. Knobs para el camino infeliz:
 * `failNext` (el próximo envío falla como un SMTP caído) y `disabled`
 * (la instancia se comporta como si no tuviera SMTP configurado).
 */
export type MockMail = {
  at: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

type MailMockState = {
  messages: MockMail[];
  failNext: boolean;
  disabled: boolean;
};

const globalForMock = globalThis as unknown as { __voceroMailMock?: MailMockState };

export function getMailMockState(): MailMockState {
  if (!globalForMock.__voceroMailMock) {
    globalForMock.__voceroMailMock = { messages: [], failNext: false, disabled: false };
  }
  return globalForMock.__voceroMailMock;
}

export function resetMailMockState(): void {
  globalForMock.__voceroMailMock = { messages: [], failNext: false, disabled: false };
}
