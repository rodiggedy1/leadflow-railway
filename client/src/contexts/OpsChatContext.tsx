/**
 * OpsChatContext
 * Single source of truth for OpsChat open/minimized/closed state.
 * Wrap the app with <OpsChatProvider> and call useOpsChatWindow() anywhere.
 *
 * Added: `initialTab` — when set, OpsChat opens to that specific tab.
 * Call `openToTab("today" | "channels" | "cs")` to open directly to a tab.
 * Added: `activeTab` — tracks the currently active tab inside OpsChat.
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export type OpsChatWindowState = "closed" | "open" | "minimized";
export type OpsChatTab = "today" | "channels" | "cs";

interface OpsChatContextValue {
  state: OpsChatWindowState;
  initialTab: OpsChatTab | null;
  activeTab: OpsChatTab;
  open: () => void;
  openToTab: (tab: OpsChatTab) => void;
  minimize: () => void;
  close: () => void;
  toggle: () => void;
  clearInitialTab: () => void;
  setActiveTab: (tab: OpsChatTab) => void;
}

const OpsChatContext = createContext<OpsChatContextValue | null>(null);

export function OpsChatProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OpsChatWindowState>("closed");
  const [initialTab, setInitialTab] = useState<OpsChatTab | null>(null);
  const [activeTab, setActiveTabState] = useState<OpsChatTab>("channels");

  const open = useCallback(() => setState("open"), []);
  const openToTab = useCallback((tab: OpsChatTab) => {
    setInitialTab(tab);
    setActiveTabState(tab);
    setState("open");
  }, []);
  const minimize = useCallback(() => setState("minimized"), []);
  const close = useCallback(() => {
    setState("closed");
    setInitialTab(null);
  }, []);
  const toggle = useCallback(
    () => setState((prev) => (prev === "open" ? "minimized" : "open")),
    []
  );
  const clearInitialTab = useCallback(() => setInitialTab(null), []);
  const setActiveTab = useCallback((tab: OpsChatTab) => setActiveTabState(tab), []);

  return (
    <OpsChatContext.Provider value={{ state, initialTab, activeTab, open, openToTab, minimize, close, toggle, clearInitialTab, setActiveTab }}>
      {children}
    </OpsChatContext.Provider>
  );
}

export function useOpsChatWindow(): OpsChatContextValue {
  const ctx = useContext(OpsChatContext);
  if (!ctx) throw new Error("useOpsChatWindow must be used inside <OpsChatProvider>");
  return ctx;
}
