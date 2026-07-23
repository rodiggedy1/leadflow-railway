/**
 * logger.ts
 *
 * Lightweight structured logger for Madison planner execution.
 * Logs to console in a structured format. Full audit system comes later.
 */

import type { MadisonExecutionLog } from "./types";

export function logMadisonExecution(log: MadisonExecutionLog): void {
  const duration =
    log.executionEndedAt && log.executionStartedAt
      ? log.executionEndedAt - log.executionStartedAt
      : null;

  const entry = {
    "[Madison]": true,
    requestId: log.requestId,
    domain: log.domain,
    message: log.message.slice(0, 80),
    durationMs: duration,
    fallbackReason: log.fallbackReason ?? null,
    error: log.error ?? null,
  };

  if (log.error || log.fallbackReason) {
    console.warn("[Madison]", JSON.stringify(entry));
  } else {
    console.log("[Madison]", JSON.stringify(entry));
  }
}
