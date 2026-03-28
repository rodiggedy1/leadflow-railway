/**
 * useNotificationSound
 * Plays a WhatsApp-style chime when new messages arrive from other people.
 *
 * Uses AudioContext + AudioBuffer instead of <Audio> so the sound plays
 * even when the tab is in the background (browsers block Audio.play() on
 * hidden tabs but allow AudioContext playback that was unlocked by a prior
 * user gesture).
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
  const ctxRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const loadingRef = useRef(false);
  const [muted, setMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === "true";
    } catch {
      return false;
    }
  });

  // Create (or resume) the AudioContext — must be called from a user gesture
  const ensureContext = useCallback((): AudioContext => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
    }
    // Resume if suspended (browser pauses context when page loses focus)
    if (ctxRef.current.state === "suspended") {
      ctxRef.current.resume().catch(() => {});
    }
    return ctxRef.current;
  }, []);

  // Decode and cache the audio buffer
  const loadBuffer = useCallback(async () => {
    if (bufferRef.current || loadingRef.current) return;
    loadingRef.current = true;
    try {
      const ctx = ensureContext();
      const res = await fetch(CHIME_URL);
      const arrayBuffer = await res.arrayBuffer();
      bufferRef.current = await ctx.decodeAudioData(arrayBuffer);
    } catch {
      // Silently ignore — will retry on next playSound call
    } finally {
      loadingRef.current = false;
    }
  }, [ensureContext]);

  // Unlock AudioContext on first user interaction anywhere on the page
  useEffect(() => {
    const unlock = () => {
      ensureContext();
      loadBuffer();
      // Once unlocked, we don't need to listen anymore
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
  }, [ensureContext, loadBuffer]);

  const playSound = useCallback(() => {
    if (muted) return;
    try {
      const ctx = ensureContext();
      if (!bufferRef.current) {
        // Buffer not loaded yet — try to load and play once ready
        loadBuffer().then(() => {
          if (!bufferRef.current || !ctxRef.current) return;
          const source = ctxRef.current.createBufferSource();
          source.buffer = bufferRef.current;
          source.connect(ctxRef.current.destination);
          source.start(0);
        }).catch(() => {});
        return;
      }
      // Play immediately from the cached buffer
      const source = ctx.createBufferSource();
      source.buffer = bufferRef.current;
      source.connect(ctx.destination);
      source.start(0);
    } catch {
      // Ignore any audio errors
    }
  }, [muted, ensureContext, loadBuffer]);

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
