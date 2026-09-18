/**
 * Web Push del lado del navegador (013): soporte, registro del service
 * worker y suscripción. Sin dependencias; solo en cliente.
 */

export type PushMode = "all" | "handoff";

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iPadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/.test(ua) || iPadOs;
}

/** Abierta desde la pantalla de inicio (requisito de push en iOS). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function keyToBase64Url(key: ArrayBuffer | null): string | null {
  if (!key) return null;
  const bytes = new Uint8Array(key);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return window.btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function getRegistration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await getRegistration();
  return reg.pushManager.getSubscription();
}

/**
 * Suscribe con la clave pública de la empresa. Si ya había una suscripción
 * con OTRA clave (otra empresa, rotación), la reemplaza.
 */
export async function subscribeToPush(publicKey: string): Promise<PushSubscription> {
  const reg = await getRegistration();
  const key = urlBase64ToUint8Array(publicKey);
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    const current = keyToBase64Url(existing.options.applicationServerKey);
    if (current === publicKey) return existing;
    await existing.unsubscribe();
  }
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key as BufferSource,
  });
}

export type SerializedSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export function serializeSubscription(sub: PushSubscription): SerializedSubscription {
  const json = sub.toJSON();
  return {
    endpoint: json.endpoint ?? sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
  };
}
