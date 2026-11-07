import { describe, expect, it } from "vitest";
import { isPaymentReceiptSummary, PAYMENT_RECEIPT_TAG } from "@/lib/payment-receipt-tag";
import { MAX_TAG_LENGTH, sanitizeTags } from "@/lib/tags";
import { profileUpdateSchema } from "@/server/ai/profile";

// Descripciones reales de producción, sin nombres de personas ni empresas.
describe("isPaymentReceiptSummary", () => {
  it.each([
    "un comprobante de transferencia de Mercado Pago",
    "Una captura de pantalla de un comprobante de transferencia de Mercado Pago",
    "Es una captura de pantalla de un comprobante de transferencia bancaria saliente.",
    "Es un comprobante de compra pagado con una billetera virtual el 15 de octubre.",
    "Un comprobante de transferencia del 15 de octubre de 2026, por una seña.",
    "Es un recibo de cobranza de una administración de propiedades, que sirve como comprobante de pago.",
    "Es un recibo de pago de póliza de seguro.",
    "Una captura de pantalla de una transferencia bancaria recibida, para confirmar un pago.",
    "Una captura de pantalla del detalle de una transferencia bancaria, para confirmar un pago.",
    "una captura de pantalla de la confirmación de un pago online con tarjeta de crédito.",
    "una captura de pantalla de una reserva de alojamiento con el detalle de los costos y el pago realizado.",
  ])("marca: %s", (summary) => {
    expect(isPaymentReceiptSummary(summary)).toBe(true);
  });

  it.each([
    // Lo que el filtro amplio de 034 dejaba pasar.
    "una captura de pantalla de una página web o aplicación con los datos para hacer una transferencia bancaria.",
    "una captura de pantalla de una confirmación de reserva con los datos para el pago de la seña.",
    "una captura de pantalla con los detalles de una reserva, incluyendo costos y datos bancarios para el pago.",
    "Una imagen con los datos de una cuenta de Mercado Pago para recibir transferencias.",
    "una tabla de comisiones por medio de pago y entidad, para comparar costos de venta.",
    "Es un cedulón de pago de la Tasa de Justicia de Córdoba, con vencimiento el 13/10/2026.",
    "Es una boleta de pago de la Municipalidad de Córdoba por multas de tránsito.",
    "Una factura de alquiler de octubre de 2026, con vencimiento para el pago el mismo día.",
    "Es una constancia de reserva de nomenclaturas previas de la Dirección General de Catastro.",
    "Una foto de un contrato o presupuesto con firmas, para dejar constancia de un acuerdo.",
    "una captura de pantalla de un mail de cancelación de reserva por falta de pago de la seña.",
    "una foto de la cabaña con la pileta",
    "no es un comprobante, es una lista de precios",
    "",
  ])("no marca: %s", (summary) => {
    expect(isPaymentReceiptSummary(summary)).toBe(false);
  });

  it("no se deja engañar por un comprobante nombrado más adelante en el documento", () => {
    const summary = `Es una nota informativa del colegio sobre la vigilia de los jóvenes, que se hará el 9 y 10 de noviembre, con el horario de entrada, el de salida y lo que cada familia tiene que llevar. Pide enviar el comprobante a secretaría.`;
    expect(isPaymentReceiptSummary(summary)).toBe(false);
  });

  it("tolera un resumen ausente", () => {
    expect(isPaymentReceiptSummary(null)).toBe(false);
    expect(isPaymentReceiptSummary(undefined)).toBe(false);
  });
});

describe("la opción y la etiqueta", () => {
  it("es una etiqueta normal, sin cambios al sanearla", () => {
    expect(PAYMENT_RECEIPT_TAG.length).toBeLessThanOrEqual(MAX_TAG_LENGTH);
    expect(sanitizeTags([PAYMENT_RECEIPT_TAG])).toEqual([PAYMENT_RECEIPT_TAG]);
  });

  it("el perfil acepta la opción y rechaza otra cosa que no sea sí o no", () => {
    expect(profileUpdateSchema.parse({ tagPaymentReceipts: true })).toEqual({ tagPaymentReceipts: true });
    expect(() => profileUpdateSchema.parse({ tagPaymentReceipts: "si" })).toThrow();
  });
});
