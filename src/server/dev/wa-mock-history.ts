import { HISTORY_DECLINED_CODE } from "@/lib/history-import";
import { deliverToWebhook } from "@/server/dev/wa-mock-inbound";
import { getWaMockState, nextN } from "@/server/dev/wa-mock-state";

/**
 * wa-mock 017: simula la sincronización de coexistence. Ante
 * `POST {pn}/smb_app_data` entrega por loopback los webhooks reales:
 * - `history`: dos chunks DESORDENADOS (el 2 antes que el 1; progreso 50 y
 *   100) con dos hilos, mensajes dentro y fuera de la ventana de 60 días,
 *   un placeholder de media y luego su detalle; o el rechazo 2593109 si el
 *   knob `historyDeclined` está activo.
 * - `smb_app_state_sync`: un nombre de agenda para el primer hilo.
 * También `smb_message_echoes` a pedido (`POST /api/dev/wa-mock/echo`).
 */

export const MOCK_BUSINESS_PHONE = "5215500000000";
export const MOCK_HISTORY_THREAD_A = "5493515550777";
export const MOCK_HISTORY_THREAD_B = "5493515550778";
export const MOCK_ADDRESS_BOOK_NAME = "Marcos Proveedor Drones";

const DAY = 86_400;

function envelope(wabaId: string, phoneNumberId: string, field: string, value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: wabaId,
        changes: [
          {
            field,
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: MOCK_BUSINESS_PHONE, phone_number_id: phoneNumberId },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

function msg(
  from: string,
  agoSeconds: number,
  body: string | null,
  extra: Record<string, unknown> = {},
  status = "READ"
) {
  const now = Math.floor(Date.now() / 1000);
  return {
    from,
    id: `wamid.mock.hist.${nextN()}`,
    timestamp: String(now - agoSeconds),
    type: body === null ? "media_placeholder" : "text",
    ...(body === null ? {} : { text: { body } }),
    history_context: { status },
    ...extra,
  };
}

/** Chunks del historial (ids fijos para el detalle de media). */
export function buildHistoryChunks(wabaId: string, phoneNumberId: string) {
  const biz = MOCK_BUSINESS_PHONE;
  const a = MOCK_HISTORY_THREAD_A;
  const b = MOCK_HISTORY_THREAD_B;
  const mediaId = `wamid.mock.hist.media.${nextN()}`;
  // Chunk 1 (fase 1: día 1..90) — más viejo: incluye un mensaje de 70 días
  // (fuera de los 60) y la media de hace 5 días.
  const chunk1 = envelope(wabaId, phoneNumberId, "history", {
    history: [
      {
        metadata: { phase: 1, chunk_order: 1, progress: 100 },
        threads: [
          {
            id: a,
            messages: [
              msg(a, 70 * DAY, "Hola, necesito presupuesto para relevar 40 ha en Alta Gracia"),
              msg(biz, 70 * DAY - 600, "Buenas Marcos, te paso: por esa superficie arrancamos en 800 mil"),
              msg(a, 20 * DAY, "Dale, confirmame para la semana que viene"),
              msg(biz, 20 * DAY - 300, "Confirmado, martes 9 hs vamos con el Matrice", {}, "DELIVERED"),
              { ...msg(a, 5 * DAY, null), id: mediaId },
            ],
          },
          {
            id: b,
            messages: [
              msg(b, 65 * DAY, "¿Hacen mensuras?"),
              msg(biz, 65 * DAY - 120, "No, solo relevamiento LiDAR; te derivo con un agrimensor"),
            ],
          },
        ],
      },
    ],
  });
  // Chunk 2 (fase 0: último día) — llega PRIMERO a propósito.
  const chunk2 = envelope(wabaId, phoneNumberId, "history", {
    history: [
      {
        metadata: { phase: 0, chunk_order: 2, progress: 50 },
        threads: [
          {
            id: a,
            messages: [
              msg(a, 2 * 3600, "Che, ¿al final el informe lo mandan hoy?"),
              msg(biz, 3600, "Sí, te llega esta tarde", {}, "SENT"),
            ],
          },
        ],
      },
    ],
  });
  // Detalle de media del placeholder (mismo field, `messages[]`).
  const media = envelope(wabaId, phoneNumberId, "history", {
    messages: [
      {
        from: a,
        id: mediaId,
        timestamp: String(Math.floor(Date.now() / 1000) - 5 * DAY),
        type: "image",
        image: { caption: "Foto del terreno desde la ruta", mime_type: "image/jpeg", id: "mockmedia1" },
      },
    ],
  });
  const declined = envelope(wabaId, phoneNumberId, "history", {
    history: [
      {
        errors: [
          {
            code: HISTORY_DECLINED_CODE,
            title: "History sync is turned off by the business from the WhatsApp Business App",
            message: "History sync is turned off by the business from the WhatsApp Business App",
          },
        ],
      },
    ],
  });
  return { chunk1, chunk2, media, declined };
}

export function buildStateSyncPayload(wabaId: string, phoneNumberId: string) {
  return envelope(wabaId, phoneNumberId, "smb_app_state_sync", {
    state_sync: [
      {
        type: "contact",
        contact: {
          full_name: MOCK_ADDRESS_BOOK_NAME,
          first_name: "Marcos",
          phone_number: `+${MOCK_HISTORY_THREAD_A}`,
        },
        action: "add",
        metadata: { timestamp: String(Math.floor(Date.now() / 1000)) },
      },
    ],
  });
}

export function buildEchoPayload(input: {
  wabaId: string;
  phoneNumberId: string;
  to: string;
  text: string;
  waMessageId?: string;
}) {
  return envelope(input.wabaId, input.phoneNumberId, "smb_message_echoes", {
    message_echoes: [
      {
        from: MOCK_BUSINESS_PHONE,
        to: input.to,
        id: input.waMessageId ?? `wamid.mock.echo.${nextN()}`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "text",
        text: { body: input.text },
      },
    ],
  });
}

/** Programa la entrega de los webhooks de un sync (fire-and-forget). */
export function scheduleSyncDelivery(input: {
  wabaId: string;
  phoneNumberId: string;
  syncType: string;
}): void {
  const state = getWaMockState();
  state.syncRequests.push({
    phoneNumberId: input.phoneNumberId,
    syncType: input.syncType,
    at: new Date().toISOString(),
  });
  const fire = (payload: unknown, delayMs: number) =>
    setTimeout(() => {
      void deliverToWebhook(payload).catch((err) =>
        console.warn("[wa-mock] entrega de sync falló:", err instanceof Error ? err.message : err)
      );
    }, delayMs);

  if (input.syncType === "smb_app_state_sync") {
    fire(buildStateSyncPayload(input.wabaId, input.phoneNumberId), 200);
    return;
  }
  if (input.syncType === "history") {
    const chunks = buildHistoryChunks(input.wabaId, input.phoneNumberId);
    if (state.historyDeclined) {
      state.historyDeclined = false;
      fire(chunks.declined, 300);
      return;
    }
    fire(chunks.chunk2, 300);
    fire(chunks.chunk1, 900);
    fire(chunks.media, 1500);
  }
}
