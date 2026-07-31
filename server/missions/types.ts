/**
 * missions/types.ts
 *
 * Shared types for the Mission Engine handler interface.
 * Each mission type implements MissionHandler and registers itself in index.ts.
 */

import type { CsMission } from "../../drizzle/schema";

/**
 * Context available when a customer inbound SMS triggers a mission.
 */
export interface MissionTriggerCtx {
  sessionId: number;
  agentId: number;
  fromPhone: string;
  customerName?: string;
  inboundText: string;
  /** cleanerJobId from resolveContext (today's job for this customer) */
  cleanerJobId?: number;
  /** cleanerPhone from resolveContext (E.164, e.g. "+12025551234") */
  cleanerPhone?: string;
  /** cleanerName / teamName from resolveContext */
  cleanerName?: string;
}

/**
 * Each mission type must implement this interface.
 */
export interface MissionHandler {
  /** Unique string identifier stored in cs_missions.missionType */
  missionType: string;

  /**
   * Returns true if this mission type should be triggered for the given inbound message.
   * Called after Madison's LLM classification — use keyword gate + intent check.
   * Should be fast and not throw.
   */
  shouldTrigger?: (ctx: MissionTriggerCtx) => boolean | Promise<boolean>;

  /**
   * Called only when createMission returns created: true.
   * Responsible for sending the first external action (e.g. SMS to cleaner).
   * Uses the already-stored mission row — do NOT re-query job/participants.
   */
  onCreate: (ctx: MissionTriggerCtx, mission: CsMission) => Promise<void>;

  /**
   * Called when an inbound SMS arrives from a cleaner phone that matches
   * a waiting mission of this type.
   * Responsible for advancing stages and setting status to 'ready'.
   */
  handleInboundMessage?: (
    inboundText: string,
    fromPhone: string,
    mission: CsMission
  ) => Promise<void>;

  /**
   * Called when the agent clicks "Send to Customer".
   * Responsible for sending the SMS and completing the mission.
   * Must use claimSending() for double-send protection.
   */
  handleAgentSend?: (missionId: number, text: string) => Promise<void>;
}
