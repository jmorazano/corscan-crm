import { describe, expect, it } from "vitest";
import { describeWebhookChange, describeWebhookPayload } from "@/lib/webhook-trace";

/**
 * Rastro de los eventos de Meta que no son mensajes (26-nov-2026): tiene que
 * alcanzar para saber QUÉ llegó sin guardar nada de lo que dice.
 */
const pn = { phone_number_id: "1229663283573332", display_phone_number: "5493518177770" };

describe("describeWebhookChange", () => {
  it("el tráfico de mensajes no deja línea", () => {
    expect(describeWebhookChange({ field: "messages", value: { metadata: pn, messages: [] } })).toBeNull();
    expect(describeWebhookChange({ field: "smb_message_echoes", value: { metadata: pn } })).toBeNull();
  });

  it("un tramo de historial: número, cantidades, fase y progreso — sin contenido", () => {
    const line = describeWebhookChange({
      field: "history",
      value: {
        metadata: pn,
        history: [
          {
            metadata: { phase: 1, chunk_order: 23, progress: 44 },
            threads: [
              { id: "5493515550001", messages: [{ from: "5493515550001", id: "wamid.1", timestamp: "1", type: "text", text: { body: "hola Juan, te paso el CBU" } }] },
              { id: "5493515550002", messages: [{ from: "x", id: "wamid.2", timestamp: "1", type: "interactive" }, { from: "x", id: "wamid.3", timestamp: "1", type: "text" }] },
            ],
          },
        ],
      },
    });
    expect(line).toBe("history pn=1229663283573332 tramos=1 hilos=2 mensajes=3 fase=1 orden=23 progreso=44");
    expect(line).not.toMatch(/hola|CBU|5493515550001/);
  });

  it("el rechazo del historial deja el código", () => {
    expect(
      describeWebhookChange({
        field: "history",
        value: { metadata: pn, history: [{ errors: [{ code: 2593109, title: "History sync is turned off" }] }] },
      })
    ).toBe("history pn=1229663283573332 tramos=1 hilos=0 mensajes=0 errores=2593109");
  });

  it("un `history` sin tramos se nota (media de un placeholder, o vacío)", () => {
    expect(
      describeWebhookChange({ field: "history", value: { metadata: pn, messages: [{ from: "x", id: "a", timestamp: "1", type: "image" }] } })
    ).toBe("history pn=1229663283573332 media=1");
    expect(describeWebhookChange({ field: "history", value: { metadata: pn } })).toBe(
      "history pn=1229663283573332 vacio"
    );
  });

  it("la agenda cuenta contactos, sin nombres ni teléfonos", () => {
    const line = describeWebhookChange({
      field: "smb_app_state_sync",
      value: { metadata: pn, state_sync: [{ contact: { full_name: "Ana Pérez", phone_number: "5493515550009" } }, {}] },
    });
    expect(line).toBe("smb_app_state_sync pn=1229663283573332 contactos=2");
  });

  it("un campo que el CRM no procesa deja el evento y la FORMA, nunca los valores", () => {
    const line = describeWebhookChange(
      {
        field: "account_update",
        value: { event: "PARTNER_REMOVED", phone_number: "5493518177770", waba_info: { owner: "x" } } as never,
      },
      "1109295528288075"
    );
    expect(line).toBe("account_update waba=1109295528288075 evento=PARTNER_REMOVED claves=event,phone_number,waba_info");
    expect(line).not.toContain("5493518177770");
  });

  it("los nombres que vienen de afuera se acotan antes de ir al log", () => {
    const line = describeWebhookChange({
      field: "raro\n[meta] falso <script>".repeat(4),
      value: { "clave con espacios\ny salto": 1 } as never,
    });
    expect(line).not.toMatch(/[\n<>\[\] ]{2}|\n/);
    expect(line!.split(" ")[0]!.length).toBeLessThanOrEqual(40);
  });

  it("sin valor no revienta", () => {
    expect(describeWebhookChange({ field: "history" })).toBe("history sin_valor");
    expect(describeWebhookChange({})).toBe("sin_campo sin_valor");
  });
});

describe("describeWebhookPayload", () => {
  it("solo mensajes → nada; con un evento → una línea con el tamaño del cuerpo", () => {
    expect(
      describeWebhookPayload({ entry: [{ id: "w", changes: [{ field: "messages", value: { metadata: pn } }] }] }, 900)
    ).toBeNull();
    expect(
      describeWebhookPayload(
        {
          entry: [
            {
              id: "w",
              changes: [
                { field: "messages", value: { metadata: pn } },
                { field: "smb_app_state_sync", value: { metadata: pn, state_sync: [{}, {}, {}] } },
              ],
            },
          ],
        },
        64_100
      )
    ).toBe("[meta] bytes=64100 · smb_app_state_sync pn=1229663283573332 contactos=3");
    expect(describeWebhookPayload({}, 2)).toBeNull();
  });

  it("muchos eventos en un POST: los primeros y cuántos más", () => {
    const changes = Array.from({ length: 11 }, () => ({ field: "history", value: { metadata: pn } }));
    const line = describeWebhookPayload({ entry: [{ id: "w", changes }] }, 10)!;
    expect(line.endsWith("· +3 más")).toBe(true);
    expect(line.split(" · ").length).toBe(1 + 8 + 1);
  });
});
