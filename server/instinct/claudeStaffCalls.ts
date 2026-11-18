import { z } from "zod";
import { type ProposedCustomerTask } from "../../shared/claudeCustomerTasks";
import { runInitialLeadDraft, type InitialLeadDraftOptions } from "./claudeAgentClient";
import { CLAUDE_CUSTOMER_CALL_TASK_INSTRUCTIONS, customerCallPlanSchema, type CustomerCallFailureCode, type CustomerCallTaskHandlerOutcome } from "./claudeCustomerCalls";

export const staffCallSourceSchema = z.object({
  recordingId: z.number().int().positive().refine(Number.isSafeInteger), providerCallId: z.string().regex(/^AC.+$/),
  sessionId: z.number().int().positive().nullable(), callerPhone: z.string().regex(/^\+[1-9]\d{7,14}$/), callerName: z.string().nullable(),
  receivedAt: z.number().finite(), transcript: z.string().min(1), customerTurns: z.array(z.string().min(1)).min(1),
  recordingUrl: z.string().url().refine(url => url.startsWith("https://")).nullable(),
  businessPhoneNumberId: z.string().regex(/^PN.+$/), businessPhoneNumber: z.string().regex(/^\+[1-9]\d{7,14}$/),
  staffUserId: z.string().regex(/^US.+$/), direction: z.enum(["incoming", "outgoing"]),
}).strict();
export type StaffCallSource = z.infer<typeof staffCallSourceSchema>;
export interface StaffCallClaim { receiptId: number; key: string; source: StaffCallSource }
export interface StaffCallStore {
  claim(source: StaffCallSource): Promise<StaffCallClaim | null>;
  prepare(claim: StaffCallClaim, task: ProposedCustomerTask | null): Promise<number | null>;
  fail(claim: StaffCallClaim, code: string): Promise<void>;
}

// Reuse the approved task-only/evidence rules; do not change the AI-call prompt.
export const CLAUDE_STAFF_CALL_TASK_INSTRUCTIONS = CLAUDE_CUSTOMER_CALL_TASK_INSTRUCTIONS
  .replace("ONE verified inbound customer AI call", "ONE verified staff-handled Quo customer phone call")
  + `\n\nThis is a completed call with HUMAN staff, not an AI conversation. Staff speech is context only, never customer evidence. Only the independently attributed customerTurns may support requested tasks. Read the full conversation, including the staff response, before identifying what remains outstanding. Do not turn a staff suggestion into a customer request. Do not create tasks for requests clearly withdrawn or resolved during the conversation, or FAQs answered with no outstanding work. A promise to do something later is still outstanding, not a completed action. A customer's acceptance of advice alone is not a new operational task. You have no authority to mark existing tasks complete or to carry out any action. Do not invent missing details or certainty about backend changes; describe only outstanding human work supported by the exact customer words.`;

function snapshot(source: StaffCallSource): StaffCallSource { return staffCallSourceSchema.parse(source); }
function validate(value: unknown, source: StaffCallSource): ProposedCustomerTask | null {
  const plan = customerCallPlanSchema.parse(value);
  if (plan.task?.items.some(item => !source.customerTurns.some(turn => turn.includes(item.evidenceQuote)))) {
    throw new Error("TASK_EVIDENCE_NOT_CALLER");
  }
  return plan.task;
}
export function createClaudeStaffCallTaskGenerator(options: {
  runner?: (input: InitialLeadDraftOptions) => Promise<{ finalSmsText: string }>;
} = {}) {
  return async (source: StaffCallSource): Promise<ProposedCustomerTask | null> => {
    const saved = snapshot(source);
    const result = await (options.runner ?? runInitialLeadDraft)({
      systemPrompt: CLAUDE_STAFF_CALL_TASK_INSTRUCTIONS, userPrompt: JSON.stringify({ source: saved }),
    });
    return validate(JSON.parse(result.finalSmsText), saved);
  };
}

/** Only a verified source can claim a call. No tools, sends, retries or booking writes. */
export function createClaudeStaffCallTaskHandler(options: {
  readSource(callId: string): Promise<StaffCallSource | null>; store: StaffCallStore;
  generate(source: StaffCallSource): Promise<ProposedCustomerTask | null>;
}) {
  return async (callId: string): Promise<CustomerCallTaskHandlerOutcome> => {
    if (typeof callId !== "string" || !/^AC.+$/.test(callId)) return { status: "excluded", code: "CALL_ID_INVALID" };
    let claim: StaffCallClaim | null = null;
    let stage: CustomerCallFailureCode = "SOURCE_READ_FAILED";
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
      const code: CustomerCallFailureCode = error instanceof Error && error.message === "TASK_EVIDENCE_NOT_CALLER" ? "TASK_EVIDENCE_NOT_CALLER" : stage;
      if (claim) { try { await options.store.fail(claim, code); } catch { /* The durable claim stays blocked. */ } }
      return { status: "failed", code };
    }
  };
}
