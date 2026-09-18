/*
  Service worker mínimo de Vocero (013): SOLO notificaciones push.
  Sin caché ni modo offline a propósito: la app es en tiempo real y una
  caché vieja tras un deploy sería peor que no tener nada.
*/

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Nuevo mensaje", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Nuevo mensaje";
  const options = {
    body: data.body || "",
    tag: data.tag || undefined,
    // Mismo chat: reemplaza la anterior y vuelve a avisar.
    renotify: Boolean(data.tag),
    data: { url: data.url || "/inbox" },
    icon: data.icon || "/api/pwa/icon/192",
    badge: data.icon || "/api/pwa/icon/192",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    (event.notification.data && event.notification.data.url) || "/inbox",
    self.location.origin
  ).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const app = clients.find((c) => c.url.startsWith(self.location.origin));
        if (app) {
          // La app decide cómo navegar (router de Next); enfocar y avisar.
          app.postMessage({ type: "push-navigate", url: target });
          return app.focus();
        }
        return self.clients.openWindow(target);
      })
  );
});

// El navegador rotó la suscripción: re-suscribir con la misma clave y
// registrarla. Si falla, la app re-sincroniza al abrirse.
self.addEventListener("pushsubscriptionchange", (event) => {
  const key =
    event.oldSubscription && event.oldSubscription.options
      ? event.oldSubscription.options.applicationServerKey
      : null;
  if (!key) return;
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: key })
      .then((sub) =>
        fetch("/api/push/subscriptions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        })
      )
      .catch(() => undefined)
  );
});
