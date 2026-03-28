/**
 * useOsNotification
 * Wraps the browser Notification API to show OS-level notifications.
 *
 * - Requests permission on first call to `notify()` (requires a user gesture)
 * - Only shows the notification when the tab is hidden (document.hidden)
 * - Falls back silently if the browser doesn't support Notifications
 *
 * Usage:
 *   const { notify, permission } = useOsNotification();
 *   notify({ title: "New message", body: "Rachel: test this" });
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type OsNotificationPermission = "default" | "granted" | "denied" | "unsupported";

const APP_ICON = "/favicon.ico";

export function useOsNotification() {
  const [permission, setPermission] = useState<OsNotificationPermission>(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    return Notification.permission as OsNotificationPermission;
  });

  // Keep permission state in sync if the user changes it in browser settings
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const interval = setInterval(() => {
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

      // Only show OS notification when the tab is not focused
      if (!document.hidden) return;

      let perm = Notification.permission;
      if (perm === "default") {
        perm = await Notification.requestPermission();
        setPermission(perm as OsNotificationPermission);
      }
      if (perm !== "granted") return;

      try {
        const n = new Notification(title, {
          body,
          icon: APP_ICON,
          tag: tag ?? "leadflow-msg",
          // renotify: true so rapid messages each trigger a sound
          // @ts-expect-error — renotify is not in all TS lib defs yet
          renotify: true,
        });
        // Auto-close after 6 seconds
        setTimeout(() => n.close(), 6000);
      } catch {
        // Silently ignore (e.g. service worker not registered)
      }
    },
    []
  );

  return { notify, permission, requestPermission };
}
