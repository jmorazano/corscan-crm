import Link from "next/link";
import { isMailConfigured } from "@/lib/mail";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ForgotPasswordForm } from "./forgot-password-form";

// Se decide en cada pedido: el SMTP llega por entorno en runtime (no en el
// build) y el mail-mock puede simular una instancia sin correo.
export const dynamic = "force-dynamic";

/** 029: pedir el enlace de recuperación (o, sin SMTP, a quién pedírsela). */
export default function ForgotPasswordPage() {
  if (isMailConfigured()) return <ForgotPasswordForm />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>¿Olvidaste tu contraseña?</CardTitle>
        <CardDescription>
          Esta instancia no manda correos, así que la contraseña se restablece
          a mano.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p>
          Pedile al administrador de la plataforma que te genere una
          contraseña temporal (si no sabés quién es, preguntale al
          propietario de tu empresa). Con ella entrás y elegís una nueva.
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
