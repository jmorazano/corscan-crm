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
  /** 023: conversaciones que devuelve la Conversations API simulada. */
  history: IgMockConversation[];
  historyFails: boolean;
};

export type IgMockConversation = {
  id: string;
  customer: { igsid: string; username: string; name: string };
  messages: { id: string; fromCustomer: boolean; text: string; at: Date }[];
};

const MIN = 60 * 1000;

/**
 * Historial de ejemplo: una conversación reciente con 25 mensajes (Meta
 * solo deja leer los 20 últimos), otra de hace 10 días y una de hace 90
 * (fuera de la ventana de 60 días).
 */
function sampleHistory(now = Date.now()): IgMockConversation[] {
  const conv = (
    n: string,
    customer: IgMockConversation["customer"],
    count: number,
    newestMinutesAgo: number
  ): IgMockConversation => ({
    id: `aWdfconv_${n}`,
    customer,
    messages: Array.from({ length: count }, (_, i) => ({
      id: `aWdfmsg_${n}_${i + 1}`,
      fromCustomer: i % 2 === 0,
      text:
        i % 2 === 0
          ? `Consulta ${i + 1} de ${customer.name.split(" ")[0]}`
          : `Respuesta ${i + 1} del negocio`,
      at: new Date(now - (newestMinutesAgo + (count - 1 - i) * 30) * MIN),
    })),
  });
  return [
    conv("sofia", { igsid: "771100220033", username: "sofia.viajera", name: "Sofía Viajera" }, 25, 120),
    conv("martin", { igsid: "771100220044", username: "martin.obras", name: "Martín Obras" }, 4, 10 * 24 * 60),
    conv("vieja", { igsid: "771100220055", username: "cliente.viejo", name: "Cliente Viejo" }, 3, 90 * 24 * 60),
  ];
}

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
    history: sampleHistory(),
    historyFails: false,
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
