/**
 * useMissionHistory.ts
 *
 * Mission history for Madison AI Concierge.
 *
 * Architecture (v2):
 * - SERVER is the source of truth — missions are persisted via createAndSaveMission
 *   on the server at the moment of action, not by the client.
 * - localStorage is an OPTIONAL display cache — used only to show missions
 *   immediately on mount before the server query resolves, and to avoid a blank
 *   panel on first render. It is never the authoritative record.
 * - On mount, the hook fires trpc.aiConcierge.getMissions to hydrate from the server.
 *   The server response replaces the cache.
 * - addMission() is kept for optimistic display only — it adds to local state so
 *   the new mission appears immediately in the UI without waiting for a refetch.
 *   It does NOT write to the server (the server already wrote it in sendBulkSms /
 *   sendPaymentLinkSms).
 * - clearHistory() calls trpc.aiConcierge.archiveMissions on the server, then
 *   clears local state and the localStorage cache.
 * - View state (expanded/collapsed) is stored in localStorage only — it is purely
 *   a display preference and does not need server persistence.
 * - New missions (added via addMission) start EXPANDED and auto-collapse after 2s.
 * - Restored missions (loaded from server on mount) start COLLAPSED.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";

// ── Types (mirrored from server/aiConciergeRouter.ts — keep in sync) ──────────

export interface MissionStep {
  id: string;
  label: string;
  status: "completed" | "failed" | "skipped";
  detail?: string;
}

export interface MissionStats {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  waiting: number;
}

export interface MissionMetadata {
  missionId: string;
  missionTitle: string;
  missionStatus: "completed" | "failed" | "blocked";
  missionStartedAt: string;
  missionCompletedAt: string;
  missionSteps: MissionStep[];
  missionStats: MissionStats;
  missionSummary: string;
}

export interface MadisonMission extends MissionMetadata {
  /** ISO timestamp when this mission was added to local history */
  addedAt: string;
  /** True when this mission was just created in this session (not restored from server) */
  isNew?: boolean;
}

export type MissionViewState = "expanded" | "collapsed";

