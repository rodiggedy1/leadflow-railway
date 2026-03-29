/**
 * useNotificationSound
 * Plays a chime when new messages arrive.
 *
 * Strategy — dead simple:
 *   Create a fresh Audio element on every play() call.
 *   Chrome/Safari allow Audio.play() after any prior user gesture on the page.
 *   Agents are always logged in and have clicked around the admin UI, so this
 *   condition is always satisfied.
 *
 *   We deliberately avoid:
 *   - AudioContext (requires gesture inside the specific element, broken when
 *     the OpsChat overlay is display:none)
 *   - cloneNode() (clones an empty shell if the source hasn't loaded yet)
 *   - Any pre-loading (unnecessary complexity, same network cost)
 *
 * Mute state is persisted in localStorage.
 */
import { useCallback, useState } from "react";

const CHIME_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/notification_94d8b39a.mp3";

const MUTE_KEY = "ops_notification_muted";

export function useNotificationSound() {
  const [muted, setMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const playSound = useCallback(() => {
    if (muted) return;
    try {
      const audio = new Audio(CHIME_URL);
      audio.volume = 0.7;
      audio.play().catch((e) => {
        // Autoplay blocked — this only happens if the user has NEVER interacted
        // with the page at all. In practice agents are always logged in and active.
        console.warn("[Sound] play() blocked:", e);
      });
    } catch (e) {
      console.warn("[Sound] playSound error:", e);
    }
  }, [muted]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(MUTE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  return { playSound, muted, toggleMute };
}
