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
 * Returns the handler for a given missionType, or undefined if none is registered.
 * MANUAL and other unregistered types return undefined — callers must guard.
 */
export function getMissionHandler(missionType: string): MissionHandler | undefined {
  return missionHandlers.find((h) => h.missionType === missionType);
}
