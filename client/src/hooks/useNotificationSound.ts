/**
 * useNotificationSound
 * Plays a WhatsApp-style chime when new messages arrive from other people.
 *
 * Usage:
 *   const { playSound, muted, toggleMute } = useNotificationSound();
 *   // call playSound() whenever a new incoming message is detected
 */
import { useCallback, useEffect, useRef, useState } from "react";

const CHIME_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/notification_94d8b39a.mp3";

const MUTE_KEY = "ops_notification_muted";

export function useNotificationSound() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === "true";
    } catch {
      return false;
    }
  });

  // Lazily create the Audio element on first interaction (avoids autoplay policy)
  const ensureAudio = useCallback(() => {
    if (!audioRef.current) {
      const a = new Audio(CHIME_URL);
      a.preload = "auto";
      a.volume = 0.7;
      audioRef.current = a;
    }
    return audioRef.current;
  }, []);

  const playSound = useCallback(() => {
    if (muted) return;
    try {
      const audio = ensureAudio();
      // Reset to start so rapid messages each play the full chime
      audio.currentTime = 0;
      audio.play().catch(() => {
        // Browser blocked autoplay — silently ignore
      });
    } catch {
      // Ignore any audio errors
    }
  }, [muted, ensureAudio]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(MUTE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  // Preload audio on mount (warm up the buffer)
  useEffect(() => {
    ensureAudio();
  }, [ensureAudio]);

  return { playSound, muted, toggleMute };
}
