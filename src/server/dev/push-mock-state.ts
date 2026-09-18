/**
 * Estado en memoria del push-mock (013, FR-011): registra cada POST que el
 * servidor haría al push service. Solo existe tras el mockGuard.
 */
export type PushMockDelivery = {
  at: string;
  status: number;
  contentEncoding: string | null;
  ttl: string | null;
  urgency: string | null;
  /** `Authorization: vapid t=…, k=…` presente y bien formado. */
  vapid: boolean;
  bodyLength: number;
};

type PushMockState = { deliveries: PushMockDelivery[] };

const globalForMock = globalThis as unknown as { __voceroPushMock?: PushMockState };

export function getPushMockState(): PushMockState {
  if (!globalForMock.__voceroPushMock) {
    globalForMock.__voceroPushMock = { deliveries: [] };
  }
  return globalForMock.__voceroPushMock;
}

export function resetPushMockState(): void {
  globalForMock.__voceroPushMock = { deliveries: [] };
}
