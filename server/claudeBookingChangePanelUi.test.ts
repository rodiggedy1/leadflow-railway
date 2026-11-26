// Phase 1 booking-change panel: the real component rendered offline in every state (fake tRPC, no network).
import { expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
(globalThis as any).React = React; // harness compiles JSX classically; the app build does not need this

let current: any = null;
let withRecords: { data?: Record<string, string>; isLoading: boolean; isError: boolean } = { data: {}, isLoading: false, isError: false };
const detailQueries: Array<{ id: number; enabled: boolean }> = [];
const visits = [
  { jobId: 501, bookingId: 77, publicBookingNumber: "B-10432", date: "2026-12-04", time: "09:00", arrivalWindow: null, serviceName: "Standard cleaning", address: "123 Main St", teamName: "Team A", recurrence: "one-time", canonicalVisit: true },
];
vi.mock("@tanstack/react-query", () => ({
  // The card's details query (keyed by its record fingerprint): enabled only for cards with a booking change.
  useQuery: (options: { queryKey: [string, number, string | null]; enabled: boolean }) => {
    detailQueries.push({ id: options.queryKey[1], enabled: options.enabled });
    return options.enabled ? { data: current, isLoading: false, isError: false } : { data: undefined, isLoading: false, isError: false };
  },
}));
vi.mock("@/lib/trpc", () => {
  const mutation = () => ({ useMutation: () => ({ mutateAsync: async () => ({}) }) });
  return { trpc: {
    useUtils: () => ({ claudeCustomerTasks: { invalidate: async () => {} } }),
    claudeCustomerTasks: {
      bookingActionVersions: { useQuery: () => withRecords },
      bookingActionVisits: { useQuery: () => ({ data: visits, isLoading: false }) },
      setupBookingAction: mutation(), editBookingAction: mutation(), executeBookingAction: mutation(), verifyBookingAction: mutation(),
      beginBookingConfirmation: mutation(), finishBookingConfirmation: mutation(),
    },
    leads: { sendMessage: mutation() },
  } };
});

const html = (data: any, task: any) => {
  current = data; withRecords = { data: data ? { [String(task.id)]: "v1" } : {}, isLoading: false, isError: false };
  return renderToStaticMarkup(React.createElement(Panel, { task }));
};
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

// Staff never see raw database errors (staging, 2026-11-26: a failed staff-record lookup showed its SQL text).
const raw = "Failed query: select `id`, `name`, `email` from `agents` where `agents`.`id` = ? limit ?\nparams: 210001,1";
const serverError = (code: string, message = raw) => Object.assign(new Error(message), { data: { code } });
it("shows only LeadFlow's own messages, never database or other server text", async () => {
  const { errorText } = await import("../client/src/components/ClaudeBookingChangePanel");
  const generic = "Something went wrong. Nothing was repeated. Refresh the task and check its status before trying again.";
  for (const error of [serverError("INTERNAL_SERVER_ERROR"), new Error(raw), serverError("BAD_REQUEST", '[{"code":"invalid_type"}]'), serverError("TIMEOUT"), "boom", null])
    expect(errorText(error)).toBe(generic);
  expect(errorText(serverError("CONFLICT", "This confirmation is not ready to send. Refresh the task."))).toBe("This confirmation is not ready to send. Refresh the task.");
  expect(errorText(serverError("PRECONDITION_FAILED", "The confirmation must be 1 to 1600 characters."))).toBe("The confirmation must be 1 to 1600 characters.");
  expect(errorText(serverError("NOT_FOUND", "Booking change not found."))).toBe("Booking change not found.");
  expect(errorText(serverError("FORBIDDEN", "bookings access required"))).toBe("You need booking access to do this.");
});

it("Send confirmation: one send, one recorded outcome, and a failure says whether the text may have gone out", async () => {
  const { sendBookingConfirmation, errorText } = await import("../client/src/components/ClaudeBookingChangePanel");
  const reserved = { sessionId: 4, text: "Hi Maya, you're all set!" };
  const run = async (steps: { begin?: () => Promise<any>; send?: () => Promise<any>; finish?: () => Promise<any> }) => {
    const calls: string[] = [];
    let message: string | null = null;
    try {
      await sendBookingConfirmation({
        begin: async () => { calls.push("begin"); return steps.begin ? steps.begin() : reserved; },
        send: async r => { calls.push(`send:${r.sessionId}`); return steps.send ? steps.send() : { success: true, smsSent: true }; },
        finish: async outcome => { calls.push(`finish:${outcome}`); return steps.finish ? steps.finish() : {}; },
      });
    } catch (caught) { message = errorText(caught); }
    expect(message ?? "").not.toMatch(/Failed query|agents|params|select/i);
    return { calls, message };
  };
  const fails = async () => { throw serverError("INTERNAL_SERVER_ERROR"); };
  expect(await run({})).toEqual({ calls: ["begin", "send:4", "finish:sent"], message: null });
  expect(await run({ send: async () => ({ success: true, smsSent: false, duplicate: true }) })).toEqual({ calls: ["begin", "send:4", "finish:sent"], message: null });
  expect(await run({ begin: fails })).toEqual({ calls: ["begin"], message: "The confirmation was not sent. Refresh the task and try again." });
  expect(await run({ begin: async () => { throw serverError("CONFLICT", "This confirmation is not ready to send. Refresh the task."); } }))
    .toEqual({ calls: ["begin"], message: "This confirmation is not ready to send. Refresh the task." });
  expect(await run({ send: fails })).toEqual({ calls: ["begin", "send:4", "finish:failed"], message: "The confirmation may not have been sent. Check the conversation before trying again." });
  expect(await run({ send: async () => ({ success: true, smsSent: false }) })).toEqual({ calls: ["begin", "send:4", "finish:failed"], message: "The confirmation was not sent. Check the conversation, then try again." });
  expect(await run({ finish: fails })).toEqual({ calls: ["begin", "send:4", "finish:sent"],
    message: "The confirmation was sent, but saving that failed. Don't send it again: refresh the task in two minutes and choose \"It was sent\"." });
  expect(await run({ send: fails, finish: fails })).toEqual({ calls: ["begin", "send:4", "finish:failed"],
    message: "The confirmation may not have been sent, and its status could not be saved. Refresh the task in two minutes and check the conversation before choosing." });
});

it("ordinary task cards make no booking-change request of their own; only cards listed by the shared request load details", async () => {
  Panel ??= (await import("../client/src/components/ClaudeBookingChangePanel")).ClaudeBookingChangePanel;
  const render = (task: any) => renderToStaticMarkup(React.createElement(Panel, { task }));
  const card = (id: number, status = "claimed") => ({ id, sessionId: 40 + id, customerPhone: "+13025550147", customerName: "Maya Lane", status,
    items: [{ id: "item-1", title: "Move the cleaning", evidenceQuote: "x", completedBy: null, completedAt: null }] });
  current = { enabled: true, visits: [], assessment: null, record: { version: 1, taskId: 7, source: "staff", itemId: "item-1", revision: 1, status: "closed",
    request: { type: "cancel_visit", visitDate: "2026-12-04", jobId: 501, newDate: null, newTime: null, evidenceQuote: null }, execution: { by: { id: "11", name: "Ana" },
      at: 1, bookingId: 77, jobId: 501, publicBookingNumber: "B-1", canonicalVisit: true, previous: { date: "2026-12-04", time: "09:00" },
      expected: { date: "2026-12-04", time: "09:00", arrivalWindow: null, cancelled: true }, availabilityConfirmed: false, lateRescheduleWarning: false },
    verification: { outcome: "verified", method: "direct_readback", explanation: "ok", checkedAt: 2, attempts: 1 },
    confirmation: { text: "x", status: "skipped", by: { id: "11", name: "Ana" }, at: 3 }, history: [] } };
  withRecords = { data: { "7": "3f2a9c0d11e4b7a8" }, isLoading: false, isError: false };
  detailQueries.length = 0;
  const cards = Array.from({ length: 150 }, (_, n) => card(n + 100));
  const out = cards.map(render);
  expect(detailQueries.filter(q => q.enabled)).toHaveLength(0); // 150 ordinary cards: no detail request at all
  expect(out.every(markup => markup.includes("Set up booking change"))).toBe(true);
  expect(render(card(7))).toContain("Executed and verified"); // the one card with a booking change loads it
  expect(detailQueries.filter(q => q.enabled).map(q => q.id)).toEqual([7]);
  expect(render(card(101, "done"))).toBe("");
  withRecords = { data: undefined, isLoading: true, isError: false };
  expect(render(card(7))).toBe(""); // nothing flashes while the shared request loads
  withRecords = { data: undefined, isLoading: false, isError: true };
  expect(render(card(101))).toBe(""); // shared request failed: no misleading set-up button
});
