import { createClaudeThumbtackFirstResponseService, thumbtackFirstResponseConfig, type EligibleLead, type FirstResponseOutcome } from "./claudeThumbtackFirstResponse";
import { createClaudeThumbtackFirstResponseStore, guardClaudeThumbtackManualSendInStore, guardClaudeThumbtackLegacyDraftActionInStore } from "./claudeThumbtackFirstResponseStore";

// No startup initializer, scan, scheduler, staff caller, credentials lookup or model call at import time.
export async function dispatchClaudeThumbtackFirstResponse(captureId: number): Promise<FirstResponseOutcome> {
  if (!thumbtackFirstResponseConfig()) return { captureId, outcome: "disabled", code: "DISABLED_OR_SENDER_UNAVAILABLE" };
  const { getDb } = await import("../db");
  const db = await getDb();
  const { createNativeIntroductionFailureReporter } = await import("./claudeThumbtackFirstResponseFailure");
  const { notifyOwner } = await import("../_core/notification");
  const reportFailure = createNativeIntroductionFailureReporter({ db, notify: notifyOwner, refresh: async () => {
    const { broadcastOpsUpdate } = await import("../sseBroadcast");
    broadcastOpsUpdate("task_update", { channel: "command" });
  } });
  if (!db) {
    await reportFailure({ captureId, lead: null, claim: null, stage: "claim", code: "THUMBTACK_FIRST_RESPONSE_DB_UNAVAILABLE", uncertain: false });
    return { captureId, outcome: "failed", code: "THUMBTACK_FIRST_RESPONSE_DB_UNAVAILABLE" };
  }
  const { sendSms, estimatePrice } = await import("../openphone");
  const { generateClaudeInitialLeadContent } = await import("./claudeInitialLead");
  const store = createClaudeThumbtackFirstResponseStore(db, (lead: EligibleLead) => {
    // Retain existing quote calculator only for source-confirmed fields. No guessed 3bd/2ba/default service.
    const { bedrooms, bathrooms, serviceType } = lead.facts;
    if (!bedrooms || !bathrooms || !serviceType) return null;
    const roomLabel = (value: string, unit: "Bedroom" | "Bathroom") => /^\d+(?:\.\d+)?$/.test(value)
      ? `${value} ${unit}${value === "1" ? "" : "s"}` : value;
    return estimatePrice({ bedrooms: roomLabel(bedrooms, "Bedroom"), bathrooms: roomLabel(bathrooms, "Bathroom"), serviceType });
  });
  return createClaudeThumbtackFirstResponseService({ config: thumbtackFirstResponseConfig, store,
    generate: generateClaudeInitialLeadContent, send: sendSms, onFailure: reportFailure })(captureId);
}

/** Parent's existing two live-send routes call this before their original side effects. */
export async function guardClaudeThumbtackManualSend(input: { sessionId?: number; phone?: string }): Promise<void> {
  if (!thumbtackFirstResponseConfig()) return;
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) throw new Error("THUMBTACK_FIRST_RESPONSE_DB_UNAVAILABLE");
  await guardClaudeThumbtackManualSendInStore(db, input);
}

export async function guardClaudeThumbtackLegacyDraftAction(draftId: number): Promise<void> {
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) return; // Original legacy draft handlers also return their existing no_db result.
  await guardClaudeThumbtackLegacyDraftActionInStore(db, draftId);
}
