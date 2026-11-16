import { createClaudeThumbtackFirstResponseService, thumbtackFirstResponseConfig, type EligibleLead } from "./claudeThumbtackFirstResponse";
import { createClaudeThumbtackFirstResponseStore, guardClaudeThumbtackManualSendInStore, guardClaudeThumbtackLegacyDraftActionInStore } from "./claudeThumbtackFirstResponseStore";

// No startup initializer, scan, scheduler, staff caller, credentials lookup or model call at import time.
export async function dispatchClaudeThumbtackFirstResponse(captureId: number): Promise<void> {
  if (!thumbtackFirstResponseConfig()) return;
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) throw new Error("THUMBTACK_FIRST_RESPONSE_DB_UNAVAILABLE");
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
  await createClaudeThumbtackFirstResponseService({ config: thumbtackFirstResponseConfig, store,
    generate: generateClaudeInitialLeadContent, send: sendSms })(captureId);
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
