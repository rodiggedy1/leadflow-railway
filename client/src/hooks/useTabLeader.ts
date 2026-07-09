/**
 * useTabLeader
 *
 * Elects a single "leader" tab among all open tabs for the same origin.
 * Only the leader tab should fire browser notifications and play sounds,
 * preventing duplicates when multiple tabs are open simultaneously.
 *
 * Protocol (BroadcastChannel "leadflow-tab-leader"):
 *
 *   Election:
 *   - On mount: broadcast "PING" to ask if a leader already exists.
 *   - If a "PONG" arrives within 200 ms → this tab is a follower.
 *   - If no PONG arrives → this tab becomes the leader and broadcasts "I_AM_LEADER".
 *   - When a leader tab receives "PING" → it replies "PONG".
 *
 *   Heartbeat (prevents silent dead-leader):
 *   - The leader broadcasts "HEARTBEAT" every HEARTBEAT_INTERVAL_MS.
 *   - Followers record the last heartbeat timestamp.
 *   - If a follower hasn't seen a heartbeat in HEARTBEAT_TIMEOUT_MS it runs
 *     a new election (handles the case where the leader tab crashed or closed
 *     without broadcasting "LEADER_GONE").
 *
 *   Graceful handoff:
 *   - When a leader tab unmounts it broadcasts "LEADER_GONE" so followers
 *     can elect a new leader immediately without waiting for the timeout.
 *
 * Returns: { isLeader: boolean }
 */
import { useEffect, useRef, useState } from "react";

const CHANNEL_NAME = "leadflow-tab-leader";
const PONG_TIMEOUT_MS = 200;
const HEARTBEAT_INTERVAL_MS = 5_000;   // leader pings every 5 s
const HEARTBEAT_TIMEOUT_MS = 12_000;   // follower re-elects if silent for 12 s

export function useTabLeader(): { isLeader: boolean } {
  const [isLeader, setIsLeader] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const pongTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatSendRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatWatchRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastHeartbeatRef = useRef<number>(Date.now());

  // Keep a ref in sync with isLeader so the onmessage closure always reads the
  // current value — updated IMMEDIATELY inside becomeLeader() (not via a
  // separate useEffect) so cleanup sees the correct value even on fast unmount.
  const isLeaderRef = useRef(false);

  useEffect(() => {
    // BroadcastChannel is not available in SSR or very old browsers
    if (typeof BroadcastChannel === "undefined") {
      // Fallback: always be the leader (single-tab behaviour)
      setIsLeader(true);
      isLeaderRef.current = true;
      return;
    }

    const ch = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = ch;

    const stopHeartbeatSend = () => {
      if (heartbeatSendRef.current) {
        clearInterval(heartbeatSendRef.current);
        heartbeatSendRef.current = null;
      }
    };

    const stopHeartbeatWatch = () => {
      if (heartbeatWatchRef.current) {
        clearInterval(heartbeatWatchRef.current);
        heartbeatWatchRef.current = null;
      }
    };

    const becomeLeader = () => {
      // Sync ref immediately — before any async state update — so that the
      // cleanup function sees the correct value even if the component unmounts
      // before React flushes the setState.
      isLeaderRef.current = true;
      setIsLeader(true);
      console.log("[LeadAlert] TabLeader: THIS TAB IS NOW LEADER");
      ch.postMessage({ type: "I_AM_LEADER" });

      // Stop watching for heartbeats (we are the source now)
      stopHeartbeatWatch();

      // Start sending heartbeats so followers know we are alive
      stopHeartbeatSend();
      heartbeatSendRef.current = setInterval(() => {
        ch.postMessage({ type: "HEARTBEAT" });
      }, HEARTBEAT_INTERVAL_MS);
    };

    const becomeFollower = () => {
      isLeaderRef.current = false;
      setIsLeader(false);
      console.log("[LeadAlert] TabLeader: this tab is a FOLLOWER");
      stopHeartbeatSend();

      // Start watching for heartbeats — re-elect if leader goes silent
      stopHeartbeatWatch();
      lastHeartbeatRef.current = Date.now();
      heartbeatWatchRef.current = setInterval(() => {
        if (Date.now() - lastHeartbeatRef.current > HEARTBEAT_TIMEOUT_MS) {
          // Leader has been silent too long — run a new election
          stopHeartbeatWatch();
          runElection();
        }
      }, HEARTBEAT_TIMEOUT_MS / 2);
    };

    const runElection = () => {
      ch.postMessage({ type: "PING" });
      if (pongTimerRef.current) clearTimeout(pongTimerRef.current);
      pongTimerRef.current = setTimeout(() => {
        // No PONG received — we are the new leader
        becomeLeader();
      }, PONG_TIMEOUT_MS);
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
        // A leader already exists — cancel our election timer and become follower
        if (pongTimerRef.current) {
          clearTimeout(pongTimerRef.current);
          pongTimerRef.current = null;
        }
        becomeFollower();
        return;
      }

      if (type === "I_AM_LEADER") {
        // Another tab declared itself leader — we are a follower
        if (pongTimerRef.current) {
          clearTimeout(pongTimerRef.current);
          pongTimerRef.current = null;
        }
        becomeFollower();
        return;
      }

      if (type === "HEARTBEAT") {
        // Leader is alive — reset the watchdog timer
        lastHeartbeatRef.current = Date.now();
        return;
      }

      if (type === "LEADER_GONE") {
        // Leader closed gracefully — run a randomised election so only one tab wins
        stopHeartbeatWatch();
        const delay = Math.random() * 150;
        if (pongTimerRef.current) clearTimeout(pongTimerRef.current);
        pongTimerRef.current = setTimeout(() => {
          runElection();
        }, delay);
        return;
      }
    };

    // Kick off the initial election
    runElection();

    return () => {
      if (pongTimerRef.current) clearTimeout(pongTimerRef.current);
      stopHeartbeatSend();
      stopHeartbeatWatch();
      // Notify other tabs that the leader is gone (only if we are the leader).
      // isLeaderRef.current is always up-to-date because becomeLeader() sets it
      // synchronously before calling setIsLeader().
      if (isLeaderRef.current) {
        ch.postMessage({ type: "LEADER_GONE" });
      }
      ch.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isLeader };
}
