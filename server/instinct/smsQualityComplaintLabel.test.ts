// Phase 2: the optional quality-complaint label on Claude's existing SMS response. Offline, synthetic.
// The label is validated on its own and can never change the reply, the task, the booking action or the call count.
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAIDS_IN_BLACK_KNOWLEDGE_BASE } from "../knowledgeBase";
import type { InitialLeadDraftOptions } from "./claudeAgentClient";
import type { ClaudeCustomerReplyInput, ClaudeCustomerSmsGenerationBinding } from "./claudeCustomerSmsGeneration";
import { createSmsBookingQuoteReplyGenerator, SMS_QUALITY_COMPLAINT_INSTRUCTIONS } from "./smsBookingQuoteGeneration";
import { validateSmsQualityComplaint, countsAgainstTeam, isCompletedRecovery } from "../../shared/teamQualityIncidents";

const NOW = Date.parse("2026-11-24T15:00:00.000Z");
const TEXT = "The bathroom was not cleaned at all yesterday and the kitchen floor is still sticky. Can someone come back? Also please move my Dec 2 cleaning to Dec 3.";
function fixture(text = TEXT): ClaudeCustomerReplyInput {
  const originalConversation = [
    { role: "assistant", content: "Thanks for booking with us!" },
    { role: "customer", content: text, opMsgId: "msg-q1", direction: "incoming" },
  ];
  const binding: ClaudeCustomerSmsGenerationBinding = { sessionId: 7, providerMessageId: "msg-q1", fromPhone: "+12025550188",
    receivingPhoneNumberId: "PN-test", receivingPhoneNumber: "+12025550999", inboundText: text, createdAt: NOW - 1, receivedAt: NOW,
    customerName: "Test Customer", historyHash: createHash("sha256").update(JSON.stringify(originalConversation)).digest("hex") };
  return { incomingMessage: text, context: { binding, contact: { sessionId: "7", displayName: binding.customerName, phone: binding.fromPhone },
    originalConversation, receivingPhoneNumberId: binding.receivingPhoneNumberId, receivingPhoneNumber: binding.receivingPhoneNumber, bookingContext: null },
  protectedIds: [binding.providerMessageId, binding.receivingPhoneNumberId] };
}
const task = { title: "Customer follow-up", items: [
  { title: "Arrange a return visit for the bathroom and kitchen", evidenceQuote: "Can someone come back?" },
  { title: "Move the Dec 2 cleaning to Dec 3", evidenceQuote: "please move my Dec 2 cleaning to Dec 3",
    bookingAction: undefined },
] };
const taskWithBooking = { ...task, bookingAction: { type: "reschedule_visit", visitDate: "2026-12-02", newDate: "2026-12-03", newTime: null, evidenceQuote: "please move my Dec 2 cleaning to Dec 3" } };
const base = { replyText: "I'm so sorry about that! We'll take care of it and confirm the return visit and the new date. 🧽", task: taskWithBooking, bookingQuote: null, quotePresentationLanguage: null };
const label = { category: "cleaning_quality", severity: "medium", evidenceQuotes: ["The bathroom was not cleaned at all yesterday"], serviceDate: null, recleanRequested: true, refundRequested: false };
function harness(output: unknown, onQualityComplaint?: (...args: any[]) => void) {
  const runner = vi.fn(async (_options: InitialLeadDraftOptions) => ({ finalSmsText: JSON.stringify(output) }));
  const generate = createSmsBookingQuoteReplyGenerator({ readKnowledge: async () => MAIDS_IN_BLACK_KNOWLEDGE_BASE, runner,
    smsBookingQuote: { readState: async () => null }, ...(onQualityComplaint ? { onQualityComplaint } : {}) });
  return { runner, generate };
}
let network: ReturnType<typeof vi.spyOn>;
beforeEach(() => { network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("OFFLINE_ONLY")); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.restoreAllMocks(); });

