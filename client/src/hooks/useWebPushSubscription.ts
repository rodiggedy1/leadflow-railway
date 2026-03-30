/**
 * useWebPushSubscription
 *
 * Registers this browser with the server for Web Push notifications.
 * Must only be mounted on ops/agent pages — NEVER on the customer quote page.
 *
 * Flow:
 *   1. Fetch the VAPID public key from the server.
 *   2. Request notification permission from the user (if not already granted).
 *   3. Call navigator.serviceWorker.ready to get the SW registration.
 *   4. Subscribe to push via pushManager.subscribe().
 *   5. POST the subscription to trpc.push.subscribe so the server can send pushes.
 *
 * The subscription is idempotent — calling this multiple times is safe.
 * On logout, call unsubscribe() to remove the endpoint from the server.
 */

import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";

/** Convert a base64url string to a Uint8Array (required by pushManager.subscribe) */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

interface UseWebPushSubscriptionOptions {
  /** Unique key identifying this agent (e.g. agent username or id string) */
  agentKey: string;
  /** Whether to actually register — set false on non-ops pages */
  enabled?: boolean;
}

export function useWebPushSubscription({
  agentKey,
  enabled = true,
}: UseWebPushSubscriptionOptions) {
  const subscribeMutation = trpc.push.subscribe.useMutation();
  const { data: vapidData } = trpc.push.getVapidPublicKey.useQuery(undefined, {
    enabled,
    staleTime: Infinity,
  });
  const subscribedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (!vapidData?.publicKey) return;
    if (subscribedRef.current) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    const register = async () => {
      try {
        // Ensure notification permission
        if (Notification.permission === "denied") return;
        if (Notification.permission === "default") {
          const result = await Notification.requestPermission();
          if (result !== "granted") return;
        }

        const swReg = await navigator.serviceWorker.ready;

        // Check if already subscribed
        let sub = await swReg.pushManager.getSubscription();

        if (!sub) {
          sub = await swReg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidData.publicKey) as unknown as BufferSource,
          });
        }

        const json = sub.toJSON();
        if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;

        await subscribeMutation.mutateAsync({
          agentKey,
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
        });

        subscribedRef.current = true;
      } catch (err) {
        // Non-fatal — app works without push, just won't get background notifications
        console.warn("[WebPush] Subscription failed:", err);
      }
    };

    register();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, vapidData?.publicKey, agentKey]);
}
