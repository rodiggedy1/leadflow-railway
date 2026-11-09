import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), sendSms: vi.fn(), broadcast: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./openphone", () => ({ sendSms: mocks.sendSms }));
vi.mock("./sseBroadcast", () => ({ broadcastOpsUpdate: mocks.broadcast }));
vi.mock("../drizzle/schema", () => {
  const table = (name: string) => new Proxy({ name }, {
    get: (target, field: string) => field === "name" ? target.name : { table: name, field },
  });
  return {
    bookings: table("booking"), bookingPaymentProfiles: table("profile"),
    bookingNotificationDeliveries: table("delivery"), opsChatMessages: table("message"),
  };
});
vi.mock("drizzle-orm", () => ({
  eq: (column: Column, value: unknown) => ({ column, value }),
  and: (...conditions: Condition[]) => conditions,
}));

import { sendBookingCompletionNotifications } from "./bookingCompletionNotifications";
import { createBookingArrivalPreference } from "../shared/bookingArrival";
import {
  createPublicBookingPriceSnapshot, type PublicBookingPricingInput,
} from "../shared/publicBookingPricing";

type Row = Record<string, any>;
type Column = { table: string; field: string };
type Table = { name: string };
type Condition = { column: Column; value: unknown } | Condition[];

// Only the actual dispatcher and pure shared validators execute. Every database,
// SMS and broadcast import is replaced before module evaluation.
class MemoryDb {
  state: Record<string, Row[]> = { booking: [], profile: [], delivery: [], message: [] };
  writes: Array<{ table: string; values: Row }> = [];
  private matches(row: Row, condition?: Condition): boolean {
    if (!condition) return true;
    return Array.isArray(condition)
      ? condition.every(part => this.matches(row, part))
      : row[condition.column.field] === condition.value;
  }
  select() {
    let table: Table;
    let condition: Condition;
    const chain = {
      from(value: Table) { table = value; return chain; },
      where(value: Condition) { condition = value; return chain; },
      limit: async (count: number) => structuredClone(this.state[table.name]
        .filter(row => this.matches(row, condition)).slice(0, count)),
    };
    return chain;
  }
  insert(table: Table) {
    return { values: async (values: Row) => {
      const rows = this.state[table.name];
      if (table.name === "delivery" && rows.some(row => row.bookingId === values.bookingId && row.channel === values.channel)) {
        throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
      }
      this.writes.push({ table: table.name, values: structuredClone(values) });
      rows.push({ id: rows.length + 1, ...structuredClone(values) });
      return [{ insertId: rows.length }];
    } };
  }
  update(table: Table) {
    return { set: (values: Row) => ({ where: async (condition: Condition) => {
      this.writes.push({ table: table.name, values: structuredClone(values) });
      const rows = this.state[table.name].filter(row => this.matches(row, condition));
      rows.forEach(row => Object.assign(row, structuredClone(values)));
      return [{ affectedRows: rows.length }];
    } }) };
  }
}

