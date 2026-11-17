import { describe, expect, it } from "vitest";
import { friendlyDeliveryError } from "@/lib/meta-errors";

describe("friendlyDeliveryError", () => {
  it("traduce los errores comunes de Meta", () => {
    expect(
      friendlyDeliveryError("Business eligibility payment issue")
    ).toMatch(/facturación/);
    expect(
      friendlyDeliveryError("Business eligibility payment issue")
    ).not.toMatch(/marketing/);
    expect(
      friendlyDeliveryError(
        "This message was not delivered to maintain healthy ecosystem engagement."
      )
    ).toMatch(/límite de frecuencia/);
    expect(friendlyDeliveryError("Message Undeliverable")).toMatch(
      /no puede recibir/
    );
    expect(friendlyDeliveryError("Re-engagement message")).toMatch(
      /24 horas/
    );
  });

  it("026: 131053 (Meta no pudo procesar el archivo)", () => {
    expect(
      friendlyDeliveryError("Meta rechazó el archivo: (#131053) Media upload error: Unsupported file type")
    ).toMatch(/no pudo procesar el archivo/);
    expect(friendlyDeliveryError("Media download error")).toMatch(/no pudo procesar/);
  });

  it("#10 subcode 2593184: línea de crédito de otro proveedor", () => {
    const raw =
      "Application does not have permission for this action: You do not have the necessary permission to send messages on behalf of this WhatsApp Business Account";
    expect(friendlyDeliveryError(raw)).toMatch(/línea de crédito/);
    expect(friendlyDeliveryError(raw)).toMatch(/reconectar el número no lo arregla/);
    // El #10 genérico (sin el texto de envío) NO se confunde con este caso.
    expect(
      friendlyDeliveryError("(#10) Application does not have permission for this action")
    ).toBe("(#10) Application does not have permission for this action");
  });

  it("desconocido → texto crudo; vacío → null", () => {
    expect(friendlyDeliveryError("Algo rarísimo 999")).toBe(
      "Algo rarísimo 999"
    );
    expect(friendlyDeliveryError("")).toBeNull();
    expect(friendlyDeliveryError(null)).toBeNull();
    expect(friendlyDeliveryError(undefined)).toBeNull();
  });
});
