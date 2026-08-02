/**
 * missions/getEta.ts
 *
 * GET_ETA mission handler.
 *
 * Lifecycle:
 * 1. Customer asks "where are they?" / "what time?" → shouldTrigger fires
 * 2. createMission (idempotent) + onCreate → texts cleaner
 * 3. Cleaner replies → handleInboundMessage → stages advance, status = 'ready'
 * 4. Agent clicks "Send to Customer" → handleAgentSend → SMS sent, mission complete
 *
 * Design rules:
 * - Do NOT re-query job/participants in onCreate — use what's stored on the mission.
 * - Do NOT say "on the way" unless the cleaner explicitly said that.
 * - All DB mutations go through missionEngine helpers.
 */

import type { MissionHandler, MissionTriggerCtx } from "./types"; // MissionTriggerCtx used in shouldTrigger
import type { CsMission, CsMissionStage } from "../../drizzle/schema";
import {
  createMission,
  advanceStages,
  flagMission,
  completeMission,
  claimSending,
  revertSending,
} from "../missionEngine";
import { sendSms } from "../openphone";
import { getDb } from "../db";
import { csMissions } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

export const MISSION_TYPE = "GET_ETA";

/** Keyword gate — fast pre-filter before LLM intent check */
const ETA_KEYWORD_RE =
  /\b(eta|arrival|arrive|coming|on the way|how long|what time|where (is|are)|when will)\b/i;

/** Normalize a phone number to 10 digits for matching */
function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, "").slice(-10);
}

/** Build the initial stages for a new GET_ETA mission */
function buildInitialStages(cleanerName?: string | null, customerName?: string | null): CsMissionStage[] {
  const cleaner = cleanerName ? cleanerName.split(" ")[0] : "cleaner";
  const customer = customerName ?? "customer";
  return [
    { id: "1", label: `Text ${cleaner} for ETA`, status: "pending" },
    { id: "2", label: `Waiting on ${cleaner} reply`, status: "pending" },
    { id: "3", label: `Reply to ${customer} with ETA`, status: "pending", suggestedReply: "" },
  ];
}

export const getEtaHandler: MissionHandler = {
  missionType: MISSION_TYPE,

  /**
   * Keyword gate only — the caller (madisonSmsAgent) already ran LLM classification
   * and resolved intent = "get_eta". We just confirm with the keyword gate as a
   * fast sanity check.
   */
  shouldTrigger(ctx: MissionTriggerCtx): boolean {
    return ETA_KEYWORD_RE.test(ctx.inboundText);
  },

  /**
   * Called only when createMission returns created: true.
   * Sends the SMS to the cleaner using the phone stored on the mission row.
   * Does NOT re-query the job.
   */
  async onCreate(mission: CsMission): Promise<void> {
    const cleanerPhone = mission.cleanerPhone;
    const cleanerFirstName = (mission.cleanerName ?? "Team").split(" ")[0];
    const customerName = mission.customerName ?? "your customer";

    if (!cleanerPhone) {
      await flagMission(mission.id, "no_cleaner_phone", { releaseDedupKey: true });
      return;
    }

    // Mark stage 1 as waiting (in progress)
    const stages = buildInitialStages(mission.cleanerName, mission.customerName);
    stages[0] = { ...stages[0], status: "waiting" };
    await advanceStages(mission.id, stages, "waiting");

    // Send SMS to cleaner
    const smsResult = await sendSms({
      to: cleanerPhone.startsWith("+") ? cleanerPhone : `+1${cleanerPhone}`,
      content: `Hi ${cleanerFirstName}, your customer ${customerName} is asking for your ETA. What time do you expect to arrive?`,
    });

    if (!smsResult.success) {
      await flagMission(mission.id, "cleaner_sms_failed", { releaseDedupKey: false });
      return;
    }

    // Stage 1 done, stage 2 waiting
    stages[0] = { ...stages[0], status: "done" };
    stages[1] = { ...stages[1], status: "waiting" };
    await advanceStages(mission.id, stages, "waiting");
  },

  /**
   * Called when an inbound SMS arrives from the cleaner's phone number
   * and matches this waiting mission.
   * Extracts ETA text from the raw message and builds a suggested customer reply.
   */
  async handleInboundMessage(
    inboundText: string,
    _fromPhone: string,
    mission: CsMission
  ): Promise<void> {
    const customerName = mission.customerName ?? "your customer";
    const etaText = inboundText.trim();

    // Build suggested reply — do NOT say "on the way" unless cleaner said so
    const suggestedReply = `Hi ${customerName}, your cleaning team expects to arrive around ${etaText}. We'll keep you posted!`;

    const stages = (mission.stages as CsMissionStage[]).map((s) => ({ ...s }));
    // Find stages by id for safety
    const s2 = stages.find((s) => s.id === "2");
    const s3 = stages.find((s) => s.id === "3");
    if (s2) s2.status = "done";
    if (s3) {
      s3.status = "ready";
      s3.suggestedReply = suggestedReply;
    }

    await advanceStages(mission.id, stages, "ready");
  },

  /**
   * Called when the agent clicks "Send to Customer" in the Operations Panel.
   * Uses claimSending() for atomic double-send protection.
   */
  async handleAgentSend(missionId: number, text: string): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    const [mission] = await db
      .select()
      .from(csMissions)
      .where(eq(csMissions.id, missionId))
      .limit(1);

    if (!mission) throw new Error(`Mission ${missionId} not found`);
    if (mission.status !== "ready") throw new Error("Mission is not ready");
    if (!mission.customerPhone) throw new Error("No customer phone on mission");

    // Atomic claim — prevents double-send on concurrent clicks
    const claimed = await claimSending(missionId);
    if (!claimed) {
      // Another request already claimed it — silently ignore
      return;
    }

    try {
      const customerPhone = mission.customerPhone.startsWith("+")
        ? mission.customerPhone
        : `+1${mission.customerPhone}`;

      const smsResult = await sendSms({ to: customerPhone, content: text });

      if (!smsResult.success) {
        await revertSending(missionId);
        throw new Error(`SMS send failed: ${smsResult.error}`);
      }

      // Mark stage 3 done and complete the mission
      const stages = (mission.stages as CsMissionStage[]).map((s) => ({ ...s }));
      const s3 = stages.find((s) => s.id === "3");
      if (s3) s3.status = "done";

      await advanceStages(missionId, stages);
      await completeMission(missionId);
    } catch (err) {
      // Revert to ready if not already reverted
      await revertSending(missionId).catch(() => {});
      throw err;
    }
  },
};
