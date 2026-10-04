"use client";

import { useState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * 029: pide el enlace por correo. La respuesta es SIEMPRE la misma exista
 * o no la cuenta (AC1.2): la pantalla no revela quién tiene cuenta.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await requestPasswordReset({
      email: email.trim(),
      redirectTo: "/reset-password",
    }).catch(() => ({ error: { status: 0, code: undefined } }));
    setLoading(false);
    if (err) {
      setError(
        err.status === 429
          ? "Demasiados intentos. Esperá unos minutos."
          : err.code === "RESET_PASSWORD_DISABLED"
            ? "La recuperación por correo no está habilitada. Pedile al administrador de la plataforma que te genere una contraseña temporal."
            : err.status === 400
              ? "Revisá el correo: no parece una dirección válida."
              : "No pudimos procesar el pedido. Probá de nuevo en un rato."
      );
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Revisá tu correo</CardTitle>
          <CardDescription>
            Si hay una cuenta con {email.trim()}, te mandamos un enlace para
            elegir una contraseña nueva.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>
            El enlace vence en 1 hora y sirve una sola vez. Si no llega en unos
            minutos, mirá en spam o correo no deseado.
          </p>
          <p className="text-text-3">
            ¿Sigue sin llegar? Pedile al administrador de la plataforma que te
            genere una contraseña temporal.
          </p>
          <p className="text-center">
            <Link href="/login" className="text-primary hover:underline">
              Volver a iniciar sesión
            </Link>
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>¿Olvidaste tu contraseña?</CardTitle>
        <CardDescription>
          Escribí el correo con el que entrás y te mandamos un enlace para
          elegir una nueva.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Correo</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Enviando…" : "Enviar enlace"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            <Link href="/login" className="text-primary hover:underline">
              Volver a iniciar sesión
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
