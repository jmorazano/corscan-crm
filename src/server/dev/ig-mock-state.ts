import { randomBytes } from "node:crypto";

/**
 * Estado en memoria del ig-mock (023): la cuenta simulada, los perfiles de
 * los clientes, lo que el CRM "envió" y las perillas del camino infeliz.
 * Vive en globalThis (sobrevive al HMR del dev server). SOLO self-test.
 */

export type IgMockSend = {
  mid: string;
  igUserId: string;
  recipientId: string;
  text: string;
  humanAgent: boolean;
  at: string;
};

export type IgMockState = {
  bootTag: string;
  counter: number;
  account: { igUserId: string; username: string; name: string };
  profiles: Map<string, { name: string | null; username: string | null }>;
  outbox: IgMockSend[];
  subscriptions: { fields: string; at: string }[];
  /** Perillas one-shot (se apagan al dispararse). */
  nextAuthError: string | null;
  failNextSend: "auth" | "error" | "down" | null;
  profileFails: boolean;
  refreshFails: boolean;
  subscribeFails: boolean;
  /** Persistente: el mock manda el eco de cada envío (como Instagram real). */
  echoSends: boolean;
};

declare global {
  var __igMockState: IgMockState | undefined;
}

function fresh(): IgMockState {
  return {
    bootTag: randomBytes(3).toString("hex"),
    counter: 0,
    account: {
      igUserId: "17841400000000001",
      username: "negocio.demo",
      name: "Negocio Demo",
    },
    profiles: new Map(),
    outbox: [],
    subscriptions: [],
    nextAuthError: null,
    failNextSend: null,
    profileFails: false,
    refreshFails: false,
    subscribeFails: false,
    echoSends: true,
  };
}

export function getIgMockState(): IgMockState {
  if (!globalThis.__igMockState) globalThis.__igMockState = fresh();
  return globalThis.__igMockState;
}

/** Reinicia todo salvo el contador (los ids siguen siendo únicos). */
export function resetIgMockState(): void {
  const prev = getIgMockState();
  const next = fresh();
  next.counter = prev.counter;
  next.bootTag = prev.bootTag;
  globalThis.__igMockState = next;
}

export function nextIgN(): string {
  const s = getIgMockState();
  s.counter += 1;
  return `${s.bootTag}.${s.counter}`;
}
