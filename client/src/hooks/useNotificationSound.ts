/**
 * useNotificationSound
 * Plays a WhatsApp-style chime when new messages arrive.
 *
 * Strategy:
 * - Use new Audio() — simpler and more reliable than AudioContext for
 *   notification sounds triggered by app events (not autoplay on page load).
 * - Chrome/Safari allow Audio.play() after ANY prior user gesture on the page.
 *   Agents are always logged in and have clicked around, so this is always met.
 * - Pre-load the audio on first gesture so the chime fires instantly with no
 *   network delay when a message arrives.
 * - Mute state is persisted in localStorage.
 *
 * Previous approach (AudioContext) was broken because: the AudioContext unlock
 * listener was attached to document, but agents receive notifications while the
 * OpsChat overlay is hidden (display:none). They never click inside it, so the
 * gesture never fired, ctxRef stayed null, and every playSound() call logged
 * "[Sound] playSound called — ctx: null buffer: false" and played nothing.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const CHIME_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/notification_94d8b39a.mp3";

const MUTE_KEY = "ops_notification_muted";

export function useNotificationSound() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const unlockedRef = useRef(false);

  const [muted, setMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === "true";
    } catch {
      return false;
    }
  });

  // Pre-load audio on first user gesture anywhere on the page.
  // This ensures the Audio element is warm and ready before any notification fires.
  useEffect(() => {
    const unlock = () => {
      if (unlockedRef.current) return;
      unlockedRef.current = true;

      try {
        const audio = new Audio(CHIME_URL);
        audio.volume = 0.7;
        audio.preload = "auto";
        // Load (but don't play) — primes the network buffer
        audio.load();
        audioRef.current = audio;
        console.log("[Sound] Audio pre-loaded on gesture");
      } catch (e) {
        console.warn("[Sound] Audio pre-load failed:", e);
      }

      document.removeEventListener("click", unlock, true);
      document.removeEventListener("keydown", unlock, true);
      document.removeEventListener("touchstart", unlock, true);
    };

    document.addEventListener("click", unlock, true);
    document.addEventListener("keydown", unlock, true);
    document.addEventListener("touchstart", unlock, true);

    return () => {
      document.removeEventListener("click", unlock, true);
      document.removeEventListener("keydown", unlock, true);
      document.removeEventListener("touchstart", unlock, true);
    };
  }, []);

  const playSound = useCallback(() => {
    if (muted) return;

    try {
      // Reuse the pre-loaded element if available, otherwise create a fresh one.
      // Creating a new Audio() each time is intentional — it allows overlapping
      // chimes if two messages arrive close together, and avoids the "already
      // playing" error from trying to replay a non-rewound element.
      const audio = audioRef.current
        ? audioRef.current.cloneNode() as HTMLAudioElement
        : new Audio(CHIME_URL);
      audio.volume = 0.7;
      audio.play().catch((e) => {
        console.warn("[Sound] play() failed:", e);
      });
      console.log("[Sound] Played");
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
