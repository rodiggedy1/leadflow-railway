/**
 * useOsNotification
 * Shows OS-level notifications via the Service Worker's showNotification() API.
 *
 * WHY Service Worker instead of window.Notification():
 *   - window.Notification() is BLOCKED by browsers when the tab is hidden
 *   - serviceWorkerRegistration.showNotification() runs in the SW process,
 *     which is always alive — fires the OS banner + sound even when the tab
 *     is minimised, hidden, or the browser is in the background.
 *   - This is exactly what WhatsApp, Slack, and Telegram use.
 *
 * Usage:
 *   const { notify, permission, requestPermission } = useOsNotification();
 *   notify({ title: "New message", body: "Rachel: test this" });
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type OsNotificationPermission = "default" | "granted" | "denied" | "unsupported";

const APP_ICON = "/favicon.ico";
const SW_PATH = "/sw.js";

export function useOsNotification() {
  const [permission, setPermission] = useState<OsNotificationPermission>(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    return Notification.permission as OsNotificationPermission;
  });

  const swRegRef = useRef<ServiceWorkerRegistration | null>(null);

  // Register the Service Worker once on mount
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register(SW_PATH, { scope: "/" })
      .then((reg) => {
        swRegRef.current = reg;
      })
      .catch(() => {
        // SW registration failed — fall back gracefully
      });

    // Keep permission state in sync if the user changes it in browser settings
    const interval = setInterval(() => {
      if (!("Notification" in window)) return;
      const current = Notification.permission as OsNotificationPermission;
      setPermission((prev) => (prev !== current ? current : prev));
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported" as const;
    if (Notification.permission === "granted") return "granted" as const;
    if (Notification.permission === "denied") return "denied" as const;
    const result = await Notification.requestPermission();
    setPermission(result as OsNotificationPermission);
    return result as OsNotificationPermission;
  }, []);

  const notify = useCallback(
    async ({ title, body, tag }: { title: string; body?: string; tag?: string }) => {
      if (typeof window === "undefined" || !("Notification" in window)) return;

      // Ensure permission
      let perm = Notification.permission;
      if (perm === "default") {
        perm = await Notification.requestPermission();
        setPermission(perm as OsNotificationPermission);
      }
      if (perm !== "granted") return;

      // Prefer Service Worker showNotification (works in background tabs)
      try {
        // Get the active SW registration
        const reg =
          swRegRef.current ??
          (await navigator.serviceWorker.ready.catch(() => null));

        if (reg) {
          // Post message to SW — SW calls self.registration.showNotification()
          // This fires the OS banner + sound even when the tab is hidden
          const sw = reg.active ?? reg.installing ?? reg.waiting;
          if (sw) {
            sw.postMessage({
              type: "NOTIFY",
              title,
              body: body ?? "",
              tag: tag ?? "leadflow-msg",
              icon: APP_ICON,
            });
            return;
          }

          // Fallback: call showNotification directly on the registration
          await reg.showNotification(title, {
            body: body ?? "",
            icon: APP_ICON,
            tag: tag ?? "leadflow-msg",
            renotify: true,
            vibrate: [200, 100, 200],
            data: { url: window.location.origin + "/ops-chat" },
          } as NotificationOptions);
          return;
        }
      } catch {
        // SW not available — fall through to window.Notification
      }

      // Last resort: window.Notification (may be blocked in hidden tabs)
      try {
        const n = new Notification(title, {
          body,
          icon: APP_ICON,
          tag: tag ?? "leadflow-msg",
          // @ts-expect-error — renotify is not in all TS lib defs yet
          renotify: true,
        });
        setTimeout(() => n.close(), 6000);
      } catch {
        // Silently ignore
      }
    },
    []
  );

  return { notify, permission, requestPermission };
}
