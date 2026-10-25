/**
 * Minimal service worker — present only to satisfy PWA installability criteria
 * (a registered fetch handler) so Chrome/Android can offer "Install app".
 *
 * It deliberately does NOT cache anything: the empty fetch handler lets the
 * browser handle every request normally, so there's no risk of serving stale
 * content. Add a caching strategy here later if offline support is wanted.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // Network passthrough — no respondWith(), so the browser fetches as usual.
});

// Web push: reminders are sent by /api/push/dispatch (see src/lib/push-reminders.ts).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Event Calendar", {
      body: data.body || "",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: data.tag || (data.eventId ? `${data.eventId}:${data.kind || ""}` : undefined),
      data: { url: data.url || "/calendar" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/calendar", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) return client.navigate(url);
          return;
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
