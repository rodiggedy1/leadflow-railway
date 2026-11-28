// Launch27 booking changes are manual (2026-11-28): the card says so, never shows an automated or verified status, and
// an AI reply never claims a requested booking change is already done. Offline, synthetic data only.
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { claimsBookingChangeDone, looksLikeBookingChange } from "../shared/bookingChangeClaims";
import { validateClaudeCustomerReplyPlan } from "./instinct/claudeCustomerSmsGeneration";
(globalThis as any).React = React; // harness compiles JSX classically; the app build does not need this

let withRecords: { data?: Record<string, string>; isLoading: boolean; isError: boolean } = { data: {}, isLoading: false, isError: false };
let current: any = null;
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { enabled: boolean }) => options.enabled ? { data: current, isLoading: false, isError: false } : { data: undefined, isLoading: false, isError: false },
}));
vi.mock("@/lib/trpc", () => {
  const mutation = () => ({ useMutation: () => ({ mutateAsync: async () => ({}) }) });
  return { trpc: {
    useUtils: () => ({ claudeCustomerTasks: { invalidate: async () => {} }, client: {} }),
    claudeCustomerTasks: {
      bookingActionVersions: { useQuery: () => withRecords },
      bookingActionVisits: { useQuery: () => ({ data: [], isLoading: false }) },
      bookingSource: { useQuery: () => ({ data: undefined, isLoading: false, isError: false }) },
      setupBookingAction: mutation(), editBookingAction: mutation(), dismissBookingAction: mutation(), executeBookingAction: mutation(), verifyBookingAction: mutation(),
      beginBookingConfirmation: mutation(), finishBookingConfirmation: mutation(),
    },
    leads: { sendMessage: mutation() },
  } };
});

const task = (sourceText: string, change: Record<string, unknown> = {}): any => ({ id: 9, sessionId: 4, customerPhone: "+13025550147", customerName: "Maya Lane",
  status: "claimed", title: "Booking request", sourceText, items: [{ id: "item-1", title: "Handle the request", evidenceQuote: sourceText, completedBy: null, completedAt: null }], ...change });
const visit = { jobId: 501, bookingId: 77, publicBookingNumber: "B-10432", date: "2026-12-04", time: "09:00", arrivalWindow: null, serviceName: "Standard cleaning",
  address: "123 Main St", teamName: "Team A", recurrence: "one-time", canonicalVisit: true };
const record = (status: string) => ({ version: 1, taskId: 9, source: "claude", itemId: "item-1", revision: 1, status, execution: null, verification: null, confirmation: null,
  request: { type: "cancel_visit", visitDate: "2026-12-04", jobId: null, newDate: null, newTime: null, evidenceQuote: "cancel" }, history: [] });
const manualView = { enabled: true, visits: [], record: record("proposed"),
  assessment: { executable: false, manualReasons: ["No LeadFlow booking was found for this customer's phone number."], paymentStatus: null, effectiveNewTime: null,
    requiresAvailabilityConfirmation: false, visit: null, warnings: [] } };
const nativeView = { ...manualView, visits: [visit], assessment: { ...manualView.assessment, executable: true, manualReasons: [], visit } };

describe("which requests are booking changes", () => {
  it.each(["Please cancel my cleaning on Friday", "Can we reschedule to next week?", "I need to skip next week", "Can I switch to every other week?",
    "We'd like to change the frequency", "Can we move it to Thursday?", "I'm not home that day", "Can we change the date?", "Please pause our service for a month",
    "Could we go to monthly instead of weekly?"])("yes: %s", text => expect(looksLikeBookingChange(text)).toBe(true));
  it.each(["How much is a biweekly cleaning for 3 bedrooms?", "Thanks, the team did a great job!", "What time will they arrive?", "Do you bring supplies?"])(
    "no: %s", text => expect(looksLikeBookingChange(text)).toBe(false));
});

describe("AI replies never claim a requested booking change is done", () => {
  it.each(["I've cancelled your cleaning for Friday.", "Your appointment has been rescheduled to Tuesday.", "Done! You're all set for next Thursday.",
    "We have moved your cleaning to Monday.", "Your cleaning is now cancelled.", "We went ahead and skipped next week for you.",
    "Your frequency has been changed to every other week.", "Your cancellation has been processed."])("claim: %s", reply => expect(claimsBookingChangeDone(reply)).toBe(true));
  it.each(["Thanks Maya! We'll cancel Friday's cleaning and confirm with you shortly.", "Got it, our team will reschedule and text you once it's been moved.",
    "I've passed this along to our team, who will confirm the new date.", "Sorry to hear that. Our team will follow up about skipping next week.",
    "Thanks for letting us know. Someone from our office will confirm the change.", "Your request has not been cancelled yet; our team will confirm."])(
    "allowed: %s", reply => expect(claimsBookingChangeDone(reply)).toBe(false));

  const plan = (replyText: string) => JSON.stringify({ replyText, task: { title: "Cancel the cleaning", items: [{ title: "Cancel Friday's cleaning", evidenceQuote: "cancel my cleaning" }] } });
  const input = (incomingMessage: string) => ({ incomingMessage, context: {}, protectedIds: [] });
  it("rejects a reply that claims it was done (the existing one retry, then the existing review task, handle it)", () => {
    expect(() => validateClaudeCustomerReplyPlan(plan("Hi Maya, I've cancelled your cleaning on Friday."), input("Please cancel my cleaning on Friday")))
      .toThrow("REPLY_CLAIMS_BOOKING_CHANGE_DONE");
  });
  it("keeps a reply that says the team will make the change", () => {
    expect(validateClaudeCustomerReplyPlan(plan("Hi Maya, thanks for letting us know! Our team will cancel Friday's cleaning and confirm with you shortly."),
      input("Please cancel my cleaning on Friday")).replyText).toContain("Our team will cancel");
  });
  it("does not touch replies to messages that are not booking-change requests", () => {
    expect(validateClaudeCustomerReplyPlan(JSON.stringify({ replyText: "You're all set, thanks Maya!", task: null }), input("Thanks so much!")).replyText).toBe("You're all set, thanks Maya!");
  });
});

