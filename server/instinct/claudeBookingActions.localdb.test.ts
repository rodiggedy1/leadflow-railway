// Booking changes against a REAL local TiDB (test data only), with the real booking functions, the real
// Instinct verifier and concurrent connections. Runs only when BOOKING_ACTIONS_TEST_DB points at a local
// throwaway database (for example mysql://root@127.0.0.1:4012/leadflow_test); skipped otherwise.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, sql } from "drizzle-orm";
import { bookingPaymentProfiles, bookings, bookingSeries, leadflowJobs, opsChatMessages, paymentAuthorizations } from "../../drizzle/schema";
import { customerTaskSchema } from "../../shared/claudeCustomerTasks";
import { createPublicBookingPriceSnapshot } from "../../shared/publicBookingPricing";
import { createBookingArrivalPreference } from "../../shared/bookingArrival";
import { getEasternBusinessDate } from "../leadflowJobsService";
import { nativeBookingFrequency, NATIVE_BOOKING_OPERATIONAL_ORIGIN } from "../bookingLifecycleService";
import { businessLocalDateTimeToUtcMs } from "../utils/businessTime";
import { createLazyReadDb } from "./readDb";
import { createClaudeCustomerTaskPersistence } from "./claudeCustomerTasksStore";
import * as actions from "./claudeBookingActions";

