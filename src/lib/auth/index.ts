import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { isMailConfigured } from "@/lib/mail";
import { RESET_TOKEN_TTL_SECONDS } from "@/lib/password-reset-email";
import {
  AUTH_RATE_LIMIT,
  checkRateLimit,
  PASSWORD_RESET_EMAIL_RATE_LIMIT,
} from "@/lib/rate-limit";
import {
  onUserCreated,
  resolveLoginOrganizationId,
} from "@/server/auth/on-signup";
import {
  clearMustChangePassword,
  queuePasswordResetEmail,
} from "@/server/auth/password-reset";
import {
  hasAnyOrganization,
  isPublicSignupAllowed,
} from "@/server/auth/registration";
import { isSuperAdminEmail } from "@/server/auth/super-admin";
import { isOrganizationPathDenied } from "@/lib/auth/organization-gate";

/**
 * Contexto interno del proceso: permite que el alta de cuentas de equipo
 * (owner → API) atraviese el gate de registro cerrado. No es alcanzable
 * desde fuera: solo envuelve llamadas server-side.
 */
const globalForSignup = globalThis as unknown as {
  __voceroInternalSignup?: AsyncLocalStorage<boolean>;
};

// En globalThis: los módulos pueden evaluarse más de una vez (una por ruta en
// dev) y todas las copias deben compartir el mismo contexto.
function internalSignupContext(): AsyncLocalStorage<boolean> {
  if (!globalForSignup.__voceroInternalSignup) {
    globalForSignup.__voceroInternalSignup = new AsyncLocalStorage<boolean>();
  }
  return globalForSignup.__voceroInternalSignup;
}

export function runInternalSignup<T>(fn: () => Promise<T>): Promise<T> {
  return internalSignupContext().run(true, fn);
}

function isInternalSignup(): boolean {
  return internalSignupContext().getStore() === true;
}

/** Por IP (FR-062); 029 suma pedir el enlace y elegir la contraseña nueva. */
const RATE_LIMITED_PATHS = new Set([
  "/sign-in/email",
  "/sign-up/email",
  "/request-password-reset",
  "/reset-password",
]);

function bodyEmail(body: unknown): string {
  const email = (body as { email?: unknown } | undefined)?.email;
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function createAuth() {
  const env = getEnv();
  return betterAuth({
    baseURL: env.APP_BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        organization: schema.organization,
        member: schema.member,
        invitation: schema.invitation,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
      // 029: recuperar la contraseña por correo. Better Auth genera y
      // consume el token (un solo uso) y responde igual exista o no la
      // cuenta; el correo sale en segundo plano (sin oráculo de timing).
      resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
      sendResetPassword: async ({ user, token }) => {
        queuePasswordResetEmail({ email: user.email, name: user.name, token });
      },
      // Quien tenía la sesión abierta (o la contraseña vieja) queda afuera.
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => {
        await clearMustChangePassword(user.id);
      },
    },
    // 029: el token de recuperación se guarda HASHEADO: una copia de la base
    // no sirve para usar un enlace vigente. El resto de `verification` sigue
    // como estaba.
    verification: {
      storeIdentifier: {
        default: "plain",
        overrides: { "reset-password:": "hashed" },
      },
    },
    plugins: [organization({ creatorRole: "owner" })],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Rate limit por IP en login/registro (FR-062): 10 / 10 min → 429.
        if (RATE_LIMITED_PATHS.has(ctx.path)) {
          const ip =
            ctx.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            ctx.headers?.get("x-real-ip") ||
            "local";
          const result = checkRateLimit(`${ctx.path}:${ip}`, AUTH_RATE_LIMIT);
          if (!result.allowed) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Demasiados intentos; espera unos minutos",
            });
          }
        }
        if (ctx.path === "/request-password-reset") {
          // Sin SMTP no hay recuperación por correo (AC3.2). Se corta ACÁ,
          // antes de buscar la cuenta: la respuesta es la misma para todos.
          if (!isMailConfigured()) {
            throw new APIError("BAD_REQUEST", {
              message: "La recuperación por correo no está habilitada",
              code: "RESET_PASSWORD_DISABLED",
            });
          }
          const email = bodyEmail(ctx.body);
          if (
            email &&
            !checkRateLimit(`reset-email:${email}`, PASSWORD_RESET_EMAIL_RATE_LIMIT)
              .allowed
          ) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Demasiados intentos; espera unos minutos",
            });
          }
        }
        // Registro público cerrado tras la primera organización (FR-060).
        if (ctx.path === "/sign-up/email" && !isInternalSignup()) {
          if (!(await isPublicSignupAllowed())) {
            throw new APIError("FORBIDDEN", {
              message:
                "El registro está cerrado: esta instancia ya tiene su organización",
            });
          }
          // FR-016: un email reservado de super admin solo puede
          // auto-registrarse en el bootstrap (instancia sin organizaciones).
          // Después — p. ej. con ALLOW_SIGNUP=true — registrarlo sería tomar
          // la plataforma: el rol deriva del email y no hay verificación.
          const email = bodyEmail(ctx.body);
          if (isSuperAdminEmail(email) && (await hasAnyOrganization())) {
            throw new APIError("FORBIDDEN", {
              message:
                "Ese correo está reservado para la administración de la plataforma",
            });
          }
        }
        // Gate ALLOWLIST del plugin organization (FR-013): las organizaciones
        // se gestionan solo server-side; todo /organization/* se niega fuera
        // del bypass interno del proceso.
        if (isOrganizationPathDenied(ctx.path) && !isInternalSignup()) {
          throw new APIError("FORBIDDEN", {
            message: "Operación no disponible en esta instancia",
          });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await onUserCreated(user.id, user.name);
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            // 018: arranca en la última empresa usada (si sigue siendo
            // miembro); si no, en la más antigua.
            const organizationId = await resolveLoginOrganizationId(
              session.userId
            );
            return {
              data: { ...session, activeOrganizationId: organizationId },
            };
          },
        },
      },
    },
  });
}

type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __voceroAuth?: Auth };

export function getAuth(): Auth {
  if (!globalForAuth.__voceroAuth) globalForAuth.__voceroAuth = createAuth();
  return globalForAuth.__voceroAuth;
}
