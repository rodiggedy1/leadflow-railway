/**
 * usePageVisibility
 *
 * Returns true when the browser tab is visible (document.visibilityState === "visible").
 * Use as the `enabled` condition on polling queries to pause them when the tab is hidden.
 *
 * Usage:
 *   const isVisible = usePageVisibility();
 *   trpc.opsChat.getTyping.useQuery(input, {
 *     refetchInterval: isVisible ? 3000 : false,
 *   });
 */
import { useEffect, useState } from "react";

export function usePageVisibility(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document !== "undefined" ? document.visibilityState === "visible" : true
  );

  useEffect(() => {
    const handler = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  return visible;
}
