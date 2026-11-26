// Offline checks for Phase 1 booking changes. The real-database behaviour (execution, rollback, duplicate
// protection, verification) is covered by claudeBookingActions.localdb.test.ts against a local throwaway TiDB.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  BOOKING_ACTION_CHANNEL, CLAUDE_BOOKING_ACTIONS_ENABLED, bookingActionKey, bookingConfirmationText, modelBookingActionSchema,
} from "../../shared/claudeBookingActions";
import { customerReplyPlanSchema, customerTaskSchema } from "../../shared/claudeCustomerTasks";
import { CLAUDE_CUSTOMER_SMS_PLAN_INSTRUCTIONS } from "./claudeCustomerSmsGeneration";
import { SMS_HISTORY_AND_RECORDS_INSTRUCTIONS } from "./smsBookingQuoteGeneration";
import { attachProposedBookingAction } from "./claudeBookingActions";

const read = (path: string) => readFileSync(path, "utf8");
const valid = { type: "reschedule_visit", visitDate: "2026-12-04", newDate: "2026-12-05", newTime: "14:00", evidenceQuote: "move it to Friday" } as const;

describe("owner-approved confirmation wording, filled only from verified values", () => {
  it("reschedule with an exact time", () => {
    expect(bookingConfirmationText({ customerName: "Maya Lane", type: "reschedule_visit", date: "2026-11-21", time: "10:00", arrivalWindow: null }))
      .toBe("Hi Maya, you're all set! Your cleaning has been moved to Saturday, November 21 at 10:00 AM. – Maids in Black");
  });
  it("reschedule that keeps an arrival window", () => {
    expect(bookingConfirmationText({ customerName: "Maya", type: "reschedule_visit", date: "2026-11-20", time: "08:00", arrivalWindow: { start: "08:00", end: "12:00" } }))
      .toBe("Hi Maya, you're all set! Your cleaning has been moved to Friday, November 20, with your arrival window of 8:00 AM–12:00 PM. – Maids in Black");
  });
  it("cancellation, and no name", () => {
    expect(bookingConfirmationText({ customerName: null, type: "cancel_visit", date: "2026-11-17", time: null, arrivalWindow: null }))
      .toBe("Hi there, your cleaning on Tuesday, November 17 has been cancelled. If you'd like to book again, just reply here. – Maids in Black");
  });
});

describe("Claude's proposal is optional and can never fail or change the reply", () => {
  it("the reply plan accepts an optional bookingAction; the saved task format is unchanged", () => {
    const plan = customerReplyPlanSchema.parse({ replyText: "We'll take care of it.", task: { title: "Move", items: [{ title: "Move", evidenceQuote: "move it" }], bookingAction: { anything: true } } });
    expect(plan.task?.bookingAction).toEqual({ anything: true });
    expect(customerReplyPlanSchema.parse({ replyText: "Hi", task: null }).task).toBeNull();
    // The saved task record still has exactly its existing fields (old code can read every task).
    expect(Object.keys(customerTaskSchema.options[0].shape)).not.toContain("bookingAction");
  });
  it.each([
    [{ ...valid, type: "move" }], [{ ...valid, visitDate: "2026-02-30" }], [{ ...valid, newTime: "2pm" }], [{ ...valid, extra: 1 }],
    [{ ...valid, evidenceQuote: "" }], ["garbage"], [null],
  ])("rejects malformed proposals: %j", proposal => {
    expect(modelBookingActionSchema.safeParse(proposal).success).toBe(false);
  });
  it("attaches only a valid proposal grounded in the customer's message, and never throws", async () => {
    const inserted: unknown[] = [];
    const tx = { insert: () => ({ values: async (row: unknown) => { inserted.push(row); } }) } as any;
    const task = { id: 7, items: [{ id: "item-1", evidenceQuote: "move it to Friday" }] };
    expect(await attachProposedBookingAction(tx, task, { ...valid, evidenceQuote: "not in the message" }, "Can you move it to Friday?")).toBe(false);
    expect(await attachProposedBookingAction(tx, task, { type: "cancel_visit" }, "Can you move it to Friday?")).toBe(false);
    expect(await attachProposedBookingAction(tx, task, undefined, "Can you move it to Friday?")).toBe(false);
    expect(inserted).toHaveLength(0);
    expect(await attachProposedBookingAction(tx, task, valid, "Can you move it to Friday?")).toBe(true);
    expect(inserted[0]).toMatchObject({ channel: BOOKING_ACTION_CHANNEL, activeDedupKey: bookingActionKey(7) });
    expect(JSON.parse((inserted[0] as { metadata: string }).metadata)).toMatchObject({ taskId: 7, source: "claude", itemId: "item-1", status: "proposed",
      request: { type: "reschedule_visit", visitDate: "2026-12-04", jobId: null, newDate: "2026-12-05", newTime: "14:00" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failing = { insert: () => ({ values: async () => { throw new Error("duplicate"); } }) } as any;
    await expect(attachProposedBookingAction(failing, task, valid, "Can you move it to Friday?")).resolves.toBe(false);
    warn.mockRestore();
  });
});

describe("minimal SMS-only prompt change", () => {
  it("adds one paragraph to the SMS-only records instructions and nothing to the shared plan instructions", () => {
    expect(SMS_HISTORY_AND_RECORDS_INSTRUCTIONS).toContain('BOOKING ACTION (optional, inside task): when the CURRENT incomingMessage clearly asks to move or cancel ONE specific existing cleaning visit');
    expect(SMS_HISTORY_AND_RECORDS_INSTRUCTIONS).toContain("the reply must still never say the change has been made.");
    expect(SMS_HISTORY_AND_RECORDS_INSTRUCTIONS.match(/BOOKING ACTION/g)).toHaveLength(1);
    expect(CLAUDE_CUSTOMER_SMS_PLAN_INSTRUCTIONS).not.toContain("bookingAction");
  });
});

describe("scope, permissions and switches", () => {
  const router = read("server/claudeCustomerTasksRouter.ts");
  const module = read("server/instinct/claudeBookingActions.ts");
  it("changes require the existing bookings permission; existing task actions are unchanged", () => {
    for (const name of ["setupBookingAction", "editBookingAction", "executeBookingAction", "verifyBookingAction", "beginBookingConfirmation", "finishBookingConfirmation"])
      expect(router, name).toMatch(new RegExp(`${name}: bookingsAgentProcedure`));
    for (const name of ["claim", "completeItem", "complete", "list", "get"]) expect(router, name).toMatch(new RegExp(`\\n    ${name}: opsChatProcedure`));
  });
  it("executes only native visits through the existing booking functions; never payments or messages", () => {
    expect(module).toContain("eq(leadflowJobs.origin, NATIVE_BOOKING_OPERATIONAL_ORIGIN)");
    expect(module).toContain("updateCanonicalBookingDetails");
    expect(module).toContain("await rescheduleOperationalBooking(tx,");
    expect(module).toContain("await cancelCanonicalBookingInTransaction(tx,");
    expect(module).not.toMatch(/stripe|sendSms|captureHold|cancelHold|placeHold|chargeSavedCard|fetch\(/i);
  });
  it("the off switch is a single code setting", () => {
    expect(CLAUDE_BOOKING_ACTIONS_ENABLED).toBe(true);
    expect(module).toContain('if (!CLAUDE_BOOKING_ACTIONS_ENABLED) manual.push("Booking changes are switched off. Handle this task manually.");');
  });
  it("the Messages API connection, model and caching are not touched", () => {
    expect(module).not.toMatch(/runInitialLeadDraft|claudeAgentClient|cacheTtl|SESSION_MODEL_ID/);
  });
});
