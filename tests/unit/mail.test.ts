import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 029 — adaptador de correo: config del SMTP (placeholders = vacío), el
 * self-test JAMÁS llega a un SMTP real (bandeja del mock + knobs) y el envío
 * real arma el transporte con timeouts y sin volcar la credencial.
 */

const env: Record<string, unknown> = {};
let mockEnabled = false;

vi.mock("@/lib/env", () => ({
  getEnv: () => env,
  isMockEnabled: () => mockEnabled,
}));

const sendMailSpy = vi.fn();
const closeSpy = vi.fn();
const createTransportSpy = vi.fn((_opts: unknown) => ({
  sendMail: sendMailSpy,
  close: closeSpy,
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: (opts: unknown) => createTransportSpy(opts) },
}));

import { readSmtpConfig } from "@/lib/mail/config";
import { isMailConfigured, MailError, sendMail } from "@/lib/mail";
import { getMailMockState, resetMailMockState } from "@/lib/mail/mock-outbox";

const MAIL = { to: "ana@empresa.com", subject: "Asunto", text: "Hola", html: "<p>Hola</p>" };

function setEnv(values: Record<string, unknown>) {
  for (const k of Object.keys(env)) delete env[k];
  Object.assign(env, { SMTP_PORT: 587 }, values);
}

beforeEach(() => {
  mockEnabled = false;
  setEnv({});
  resetMailMockState();
  sendMailSpy.mockReset();
  closeSpy.mockReset();
  createTransportSpy.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readSmtpConfig", () => {
  it("sin host o sin remitente → null", () => {
    expect(readSmtpConfig({ SMTP_PORT: 587 })).toBeNull();
    expect(readSmtpConfig({ SMTP_PORT: 587, SMTP_HOST: "smtp.x.com" })).toBeNull();
    expect(readSmtpConfig({ SMTP_PORT: 587, SMTP_FROM: "a@x.com" })).toBeNull();
  });

  it("los placeholders REEMPLAZA_… cuentan como vacío", () => {
    expect(
      readSmtpConfig({
        SMTP_PORT: 587,
        SMTP_HOST: "REEMPLAZA_smtp.tu-proveedor.com",
        SMTP_FROM: "a@x.com",
      })
    ).toBeNull();
    expect(
      readSmtpConfig({
        SMTP_PORT: 587,
        SMTP_HOST: "smtp.x.com",
        SMTP_FROM: "REEMPLAZA_Vocero <no-reply@tudominio.com>",
      })
    ).toBeNull();
  });

  it("usuario sin contraseña (o al revés) → null; ninguno de los dos = relay sin auth", () => {
    const base = { SMTP_PORT: 587, SMTP_HOST: "smtp.x.com", SMTP_FROM: "a@x.com" };
    expect(readSmtpConfig({ ...base, SMTP_USER: "u" })).toBeNull();
    expect(readSmtpConfig({ ...base, SMTP_PASS: "p" })).toBeNull();
    expect(readSmtpConfig(base)?.auth).toBeNull();
    expect(readSmtpConfig({ ...base, SMTP_USER: "u", SMTP_PASS: "p" })?.auth).toEqual({
      user: "u",
      pass: "p",
    });
  });

  it("TLS directo: se deduce del puerto 465 y SMTP_SECURE lo fuerza", () => {
    const base = { SMTP_HOST: "smtp.x.com", SMTP_FROM: "a@x.com" };
    expect(readSmtpConfig({ ...base, SMTP_PORT: 587 })?.secure).toBe(false);
    expect(readSmtpConfig({ ...base, SMTP_PORT: 465 })?.secure).toBe(true);
    expect(readSmtpConfig({ ...base, SMTP_PORT: 2525, SMTP_SECURE: "true" })?.secure).toBe(true);
    expect(readSmtpConfig({ ...base, SMTP_PORT: 465, SMTP_SECURE: "false" })?.secure).toBe(false);
  });
});

describe("modo de pruebas (mail-mock)", () => {
  beforeEach(() => {
    mockEnabled = true;
  });

  it("el correo queda en la bandeja y NO toca nodemailer, aun con SMTP cargado", async () => {
    setEnv({ SMTP_HOST: "smtp.real.com", SMTP_FROM: "Vocero <no-reply@real.com>" });
    expect(isMailConfigured()).toBe(true);
    await sendMail(MAIL);
    expect(createTransportSpy).not.toHaveBeenCalled();
    const [msg] = getMailMockState().messages;
    expect(msg).toMatchObject({ ...MAIL, from: "Vocero <no-reply@real.com>" });
  });

  it("configurado aunque no haya SMTP (el self-test no depende del entorno real)", () => {
    expect(isMailConfigured()).toBe(true);
  });

  it("failNext: el próximo envío falla una sola vez", async () => {
    getMailMockState().failNext = true;
    await expect(sendMail(MAIL)).rejects.toBeInstanceOf(MailError);
    await sendMail(MAIL);
    expect(getMailMockState().messages).toHaveLength(1);
  });

  it("disabled: se comporta como una instancia sin SMTP", async () => {
    getMailMockState().disabled = true;
    expect(isMailConfigured()).toBe(false);
    await expect(sendMail(MAIL)).rejects.toMatchObject({ code: "not_configured" });
  });
});

describe("envío real (SMTP)", () => {
  it("sin SMTP configurado → no configurado y sendMail lanza not_configured", async () => {
    expect(isMailConfigured()).toBe(false);
    await expect(sendMail(MAIL)).rejects.toMatchObject({ code: "not_configured" });
    expect(createTransportSpy).not.toHaveBeenCalled();
  });

  it("arma el transporte con la config, timeouts y el remitente, y lo cierra", async () => {
    setEnv({
      SMTP_HOST: "smtp.x.com",
      SMTP_PORT: 465,
      SMTP_USER: "u",
      SMTP_PASS: "secreto",
      SMTP_FROM: "Vocero <no-reply@x.com>",
    });
    sendMailSpy.mockResolvedValue({ messageId: "1" });
    expect(isMailConfigured()).toBe(true);
    await sendMail(MAIL);
    expect(createTransportSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.x.com",
        port: 465,
        secure: true,
        auth: { user: "u", pass: "secreto" },
        connectionTimeout: 10_000,
      })
    );
    expect(sendMailSpy).toHaveBeenCalledWith({ from: "Vocero <no-reply@x.com>", ...MAIL });
    expect(closeSpy).toHaveBeenCalled();
  });

  it("un rechazo del SMTP lanza send_failed con código + mensaje recortado y cierra", async () => {
    setEnv({ SMTP_HOST: "smtp.x.com", SMTP_FROM: "a@x.com" });
    const err = Object.assign(new Error("Invalid login: 535 Authentication failed\n\n" + "x".repeat(400)), {
      code: "EAUTH",
    });
    sendMailSpy.mockRejectedValue(err);
    const failure = await sendMail(MAIL).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(MailError);
    expect((failure as MailError).code).toBe("send_failed");
    expect((failure as MailError).message).toMatch(/^EAUTH: Invalid login: 535/);
    expect((failure as MailError).message.length).toBeLessThan(220);
    expect(closeSpy).toHaveBeenCalled();
  });
});