describe("optional SMS quality complaint label", () => {
  it("a valid label is passed on once, and the reply plan (text, task, booking action) is identical to having no label", async () => {
    const withoutLabel = harness(base), seen = vi.fn(), withLabel = harness({ ...base, qualityComplaint: label }, seen);
    const expected = await withoutLabel.generate(fixture());
    const plan = await withLabel.generate(fixture());
    expect(plan).toEqual(expected);
    expect(plan.task).toEqual(taskWithBooking);
    expect(withLabel.runner).toHaveBeenCalledTimes(1); // no extra AI call
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0]).toEqual({ ...label, evidenceQuotes: ["The bathroom was not cleaned at all yesterday"] });
    expect(seen.mock.calls[0][1]).toMatchObject({ providerMessageId: "msg-q1", fromPhone: "+12025550188", receivedAt: NOW });
  });
  it.each([
    ["a string", "yes"], ["an unknown category", { ...label, category: "rude" }], ["an extra field", { ...label, teamId: 4 }],
    ["an invented quote", { ...label, evidenceQuotes: ["The team broke my vase"] }], ["no quotes", { ...label, evidenceQuotes: [] }],
    ["an array", [label]], ["a number severity", { ...label, severity: 3 }],
  ])("invalid metadata (%s) is ignored: same reply plan, no record", async (_name, bad) => {
    const expected = await harness(base).generate(fixture());
    const seen = vi.fn(), h = harness({ ...base, qualityComplaint: bad }, seen);
    await expect(h.generate(fixture())).resolves.toEqual(expected);
    expect(seen).not.toHaveBeenCalled();
    expect(h.runner).toHaveBeenCalledTimes(1);
  });
  it("a missing or null label is simply no complaint", async () => {
    for (const output of [base, { ...base, qualityComplaint: null }]) {
      const seen = vi.fn();
      await harness(output, seen).generate(fixture());
      expect(seen).not.toHaveBeenCalled();
    }
  });
  it("an error while saving the label never changes the reply plan", async () => {
    const expected = await harness(base).generate(fixture());
    const h = harness({ ...base, qualityComplaint: label }, () => { throw new Error("DB down"); });
    await expect(h.generate(fixture())).resolves.toEqual(expected);
  });
  it("an existing invalid reply still fails exactly as before (the label does not rescue or change it)", async () => {
    const h = harness({ replyText: "", task: null, bookingQuote: null, qualityComplaint: label }, vi.fn());
    await expect(h.generate(fixture())).rejects.toThrow();
  });
  it("the instruction is one added paragraph that keeps reply, task and booking behaviour unchanged", () => {
    expect(SMS_QUALITY_COMPLAINT_INSTRUCTIONS).toMatch(/^OPTIONAL QUALITY COMPLAINT LABEL/);
    expect(SMS_QUALITY_COMPLAINT_INSTRUCTIONS).toContain("never changes replyText, task, bookingAction or bookingQuote");
    expect(SMS_QUALITY_COMPLAINT_INSTRUCTIONS).toContain("Never infer a team, visit or customer identity");
  });
});

describe("label validation and counting rules (pure)", () => {
  it("keeps only quotes from the current message and drops an impossible date", () => {
    const result = validateSmsQualityComplaint({ ...label, evidenceQuotes: ["The bathroom was not cleaned at all yesterday", "made up"], serviceDate: "2026-02-30" }, TEXT);
    expect(result).toEqual({ complaint: { ...label, evidenceQuotes: ["The bathroom was not cleaned at all yesterday"], serviceDate: null }, dropped: null });
  });
  it("never throws, even on hostile input", () => {
    const hostile = { get category() { throw new Error("boom"); } };
    expect(validateSmsQualityComplaint(hostile, TEXT)).toEqual({ complaint: null, dropped: expect.any(String) });
  });
  const incident = { id: 1, teamId: 3, leadflowJobId: 10, category: "cleaning_quality", attribution: "auto", status: "open", recleanStatus: "none", refundStatus: "none", processingStatus: "ok" };
  it("only team-attributable, attributed, processed, non-dismissed incidents count", () => {
    expect(countsAgainstTeam(incident)).toBe(true);
    expect(countsAgainstTeam({ ...incident, status: "resolved" })).toBe(true); // a resolved complaint still happened
    for (const change of [{ status: "dismissed" }, { attribution: "unattributed" }, { teamId: null }, { processingStatus: "failed" },
      { category: "pricing_billing" }, { category: "scheduling" }, { category: "office_service" }, { category: "unclassified" }])
      expect(countsAgainstTeam({ ...incident, ...change })).toBe(false);
  });
  it("a refund request or upset-customer label alone never penalises a team", () => {
    expect(countsAgainstTeam({ ...incident, category: "unclassified", refundStatus: "requested" })).toBe(false);
    expect(countsAgainstTeam({ ...incident, category: "pricing_billing", refundStatus: "issued" })).toBe(false);
  });
  it("a reclean and a refund on one incident are one recovery", () => {
    expect(isCompletedRecovery({ ...incident, recleanStatus: "completed", refundStatus: "issued" })).toBe(true);
    expect(isCompletedRecovery({ ...incident, recleanStatus: "requested" })).toBe(false);
  });
});