interface StoredViewState {
  version: 1;
  viewState: Record<string, MissionViewState>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const VIEW_STATE_KEY_PREFIX = "madison_mission_view_v1_";

function viewStateKey(userId: string): string {
  return `${VIEW_STATE_KEY_PREFIX}${userId}`;
}

// ── View state storage helpers ────────────────────────────────────────────────

function loadViewState(userId: string): Record<string, MissionViewState> {
  if (!userId) return {};
  try {
    const raw = localStorage.getItem(viewStateKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<StoredViewState>;
    if (parsed.version !== 1) return {};
    return (parsed.viewState && typeof parsed.viewState === "object")
      ? parsed.viewState as Record<string, MissionViewState>
      : {};
  } catch {
    return {};
  }
}

function saveViewState(userId: string, viewState: Record<string, MissionViewState>): void {
  if (!userId) return;
  try {
    const data: StoredViewState = { version: 1, viewState };
    localStorage.setItem(viewStateKey(userId), JSON.stringify(data));
  } catch {
    // Storage quota exceeded — fail silently
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseMissionHistoryReturn {
  missions: MadisonMission[];
  viewState: Record<string, MissionViewState>;
  addMission: (metadata: MissionMetadata) => void;
  setViewState: (missionId: string, state: MissionViewState) => void;
  clearHistory: () => void;
  isHydrated: boolean;
  isLoading: boolean;
}

export function useMissionHistory(userId: string | undefined): UseMissionHistoryReturn {
  const [missions, setMissions] = useState<MadisonMission[]>([]);
  const [viewState, setViewStateMap] = useState<Record<string, MissionViewState>>({});
  const [isHydrated, setIsHydrated] = useState(false);
  const loadedForRef = useRef<string | undefined>(undefined);
  const serverSyncedRef = useRef(false);

  // ── Server query — fires once per userId ─────────────────────────────────────
  const getMissionsQuery = trpc.aiConcierge.getMissions.useQuery(
    { limit: 50 },
    {
      enabled: !!userId,
      // Don't refetch on window focus — missions are append-only from the server's perspective
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes
    }
  );

  // ── Archive mutation ──────────────────────────────────────────────────────────
  const archiveMutation = trpc.aiConcierge.archiveMissions.useMutation();

  // ── Load view state from localStorage when userId changes ────────────────────
  useEffect(() => {
    if (!userId) return;
    if (loadedForRef.current === userId) return;
    loadedForRef.current = userId;
    const vs = loadViewState(userId);
    setViewStateMap(vs);
    setIsHydrated(true);
  }, [userId]);

  // ── Sync from server when query resolves ─────────────────────────────────────
  useEffect(() => {
    if (!getMissionsQuery.data || serverSyncedRef.current) return;
    serverSyncedRef.current = true;

    const serverMissions: MadisonMission[] = getMissionsQuery.data.map(row => ({
      missionId: row.missionId,
      missionTitle: row.title,
      missionStatus: row.status as MadisonMission["missionStatus"],
      missionStartedAt: new Date(row.startedAt ?? Date.now()).toISOString(),
      missionCompletedAt: new Date(row.completedAt ?? Date.now()).toISOString(),
      missionSteps: (row.steps as MissionStep[]) ?? [],
      missionStats: (row.stats as MissionStats) ?? { total: 0, completed: 0, failed: 0, skipped: 0, waiting: 0 },
      missionSummary: row.summary ?? "",
      addedAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
      isNew: false, // restored from server — starts collapsed
    }));

    setMissions(prev => {
      // Merge: keep any locally-added new missions (isNew: true) that aren't yet in server data,
      // then append server missions (deduped by missionId).
      const serverIds = new Set(serverMissions.map(m => m.missionId));
      const localNewOnly = prev.filter(m => m.isNew && !serverIds.has(m.missionId));
      return [...localNewOnly, ...serverMissions];
    });
  }, [getMissionsQuery.data]);

  // ── Persist view state to localStorage whenever it changes ───────────────────
  useEffect(() => {
    if (!isHydrated || !userId) return;
    saveViewState(userId, viewState);
  }, [viewState, isHydrated, userId]);

  // ── addMission — optimistic display only ─────────────────────────────────────
  // The server already persisted the mission. This just makes it appear immediately
  // in the UI without waiting for a getMissions refetch.
  const addMission = useCallback((metadata: MissionMetadata) => {
    setMissions(prev => {
      // Deduplication: skip if missionId already exists
      if (prev.some(m => m.missionId === metadata.missionId)) return prev;

      const newMission: MadisonMission = {
        ...metadata,
        addedAt: new Date().toISOString(),
        isNew: true, // brand new — starts expanded
      };

      // Prepend (newest first)
      return [newMission, ...prev];
    });

    // New missions start expanded
    setViewStateMap(prev => ({
      ...prev,
      [metadata.missionId]: "expanded",
    }));
  }, []);

  // ── setViewState ──────────────────────────────────────────────────────────────
  const setViewState = useCallback((missionId: string, state: MissionViewState) => {
    setViewStateMap(prev => ({ ...prev, [missionId]: state }));
  }, []);

  // ── clearHistory — archives on server, clears local state ────────────────────
  const clearHistory = useCallback(() => {
    archiveMutation.mutate(undefined, {
      onSuccess: () => {
        setMissions([]);
        setViewStateMap({});
        if (loadedForRef.current) {
          saveViewState(loadedForRef.current, {});
        }
      },
      onError: (err) => {
        console.error("[MissionHistory] Archive failed:", err.message);
        // Still clear locally so the UI doesn't appear stuck
        setMissions([]);
        setViewStateMap({});
      },
    });
  }, [archiveMutation]);

  return {
    missions,
    viewState,
    addMission,
    setViewState,
    clearHistory,
    isHydrated,
    isLoading: getMissionsQuery.isLoading,
  };
}
