/**
 * missions/index.ts
 *
 * Mission handler registry.
 * Add new mission handlers here — no other file needs to change for routing.
 */

import type { MissionHandler } from "./types";
import { getEtaHandler } from "./getEta";

/** All registered mission handlers */
export const missionHandlers: MissionHandler[] = [getEtaHandler];

/**
 * Returns the handler for a given missionType.
 * Throws if no handler is registered — this is intentional so unhandled
 * mission types surface immediately rather than silently failing.
 */
export function getMissionHandler(missionType: string): MissionHandler {
  const handler = missionHandlers.find((h) => h.missionType === missionType);
  if (!handler) throw new Error(`No mission handler registered for type: ${missionType}`);
  return handler;
}
