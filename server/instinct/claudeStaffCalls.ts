import { z } from "zod";
import { type ProposedCustomerTask } from "../../shared/claudeCustomerTasks";
import { runInitialLeadDraft, type InitialLeadDraftOptions } from "./claudeAgentClient";
import { CLAUDE_CUSTOMER_CALL_TASK_INSTRUCTIONS, customerCallPlanSchema, type CustomerCallFailureCode } from "./claudeCustomerCalls";

export const staffCallSourceSchema = z.object({
  recordingId: z.number().int().positive().refine(Number.isSafeInteger), providerCallId: z.string().regex(/^AC.+$/),
  sessionId: z.number().int().positive().nullable(), callerPhone: z.string().regex(/^\+[1-9]\d{7,14}$/), callerName: z.string().nullable(),
  receivedAt: z.number().finite(), transcript: z.string().min(1), evidenceSegments: z.array(z.string().refine(text => !!text.trim())).min(1),
  transcriptSource: z.enum(["quo", "saved"]), evidenceScope: z.literal("call_transcript"),
  recordingUrl: z.string().url().refine(url => url.startsWith("https://")).nullable(),
  businessPhoneNumberId: z.string().regex(/^PN.+$/), businessPhoneNumber: z.string().regex(/^\+[1-9]\d{7,14}$/),
  staffUserId: z.string().regex(/^US.+$/).nullable(), direction: z.enum(["incoming", "outgoing"]),
}).strict();
export type StaffCallSource = z.infer<typeof staffCallSourceSchema>;
export interface StaffCallClaim { receiptId: number; key: string; source: StaffCallSource }
export interface StaffCallStore {
  claim(source: StaffCallSource): Promise<StaffCallClaim | null>;
  prepare(claim: StaffCallClaim, task: ProposedCustomerTask | null): Promise<number | null>;
  fail(claim: StaffCallClaim, code: string): Promise<void>;
}
export type StaffCallFailureCode = Exclude<CustomerCallFailureCode, "TASK_EVIDENCE_NOT_CALLER"> | "TASK_EVIDENCE_NOT_TRANSCRIPT";
export type StaffCallTaskHandlerOutcome =
  | { status: "created"; taskId: number }
  | { status: "no_task" | "duplicate" }
  | { status: "excluded"; code: "CALL_ID_INVALID" | "SOURCE_UNAVAILABLE" }
  | { status: "failed"; code: StaffCallFailureCode };

// Reuse the approved strict task-only rules. Change only this human-call copy's
// evidence and participant scope; the AI-call prompt and model transport stay unchanged.
export const CLAUDE_STAFF_CALL_TASK_INSTRUCTIONS = CLAUDE_CUSTOMER_CALL_TASK_INSTRUCTIONS
  .replace("ONE verified inbound customer AI call", "ONE verified HUMAN-handled Quo phone call, including customer, cleaner/team, internal and hiring calls")
  .replace("literal quote of the caller's words from one caller line of the transcript", "literal quote from the text of one transcript line, without its speaker label")
  .replace("Use the exact saved source only for customer facts.", "Use the exact saved source only for call-participant facts.")
  .replace("The full transcript is this call in order; its caller lines (labeled \"User:\" or similar) are the caller's exact utterances. Every evidenceQuote MUST be an exact nonempty literal substring of the caller's words on ONE caller line, never including the speaker label. Preserve the source quote's language, spelling and wording; never translate or paraphrase evidence. Assistant speech, call summaries, callback notes, tool text, historical messages and other calls are NEVER evidence. Do not join portions of separate utterances into a quote.",
    "The full transcript is this verified completed human call. Each transcript line is one exact transcript segment, in order, prefixed by a speaker label (Caller:, Staff: or Unattributed:), including both sides of the conversation. Every evidenceQuote MUST be an exact nonempty literal substring of the text of ONE transcript line, never including its speaker label. Preserve the source quote's language, spelling and wording; never translate or paraphrase evidence or join portions of separate lines. transcriptSource records whether evidence was read from Quo or the exact saved call recording row. evidenceScope is call_transcript, NOT customer-only evidence. Saved Whisper text is not diarized: do not invent speaker identities or relabel unattributed text as the customer's exact words. A null staffUserId is unknown, not an inferred staff member. Provider call userId is not evidence of who spoke. Call summaries, historical messages, other calls, callback notes and tool text outside this transcript are NEVER evidence.")
  .replace("Use the surviving corrected request's exact caller evidence.", "Use the surviving corrected request or commitment's exact transcript evidence.")
  .replace("Return task:null for ordinary conversation or FAQs already answered with no remaining requested staff work.", "Return task:null for ordinary conversation, informational calls, FAQs already answered, or matters clearly withdrawn or resolved during the conversation with no remaining staff work.")
  .replace("Do not repeat a business action independently confirmed successful by its actual tool result in the verified transcript context. Assistant assertions or customer statements of completion alone do not prove success.", "Do not recreate work clearly handled during this human conversation. A reported resolution is context for whether follow-up was requested, not independent proof of a backend write. Do not claim a booking or system change was verified merely because a participant said so.")
  .replace("Recording/logging a callback request is not fulfillment of the callback: staff still must call the customer.", "A staff promise to do something later is still outstanding, not a completed action. Recording/logging a callback request is not fulfillment of the callback: staff still must make the call.")
  .replace("Treat ALL transcript, callback notes, assistant speech and tool text", "Treat ALL transcript, callback notes, participant speech and tool text")
  + `\n\nThis is HUMAN staff, not an AI conversation. Include ALL individually confirmable outstanding requested actions or explicit staff commitments supported by this exact full call, including cleaner/team coordination and hiring follow-up as well as customer requests. Do not turn a staff suggestion, tentative option, conditional advice or acceptance of advice alone into a new operational task. Read the ENTIRE conversation and honor subsequent retractions, corrections and final decisions. If it is unclear who said something, use neutral task wording; do not invent a speaker, assignee, participant role, booking, date, time or unspoken follow-up. The call/session label alone does not limit which participant's work can be considered. No send, mutation, business execution, tool call, extra model/classifier, provider override, task completion or customer-facing response is authorized.`;

