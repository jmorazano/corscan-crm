"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCurrentSubscription,
  isIos,
  isPushSupported,
  isStandalone,
  serializeSubscription,
  subscribeToPush,
  type PushMode,
} from "@/lib/push-client";

export type PushDevice = {
  endpoint: string;
  mode: PushMode;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

export type PushState = {
  ready: boolean;
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  ios: boolean;
  standalone: boolean;
  /** iPhone/iPad sin instalar: el push no existe hasta agregar a inicio. */
  needsInstall: boolean;
  /** Endpoint de ESTE dispositivo (null si no está suscripto). */
  endpoint: string | null;
  /** Modo de este dispositivo según el servidor. */
  mode: PushMode | null;
  devices: PushDevice[];
  busy: boolean;
  error: string | null;
  notice: string | null;
};

const JSON_HEADERS = { "content-type": "application/json" };

/**
 * Estado y acciones de Web Push para la página de Ajustes (013, US1).
 * `enable` pide el permiso PRIMERO (dentro del gesto del usuario, como
 * exige Safari) y recién después trae la clave y suscribe.
 */
export function usePush() {
  const [state, setState] = useState<PushState>({
    ready: false,
    supported: false,
    permission: "unsupported",
    ios: false,
    standalone: false,
    needsInstall: false,
    endpoint: null,
    mode: null,
    devices: [],
    busy: false,
    error: null,
    notice: null,
  });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const patch = useCallback((p: Partial<PushState>) => {
    if (mounted.current) setState((s) => ({ ...s, ...p }));
  }, []);

  const refresh = useCallback(async () => {
    const supported = isPushSupported();
    const ios = isIos();
    const standalone = isStandalone();
    const permission: PushState["permission"] = supported
      ? Notification.permission
      : "unsupported";
    let endpoint: string | null = null;
    if (supported && permission === "granted") {
      try {
        endpoint = (await getCurrentSubscription())?.endpoint ?? null;
      } catch {
        endpoint = null;
      }
    }
    let devices: PushDevice[] = [];
    try {
      const res = await fetch("/api/push/subscriptions");
      if (res.ok) {
        devices = ((await res.json()) as { subscriptions: PushDevice[] }).subscriptions;
      }
    } catch {
      // sin red: se muestra lo local
    }
    const mine = endpoint ? devices.find((d) => d.endpoint === endpoint) : null;
    patch({
      ready: true,
      supported,
      permission,
      ios,
      standalone,
      needsInstall: ios && !standalone,
      endpoint: mine ? endpoint : null,
      mode: mine?.mode ?? null,
      devices,
    });
  }, [patch]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(
    async (mode: PushMode) => {
      if (!isPushSupported()) return;
      patch({ busy: true, error: null, notice: null });
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          patch({
            busy: false,
            permission,
            error:
              permission === "denied"
                ? "El navegador tiene bloqueadas las notificaciones para este sitio. Permitilas desde los ajustes del sitio y volvé a intentar."
                : "No se otorgó el permiso.",
          });
          return;
        }
        const keyRes = await fetch("/api/push/vapid");
        if (!keyRes.ok) throw new Error("No se pudo obtener la clave de la empresa");
        const { publicKey } = (await keyRes.json()) as { publicKey: string };
        const sub = await subscribeToPush(publicKey);
        const res = await fetch("/api/push/subscriptions", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            ...serializeSubscription(sub),
            mode,
            userAgent: navigator.userAgent.slice(0, 400),
          }),
        });
        if (!res.ok) throw new Error("No se pudo registrar el dispositivo");
        patch({ notice: "Notificaciones activas en este dispositivo." });
      } catch (err) {
        patch({ error: err instanceof Error ? err.message : "No se pudo activar" });
      } finally {
        patch({ busy: false });
        await refresh();
      }
    },
    [patch, refresh]
  );

  const disable = useCallback(async () => {
    patch({ busy: true, error: null, notice: null });
    try {
      const sub = await getCurrentSubscription();
      if (sub) {
        await fetch("/api/push/subscriptions", {
          method: "DELETE",
          headers: JSON_HEADERS,
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => null);
        await sub.unsubscribe();
      }
      patch({ notice: "Este dispositivo ya no recibe notificaciones." });
    } catch (err) {
      patch({ error: err instanceof Error ? err.message : "No se pudo desactivar" });
    } finally {
      patch({ busy: false });
      await refresh();
    }
  }, [patch, refresh]);

  const setMode = useCallback(
    async (mode: PushMode) => {
      if (!state.endpoint) return;
      patch({ mode, error: null }); // optimista
      const res = await fetch("/api/push/subscriptions", {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ endpoint: state.endpoint, mode }),
      }).catch(() => null);
      if (!res?.ok) patch({ error: "No se pudo guardar el modo" });
      await refresh();
    },
    [state.endpoint, patch, refresh]
  );

  const sendTest = useCallback(async () => {
    patch({ busy: true, error: null, notice: null });
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = (await res.json().catch(() => null)) as {
        sent?: number;
        total?: number;
      } | null;
      if (!res.ok) throw new Error("No se pudo enviar la prueba");
      patch({
        notice:
          (data?.total ?? 0) === 0
            ? "No hay dispositivos suscriptos."
            : `Prueba enviada a ${data?.sent ?? 0} de ${data?.total ?? 0} dispositivo(s).`,
      });
    } catch (err) {
      patch({ error: err instanceof Error ? err.message : "No se pudo enviar la prueba" });
    } finally {
      patch({ busy: false });
    }
  }, [patch]);

  return { state, enable, disable, setMode, sendTest, refresh };
}