describe("task card: native keeps its workflow; Launch27 or unclear is manual", async () => {
  const panel = await import("../client/src/components/ClaudeBookingChangePanel");
  it("decides native, Launch27, unclear and failed lookups", () => {
    const t = task("Please cancel my cleaning on Friday");
    expect(panel.manualBookingChange(t, null, { source: "native", launch27BookingIds: [] }, false)).toBeNull();
    expect(panel.manualBookingChange(t, null, { source: "launch27", launch27BookingIds: [4512] }, false)).toEqual({ source: "launch27", launch27BookingIds: [4512] });
    expect(panel.manualBookingChange(t, null, { source: "unknown", launch27BookingIds: [] }, false)).toEqual({ source: "unknown", launch27BookingIds: [] });
    expect(panel.manualBookingChange(t, null, undefined, true)).toEqual({ source: "unknown", launch27BookingIds: [] }); // lookup failed: manual
    expect(panel.manualBookingChange(t, null, undefined, false)).toBeNull(); // still loading: nothing claimed either way
    // A record for a native visit keeps the native approve/execute/verify workflow, whatever the lookup says
    for (const status of ["executed", "verified", "verification_failed", "confirmed"])
      expect(panel.manualBookingChange(t, { ...manualView, record: record(status) } as any, { source: "launch27", launch27BookingIds: [1] }, false)).toBeNull();
    expect(panel.manualBookingChange(t, nativeView as any, { source: "unknown", launch27BookingIds: [] }, false)).toBeNull();
    // A Launch27 proposal (not executable) is manual even without booking-change words
    expect(panel.manualBookingChange(task("Hi there"), manualView as any, { source: "launch27", launch27BookingIds: [] }, false)).not.toBeNull();
    // Not a booking change: nothing changes
    expect(panel.manualBookingChange(task("Thanks, great job"), null, { source: "launch27", launch27BookingIds: [] }, false)).toBeNull();
  });
  it("Launch27 card: prominent manual notice, NOT made automatically, direct link, no automated or verified status", () => {
    const t = task("Please cancel my cleaning on Friday", { title: "Cancel Friday cleaning" });
    const notice = renderToStaticMarkup(React.createElement(panel.ManualBookingNotice, { task: t, manual: { source: "launch27", launch27BookingIds: [4512, 4513] } }));
    expect(notice).toContain("Manual action required — Launch27");
    expect(notice).toContain("The cancellation has <strong>NOT</strong> been made automatically.");
    expect(notice).toContain('href="https://maidsinblack.launch27.com/admin/bookings/4512"');
    expect(notice).toContain('href="https://maidsinblack.launch27.com/admin/bookings/4513"');
    expect(notice).toContain('rel="noopener noreferrer"');
    expect(notice).not.toMatch(/verified|Rescheduled|Cancelled &amp;|Approve/i);
    expect(panel.manualBookingStatus({ source: "launch27", launch27BookingIds: [] })).toEqual({ tone: "warning", text: "Manual action required — Launch27" });
    // Kinds of change
    const kind = (text: string) => renderToStaticMarkup(React.createElement(panel.ManualBookingNotice, { task: task(text), manual: { source: "launch27", launch27BookingIds: [] } }));
    expect(kind("Can we reschedule to Monday?")).toContain("The reschedule has");
    expect(kind("Please skip next week")).toContain("The skipped appointment has");
    expect(kind("Can we switch to every other week?")).toContain("The frequency change has");
    expect(kind("Can you add the fridge?")).toContain("The booking change has");
    expect(kind("Can you add the fridge?")).toContain("No Launch27 booking link was found");
  });
  it("unclear source: manual, says LeadFlow could not confirm where the booking is", () => {
    const notice = renderToStaticMarkup(React.createElement(panel.ManualBookingNotice, { task: task("Please cancel Friday"), manual: { source: "unknown", launch27BookingIds: [] } }));
    expect(notice).toContain("Manual action required — booking system not confirmed");
    expect(notice).toContain("NOT</strong> been made automatically");
  });
  it("panel: hides the native set-up and Approve for a manual booking; native is unchanged", () => {
    const render = (view: any, manual: any) => {
      current = view; withRecords = { data: view ? { "9": "v1" } : {}, isLoading: false, isError: false };
      return renderToStaticMarkup(React.createElement(panel.ClaudeBookingChangePanel, { task: task("Please cancel my cleaning on Friday"), manual }));
    };
    const l27 = { source: "launch27", launch27BookingIds: [4512] };
    expect(render(null, l27)).toBe("");
    expect(render(null, null)).toContain("Set up booking change");
    const manualHtml = render(manualView, l27);
    expect(manualHtml).not.toContain("Approve");
    expect(manualHtml).toContain("Dismiss proposal");
    expect(manualHtml).not.toMatch(/verified/i);
    expect(render(nativeView, null)).toContain("Approve &amp; cancel");
  });
});
