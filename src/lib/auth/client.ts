"use client";

import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [organizationClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;

/** 029: recuperar la contraseña por correo (endpoints nativos de Better Auth). */
export const { requestPasswordReset, resetPassword } = authClient;
