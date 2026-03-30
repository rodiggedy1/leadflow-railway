/**
 * LeadFlow Service Worker
 * Handles background notifications two ways:
 *   1. postMessage({ type: 'NOTIFY', ... }) — from the page (existing path)
 *   2. Web Push 'push' event — from the server via VAPID (new reliable path)
 *
 * Both paths call showNotification() which fires even when ALL tabs are closed.
 * Sound is relayed only to ops-eligible tabs (never to the customer quote page).
 */

const CHIME_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/notification_94d8b39a.mp3";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ─── Shared helpers ───────────────────────────────────────────────────────────

function showAndSound({ title, body, tag, icon, url, playSound }) {
  const targetUrl = url || (self.location.origin + "/ops-chat");

  const notifPromise = self.registration.showNotification(title, {
    body: body ?? "",
    icon: icon ?? "/favicon.ico",
    badge: "/favicon.ico",
    tag: tag ?? "leadflow-msg",
    renotify: true,
    silent: false,
    vibrate: [200, 100, 200],
    data: { url: targetUrl },
  });

  // Relay PLAY_SOUND only to OpsChat-eligible tabs.
  // This prevents the chime from playing on the public quote form at / or any
  // other non-ops page that happens to be open in the same browser.
  const soundPromise = playSound !== false
    ? self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clients) => {
          for (const client of clients) {
            const u = client.url || "";
            const isOpsTab =
              u.includes("/admin") ||
              u.includes("/agent") ||
              u.includes("/ops-chat") ||
              u.includes("/call-assist");
            if (isOpsTab) {
              client.postMessage({ type: "PLAY_SOUND" });
            }
          }
        })
    : Promise.resolve();

  return Promise.all([notifPromise, soundPromise]);
}

// ─── Web Push event (server-sent, works even with zero tabs open) ─────────────

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "LeadFlow", body: event.data.text() };
  }

  const { title = "LeadFlow", body = "", tag, icon, url, playSound } = payload;
  event.waitUntil(showAndSound({ title, body, tag, icon, url, playSound }));
});

// ─── postMessage path (existing — page posts NOTIFY when it's open) ───────────

self.addEventListener("message", (event) => {
  if (!event.data) return;

  if (event.data.type === "NOTIFY") {
    const { title, body, tag, icon, url, playSound } = event.data;
    event.waitUntil(showAndSound({ title, body, tag, icon, url, playSound }));
  }
});

// ─── Notification click — focus or open the ops tab ──────────────────────────

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : self.location.origin + "/ops-chat";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (
            (client.url.includes("/ops-chat") || client.url.includes("/admin")) &&
            "focus" in client
          ) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
