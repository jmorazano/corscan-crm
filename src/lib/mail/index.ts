import nodemailer from "nodemailer";
import { getEnv, isMockEnabled } from "@/lib/env";
import { readSmtpConfig } from "./config";
import { getMailMockState } from "./mock-outbox";

/**
 * Adaptador de correo (029, constitución II cat. 6): ÚNICO punto que habla
 * SMTP. Solo correo transaccional de la propia cuenta (hoy: recuperar la
 * contraseña) — jamás a contactos ni campañas.
 *
 * Con el entorno de pruebas activo todo va a la bandeja del mail-mock: el
 * self-test JAMÁS alcanza un SMTP real, haya o no `SMTP_*` cargado.
 */

export type OutgoingMail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/** true si esta instancia puede mandar correo (o el mock lo simula). */
export function isMailConfigured(): boolean {
  if (isMockEnabled()) return !getMailMockState().disabled;
  return readSmtpConfig(getEnv()) !== null;
}

/**
 * Manda un correo. Lanza si no hay SMTP o si el servidor lo rechaza: el
 * llamador decide (la recuperación de contraseña lo corre en segundo plano
 * y solo lo registra). Los errores de nodemailer no incluyen la contraseña
 * del SMTP; igual se recortan antes de llegar a un log.
 */
export async function sendMail(mail: OutgoingMail): Promise<void> {
  if (isMockEnabled()) {
    const state = getMailMockState();
    if (state.disabled) throw new MailError("not_configured", "Correo no configurado");
    if (state.failNext) {
      state.failNext = false;
      throw new MailError("send_failed", "mail-mock: fallo simulado del SMTP");
    }
    state.messages.push({
      at: new Date().toISOString(),
      from: readSmtpConfig(getEnv())?.from ?? "Vocero <no-reply@localhost>",
      ...mail,
    });
    return;
  }

  const config = readSmtpConfig(getEnv());
  if (!config) throw new MailError("not_configured", "Correo no configurado");

  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.auth ? { auth: config.auth } : {}),
    // Un SMTP colgado no debe retener el proceso: el envío corre en
    // segundo plano, pero igual se corta.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    await transport.sendMail({ from: config.from, ...mail });
  } catch (err) {
    throw new MailError("send_failed", describeSmtpError(err));
  } finally {
    transport.close();
  }
}

export class MailError extends Error {
  constructor(
    readonly code: "not_configured" | "send_failed",
    message: string
  ) {
    super(message);
    this.name = "MailError";
  }
}

/** Código + mensaje recortado: suficiente para diagnosticar, sin volcar objetos. */
function describeSmtpError(err: unknown): string {
  if (!(err instanceof Error)) return "error desconocido del SMTP";
  const code = (err as { code?: unknown }).code;
  const text = err.message.replace(/\s+/g, " ").slice(0, 200);
  return typeof code === "string" ? `${code}: ${text}` : text;
}