const base: PublicBookingPricingInput = {
  pricingMode: "home", serviceId: "standard", bedrooms: 2, bathrooms: 2,
  homeType: "House", condition: 5, maidCount: 2, hourCount: 2,
  extras: [], recurrence: "one-time",
};
const snapshotWith = (arrivalPreference: unknown) => ({
  ...createPublicBookingPriceSnapshot(base), input: { ...base, arrivalPreference },
});
const channels = ["purchaser_sms", "cs_sms", "owner_sms", "command_chat"];
const recipients = ["+12025550123", "+12028885362", "+13029816191"];
const delayedTiming = "Nothing is charged until your cleaning is complete. We'll text you closer to your appointment with updates from your cleaning team.";
const paidTiming = "$321.23 was paid today with Cash App for your first cleaning.";
const payments = [
  { paymentMethod: "card", paymentStatus: "card_on_file", paid: false },
  { paymentMethod: "invoice", paymentStatus: "invoice_pending", paid: false },
  { paymentMethod: "cashapp", paymentStatus: "captured", paid: true },
];
const windows = [
  { label: "flexible", preference: createBookingArrivalPreference("flexible"), text: "8:30 AM to 5 PM" },
  { label: "preferred morning", preference: createBookingArrivalPreference("preferred", "morning"), text: "8 AM to 12 PM" },
  { label: "preferred afternoon", preference: createBookingArrivalPreference("preferred", "afternoon"), text: "12 PM to 5 PM" },
  { label: "exact 08:30", preference: createBookingArrivalPreference("exact", undefined, "08:30"), text: "8:30 AM to 10:30 AM" },
  { label: "exact 10:30", preference: createBookingArrivalPreference("exact", undefined, "10:30"), text: "10:30 AM to 12:30 PM" },
  { label: "exact 12:30", preference: createBookingArrivalPreference("exact", undefined, "12:30"), text: "12:30 PM to 2:30 PM" },
  { label: "exact 14:30", preference: createBookingArrivalPreference("exact", undefined, "14:30"), text: "2:30 PM to 4:30 PM" },
  { label: "exact 16:30", preference: createBookingArrivalPreference("exact", undefined, "16:30"), text: "4:30 PM to 6:30 PM" },
];
let db: MemoryDb;
function fixture(priceSnapshot: unknown, payment = payments[0], requestedLocalTime = "11:00") {
  db.state.booking = [{
    id: 7, publicBookingNumber: "MIB-7", customerName: "Submitted Customer",
    customerPhone: recipients[0], address: "123 Main Street", serviceName: "Deep Cleaning",
    bedrooms: 2, bathrooms: 2, extras: [{ label: "inside fridge", quantity: 2 }],
    requestedLocalDate: "2027-02-15", requestedLocalTime, firstCleaningTotalCents: 32123,
    bookedByAgentId: 9, bookedByAgentName: "Original Agent", priceSnapshot,
    paymentMethod: payment.paymentMethod, paymentStatus: payment.paymentStatus,
  }];
  db.state.profile = [{ id: 17, bookingId: 7 }];
}
function purchaserText(window: string, paid: boolean) {
  return [
    "You're booked! 🎉 Your Maids in Black cleaning is confirmed.",
    [
      "📅 Monday, Feb 15", `🕚 Arrival window: ${window}`, "📍 123 Main Street",
      "🧼 Deep Cleaning, 2 bed / 2 bath", "➕ Add-on: Inside Fridge × 2", "💵 Total: $321.23",
    ].join("\n"),
    paid ? paidTiming : delayedTiming,
    "Need to reschedule or add anything? Just reply here. Consider it handled. ✨",
  ].join("\n\n");
}
function expectMessages(window: string, schedule: string, paid: boolean) {
  const operations = paid
    ? `New booking: Submitted Customer · Deep Cleaning · ${schedule} · Cash App paid $321.23 today · MIB-7`
    : `New booking: Submitted Customer · Deep Cleaning · ${schedule} · $321.23 · MIB-7`;
  expect(mocks.sendSms.mock.calls.map(([message]) => message)).toEqual([
    { to: recipients[0], content: purchaserText(window, paid) },
    { to: recipients[1], content: operations }, { to: recipients[2], content: operations },
  ]);
  const note = `Deep Cleaning · ${schedule}`;
  expect(db.state.message).toEqual([{
    id: 1, channel: "command", authorName: "🎉 New Booking", authorRole: "office",
    body: paid
      ? `🎉 New booking! Submitted Customer — Cash App paid $321.23 today · ${note}`
      : `🎉 New booking! Submitted Customer — $321.23 · ${note}`,
    quickAction: "announce_booking",
    metadata: JSON.stringify({ personName: "Submitted Customer", amount: "$321.23", note,
      bookingId: 7, bookedByAgentId: 9, bookedByAgentName: "Original Agent" }),
  }]);
  expect(mocks.broadcast).toHaveBeenCalledTimes(1);
  expect(mocks.broadcast).toHaveBeenCalledWith("new_message", { channel: "command" });
}
function expectLedger() {
  expect(db.state.delivery.map(row => row.channel)).toEqual(channels);
  expect(db.state.delivery).toHaveLength(4);
  for (const [index, row] of db.state.delivery.entries()) {
    expect(row).toMatchObject({
      id: index + 1, bookingId: 7, channel: channels[index], status: "sent",
      claimToken: expect.any(String), claimedAt: expect.any(Date),
      providerMessageId: index < 3 ? "sms_mock" : null, errorMessage: null,
      createdAt: expect.any(Date), updatedAt: expect.any(Date),
    });
  }
  expect(db.writes.filter(write => write.table === "delivery").map(write => write.values.status))
    .toEqual(channels.flatMap(() => ["pending", "sending", "sent"]));
  expect(db.writes.map(write => write.table)).toEqual([
    ...channels.slice(0, 3).flatMap(() => ["delivery", "delivery", "delivery"]),
    "delivery", "delivery", "message", "delivery",
  ]);
  expect(mocks.getDb).toHaveBeenCalledTimes(1);
}

