"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { resetPassword } from "@/lib/auth/client";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

function InvalidLink() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>El enlace venció o ya se usó</CardTitle>
        <CardDescription>
          Cada enlace sirve una sola vez y dura 1 hora.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <Link
          href="/forgot-password"
          className={cn(buttonVariants(), "w-full")}
        >
          Pedir un enlace nuevo
        </Link>
        <p className="text-center">
          <Link href="/login" className="text-primary hover:underline">
            Volver a iniciar sesión
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

/** 029: formulario de la contraseña nueva; `token` null = enlace inválido. */
export function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(token === null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    if (newPassword.length < 8) {
      setError("La contraseña nueva debe tener al menos 8 caracteres.");
      return;
    }
    if (newPassword !== confirm) {
      setError("La confirmación no coincide con la contraseña nueva.");
      return;
    }
    setLoading(true);
    const { error: err } = await resetPassword({ newPassword, token }).catch(
      () => ({ error: { status: 0, code: undefined } })
    );
    setLoading(false);
    if (err) {
      if (err.code === "INVALID_TOKEN") {
        setInvalid(true);
        return;
      }
      setError(
        err.status === 429
          ? "Demasiados intentos. Esperá unos minutos."
          : err.code === "PASSWORD_TOO_SHORT"
            ? "La contraseña nueva debe tener al menos 8 caracteres."
            : err.code === "PASSWORD_TOO_LONG"
              ? "La contraseña nueva es demasiado larga (máximo 128 caracteres)."
              : "No se pudo guardar la contraseña. Probá de nuevo."
      );
      return;
    }
    router.push("/login?reset=1");
  }

  if (invalid) return <InvalidLink />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Elegí una contraseña nueva</CardTitle>
        <CardDescription>
          Al guardarla se cierran todas las sesiones abiertas de tu cuenta.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-password">Contraseña nueva</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              placeholder="mínimo 8 caracteres"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Repetir contraseña nueva</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Guardando…" : "Guardar contraseña"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