const url = process.env.BOOKING_ACTIONS_TEST_DB;
const local = Boolean(url && /^mysql:\/\/[^@]*@127\.0\.0\.1:\d+\//.test(url));
const run = local ? describe : describe.skip;

let pool: mysql.Pool, db: actions.BookingActionDb;
const readDb = local ? createLazyReadDb({ databaseUrl: () => url }) : undefined;
const verifyOptions = () => ({ readDb, env: { DATABASE_URL: url } });
const ana = { id: "11", name: "Ana" }, ben = { id: "12", name: "Ben" };
let seq = 0;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const today = () => getEasternBusinessDate();
const iso = (date: string, time: string) => new Date(businessLocalDateTimeToUtcMs(date, time, "America/New_York")).toISOString();

async function booking(options: { phone: string; email?: string; date: string; time: string; recurrence?: "one-time" | "weekly"; paymentStatus?: string; window?: "morning" }) {
  const n = ++seq, recurrence = options.recurrence ?? "one-time";
  const arrival = options.window ? createBookingArrivalPreference("preferred", "morning") : undefined;
  const snapshot = createPublicBookingPriceSnapshot({ pricingMode: "home", serviceId: "standard", bedrooms: 2, bathrooms: 1, homeType: "House",
    condition: 5, maidCount: 1, hourCount: 1, extras: [], recurrence: recurrence === "one-time" ? "one-time" : "weekly", ...(arrival ? { arrivalPreference: arrival } : {}) } as any);
  const now = new Date();
  const [inserted] = await db.insert(bookings).values({ publicBookingNumber: `B-T${Date.now()}${n}`, idempotencyKey: `00000000-0000-4000-8000-${String(Date.now()).slice(-8)}${String(n).padStart(4, "0")}`,
    commandHash: "a".repeat(64), source: "public", status: "needs_attention", availabilityStatus: "requested", assignmentStatus: "assigned",
    paymentStatus: options.paymentStatus ?? "card_on_file", customerName: "Maya Lane", customerPhone: options.phone, customerEmail: options.email ?? "maya@example.com",
    serviceId: "standard", serviceName: "Standard cleaning", bedrooms: 2, bathrooms: 1, extras: [], specialRequestNotes: [], address: "123 Main St",
    requestedLocalDate: options.date, requestedLocalTime: options.time, requestedTimeZone: "America/New_York",
    requestedStartAt: businessLocalDateTimeToUtcMs(options.date, options.time, "America/New_York"), recurrence,
    pricingVersion: "public-book-v2", firstCleaningTotalCents: 20000, futureVisitTotalCents: recurrence === "one-time" ? null : 18000,
    priceSnapshot: snapshot, createdAt: now, updatedAt: now });
  const id = Number((inserted as any).insertId);
  if (recurrence !== "one-time") await db.insert(bookingSeries).values({ bookingId: id, status: "intent_pending", frequency: recurrence,
    anchorLocalDate: options.date, anchorLocalTime: options.time, timeZone: "America/New_York", firstCleaningTotalCents: 20000, futureVisitTotalCents: 18000, createdAt: now, updatedAt: now });
  return id;
}
async function visit(bookingId: number, date: string, time: string, extra: Partial<typeof leadflowJobs.$inferInsert> = {}) {
  const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  const [inserted] = await db.insert(leadflowJobs).values({ origin: NATIVE_BOOKING_OPERATIONAL_ORIGIN, bookingId, jobDate: date, serviceDateTime: iso(date, time),
    customerName: row.customerName, customerPhone: row.customerPhone, customerEmail: row.customerEmail, jobAddress: row.address, serviceName: row.serviceName,
    bedrooms: 2, bathrooms: 1, extras: "[]", frequency: nativeBookingFrequency(row.recurrence), bookingStatus: "assigned", teamName: "Team A", teamId: 1,
    jobTotalCents: 20000, ...extra });
  return Number((inserted as any).insertId);
}
async function task(phone: string, inboundText: string, proposal: unknown, items = [{ title: "Move the cleaning", evidenceQuote: inboundText }]) {
  const persistence = createClaudeCustomerTaskPersistence();
  return db.transaction(async tx => {
    const n = ++seq;
    const id = await persistence.createTask(tx, { sessionId: 900 + n, customerName: "Maya Lane", customerPhone: phone, sourceMessageId: `AC-msg-${Date.now()}-${n}`,
      sourceText: inboundText, receivedAt: Date.now(), receivingPhoneNumberId: "PN-test", receivingPhoneNumber: "+13025550100" },
      { replyText: "We'll take care of it and confirm once it's done.", task: { title: "Booking request", items, bookingAction: proposal } }, `test-task:${Date.now()}:${n}`);
    await actions.attachProposedBookingAction(tx, { id: id!, items: items.map((item, index) => ({ id: `item-${index + 1}`, evidenceQuote: item.evidenceQuote })) }, proposal, inboundText);
    return id!;
  });
}
const jobOf = async (id: number) => (await db.select().from(leadflowJobs).where(eq(leadflowJobs.id, id)))[0];
const bookingOf = async (id: number) => (await db.select().from(bookings).where(eq(bookings.id, id)))[0];
const taskOf = async (id: number) => customerTaskSchema.parse(JSON.parse((await db.select().from(opsChatMessages).where(eq(opsChatMessages.id, id)))[0].metadata!).task);
const localTime = (value: string | null) => new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value!));
let phoneSeq = 100;
const newPhone = () => `+1302555${String(++phoneSeq).padStart(4, "0")}`;

