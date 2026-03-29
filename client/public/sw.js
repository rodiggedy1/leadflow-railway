/**
 * LeadFlow Service Worker
 * Handles background notifications using self.registration.showNotification()
 * which works even when the tab is hidden — unlike window.Notification().
 *
 * WhatsApp / Slack pattern:
 *   1. Page posts a message to the SW via postMessage({ type: 'NOTIFY', ... })
 *   2. SW calls self.registration.showNotification() — OS banner + sound fires
 *   3. On notificationclick, SW focuses the existing tab or opens a new one
 */

const CHIME_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/notification_94d8b39a.mp3";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Listen for messages from the page
self.addEventListener("message", (event) => {
  if (!event.data) return;

  if (event.data.type === "NOTIFY") {
    const { title, body, tag, icon } = event.data;

    // Show OS notification banner
    const notifPromise = self.registration.showNotification(title, {
      body: body ?? "",
      icon: icon ?? "/favicon.ico",
      badge: "/favicon.ico",
      tag: tag ?? "leadflow-msg",
      renotify: true,
      silent: false,
      vibrate: [200, 100, 200],
      data: { url: self.location.origin + "/ops-chat" },
    });

    // Relay PLAY_SOUND only to OpsChat-eligible tabs (admin / agent / call-assist).
    // This prevents the chime from playing on the public quote form at / or any
    // other non-ops page that happens to be open in the same browser.
    const soundPromise = self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          const url = client.url || "";
          const isOpsTab =
            url.includes("/admin") ||
            url.includes("/agent") ||
            url.includes("/call-assist");
          if (isOpsTab) {
            client.postMessage({ type: "PLAY_SOUND" });
          }
        }
      });

    event.waitUntil(Promise.all([notifPromise, soundPromise]));
  }
});

// When user clicks the notification banner — focus or open the tab
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : self.location.origin + "/ops-chat";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // If a tab is already open, focus it
        for (const client of clientList) {
          if ((client.url.includes("/ops-chat") || client.url.includes("/admin")) && "focus" in client) {
            return client.focus();
          }
        }
        // Otherwise open a new tab
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
