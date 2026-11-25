import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it, vi } from "vitest";
import { businessLocalDateTimeToUtcMs } from "../utils/businessTime";
import { createSmsCustomerRecordsReader, modelBookingContext, openStaffTasksFromRows } from "./smsCustomerRecords";
import { projectVoiceCustomerBookingContext, type VoiceBookingRecord } from "./voiceCustomerBookingContext";
import type { ClaudeCustomerSmsGenerationBinding } from "./claudeCustomerSmsGeneration";

const phone = "+13029816191";
const now = new Date("2026-11-17T18:00:00Z");
const binding = { sessionId: 42, fromPhone: phone } as ClaudeCustomerSmsGenerationBinding;
function job(patch: Partial<VoiceBookingRecord> = {}): VoiceBookingRecord {
  return { source: "leadflow_job", id: 1, customerName: "Maya Lane", customerPhone: phone, date: "2026-11-18",
    serviceDateTime: "2026-11-18T15:00:00Z", serviceName: "Standard cleaning", address: "123 Main St", teamName: "Team A",
    status: "assigned", ...patch };
}
const bookingsFor = (records: VoiceBookingRecord[]) => modelBookingContext(projectVoiceCustomerBookingContext({ phone, bookings: records, contacts: [], now }));
const taskRow = (task: Record<string, unknown>) => ({ id: 1, metadata: JSON.stringify({ taskId: 1, task }) });
const task = (patch: Record<string, unknown> = {}) => ({ id: 1, title: "Move cleaning to Friday", status: "unclaimed", receivedAt: Date.parse("2026-11-16T15:00:00Z"),
  items: [{ id: "a", title: "Reschedule to Friday", evidenceQuote: "Friday", completedBy: null, completedAt: null },
    { id: "b", title: "Add oven cleaning", evidenceQuote: "oven", completedBy: { id: 1 }, completedAt: 5 }], ...patch });

describe("unfinished staff tasks for this conversation", () => {
  it("lists unclaimed and claimed tasks with item progress, never done tasks", () => {
    expect(openStaffTasksFromRows([taskRow(task()), taskRow(task({ title: "Claimed work", status: "claimed" })), taskRow(task({ title: "Done work", status: "done" }))]))
      .toEqual([
        { title: "Move cleaning to Friday", status: "unclaimed", createdOn: "2026-11-16", items: [{ title: "Reschedule to Friday", done: false }, { title: "Add oven cleaning", done: true }] },
        { title: "Claimed work", status: "claimed", createdOn: "2026-11-16", items: [{ title: "Reschedule to Friday", done: false }, { title: "Add oven cleaning", done: true }] },
      ]);
  });
  it("skips unreadable rows instead of failing, and sends no evidence quotes or staff identities", () => {
    const result = openStaffTasksFromRows([{ metadata: "not json" }, { metadata: null }, taskRow({ title: "" }), taskRow(task())]);
    expect(result).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/evidenceQuote|completedBy|"id"/);
  });
  it("caps the list at 20 open tasks", () => {
    expect(openStaffTasksFromRows(Array.from({ length: 30 }, () => taskRow(task())))).toHaveLength(20);
  });
});

describe("booking statuses Claude receives (existing booking lookup)", () => {
  it("presents only a confirmed, scheduled visit as upcoming", () => {
    expect(bookingsFor([job()])).toEqual({ customerFound: true, currentLocalDate: "2026-11-17",
      upcomingBooking: { status: "confirmed", timing: "upcoming", date: "2026-11-18", time: "10:00", service: "Standard cleaning", address: "123 Main St", team: "Team A" },
      mostRecentPastBooking: null });
  });
  it.each(["cancelled", "canceled", "completed", "rescheduled"])("never presents a %s booking as upcoming", status => {
    expect(bookingsFor([job({ status })]).upcomingBooking).toBeNull();
  });
  it("shows the moved date of a rescheduled booking, and the old date as rescheduled history", () => {
    const result = bookingsFor([job({ id: 1, date: "2026-11-16", serviceDateTime: "2026-11-16T15:00:00Z", status: "rescheduled" }),
      job({ id: 2, date: "2026-11-20", serviceDateTime: "2026-11-20T15:00:00Z" })]);
    expect(result.upcomingBooking).toMatchObject({ status: "confirmed", date: "2026-11-20" });
    expect(result.mostRecentPastBooking).toMatchObject({ status: "rescheduled", recordedStatus: "rescheduled", date: "2026-11-16" });
  });
  it.each([["completed", "completed"], ["cancelled", "cancelled"], ["canceled", "cancelled"], ["assigned", "past"]])("labels a past %s booking as %s", (recorded, expected) => {
    expect(bookingsFor([job({ date: "2026-11-10", serviceDateTime: "2026-11-10T15:00:00Z", status: recorded })]).mostRecentPastBooking)
      .toMatchObject({ status: expected, recordedStatus: recorded, date: "2026-11-10" });
  });
  it("cancelled native bookings are not upcoming", () => {
    const native = job({ source: "native_booking", status: "cancelled", localTime: "10:00", timeZone: "America/New_York",
      startAt: businessLocalDateTimeToUtcMs("2026-11-18", "10:00", "America/New_York") });
    expect(bookingsFor([native]).upcomingBooking).toBeNull();
  });
  it("reports an unknown customer plainly", () => {
    expect(bookingsFor([])).toEqual({ customerFound: false, currentLocalDate: "2026-11-17", upcomingBooking: null, mostRecentPastBooking: null });
  });
});

describe("records reader: read-only, scoped to this conversation, never blocking", () => {
  const dialect = new MySqlDialect();
  it("reads only this conversation's Claude tasks and this phone's bookings", async () => {
    const execute = vi.fn(async (_query: unknown) => [[taskRow(task())]]);
    const readBookings = vi.fn(async () => projectVoiceCustomerBookingContext({ phone, bookings: [job()], contacts: [], now }));
    const records = await createSmsCustomerRecordsReader({ execute } as never, readBookings)(binding);
    const query = dialect.sqlToQuery(execute.mock.calls[0][0] as never);
    expect(query.sql.replace(/\s+/g, " ")).toMatch(/^SELECT id, metadata FROM ops_chat_messages WHERE channel = 'command' AND quickAction = \? AND sessionId = \?/);
    expect(query.params).toEqual(["claude_customer_task", 42]);
    expect(readBookings).toHaveBeenCalledWith(expect.anything(), phone);
    expect(records.unavailableRecords).toEqual([]);
    expect(records.openStaffTasks).toHaveLength(1);
    expect(records.bookingContext).toMatchObject({ upcomingBooking: { status: "confirmed" } });
  });
  it("a failed task lookup keeps bookings and reports tasks unavailable", async () => {
    const records = await createSmsCustomerRecordsReader({ execute: async () => { throw new Error("DB down"); } } as never,
      async () => projectVoiceCustomerBookingContext({ phone, bookings: [job()], contacts: [], now }))(binding);
    expect(records).toMatchObject({ openStaffTasks: null, unavailableRecords: ["openStaffTasks"] });
    expect(records.bookingContext).not.toBeNull();
  });
  it("a failed booking lookup keeps tasks and reports bookings unavailable", async () => {
    const records = await createSmsCustomerRecordsReader({ execute: async () => [[taskRow(task())]] } as never,
      async () => { throw new Error("lookup failed"); })(binding);
    expect(records).toMatchObject({ bookingContext: null, unavailableRecords: ["bookings"] });
    expect(records.openStaffTasks).toHaveLength(1);
  });
});
