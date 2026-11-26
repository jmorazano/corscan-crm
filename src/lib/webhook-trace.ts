import type { WebhookChange, WebhookPayload } from "@/server/inbox/webhook";

/**
 * Rastro de los eventos de Meta que NO son tráfico de mensajes.
 *
 * Caso que lo motivó (25-nov-2026, Distrito Inmobiliario): Meta aceptó el
 * pedido de historial de un número y nunca mandó un tramo. Para saber si no
 * había llegado nada o si había llegado algo que el CRM ignoró hubo que
 * deducirlo del TAMAÑO de los pedidos HTTP. Con una línea por evento se ve
 * directo en `railway logs` (buscar `[meta]`).
 *
 * Puro y sin contenido: solo el tipo de evento, ids de negocio, cantidades y
 * los NOMBRES de los campos. Jamás texto de mensajes, nombres ni teléfonos
 * de contactos.
 */

/** Tiempo real: una línea por mensaje sería ruido (y ya dejan su propio rastro). */
const QUIET_FIELDS = new Set(["messages", "smb_message_echoes"]);

const MAX_EVENTS_PER_LINE = 8;
const MAX_KEYS = 12;

/** Los nombres vienen de afuera: se acotan antes de escribirlos en el log. */
function token(value: unknown, max = 40): string {
  return String(value ?? "")
    .replace(/[^\w.-]/g, "")
    .slice(0, max);
}

function part(label: string, value: unknown): string | null {
  const t = token(value);
  return t ? `${label}=${t}` : null;
}

/** Una línea corta por change, o `null` si es tráfico de mensajes. */
export function describeWebhookChange(
  change: WebhookChange,
  entryId?: string | null
): string | null {
  const field = token(change.field) || "sin_campo";
  if (QUIET_FIELDS.has(field)) return null;
  const value = change.value;
  if (!value || typeof value !== "object") return `${field} sin_valor`;

  const pn = part("pn", value.metadata?.phone_number_id) ?? part("waba", entryId);
  const out: (string | null)[] = [field, pn];

  if (field === "history") {
    const chunks = Array.isArray(value.history) ? value.history : [];
    if (chunks.length === 0) {
      // Segundo webhook del mismo field: detalle de media de un placeholder.
      const media = Array.isArray(value.messages) ? value.messages.length : 0;
      out.push(media > 0 ? `media=${media}` : "vacio");
    } else {
      let threads = 0;
      let messages = 0;
      const errors: string[] = [];
      for (const chunk of chunks) {
        for (const e of chunk.errors ?? []) errors.push(token(e.code) || "?");
        for (const t of chunk.threads ?? []) {
          threads++;
          messages += t.messages?.length ?? 0;
        }
      }
      const meta = chunks[0]?.metadata;
      out.push(
        `tramos=${chunks.length}`,
        `hilos=${threads}`,
        `mensajes=${messages}`,
        part("fase", meta?.phase),
        part("orden", meta?.chunk_order),
        part("progreso", meta?.progress),
        errors.length > 0 ? `errores=${errors.slice(0, 5).join(",")}` : null
      );
    }
  } else if (field === "smb_app_state_sync") {
    out.push(`contactos=${Array.isArray(value.state_sync) ? value.state_sync.length : 0}`);
  } else {
    // Estados de plantillas, `account_update` (PARTNER_REMOVED…) y cualquier
    // campo que el CRM todavía no procesa: el evento y la FORMA, sin valores.
    const keys = Object.keys(value)
      .map((k) => token(k, 30))
      .filter(Boolean)
      .slice(0, MAX_KEYS);
    out.push(
      typeof value.event === "string" ? part("evento", value.event) : null,
      keys.length > 0 ? `claves=${keys.join(",")}` : null
    );
  }
  return out.filter(Boolean).join(" ");
}

/**
 * Línea para el log de un POST del webhook, o `null` si solo traía mensajes.
 * `bytes` = tamaño del cuerpo: un tramo de historial pesa cientos de KB.
 */
export function describeWebhookPayload(payload: WebhookPayload, bytes: number): string | null {
  const events: string[] = [];
  let extra = 0;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const line = describeWebhookChange(change, entry.id ?? null);
      if (!line) continue;
      if (events.length < MAX_EVENTS_PER_LINE) events.push(line);
      else extra++;
    }
  }
  if (events.length === 0) return null;
  return `[meta] bytes=${bytes} · ${events.join(" · ")}${extra > 0 ? ` · +${extra} más` : ""}`;
}
