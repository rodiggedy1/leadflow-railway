/**
 * OpsChatContext
 * Single source of truth for OpsChat open/minimized/closed state.
 * Wrap the app with <OpsChatProvider> and call useOpsChatWindow() anywhere.
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export type OpsChatWindowState = "closed" | "open" | "minimized";

interface OpsChatContextValue {
  state: OpsChatWindowState;
  open: () => void;
  minimize: () => void;
  close: () => void;
  toggle: () => void;
}

const OpsChatContext = createContext<OpsChatContextValue | null>(null);

export function OpsChatProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OpsChatWindowState>("closed");

  const open = useCallback(() => setState("open"), []);
  const minimize = useCallback(() => setState("minimized"), []);
  const close = useCallback(() => setState("closed"), []);
  const toggle = useCallback(
    () => setState((prev) => (prev === "open" ? "minimized" : "open")),
    []
  );

  return (
    <OpsChatContext.Provider value={{ state, open, minimize, close, toggle }}>
      {children}
    </OpsChatContext.Provider>
  );
}

export function useOpsChatWindow(): OpsChatContextValue {
  const ctx = useContext(OpsChatContext);
  if (!ctx) throw new Error("useOpsChatWindow must be used inside <OpsChatProvider>");
  return ctx;
}
