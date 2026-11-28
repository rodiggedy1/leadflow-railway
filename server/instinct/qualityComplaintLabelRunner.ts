// Phase 2: the same optional quality-complaint label on Claude's EXISTING email and call processing, with no extra AI
// call and no change to those generators. The wrapper:
//   1. puts one fixed paragraph in front of the system prompt it is given (the generator's own prompt follows unchanged,
//      still ending with the knowledge base; a retry reuses the exact same request object, as before),
//   2. calls the same runner (same model, transport and cache setting),
//   3. removes "qualityComplaint" from the JSON answer before the generator's existing strict checks see it.
// If the answer is not a JSON object, it is returned exactly as received, so existing validation behaves as before.
import { validateSmsQualityComplaint, type SmsQualityComplaint } from "../../shared/teamQualityIncidents";
import { runInitialLeadDraft, type InitialLeadDraftOptions } from "./claudeAgentClient";

export const QUALITY_COMPLAINT_LABEL_INSTRUCTIONS = `OPTIONAL QUALITY COMPLAINT LABEL (internal data only, never shown to anyone):
Your JSON object may include ONE more optional top-level field, "qualityComplaint". Include it only when the current customer communication you are processing (the incoming email or the call transcript) itself reports dissatisfaction or a problem with a cleaning or with our service: {"category":"cleaning_quality"|"team_service"|"office_service"|"pricing_billing"|"scheduling"|"other","severity":"low"|"medium"|"high","evidenceQuotes":["exact literal quote from that email or transcript"],"serviceDate":"YYYY-MM-DD"|null,"recleanRequested":true|false,"refundRequested":true|false}. cleaning_quality = the cleaning itself (missed areas, dirty, not done properly, damage). team_service = the cleaners' conduct, lateness, no-show or rushing. office_service = office or communication. pricing_billing = prices, charges, payments or refunds about billing. scheduling = booking or rescheduling problems. severity: high for damage, safety, no-show or a demand for a refund; medium for a clear problem; low for a minor remark. serviceDate only when the customer states the date of the visit, otherwise null. Quote only the customer's own words. Never infer a team, visit or customer identity. Omit the field (or use null) otherwise. The label never changes any other field: write everything else exactly as you would without it.`;

type Runner = (options: InitialLeadDraftOptions) => Promise<{ finalSmsText: string }>;
/** One wrapper per processed email/call. take() returns the validated label from the last answer, or null. */
export function createQualityLabelRunner<R extends { finalSmsText: string }>(base: (options: InitialLeadDraftOptions) => Promise<R> = runInitialLeadDraft as unknown as (options: InitialLeadDraftOptions) => Promise<R>) {
  let raw: unknown;
  const requests = new WeakMap<InitialLeadDraftOptions, InitialLeadDraftOptions>();
  const runner = async (options: InitialLeadDraftOptions): Promise<R> => {
    raw = undefined;
    let request = requests.get(options);
    if (!request) { request = { ...options, systemPrompt: `${QUALITY_COMPLAINT_LABEL_INSTRUCTIONS}\n\n${options.systemPrompt}` }; requests.set(options, request); }
    const output = await base(request);
    try {
      const parsed = JSON.parse(output.finalSmsText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.hasOwn(parsed, "qualityComplaint")) {
        raw = (parsed as Record<string, unknown>).qualityComplaint;
        const { qualityComplaint: _label, ...rest } = parsed as Record<string, unknown>;
        return { ...output, finalSmsText: JSON.stringify(rest) };
      }
    } catch { /* not JSON: returned unchanged below, so the existing checks decide */ }
    return output;
  };
  return {
    runner: runner as Runner & ((options: InitialLeadDraftOptions) => Promise<R>),
    /** Independent validation against the exact email text or transcript. Never throws. */
    take(evidenceText: string): SmsQualityComplaint | null {
      try {
        const { complaint, dropped } = validateSmsQualityComplaint(raw, evidenceText);
        if (dropped) console.warn(`[quality-incident] complaint label ignored (${dropped}); processing unaffected`);
        return complaint;
      } catch { return null; }
    },
  };
}
