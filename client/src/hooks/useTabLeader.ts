/**
 * useTabLeader
 *
 * Elects a single "leader" tab among all open tabs for the same origin.
 * Only the leader tab should fire browser notifications and play sounds,
 * preventing duplicates when multiple tabs are open simultaneously.
 *
 * Protocol (BroadcastChannel "leadflow-tab-leader"):
 *   - On mount: broadcast "PING" to ask if a leader already exists.
 *   - If a "PONG" arrives within 200 ms → this tab is a follower.
 *   - If no PONG arrives → this tab becomes the leader and broadcasts "I_AM_LEADER".
 *   - When a leader tab receives "PING" → it replies "PONG".
 *   - When a leader tab unmounts (closes/navigates away) → it broadcasts "LEADER_GONE".
 *   - Any follower that receives "LEADER_GONE" runs its own election after a short
 *     random delay (to avoid simultaneous elections) and becomes the new leader.
 *
 * Returns: { isLeader: boolean }
 */
import { useEffect, useRef, useState } from "react";

const CHANNEL_NAME = "leadflow-tab-leader";
const PONG_TIMEOUT_MS = 200;

export function useTabLeader(): { isLeader: boolean } {
  const [isLeader, setIsLeader] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const pongTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep a ref in sync so the onmessage closure can read the current value
  const isLeaderRef = useRef(false);

  useEffect(() => {
    // BroadcastChannel is not available in SSR or very old browsers
    if (typeof BroadcastChannel === "undefined") {
      // Fallback: always be the leader (single-tab behaviour)
      setIsLeader(true);
      return;
    }

    const ch = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = ch;

    const becomeLeader = () => {
      setIsLeader(true);
      ch.postMessage({ type: "I_AM_LEADER" });
    };

    ch.onmessage = (event) => {
      const { type } = event.data ?? {};

      if (type === "PING") {
        // Another tab is asking if a leader exists — reply if we are the leader
        if (isLeaderRef.current) {
          ch.postMessage({ type: "PONG" });
        }
        return;
      }

      if (type === "PONG") {
        // A leader already exists — cancel our election timer and stay as follower
        if (pongTimerRef.current) {
          clearTimeout(pongTimerRef.current);
          pongTimerRef.current = null;
        }
        setIsLeader(false);
        return;
      }

      if (type === "I_AM_LEADER") {
        // Another tab declared itself leader — we are a follower
        if (pongTimerRef.current) {
          clearTimeout(pongTimerRef.current);
          pongTimerRef.current = null;
        }
        setIsLeader(false);
        return;
      }

      if (type === "LEADER_GONE") {
        // The leader closed — run a randomised election so only one tab wins
        const delay = Math.random() * 150;
        pongTimerRef.current = setTimeout(() => {
          becomeLeader();
        }, delay);
        return;
      }
    };

    // Kick off the election: broadcast PING and wait for a PONG
    ch.postMessage({ type: "PING" });
    pongTimerRef.current = setTimeout(() => {
      // No PONG received — we are the leader
      becomeLeader();
    }, PONG_TIMEOUT_MS);

    return () => {
      if (pongTimerRef.current) clearTimeout(pongTimerRef.current);
      // Notify other tabs that the leader is gone (only matters if we are the leader)
      if (isLeaderRef.current) {
        ch.postMessage({ type: "LEADER_GONE" });
      }
      ch.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    isLeaderRef.current = isLeader;
  }, [isLeader]);

  return { isLeader };
}
