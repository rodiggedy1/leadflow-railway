/**
 * useNotificationSound
 * Plays a WhatsApp-style chime when new messages arrive.
 *
 * Strategy (most reliable cross-browser approach):
 * 1. On first user gesture (click/keydown/touchstart), create AudioContext
 *    SYNCHRONOUSLY inside the event handler — this is the only way Chrome
 *    guarantees the context starts in "running" state.
 * 2. Immediately fetch + decode the audio buffer while the context is warm.
 * 3. On playSound(), await ctx.resume() before starting the source node
 *    so we handle the case where the browser suspended the context.
 * 4. Fall back to new Audio() if AudioContext is not available (Safari quirks).
 */
import { useCallback, useEffect, useRef, useState } from "react";

const CHIME_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/notification_94d8b39a.mp3";

const MUTE_KEY = "ops_notification_muted";

export function useNotificationSound() {
  const ctxRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const unlockedRef = useRef(false);

  const [muted, setMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === "true";
    } catch {
      return false;
    }
  });

  // Load the audio buffer — called after context is created
  const loadBuffer = useCallback(async (ctx: AudioContext) => {
    if (bufferRef.current) return; // already loaded
    try {
      const res = await fetch(CHIME_URL);
      const arrayBuffer = await res.arrayBuffer();
      bufferRef.current = await ctx.decodeAudioData(arrayBuffer);
      console.log("[Sound] Audio buffer loaded OK");
    } catch (e) {
      console.warn("[Sound] Failed to load audio buffer:", e);
    }
  }, []);

  // Unlock on first user gesture — AudioContext MUST be created synchronously here
  useEffect(() => {
    const unlock = (e: Event) => {
      if (unlockedRef.current) return;
      unlockedRef.current = true;

      // Remove listeners immediately
      document.removeEventListener("click", unlock, true);
      document.removeEventListener("keydown", unlock, true);
      document.removeEventListener("touchstart", unlock, true);

      try {
        // Create context synchronously inside the event handler
        const ctx = new AudioContext();
        ctxRef.current = ctx;
        console.log("[Sound] AudioContext created, state:", ctx.state);
        // Resume if needed (some browsers start suspended even on gesture)
        const doLoad = () => loadBuffer(ctx);
        if (ctx.state === "suspended") {
          ctx.resume().then(doLoad).catch(doLoad);
        } else {
          doLoad();
        }
      } catch (e) {
        console.warn("[Sound] AudioContext creation failed:", e);
      }
    };

    document.addEventListener("click", unlock, true);
    document.addEventListener("keydown", unlock, true);
    document.addEventListener("touchstart", unlock, true);

    return () => {
      document.removeEventListener("click", unlock, true);
      document.removeEventListener("keydown", unlock, true);
      document.removeEventListener("touchstart", unlock, true);
    };
  }, [loadBuffer]);

  const playSound = useCallback(() => {
    if (muted) {
      console.log("[Sound] Muted, skipping");
      return;
    }

    const ctx = ctxRef.current;
    console.log("[Sound] playSound called — ctx:", ctx ? ctx.state : "null", "buffer:", !!bufferRef.current);

    // AudioContext not yet created (no user gesture yet) — use Audio element as fallback
    if (!ctx) {
      try {
        const audio = new Audio(CHIME_URL);
        audio.volume = 0.7;
        audio.play().catch((e) => console.warn("[Sound] Audio fallback failed:", e));
      } catch {}
      return;
    }

    const doPlay = () => {
      const buf = bufferRef.current;
      if (!buf) {
        // Buffer still loading — schedule a retry after 600ms
        console.log("[Sound] Buffer not ready, retrying in 600ms");
        setTimeout(() => {
          if (bufferRef.current && ctxRef.current) {
            try {
              const src = ctxRef.current.createBufferSource();
              src.buffer = bufferRef.current;
              src.connect(ctxRef.current.destination);
              src.start(0);
              console.log("[Sound] Played (retry)");
            } catch (e) {
              console.warn("[Sound] Retry play failed:", e);
            }
          }
        }, 600);
        return;
      }
      try {
        const source = ctx.createBufferSource();
        source.buffer = buf;
        source.connect(ctx.destination);
        source.start(0);
        console.log("[Sound] Played OK");
      } catch (e) {
        console.warn("[Sound] playSound error:", e);
      }
    };

    if (ctx.state === "suspended") {
      console.log("[Sound] Resuming suspended context...");
      ctx.resume().then(doPlay).catch(doPlay);
    } else {
      doPlay();
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
