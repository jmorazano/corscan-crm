import type { Metadata } from "next";
import { ResetPasswordForm } from "./reset-password-form";

// El token viaja en la URL: que no se filtre por el Referer a ningún lado.
export const metadata: Metadata = { referrer: "no-referrer" };

type Props = { searchParams: Promise<{ token?: string; error?: string }> };

/**
 * 029: elegir la contraseña nueva. Se llega desde el enlace del correo,
 * después de que Better Auth validó el token (`?token=`) o lo rechazó por
 * vencido/usado (`?error=INVALID_TOKEN`).
 */
export default async function ResetPasswordPage({ searchParams }: Props) {
  const { token, error } = await searchParams;
  const valid = Boolean(token) && !error;
  return <ResetPasswordForm token={valid ? (token ?? null) : null} />;
}