run("booking changes on a real local TiDB", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    pool = mysql.createPool({ uri: url! });
    db = drizzle(pool) as unknown as actions.BookingActionDb;
    // Local throwaway test database only (the address check above refuses anything but 127.0.0.1).
    for (const table of ["bookings", "leadflow_jobs", "booking_series", "ops_chat_messages", "booking_payment_profiles", "payment_authorizations",
      "booking_cash_app_payments", "cleaner_portal_job_progress"]) await pool.query(`DELETE FROM \`${table}\``);
  });
  afterAll(async () => { await pool?.end(); await (readDb as any)?.close?.(); });
  beforeEach(() => { process.env.DATABASE_URL = url; });

  it("reschedules the booking's own visit: booking and visit move together, once, then verify; task stays in its existing format", async () => {
    const phone = newPhone(), date = addDays(today(), 10), newDate = addDays(today(), 12);
    const b = await booking({ phone, date, time: "10:00" }); const j = await visit(b, date, "10:00");
    const id = await task(phone, "Can we move it to Friday at 2pm?", { type: "reschedule_visit", visitDate: date, newDate, newTime: "14:00", evidenceQuote: "move it to Friday at 2pm" });
    const view = await actions.getBookingActionView(db, id);
    expect(view!.assessment).toMatchObject({ executable: true, manualReasons: [], visit: { jobId: j, canonicalVisit: true }, effectiveNewTime: "14:00" });
    expect(view!.record.itemId).toBe("item-1");
    await expect(actions.executeBookingAction(db, id, { revision: 1, jobId: j, availabilityConfirmed: false }, ana)).rejects.toThrow(/availability/);
    const first = await actions.executeBookingAction(db, id, { revision: 1, jobId: j, availabilityConfirmed: true }, ana);
    expect(first.executedNow).toBe(true);
    const again = await actions.executeBookingAction(db, id, { revision: 1, jobId: j, availabilityConfirmed: true }, ana);
    expect(again.executedNow).toBe(false);
    expect(await bookingOf(b)).toMatchObject({ requestedLocalDate: newDate, requestedLocalTime: "14:00" });
    const job = await jobOf(j); expect(job.jobDate).toBe(newDate); expect(localTime(job.serviceDateTime)).toBe("14:00");
    expect((await db.select().from(leadflowJobs).where(eq(leadflowJobs.bookingId, b))).length).toBe(1);
    const verified = await actions.verifyBookingAction(db, id, ana, verifyOptions());
    expect(verified.status).toBe("verified");
    expect(verified.confirmation!.text).toContain("you're all set! Your cleaning has been moved to");
    const saved = await taskOf(id);
    expect(saved.status).toBe("claimed"); expect(saved.owner).toEqual(ana);
    expect(saved.items[0].completedBy).toEqual(ana);
    expect(Object.keys(saved)).not.toContain("bookingAction");
  });

  it("keeps an existing arrival window: the date moves, the window start and the stored window stay", async () => {
    const phone = newPhone(), date = addDays(today(), 10), newDate = addDays(today(), 13);
    const b = await booking({ phone, date, time: "08:00", window: "morning" }); const j = await visit(b, date, "08:00");
    const before = await bookingOf(b);
    const id = await task(phone, "Please move it to Saturday", { type: "reschedule_visit", visitDate: date, newDate, newTime: null, evidenceQuote: "move it to Saturday" });
    const view = await actions.getBookingActionView(db, id);
    expect(view!.assessment!.effectiveNewTime).toBe("08:00");
    expect(view!.assessment!.warnings.join(" ")).toContain("arrival window (8:00 AM–12:00 PM)");
    await actions.executeBookingAction(db, id, { revision: 1, jobId: j, availabilityConfirmed: true }, ana);
    const after = await bookingOf(b);
    expect(after).toMatchObject({ requestedLocalDate: newDate, requestedLocalTime: "08:00" });
    expect(after.priceSnapshot).toEqual(before.priceSnapshot);
    expect(after.firstCleaningTotalCents).toBe(before.firstCleaningTotalCents);
    const verified = await actions.verifyBookingAction(db, id, ana, verifyOptions());
    expect(verified.status).toBe("verified");
    expect(verified.confirmation!.text).toContain("with your arrival window of 8:00 AM–12:00 PM");
    // A different time on a window booking stays manual (changing the window isn't supported).
    const id2 = await task(phone, "move it to 3pm", { type: "reschedule_visit", visitDate: newDate, newDate: addDays(newDate, 1), newTime: "15:00", evidenceQuote: "move it to 3pm" });
    const view2 = await actions.getBookingActionView(db, id2);
    expect(view2!.assessment!.executable).toBe(false);
    expect(view2!.assessment!.manualReasons.join(" ")).toContain("Changing the arrival window isn't supported");
  });

  it("moves a later recurring visit with the existing visit-only path; the series continues", async () => {
    const phone = newPhone(), first = addDays(today(), 7), second = addDays(today(), 14), moved = addDays(today(), 16);
    const b = await booking({ phone, date: first, time: "09:00", recurrence: "weekly" });
    await visit(b, first, "09:00"); const j2 = await visit(b, second, "09:00");
    const id = await task(phone, "Can you do the one after on Thursday instead?", { type: "reschedule_visit", visitDate: second, newDate: moved, newTime: null, evidenceQuote: "Thursday instead" });
    const view = await actions.getBookingActionView(db, id);
    expect(view!.assessment).toMatchObject({ executable: true, visit: { jobId: j2, canonicalVisit: false } });
    await actions.executeBookingAction(db, id, { revision: 1, jobId: j2, availabilityConfirmed: true }, ana);
    expect((await jobOf(j2)).jobDate).toBe(moved);
    expect(await bookingOf(b)).toMatchObject({ requestedLocalDate: first });
    const jobs = await db.select().from(leadflowJobs).where(eq(leadflowJobs.bookingId, b));
    expect(jobs.map(job => job.jobDate).sort()).toEqual([first, moved, addDays(second, 7)].sort());
    expect((await actions.verifyBookingAction(db, id, ana, verifyOptions())).status).toBe("verified");
  });

  it("cancels a one-time booking with no payment taken; blocks recurring, holds, payments and Cash App", async () => {
    const phone = newPhone(), date = addDays(today(), 9);
    const b = await booking({ phone, date, time: "11:00" }); const j = await visit(b, date, "11:00");
    const id = await task(phone, "Please cancel my cleaning", { type: "cancel_visit", visitDate: date, newDate: null, newTime: null, evidenceQuote: "cancel my cleaning" });
    expect((await actions.getBookingActionView(db, id))!.assessment!.executable).toBe(true);
    await actions.executeBookingAction(db, id, { revision: 1, jobId: j, availabilityConfirmed: false }, ana);
    expect((await bookingOf(b)).status).toBe("cancelled"); expect((await jobOf(j)).bookingStatus).toBe("cancelled");
    const verified = await actions.verifyBookingAction(db, id, ana, verifyOptions());
    expect(verified.status).toBe("verified");
    expect(verified.confirmation!.text).toMatch(/has been cancelled\. If you'd like to book again, just reply here\. – Maids in Black$/);

    const reasons = async (setup: (bookingId: number) => Promise<void>, options: Parameters<typeof booking>[0]) => {
      const bookingId = await booking(options); const jobId = await visit(bookingId, options.date, options.time);
      await setup(bookingId);
      const t = await task(options.phone, "Please cancel my cleaning", { type: "cancel_visit", visitDate: options.date, newDate: null, newTime: null, evidenceQuote: "cancel my cleaning" });
      const v = await actions.getBookingActionView(db, t);
      await expect(actions.executeBookingAction(db, t, { revision: 1, jobId, availabilityConfirmed: false }, ana)).rejects.toThrow();
      expect((await bookingOf(bookingId)).status).not.toBe("cancelled");
      return v!.assessment!.manualReasons.join(" ");
    };
    expect(await reasons(async () => {}, { phone: newPhone(), date, time: "11:00", recurrence: "weekly" })).toContain("recurring booking isn't supported");
    expect(await reasons(async () => {}, { phone: newPhone(), date, time: "11:00", paymentStatus: "captured" })).toContain('Payment status is "captured"');
    expect(await reasons(async bookingId => {
      const now = new Date();
      const [profile] = await db.insert(bookingPaymentProfiles).values({ bookingId, funnelRecordId: 700000 + ++seq, paymentStatus: "card_on_file", createdAt: now, updatedAt: now });
      await db.insert(paymentAuthorizations).values({ bookingPaymentProfileId: Number((profile as any).insertId), customerPhone: "+13025550000", stripeCustomerId: "cus_test",
        stripePaymentMethodId: "pm_test", amountCents: 20000, status: "authorized" });
    }, { phone: newPhone(), date, time: "11:00" })).toContain("A card hold exists");
    expect(await reasons(async bookingId => {
      await db.execute(sql`INSERT INTO booking_cash_app_payments (bookingId, bookingPaymentProfileId, attempt, status, amountCents, idempotencyKey, returnToken, createdAt, updatedAt)
        VALUES (${bookingId}, 1, 1, 'paid', 20000, ${`idem-${bookingId}`}, ${`ret-${bookingId}`}, NOW(3), NOW(3))`).catch(() => undefined);
      await db.update(bookings).set({ paymentStatus: "paid" }).where(eq(bookings.id, bookingId));
    }, { phone: newPhone(), date, time: "11:00" })).toMatch(/Payment status is "paid"|Cash App/);
  });

  it("native bookings only: a Launch27 visit on the same phone and date is never selected", async () => {
    const phone = newPhone(), date = addDays(today(), 8);
    await booking({ phone, date: addDays(date, 30), time: "10:00" });
    await db.insert(leadflowJobs).values({ origin: "launch27_manual_import", launch27BookingId: 900000 + ++seq, jobDate: date, serviceDateTime: iso(date, "10:00"),
      customerName: "Maya Lane", customerPhone: phone, bookingStatus: "assigned", jobTotalCents: 1 });
    const id = await task(phone, "Can we move it to Friday?", { type: "reschedule_visit", visitDate: date, newDate: addDays(date, 2), newTime: null, evidenceQuote: "move it to Friday" });
    const view = await actions.getBookingActionView(db, id);
    expect(view!.assessment!.executable).toBe(false);
    expect(view!.assessment!.manualReasons[0]).toContain("No native booking visit was found");
  });

  it("simultaneous approvals execute exactly once", async () => {
    const phone = newPhone(), date = addDays(today(), 11), newDate = addDays(today(), 15);
    const b = await booking({ phone, date, time: "13:00" }); const j = await visit(b, date, "13:00");
    const id = await task(phone, "move it please", { type: "reschedule_visit", visitDate: date, newDate, newTime: "15:00", evidenceQuote: "move it please" });
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => actions.executeBookingAction(db, id, { revision: 1, jobId: j, availabilityConfirmed: true }, ana)));
    const executed = results.filter(result => result.status === "fulfilled" && result.value.executedNow);
    expect(executed).toHaveLength(1);
    expect(results.every(result => result.status === "fulfilled")).toBe(true);
    expect((await jobOf(j)).jobDate).toBe(newDate);
    const record = (await actions.getBookingActionView(db, id))!.record;
    expect(record.history.filter(entry => entry.action === "executed")).toHaveLength(1);
  });

  it("a failure after the booking write rolls back everything (booking functions share the transaction); a retry then executes once", async () => {
    const phone = newPhone(), date = addDays(today(), 12), newDate = addDays(today(), 14);
    const b = await booking({ phone, date, time: "10:00" }); const j = await visit(b, date, "10:00");
    const id = await task(phone, "move it please", { type: "reschedule_visit", visitDate: date, newDate, newTime: "10:00", evidenceQuote: "move it please" });
    const { updateCanonicalBookingDetails } = await import("../bookingsRouter");
    await expect(actions.executeBookingAction(db, id, { revision: 1, jobId: j, availabilityConfirmed: true }, ana, {
      updateCanonicalBookingDetails: async (tx, input) => { await updateCanonicalBookingDetails(tx as any, input); throw new Error("Simulated crash after the booking write"); },
    })).rejects.toThrow("Simulated crash");
    expect(await bookingOf(b)).toMatchObject({ requestedLocalDate: date, requestedLocalTime: "10:00" });
    expect((await jobOf(j)).jobDate).toBe(date);
    const record = (await actions.getBookingActionView(db, id))!.record;
    expect(record.status).toBe("proposed");
    expect(record.history.at(-1)).toMatchObject({ action: "execution_failed", note: "Simulated crash after the booking write" });
    expect((await actions.executeBookingAction(db, id, { revision: 1, jobId: j, availabilityConfirmed: true }, ana)).executedNow).toBe(true);
    expect((await jobOf(j)).jobDate).toBe(newDate);
  });

  it("a failed verification never re-executes; verification can be retried on its own", async () => {
    const phone = newPhone(), date = addDays(today(), 10), newDate = addDays(today(), 11);
    const b = await booking({ phone, date, time: "10:00" }); const j = await visit(b, date, "10:00");
    const id = await task(phone, "move it please", { type: "reschedule_visit", visitDate: date, newDate, newTime: "12:00", evidenceQuote: "move it please" });
    await actions.executeBookingAction(db, id, { revision: 1, jobId: j, availabilityConfirmed: true }, ana);
    const elsewhere = addDays(today(), 20);
    await db.update(leadflowJobs).set({ jobDate: elsewhere }).where(eq(leadflowJobs.id, j)); // someone changes it before verification
    const failed = await actions.verifyBookingAction(db, id, ana, verifyOptions());
    expect(failed.status).toBe("verification_failed");
    expect((await taskOf(id)).items[0].completedBy).toBeNull();
    expect((await actions.executeBookingAction(db, id, { revision: 1, jobId: j, availabilityConfirmed: true }, ana)).executedNow).toBe(false);
    expect((await jobOf(j)).jobDate).toBe(elsewhere);
    await db.update(leadflowJobs).set({ jobDate: newDate }).where(eq(leadflowJobs.id, j));
    const retried = await actions.verifyBookingAction(db, id, ben, verifyOptions());
    expect(retried.status).toBe("verified"); expect(retried.verification!.attempts).toBe(2);
  });

  it("falls back to an exact re-read when the Instinct verifier can't decide (customer with several emails)", async () => {
    const phone = newPhone(), date = addDays(today(), 10), newDate = addDays(today(), 12);
    await booking({ phone, email: "other@example.com", date: addDays(today(), 40), time: "09:00" });
    const b = await booking({ phone, date, time: "10:00" }); const j = await visit(b, date, "10:00");
    const id = await task(phone, "move it please", { type: "reschedule_visit", visitDate: date, newDate, newTime: "10:00", evidenceQuote: "move it please" });
    await actions.executeBookingAction(db, id, { revision: 1, jobId: j, availabilityConfirmed: true }, ana);
    const verified = await actions.verifyBookingAction(db, id, ana, verifyOptions());
    expect(verified.status).toBe("verified");
    expect(verified.verification).toMatchObject({ method: "direct_readback" });
    expect(verified.verification!.explanation).toContain("Instinct verifier could not decide");
  });

  it("any authorized staff member can execute; confirmation sends once and closes the task in its existing format", async () => {
    const phone = newPhone(), date = addDays(today(), 10), newDate = addDays(today(), 12);
    const b = await booking({ phone, date, time: "10:00" }); const j = await visit(b, date, "10:00");
    const id = await task(phone, "move it please", { type: "reschedule_visit", visitDate: date, newDate, newTime: "10:00", evidenceQuote: "move it please" });
    const persistence = createClaudeCustomerTaskPersistence();
    await db.transaction(async tx => { const t = persistence.parseTask(await persistence.taskRow(tx, id)); t.status = "claimed"; t.owner = ben; t.claimedAt = Date.now();
      t.activity.push({ action: "claimed", actor: ben, at: Date.now(), note: null }); await persistence.saveTask(tx, t); });
    await actions.executeBookingAction(db, id, { revision: 1, jobId: j, availabilityConfirmed: true }, ana);
    expect((await taskOf(id)).owner).toEqual(ben);
    await actions.verifyBookingAction(db, id, ana, verifyOptions());
    const begun = await actions.beginBookingConfirmation(db, id, "Hi Maya, you're all set!", ana);
    expect(begun).toMatchObject({ text: "Hi Maya, you're all set!", sessionId: expect.any(Number) });
    await expect(actions.beginBookingConfirmation(db, id, "again", ana)).rejects.toThrow(/not ready/);
    const closed = await actions.finishBookingConfirmation(db, id, "sent", ana);
    expect(closed.status).toBe("closed"); expect(closed.confirmation).toMatchObject({ status: "sent", by: ana });
    const done = await taskOf(id);
    expect(done).toMatchObject({ status: "done", owner: ana, completedBy: ana });
    expect(done.completionNote).toBe("Booking change executed by Ana and verified by LeadFlow. Confirmation sent by Ana.");
    expect(done.activity.some(entry => entry.note?.startsWith("Took over from Ben"))).toBe(true);
    await expect(actions.executeBookingAction(db, id, { revision: 1, jobId: j, availabilityConfirmed: true }, ana)).resolves.toMatchObject({ executedNow: false });
  });

  it("staff set-up, edits with revision checks, and skip-confirmation; other checklist items keep the task open", async () => {
    const phone = newPhone(), date = addDays(today(), 10), newDate = addDays(today(), 12);
    const b = await booking({ phone, date, time: "10:00" }); const j = await visit(b, date, "10:00");
    const id = await task(phone, "move it and add fridge", null, [{ title: "Move the cleaning", evidenceQuote: "move it" }, { title: "Add fridge", evidenceQuote: "add fridge" }]);
    expect(await actions.getBookingActionView(db, id)).toBeNull();
    expect((await actions.taskUpcomingVisits(db, id)).map(v => v.jobId)).toContain(j);
    const setUp = await actions.setupBookingAction(db, id, { request: { type: "reschedule_visit", visitDate: date, jobId: j, newDate: null, newTime: null, evidenceQuote: null }, itemId: "item-1" }, ana);
    expect(setUp).toMatchObject({ source: "staff", revision: 1, itemId: "item-1" });
    await expect(actions.setupBookingAction(db, id, { request: setUp.request, itemId: null }, ana)).rejects.toThrow(/already has/);
    expect((await actions.getBookingActionView(db, id))!.assessment!.manualReasons).toContain("Choose the new date.");
    const edited = await actions.editBookingAction(db, id, { revision: 1, request: { ...setUp.request, newDate } }, ben);
    expect(edited.revision).toBe(2);
    await expect(actions.editBookingAction(db, id, { revision: 1, request: setUp.request }, ana)).rejects.toThrow(/edited by someone else/);
    await expect(actions.executeBookingAction(db, id, { revision: 1, jobId: j, availabilityConfirmed: true }, ana)).rejects.toThrow(/was edited/);
    await actions.executeBookingAction(db, id, { revision: 2, jobId: j, availabilityConfirmed: true }, ana);
    await actions.verifyBookingAction(db, id, ana, verifyOptions());
    const closed = await actions.finishBookingConfirmation(db, id, "skipped", ana);
    expect(closed.history.at(-1)).toMatchObject({ action: "closed", note: "Task left open: other checklist items remain." });
    const open = await taskOf(id);
    expect(open.status).toBe("claimed"); expect(open.items.map(item => Boolean(item.completedBy))).toEqual([true, false]);
  });

  it("invalid proposals are dropped silently and the task stays manual", async () => {
    const phone = newPhone();
    for (const proposal of [{ type: "reschedule_visit" }, { type: "move", visitDate: "2026-12-01", newDate: null, newTime: null, evidenceQuote: "x" },
      { type: "cancel_visit", visitDate: "2026-12-01", newDate: null, newTime: null, evidenceQuote: "not in the message" }, "garbage"]) {
      const id = await task(phone, "Please cancel", proposal);
      expect(await actions.getBookingActionView(db, id)).toBeNull();
      expect((await taskOf(id)).status).toBe("unclaimed");
    }
  });
});