beforeEach(() => {
  vi.clearAllMocks();
  db = new MemoryDb();
  mocks.getDb.mockResolvedValue(db);
  mocks.sendSms.mockResolvedValue({ success: true, messageId: "sms_mock" });
});
afterEach(() => vi.restoreAllMocks());

describe("saved arrival windows in the real completion dispatcher, with offline boundaries", () => {
  it.each(windows.flatMap(window => payments.map(payment => ({ ...window, ...payment }))))(
    "formats $label for $paymentMethod across purchaser, operations and command, preserving claims and recipients",
    async ({ preference, text, ...payment }) => {
      // Deliberately disagreeing legacy start proves the explicit saved snapshot
      // alone supplies both endpoints, rather than inferring a mode from a time.
      fixture(snapshotWith(preference), payment);
      const originalBooking = structuredClone(db.state.booking);
      await sendBookingCompletionNotifications(7);
      expectMessages(text, `2027-02-15 at ${text}`, payment.paid);
      expectLedger();
      expect(db.state.booking).toEqual(originalBooking);
      expect(db.state.profile).toEqual([{ id: 17, bookingId: 7 }]);
      const writes = db.writes.length;
      await sendBookingCompletionNotifications(7);
      expect(db.writes).toHaveLength(writes);
      expect(mocks.sendSms).toHaveBeenCalledTimes(3);
      expect(mocks.broadcast).toHaveBeenCalledTimes(1);
      expect(db.state.delivery).toHaveLength(4);
      expect(db.state.message).toHaveLength(1);
    },
  );

  const flexible = windows[0].preference;
  const legacySnapshots = [
    { label: "missing snapshot", value: undefined },
    { label: "null snapshot", value: null },
    { label: "empty snapshot", value: {} },
    { label: "legacy public quote", value: createPublicBookingPriceSnapshot(base) },
    { label: "wrong snapshot version", value: { ...snapshotWith(flexible), version: "booking-widget-v1" } },
    { label: "missing snapshot breakdown", value: { ...snapshotWith(flexible), breakdown: undefined } },
    { label: "null snapshot input", value: { ...snapshotWith(flexible), input: null } },
    { label: "top-level preference only", value: { ...createPublicBookingPriceSnapshot(base), arrivalPreference: flexible } },
    { label: "breakdown preference only", value: { ...createPublicBookingPriceSnapshot(base), breakdown: { arrivalPreference: flexible } } },
    ...[
      null, "flexible", {}, { mode: "unknown", startLocalTime: "08:30", endLocalTime: "17:00" },
      { ...flexible, endLocalTime: "10:30" }, { ...flexible, period: "morning" },
      { ...flexible, unexpected: true }, { ...flexible, startLocalTime: "8:30" },
      { mode: "preferred", startLocalTime: "08:00", endLocalTime: "12:00" },
      { mode: "preferred", period: "morning", startLocalTime: "08:00", endLocalTime: "17:00" },
      { mode: "preferred", period: "afternoon", startLocalTime: "08:00", endLocalTime: "12:00" },
      { mode: "exact", startLocalTime: "11:00", endLocalTime: "13:00" },
      { mode: "exact", startLocalTime: "16:30", endLocalTime: "17:00" },
    ].map((value, index) => ({ label: `malformed preference ${index}`, value: snapshotWith(value) })),
  ];
  it.each(legacySnapshots)("keeps legacy purchaser/operations/command bytes for $label", async ({ value }) => {
    fixture(value);
    await sendBookingCompletionNotifications(7);
    expectMessages("11 AM to 1 PM", "2027-02-15 at 11:00", false);
    expectLedger();
  });
  it.each([
    { start: "08:30", text: "8:30 AM to 10:30 AM" },
    { start: "12:00", text: "12 PM to 2 PM" },
    { start: "16:30", text: "4:30 PM to 6:30 PM" },
    { start: "23:45", text: "11:45 PM to 1:45 AM" },
  ].flatMap(time => payments.map(payment => ({ ...time, ...payment }))))(
    "retains original start+2h and raw operations time $start for legacy $paymentMethod",
    async ({ start, text, ...payment }) => {
      fixture(createPublicBookingPriceSnapshot(base), payment, start);
      await sendBookingCompletionNotifications(7);
      expectMessages(text, `2027-02-15 at ${start}`, payment.paid);
      expectLedger();
    },
  );

  it("keeps failed/sending/sent ledger rows claimed and does not retry or send", async () => {
    fixture(snapshotWith(flexible));
    db.state.delivery = channels.map((channel, index) => ({
      id: index + 1, bookingId: 7, channel, status: ["failed", "sending", "sent", "sent"][index],
    }));
    const before = structuredClone(db.state);
    await sendBookingCompletionNotifications(7);
    expect(db.state).toEqual(before);
    expect(db.writes).toHaveLength(0);
    expect(mocks.sendSms).not.toHaveBeenCalled();
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it("retains existing missing-booking/profile early exits without writes or sends", async () => {
    for (const missing of ["booking", "profile"]) {
      fixture(snapshotWith(flexible));
      db.state[missing] = [];
      await sendBookingCompletionNotifications(7);
    }
    expect(db.writes).toHaveLength(0);
    expect(mocks.sendSms).not.toHaveBeenCalled();
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it("preserves the complete pre-change dispatch/ledger/recipient block byte-for-byte", () => {
    const source = readFileSync(resolve(import.meta.dirname, "bookingCompletionNotifications.ts"), "utf8");
    const digest = (text: string) => createHash("sha256").update(text).digest("hex");
    // Fingerprints captured from untouched bc63fd6, the approved worktree baseline.
    expect(digest(source.slice(source.indexOf("  for (const channel of CHANNELS) {"))))
      .toBe("090506397fecf950a147218ff2dbcd4a46cf02699098e7f91f85d3360b8c608c");
    expect(digest(source.slice(source.indexOf("const CS_SUPPORT_NUMBER"), source.indexOf("function isDuplicateEntry"))))
      .toBe("9958417070b648f5ed772419a5040494c0d0accac9ecf5f38411c4572b09ec5c");
    expect(digest(source.slice(source.indexOf("  const operationsText ="), source.indexOf("\n\n  for (const channel"))))
      .toBe("47a61f7210242a0782845af80c17f6515286b3a663699ac7cc923e13a002d129");
    expect(source).toContain("getPublicBookingArrivalPreference(booking.priceSnapshot)");
  });
});
