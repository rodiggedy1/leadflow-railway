/**
 * useOpsChatWindow
 * Manages the OpsChat panel state (closed | open | minimized) across page
 * navigation using localStorage so the bubble persists without a full-page
 * redirect.
 */
import { useState, useCallback, useEffect } from "react";

export type OpsChatWindowState = "closed" | "open" | "minimized";

const STORAGE_KEY = "ops-chat-window";

function readState(): OpsChatWindowState {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "open" || v === "minimized") return v;
  } catch {
    // SSR / private mode
  }
  return "closed";
}

function writeState(s: OpsChatWindowState) {
  try {
    localStorage.setItem(STORAGE_KEY, s);
  } catch {
    // ignore
  }
}

export function useOpsChatWindow() {
  const [state, setState] = useState<OpsChatWindowState>(readState);

  // Keep localStorage in sync whenever state changes
  useEffect(() => {
    writeState(state);
  }, [state]);

  const open = useCallback(() => setState("open"), []);
  const minimize = useCallback(() => setState("minimized"), []);
  const close = useCallback(() => setState("closed"), []);
  const toggle = useCallback(() => {
    setState((prev) => (prev === "open" ? "minimized" : "open"));
  }, []);

  return { state, open, minimize, close, toggle };
}
