/**
 * useOpsChatWindow
 * Thin hook that reads from OpsChatContext — the single source of truth.
 * Import OpsChatProvider and wrap App with it; then call useOpsChatWindow()
 * anywhere to get/set the state.
 */
export { useOpsChatWindow, OpsChatProvider } from "../contexts/OpsChatContext";
export type { OpsChatWindowState } from "../contexts/OpsChatContext";
