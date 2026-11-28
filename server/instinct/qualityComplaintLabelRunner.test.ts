// Phase 2: the optional complaint label on Claude's existing email and call processing. Offline, synthetic.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAIDS_IN_BLACK_KNOWLEDGE_BASE } from "../knowledgeBase";
import type { InitialLeadDraftOptions } from "./claudeAgentClient";
import { CLAUDE_STAFF_CALL_TASK_INSTRUCTIONS, createClaudeStaffCallTaskGenerator, type StaffCallSource } from "./claudeStaffCalls";
import { createClaudeCustomerReplyGenerator } from "./claudeCustomerSmsGeneration";
import { createQualityLabelRunner, QUALITY_COMPLAINT_LABEL_INSTRUCTIONS } from "./qualityComplaintLabelRunner";
import { classifyComplaintText, isRecleanJob } from "../teamQualityRules";

const request = "The cleaners missed the whole upstairs bathroom yesterday, can someone come back?";
const transcript = `Caller: ${request}\nStaff: I'm so sorry, we'll arrange it.`;
const callSource: StaffCallSource = { recordingId: 9, providerCallId: "ACsynthetic9", sessionId: null, callerPhone: "+12025550177", callerName: "Synthetic Caller",
  receivedAt: Date.parse("2026-11-24T15:00:00Z"), transcript, evidenceSegments: [request, "I'm so sorry, we'll arrange it."], transcriptSource: "quo", evidenceScope: "call_transcript",
  recordingUrl: null, businessPhoneNumberId: "PNsynthetic9", businessPhoneNumber: "+12025550999", staffUserId: null, direction: "incoming" };
const task = { title: "Customer follow-up", items: [{ title: "Arrange a return visit", evidenceQuote: "can someone come back?" }] };
const label = { category: "cleaning_quality", severity: "medium", evidenceQuotes: ["missed the whole upstairs bathroom"], serviceDate: null, recleanRequested: true, refundRequested: false };
const runnerFor = (output: unknown) => vi.fn(async (_options: InitialLeadDraftOptions) => ({ finalSmsText: typeof output === "string" ? output : JSON.stringify(output) }));
let network: ReturnType<typeof vi.spyOn>;
beforeEach(() => { network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("OFFLINE_ONLY")); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.restoreAllMocks(); });

describe("label wrapper on the existing call task generator", () => {
  it("adds one paragraph to the same prompt, removes the label before the existing checks, and the task is unchanged", async () => {
    const plain = runnerFor({ task }), expected = await createClaudeStaffCallTaskGenerator({ runner: plain })(callSource);
    const base = runnerFor({ task, qualityComplaint: label }), wrapped = createQualityLabelRunner(base);
    const result = await createClaudeStaffCallTaskGenerator({ runner: wrapped.runner })(callSource);
    expect(result).toEqual(expected);
    expect(base).toHaveBeenCalledTimes(1);
    expect(base.mock.calls[0][0].systemPrompt).toBe(`${QUALITY_COMPLAINT_LABEL_INSTRUCTIONS}\n\n${CLAUDE_STAFF_CALL_TASK_INSTRUCTIONS}`);
    expect(base.mock.calls[0][0].userPrompt).toBe(plain.mock.calls[0][0].userPrompt);
    expect(wrapped.take(callSource.transcript)).toEqual(label);
  });
  it("an invalid label is ignored and the task is still the same", async () => {
    const expected = await createClaudeStaffCallTaskGenerator({ runner: runnerFor({ task }) })(callSource);
    for (const bad of ["yes", { ...label, evidenceQuotes: ["not in the call"] }, { ...label, category: "rude" }]) {
      const wrapped = createQualityLabelRunner(runnerFor({ task, qualityComplaint: bad }));
      await expect(createClaudeStaffCallTaskGenerator({ runner: wrapped.runner })(callSource)).resolves.toEqual(expected);
      expect(wrapped.take(callSource.transcript)).toBeNull();
    }
  });
  it("a non-JSON answer is passed through untouched, so the existing failure behaviour is unchanged", async () => {
    const plainError = await createClaudeStaffCallTaskGenerator({ runner: runnerFor("not json") })(callSource).catch(error => String(error));
    const wrapped = createQualityLabelRunner(runnerFor("not json"));
    const wrappedError = await createClaudeStaffCallTaskGenerator({ runner: wrapped.runner })(callSource).catch(error => String(error));
    expect(wrappedError).toBe(plainError);
    expect(wrapped.take(callSource.transcript)).toBeNull();
  });
});

describe("label wrapper on the existing email reply generator", () => {
  const email = "Hello, the kitchen was left dirty after Tuesday's cleaning and I was still charged the full price.";
  const input = { incomingMessage: email, protectedIds: ["thread-1"], context: { source: "email", contact: { displayName: "Synthetic", email: "synthetic@example.invalid" }, originalConversation: [{ role: "user", content: email }], bookingContext: null } };
  it("the email reply plan is identical with or without the label", async () => {
    const reply = { replyText: "I'm so sorry about the kitchen. We'll make it right and follow up shortly.", task: null };
    const readKnowledge = async () => MAIDS_IN_BLACK_KNOWLEDGE_BASE;
    const expected = await createClaudeCustomerReplyGenerator({ readKnowledge, runner: runnerFor(reply) })(input);
    const wrapped = createQualityLabelRunner(runnerFor({ ...reply, qualityComplaint: { ...label, evidenceQuotes: ["the kitchen was left dirty"], recleanRequested: false } }));
    await expect(createClaudeCustomerReplyGenerator({ readKnowledge, runner: wrapped.runner })(input)).resolves.toEqual(expected);
    expect(wrapped.take(email)).toMatchObject({ category: "cleaning_quality", evidenceQuotes: ["the kitchen was left dirty"] });
  });
});

describe("free rules for signals without an AI category", () => {
  it.each([
    ["The team missed the bathroom and the floors are still dirty", "cleaning_quality", "medium"],
    ["They broke a vase", "cleaning_quality", "high"],
    ["The cleaner was rude and left early", "team_service", "medium"],
    ["The cleaners never showed up", "team_service", "high"],
    ["I was charged twice for my cleaning", "pricing_billing", "medium"],
    ["I need to reschedule my appointment", "scheduling", "medium"],
    ["No one called me back from the office", "office_service", "medium"],
    ["Customer upset", "unclassified", "low"],
    ["", "unclassified", "low"],
  ])("%s → %s", (text, category, severity) => {
    expect(classifyComplaintText(text)).toEqual({ category, severity });
  });
  it("recognises a reclean visit from the job record", () => {
    expect(isRecleanJob({ serviceName: "Re-clean" })).toBe(true);
    expect(isRecleanJob({ serviceName: "Standard Cleaning", jobTotalCents: 0, customerNotes: "Reclean for missed bathroom" })).toBe(true);
    expect(isRecleanJob({ serviceName: "Standard Cleaning", jobTotalCents: 0, customerNotes: "Free promo" })).toBe(false);
    expect(isRecleanJob({ serviceName: "Deep Cleaning", jobTotalCents: 24000, customerNotes: "reclean" })).toBe(false);
  });
});
