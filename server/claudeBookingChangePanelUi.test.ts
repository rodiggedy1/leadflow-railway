// Phase 1 booking-change panel: the real component rendered offline in every state (fake tRPC, no network).
import { expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
(globalThis as any).React = React; // harness compiles JSX classically; the app build does not need this

let current: any = null;
const visits = [
  { jobId: 501, bookingId: 77, publicBookingNumber: "B-10432", date: "2026-12-04", time: "09:00", arrivalWindow: null, serviceName: "Standard cleaning", address: "123 Main St", teamName: "Team A", recurrence: "one-time", canonicalVisit: true },
];
vi.mock("@/lib/trpc", () => {
  const mutation = () => ({ useMutation: () => ({ mutateAsync: async () => ({}) }) });
  return { trpc: {
    useUtils: () => ({ claudeCustomerTasks: { invalidate: async () => {} } }),
    claudeCustomerTasks: {
      bookingAction: { useQuery: () => ({ data: current, isLoading: false, isError: false }) },
      bookingActionVisits: { useQuery: () => ({ data: visits, isLoading: false }) },
      setupBookingAction: mutation(), editBookingAction: mutation(), executeBookingAction: mutation(), verifyBookingAction: mutation(),
      beginBookingConfirmation: mutation(), finishBookingConfirmation: mutation(),
    },
    leads: { sendMessage: mutation() },
  } };
});

const html = (data: any, task: any) => { current = data; return renderToStaticMarkup(React.createElement(Panel, { task })); };
let Panel: any;
it("renders every booking-change state with the right controls; nothing for call and email tasks", async () => {
  Panel = (await import("../client/src/components/ClaudeBookingChangePanel")).ClaudeBookingChangePanel;
  const task: any = { id: 9, sessionId: 4, customerPhone: "+13025550147", customerName: "Maya Lane", status: "claimed", items: [{ id: "item-1", title: "Move the cleaning", evidenceQuote: "x", completedBy: null, completedAt: null }] };
  const base = { version: 1, taskId: 9, source: "claude", itemId: "item-1", revision: 1, status: "proposed", execution: null, verification: null, confirmation: null,
    request: { type: "reschedule_visit", visitDate: "2026-12-04", jobId: null, newDate: "2026-12-05", newTime: "14:00", evidenceQuote: "can we move it to Friday at 2pm?" },
    history: [{ action: "proposed", actor: null, at: Date.parse("2026-11-26T15:00:00Z"), note: "Proposed by Claude" }] };
  const assessment = { executable: true, manualReasons: [], paymentStatus: "card_on_file", effectiveNewTime: "14:00", requiresAvailabilityConfirmation: true, visit: visits[0],
    warnings: ["Within 24 hours of the visit: the $70 late-reschedule fee may apply. Staff decide; nothing is charged.", "LeadFlow can't check team availability. Confirm it before executing."] };
  const execution = { by: { id: "11", name: "Ana" }, at: Date.parse("2026-11-26T19:14:00Z"), bookingId: 77, jobId: 501, publicBookingNumber: "B-10432", canonicalVisit: true,
    previous: { date: "2026-12-04", time: "09:00" }, expected: { date: "2026-12-05", time: "14:00", arrivalWindow: null, cancelled: false }, availabilityConfirmed: true, lateRescheduleWarning: false };
  const verified = { outcome: "verified", method: "instinct", explanation: "ok", checkedAt: Date.parse("2026-11-26T19:14:30Z"), attempts: 1 };
  const states: Array<[string, any]> = [
    ["1. No booking change yet (new optional button)", null],
    ["2. Claude proposal, ready to approve", { enabled: true, visits, assessment, record: base }],
    ["3. Arrival-window booking: window kept", { enabled: true, visits, record: { ...base, request: { ...base.request, newTime: null } },
      assessment: { ...assessment, effectiveNewTime: "08:00", visit: { ...visits[0], time: "08:00", arrivalWindow: { start: "08:00", end: "12:00", label: "morning" } },
        warnings: ["Keeps the booking's morning arrival window (8:00 AM–12:00 PM).", "LeadFlow can't check team availability. Confirm it before executing."] } }],
    ["4. Stays manual (recurring cancellation)", { enabled: true, visits, record: { ...base, request: { ...base.request, type: "cancel_visit", newDate: null, newTime: null, evidenceQuote: "cancel next week" } },
      assessment: { ...assessment, executable: false, effectiveNewTime: null, requiresAvailabilityConfirmation: false, visit: { ...visits[0], recurrence: "weekly" }, warnings: [],
        manualReasons: ["Cancelling one visit of a recurring booking isn't supported yet. Handle it manually."] } }],
    ["5. Executed, verification failed (never re-executed)", { enabled: true, visits: [], assessment: null, record: { ...base, status: "verification_failed", execution,
      verification: { outcome: "not_verified", method: "direct_readback", explanation: "Expected 2026-12-05 14:00; found visit date 2026-12-08.", checkedAt: Date.parse("2026-11-26T19:15:00Z"), attempts: 1 } } }],
    ["6. Verified, confirmation ready", { enabled: true, visits: [], assessment: null, record: { ...base, status: "verified", execution, verification: verified,
      confirmation: { text: "Hi Maya, you're all set! Your cleaning has been moved to Saturday, December 5 at 2:00 PM. – Maids in Black", status: "ready", by: null, at: null } } }],
    ["7. Confirmation may have been sent", { enabled: true, visits: [], assessment: null, record: { ...base, status: "verified", execution, verification: verified,
      confirmation: { text: "Hi Maya…", status: "uncertain", by: { id: "11", name: "Ana" }, at: Date.parse("2026-11-26T19:16:00Z") } } }],
    ["8. Closed", { enabled: true, visits: [], assessment: null, record: { ...base, status: "closed", execution, verification: verified,
      confirmation: { text: "Hi Maya…", status: "sent", by: { id: "11", name: "Ana" }, at: Date.parse("2026-11-26T19:16:00Z") } } }],
  ];
  const out = Object.fromEntries(states.map(([title, data]) => [title.slice(0, 1), html(data, task)]));
  expect(out["1"]).toContain("Set up booking change");
  expect(html(null, { ...task, status: "done" })).toBe("");
  expect(html(null, { ...task, call: {} })).toBe("");
  expect(html(null, { ...task, email: {} })).toBe("");
  expect(out["2"]).toContain("Approve &amp; execute"); expect(out["2"]).toContain("I confirmed a team is available");
  expect(out["2"]).toMatch(/<button type="button" class="cct-primary" disabled="">Approve &amp; execute/); // disabled until availability is confirmed
  expect(out["2"]).toContain("late-reschedule fee may apply. Staff decide; nothing is charged.");
  expect(out["3"]).toContain("8:00 AM–12:00 PM window"); expect(out["3"]).toContain("Keeps the booking&#x27;s morning arrival window");
  expect(out["4"]).toContain("Manual: Cancelling one visit of a recurring booking isn&#x27;t supported yet."); expect(out["4"]).not.toContain("I confirmed a team");
  expect(out["5"]).toContain("Executed, not verified yet."); expect(out["5"]).toContain("Verify again"); expect(out["5"]).toContain("will not be executed again");
  expect(out["5"]).not.toContain("Approve &amp; execute");
  expect(out["6"]).toContain("Send confirmation"); expect(out["6"]).toContain("No confirmation needed"); expect(out["6"]).toContain("Hi Maya, you&#x27;re all set!");
  expect(out["7"]).toContain("may have been sent"); expect(out["7"]).toContain("It was sent"); expect(out["7"]).not.toContain("Send confirmation");
  expect(out["8"]).toContain("Confirmation sent (Ana)"); expect(out["8"]).not.toMatch(/<button/);
});
