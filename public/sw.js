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
