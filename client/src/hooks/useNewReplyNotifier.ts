/**
 * useNewReplyNotifier
 *
 * Watches the unreadJobIds Set for newly-added entries (i.e. a reply that wasn't
 * unread on the previous poll cycle).  When a new entry appears it:
 *   1. Plays a short bell chime via Web Audio API (decoded from a CDN WAV).
 *   2. Shows a browser Notification (requests permission on first trigger).
 *
 * The hook is intentionally side-effect-only — it returns nothing.
 *
 * Usage:
 *   useNewReplyNotifier(unreadJobIds, jobs);
 */

import { useEffect, useRef } from "react";

const CHIME_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/reply-chime_8f7c1b7a.wav";

type Job = {
  id: number;
  customerName: string | null;
  cleanerName: string | null;
};

// ─── Audio helpers ────────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;
let audioBuffer: AudioBuffer | null = null;
let bufferLoading = false;

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

async function loadBuffer(): Promise<AudioBuffer | null> {
  if (audioBuffer) return audioBuffer;
  if (bufferLoading) return null;
  bufferLoading = true;
  try {
    const ctx = getAudioContext();
    if (!ctx) return null;
    const res = await fetch(CHIME_URL);
    const arr = await res.arrayBuffer();
    audioBuffer = await ctx.decodeAudioData(arr);
    return audioBuffer;
  } catch {
    return null;
  } finally {
    bufferLoading = false;
  }
}

function playChime() {
  const ctx = getAudioContext();
  if (!ctx || !audioBuffer) return;
  try {
    // Resume suspended context (required after user interaction policy)
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.55; // subtle volume
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
  } catch {
    // Silently ignore — autoplay policy may block on first load
  }
}

// ─── Notification helpers ─────────────────────────────────────────────────────

async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

function showNotification(title: string, body: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, {
      body,
      icon: "/favicon.ico",
      tag: "reply-alert", // replace previous notification instead of stacking
      silent: true,       // we handle sound ourselves
    });
    // Auto-close after 6 seconds
    setTimeout(() => n.close(), 6000);
  } catch {
    // Silently ignore
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useNewReplyNotifier(
  unreadJobIds: Set<number>,
  jobs: Job[]
) {
  // Track the previous Set so we can diff on each render
  const prevUnreadRef = useRef<Set<number>>(new Set());
  // Track whether we've pre-loaded the audio buffer yet
  const bufferPreloaded = useRef(false);

  // Pre-load audio buffer on first mount (silent — no playback)
  useEffect(() => {
    if (bufferPreloaded.current) return;
    bufferPreloaded.current = true;
    void loadBuffer();
  }, []);

  useEffect(() => {
    const prev = prevUnreadRef.current;
    const newlyUnread: number[] = [];

    for (const id of Array.from(unreadJobIds)) {
      if (!prev.has(id)) {
        newlyUnread.push(id);
      }
    }

    if (newlyUnread.length > 0) {
      // Play chime
      playChime();

      // Show browser notification
      const jobMap = new Map(jobs.map((j) => [j.id, j]));
      const names = newlyUnread
        .map((id) => jobMap.get(id)?.customerName ?? "A client")
        .slice(0, 3); // cap at 3 names to keep notification readable

      const title = newlyUnread.length === 1
        ? `New reply from ${names[0]}`
        : `${newlyUnread.length} new replies`;

      const body = newlyUnread.length === 1
        ? "Tap to open the Day Board and reply"
        : names.join(", ") + (newlyUnread.length > 3 ? ` +${newlyUnread.length - 3} more` : "");

      // Request permission if needed, then show
      void requestNotificationPermission().then((granted) => {
        if (granted) showNotification(title, body);
      });
    }

    // Update ref to current snapshot
    prevUnreadRef.current = new Set(unreadJobIds);
  }, [unreadJobIds, jobs]);
}
