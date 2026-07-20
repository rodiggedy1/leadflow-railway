/**
 * useMissionHistory.ts
 *
 * Persistent mission history for Madison AI Concierge.
 * Stores completed mission cards in localStorage, keyed per user.
 *
 * Design decisions:
 * - Server generates missionId, timestamps, steps, stats — client never invents these
 * - Deduplication by missionId prevents duplicates on retry/remount
 * - Schema versioning allows future migrations without data loss
 * - Bounded to MAX_MISSIONS entries (oldest pruned first)
 * - View state (expanded/collapsed) stored separately so it survives history clears
 * - Handles malformed JSON, storage quota errors, and user changes gracefully
 * - Does NOT write to localStorage before hydration completes
 */

import { useState, useEffect, useCallback, useRef } from "react";

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
}

export type MissionViewState = "expanded" | "collapsed";

interface StoredMissionHistory {
  version: 1;
  missions: MadisonMission[];
  viewState: Record<string, MissionViewState>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 1 as const;
const MAX_MISSIONS = 100;

function storageKey(userId: string): string {
  return `madison_missions_v1_${userId}`;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function loadFromStorage(userId: string): StoredMissionHistory {
  const empty: StoredMissionHistory = { version: SCHEMA_VERSION, missions: [], viewState: {} };
  if (!userId) return empty;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<StoredMissionHistory>;
    // Schema version check — if version mismatch, discard and start fresh
    if (parsed.version !== SCHEMA_VERSION) return empty;
    return {
      version: SCHEMA_VERSION,
      missions: Array.isArray(parsed.missions) ? parsed.missions : [],
      viewState: (parsed.viewState && typeof parsed.viewState === "object")
        ? parsed.viewState as Record<string, MissionViewState>
        : {},
    };
  } catch {
    return empty;
  }
}

function saveToStorage(userId: string, data: StoredMissionHistory): void {
  if (!userId) return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(data));
  } catch {
    // Storage quota exceeded or unavailable — fail silently
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
}

export function useMissionHistory(userId: string | undefined): UseMissionHistoryReturn {
  const [isHydrated, setIsHydrated] = useState(false);
  const [data, setData] = useState<StoredMissionHistory>({
    version: SCHEMA_VERSION,
    missions: [],
    viewState: {},
  });

  // Track the userId we loaded for, so we reload if user changes
  const loadedForRef = useRef<string | undefined>(undefined);

  // Hydrate from localStorage once userId is available
  useEffect(() => {
    if (!userId) return;
    if (loadedForRef.current === userId) return; // already loaded for this user
    loadedForRef.current = userId;
    const stored = loadFromStorage(userId);
    setData(stored);
    setIsHydrated(true);
  }, [userId]);

  // Persist to localStorage whenever data changes — only AFTER hydration completes
  // This prevents writing an empty history before we've read the stored one
  useEffect(() => {
    if (!isHydrated || !userId) return;
    saveToStorage(userId, data);
  }, [data, isHydrated, userId]);

  const addMission = useCallback((metadata: MissionMetadata) => {
    setData(prev => {
      // Deduplication: skip if missionId already exists
      if (prev.missions.some(m => m.missionId === metadata.missionId)) return prev;

      const newMission: MadisonMission = {
        ...metadata,
        addedAt: new Date().toISOString(),
      };

      // Prepend (newest first in storage), then prune to MAX_MISSIONS
      const updated = [newMission, ...prev.missions].slice(0, MAX_MISSIONS);

      // New missions always start expanded — auto-collapse handled by MissionCard
      const newViewState = {
        ...prev.viewState,
        [metadata.missionId]: "expanded" as MissionViewState,
      };

      return {
        ...prev,
        missions: updated,
        viewState: newViewState,
      };
    });
  }, []);

  const setViewState = useCallback((missionId: string, state: MissionViewState) => {
    setData(prev => ({
      ...prev,
      viewState: { ...prev.viewState, [missionId]: state },
    }));
  }, []);

  const clearHistory = useCallback(() => {
    // Clear missions immediately in both React state and localStorage
    setData(prev => {
      const cleared: StoredMissionHistory = {
        ...prev,
        missions: [],
        // Keep viewState — harmless, avoids flash if missions are re-added
      };
      // Write synchronously so localStorage is updated immediately
      if (loadedForRef.current) {
        saveToStorage(loadedForRef.current, cleared);
      }
      return cleared;
    });
  }, []);

  return {
    missions: data.missions,
    viewState: data.viewState,
    addMission,
    setViewState,
    clearHistory,
    isHydrated,
  };
}