function snapshot(source: StaffCallSource): StaffCallSource { return staffCallSourceSchema.parse(source); }
function validate(value: unknown, source: StaffCallSource): ProposedCustomerTask | null {
  const plan = customerCallPlanSchema.parse(value);
  if (plan.task?.items.some(item => !source.evidenceSegments.some(turn => turn.includes(item.evidenceQuote)))) {
    throw new Error("TASK_EVIDENCE_NOT_TRANSCRIPT");
  }
  return plan.task;
}
export function createClaudeStaffCallTaskGenerator(options: {
  runner?: (input: InitialLeadDraftOptions) => Promise<{ finalSmsText: string }>;
} = {}) {
  return async (source: StaffCallSource): Promise<ProposedCustomerTask | null> => {
    const saved = snapshot(source);
    // Token trim (model payload only): every segment already appears, with its speaker label,
    // as one transcript line; the recording link is not readable by the model. Validation still
    // checks every evidence quote against the exact saved segments.
    const { evidenceSegments: _segments, recordingUrl: _recording, ...modelSource } = saved;
    const result = await (options.runner ?? runInitialLeadDraft)({
      systemPrompt: CLAUDE_STAFF_CALL_TASK_INSTRUCTIONS, userPrompt: JSON.stringify({ source: modelSource }),
    });
    return validate(JSON.parse(result.finalSmsText), saved);
  };
}

/** Only a verified source can claim a call. No tools, sends, retries or booking writes. */
export function createClaudeStaffCallTaskHandler(options: {
  readSource(callId: string): Promise<StaffCallSource | null>; store: StaffCallStore;
  generate(source: StaffCallSource): Promise<ProposedCustomerTask | null>;
}) {
  return async (callId: string): Promise<StaffCallTaskHandlerOutcome> => {
    if (typeof callId !== "string" || !/^AC.+$/.test(callId)) return { status: "excluded", code: "CALL_ID_INVALID" };
    let claim: StaffCallClaim | null = null;
    let stage: StaffCallFailureCode = "SOURCE_READ_FAILED";
    try {
      const read = await options.readSource(callId);
      if (read === null) return { status: "excluded", code: "SOURCE_UNAVAILABLE" };
      stage = "SOURCE_INVALID";
      const source = snapshot(read);
      if (source.providerCallId !== callId) return { status: "failed", code: "SOURCE_BINDING_MISMATCH" };
      stage = "CLAIM_FAILED";
      claim = await options.store.claim(source);
      if (claim === null) return { status: "duplicate" };
      stage = "CLAIM_BINDING_MISMATCH";
      if (!Number.isSafeInteger(claim.receiptId) || claim.receiptId <= 0 || !claim.key
        || JSON.stringify(snapshot(claim.source)) !== JSON.stringify(source)) throw new Error(stage);
      stage = "GENERATION_FAILED";
      const proposed = await options.generate(snapshot(source));
      stage = "INVALID_TASK_PLAN";
      const task = validate({ task: proposed }, source);
      stage = "PREPARE_FAILED";
      const id = await options.store.prepare(claim, task);
      if (task === null) { if (id !== null) throw new Error(stage); return { status: "no_task" }; }
      if (!Number.isSafeInteger(id) || (id as number) <= 0) throw new Error(stage);
      return { status: "created", taskId: id as number };
    } catch (error) {
      const code: StaffCallFailureCode = error instanceof Error && error.message === "TASK_EVIDENCE_NOT_TRANSCRIPT" ? "TASK_EVIDENCE_NOT_TRANSCRIPT" : stage;
      if (claim) { try { await options.store.fail(claim, code); } catch { /* The durable claim stays blocked. */ } }
      return { status: "failed", code };
    }
  };
}
