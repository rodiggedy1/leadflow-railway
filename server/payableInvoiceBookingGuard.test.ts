import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { bookingPaymentProfiles, bookings, paymentAuthorizations } from "../drizzle/schema";
import { withUnclaimedNativeFirstVisit, nativeFirstVisitOccurrenceKey, type InvoiceGuardDb } from "./payableInvoiceBookingGuard";

const mocks = vi.hoisted(() => ({ db: null as unknown, create: vi.fn(), capture: vi.fn(), sync: vi.fn() }));
vi.mock("./db", () => ({ getDb: async () => mocks.db }));
vi.mock("./_core/trpc", async () => { const { initTRPC } = await import("@trpc/server"); const t = initTRPC.create(); return { router: t.router, agentProcedure: t.procedure }; });
vi.mock("./stripeClient", () => ({ getStripeClient: () => ({ paymentIntents: { create: mocks.create, capture: mocks.capture } }) }));
vi.mock("./customerPortalService", () => ({ createCanonicalBookingPortalHandoff: vi.fn() }));
vi.mock("./bookingLifecycleService", () => ({ syncNativeBookingPaymentState: mocks.sync }));
vi.mock("./sseBroadcast", () => ({ broadcastOpsUpdate: vi.fn() }));
vi.mock("./bookingPaymentEngine", () => ({ finalizeCanonicalBooking: vi.fn(), finalizeCanonicalCardOnFile: vi.fn(), startCanonicalCardSetup: vi.fn() }));
vi.mock("./bookingPaymentVerification", () => ({ verifyCanonicalCardSetup: vi.fn() }));
import { bookingPaymentAdminRouter } from "./bookingPaymentAdminRouter";

const dialect = new MySqlDialect();
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
type Row = Record<string, any>;
function fixture() {
  const booking: Row = { id: 7, requestedLocalDate: "2026-11-09", publicBookingNumber: "LF-7", firstCleaningTotalCents: 12000, customerName: "Test", customerPhone: "+12025550123" };
  const profile: Row = { id: 19, bookingId: 7, version: 3, paymentStatus: "card_on_file", stripeCustomerId: "cus_bound", stripePaymentMethodId: "pm_bound" };
  const authorizations: Row[] = [];
  const claims = new Set<string>();
  const manual = new Set<string>();
  const events: string[] = [];
  let tail = Promise.resolve();
  let nextId = 50;
  const select = (tx?: { locked: boolean; release?: () => void }) => {
    let table: unknown; let params: unknown[] = []; let locking = false;
    const chain: any = {
      from: (value: unknown) => { table = value; return chain; },
      where: (value: any) => { params = dialect.sqlToQuery(value).params; return chain; },
      limit: () => chain, orderBy: () => chain,
      for: (value: string) => { expect(value).toBe("update"); locking = true; return chain; },
      then: async (resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) => {
        try {
          if (table === bookings && locking && tx && !tx.locked) {
            const previous = tail; const gate = deferred(); tail = gate.promise;
            await previous; tx.locked = true; tx.release = gate.resolve; events.push("booking-lock");
          }
          if (table === bookingPaymentProfiles && locking) expect(tx?.locked).toBe(true);
          const source = table === bookings ? [booking] : table === bookingPaymentProfiles ? [profile] : authorizations;
          const rows = source.filter(row => table === bookings ? row.id === params[0] : table === bookingPaymentProfiles ? row.bookingId === params[0] : row.bookingPaymentProfileId === params[0] && (!params[1] || params.slice(1).includes(row.status)));
          return resolve(rows.map(row => ({ ...row })));
        } catch (error) { return reject(error); }
      },
    }; return chain;
  };
  const update = (table: unknown) => ({ set: (values: Row) => ({ where: async (where: any) => {
    const id = dialect.sqlToQuery(where).params[0];
    const source = table === bookingPaymentProfiles ? [profile] : authorizations;
    for (const row of source.filter(row => row.id === id)) Object.assign(row, values);
    events.push("update");
    return [{ affectedRows: 1 }];
  } }) });
  const insert = (tx?: { locked: boolean; inserts: Row[] }) => (table: unknown) => ({ values: (values: Row) => ({ $returningId: async () => {
    expect(table).toBe(paymentAuthorizations); expect(tx?.locked).toBe(true);
    const id = nextId++; tx!.inserts.push({ ...values, id }); events.push("reserve"); return [{ id }];
  } }) });
  const db = {
    select: () => select(), update,
    transaction: async <T>(work: (tx: any) => Promise<T>) => {
      const state = { locked: false, release: undefined as undefined | (() => void), inserts: [] as Row[] };
      const tx = {
        select: () => select(state), update, insert: insert(state),
        execute: async (query: any) => {
          expect(state.locked).toBe(true);
          const compiled = dialect.sqlToQuery(query);
          expect(compiled.sql).toContain("FOR UPDATE");
          expect(compiled.params).toEqual(["booking:7:first:2026-11-09"]);
          const set = compiled.sql.includes("payable_invoice_manual_payments") ? manual : claims;
          events.push(set === manual ? "manual-check" : "claim-check");
          return [set.has(String(compiled.params[0])) ? [{ id: 1, invoiceId: 8 }] : [], []];
        },
      };
      try { const result = await work(tx); authorizations.push(...state.inserts); events.push("commit"); return result; }
      catch (error) { events.push("rollback"); throw error; }
      finally { state.release?.(); }
    },
  };
  mocks.db = db;
  return { db: db as unknown as InvoiceGuardDb, booking, profile, authorizations, claims, manual, events };
}
const caller = () => bookingPaymentAdminRouter.createCaller({ agent: { agentName: "Staff" } } as never);

beforeEach(() => { vi.clearAllMocks(); });
describe("native invoice collection ownership", () => {
  it("uses the exact native date, rejects invalid identity, and preserves unrelated occurrences", async () => {
    expect(nativeFirstVisitOccurrenceKey(7, "2026-11-09")).toBe("booking:7:first:2026-11-09");
    expect(() => nativeFirstVisitOccurrenceKey(0, "2026-11-09")).toThrow();
    const f = fixture(); f.claims.add("booking:8:first:2026-11-09"); f.claims.add("booking:7:first:2026-11-10");
    const work = vi.fn(async () => "ok");
    expect(await withUnclaimedNativeFirstVisit(f.db, 7, work)).toBe("ok");
    expect(f.events).toEqual(["booking-lock", "claim-check", "manual-check", "commit"]);
    expect(work).toHaveBeenCalledOnce();
  });
  it("rolls back and never reserves if an ownership read cannot be verified", async () => {
    const f = fixture(); const work = vi.fn();
    const db = { transaction: (fn: (tx: any) => Promise<unknown>) => f.db.transaction(tx => fn({ ...tx, execute: async () => { throw new Error("ownership unavailable"); } })) } as unknown as InvoiceGuardDb;
    await expect(withUnclaimedNativeFirstVisit(db, 7, work)).rejects.toThrow("ownership unavailable");
    expect(work).not.toHaveBeenCalled(); expect(f.events).toContain("rollback"); expect(f.authorizations).toHaveLength(0);
  });
  it("does not apply a different booking's profile when the native booking is missing", async () => {
    const f = fixture(); const work = vi.fn();
    await expect(withUnclaimedNativeFirstVisit(f.db, 99, work)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(work).not.toHaveBeenCalled(); expect(f.events).not.toContain("claim-check");
  });
  it.each(["placeHold", "captureHold", "chargeSavedCard"] as const)("blocks %s when its exact visit belongs to any retained invoice", async action => {
    const f = fixture(); f.claims.add("booking:7:first:2026-11-09");
    await expect(caller()[action]({ bookingId: 7, confirmed: true })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.capture).not.toHaveBeenCalled(); expect(f.authorizations).toEqual([]);
  });
  it("blocks exact staff-paid markers without changing the booking payment status", async () => {
    const f = fixture(); f.manual.add("booking:7:first:2026-11-09");
    await expect(caller().chargeSavedCard({ bookingId: 7, confirmed: true })).rejects.toThrow("already marked paid");
    expect(f.profile.paymentStatus).toBe("card_on_file"); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("holds the booking lock through the reservation callback and commits before releasing it", async () => {
    const f = fixture(); const entered = deferred(); const finish = deferred();
    const first = withUnclaimedNativeFirstVisit(f.db, 7, async () => { entered.resolve(); await finish.promise; return 1; });
    await entered.promise;
    const work = vi.fn(async () => 2); const second = withUnclaimedNativeFirstVisit(f.db, 7, work);
    await Promise.resolve(); expect(work).not.toHaveBeenCalled();
    finish.resolve(); expect(await first).toBe(1); expect(await second).toBe(2);
    expect(f.events.indexOf("commit")).toBeLessThan(f.events.lastIndexOf("booking-lock"));
  });
  it("invoice-first race: waiting collector re-reads the newly committed claim", async () => {
    const f = fixture(); const entered = deferred(); const finish = deferred();
    const issuance = f.db.transaction(async tx => { await tx.select().from(bookings).where(sql`${bookings.id} = ${7}`).limit(1).for("update"); entered.resolve(); await finish.promise; f.claims.add("booking:7:first:2026-11-09"); });
    await entered.promise;
    const collecting = caller().chargeSavedCard({ bookingId: 7, confirmed: true });
    finish.resolve(); await issuance;
    await expect(collecting).rejects.toMatchObject({ code: "CONFLICT" }); expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(["placeHold", "chargeSavedCard"] as const)("collector-first race: %s commits a pending attempt before provider and invoice checks", async action => {
    const f = fixture(); const entered = deferred(); const finish = deferred();
    mocks.create.mockImplementation(async () => { expect(f.events.at(-1)).toBe("commit"); expect(f.authorizations[0].status).toBe("pending_card"); entered.resolve(); await finish.promise; return { id: "pi_ok", status: action === "placeHold" ? "requires_capture" : "succeeded" }; });
    const collecting = caller()[action]({ bookingId: 7, confirmed: true }); await entered.promise;
    const issuance = f.db.transaction(async tx => { await tx.select().from(bookings).where(sql`${bookings.id} = ${7}`).limit(1).for("update"); const [active] = await tx.select().from(paymentAuthorizations).where(sql`${paymentAuthorizations.bookingPaymentProfileId} = ${19} AND ${paymentAuthorizations.status} IN (${"pending_card"}, ${"authorized"})`).limit(1).for("update"); if (active) throw new Error("active collection"); });
    await expect(issuance).rejects.toThrow("active collection"); finish.resolve(); await collecting;
  });
  it("direct charge retains its stable intent metadata and original Stripe arguments", async () => {
    const f = fixture(); mocks.create.mockResolvedValue({ id: "pi_ok", status: "succeeded" });
    await expect(caller().chargeSavedCard({ bookingId: 7, confirmed: true })).resolves.toEqual({ success: true, paymentStatus: "captured" });
    expect(f.authorizations).toHaveLength(1); expect(f.authorizations[0].status).toBe("captured");
    expect(JSON.parse(f.authorizations[0].notes)).toEqual({ bookingId: 7, profileId: 19, profileVersion: 3, idempotencyKey: "leadflow:booking:7:direct_charge:v3" });
    expect(mocks.create).toHaveBeenCalledWith({ amount: 12000, currency: "usd", customer: "cus_bound", payment_method: "pm_bound", confirm: true, off_session: true, description: "LeadFlow booking LF-7", metadata: { source: "leadflow_booking", bookingId: "7", bookingPaymentProfileId: "19", operation: "direct_charge", createdBy: "Staff" } }, { idempotencyKey: "leadflow:booking:7:direct_charge:v3" });
  });
  it("an unknown direct-charge outcome blocks repeats even after profile version/status changes", async () => {
    const f = fixture(); mocks.create.mockRejectedValue(new Error("timeout"));
    await expect(caller().chargeSavedCard({ bookingId: 7, confirmed: true })).rejects.toThrow("timeout");
    expect(f.authorizations[0]).toMatchObject({ operation: "direct_charge", status: "pending_card", stripePaymentIntentId: null });
    f.profile.paymentStatus = "card_on_file"; f.profile.version = 4;
    await expect(caller().chargeSavedCard({ bookingId: 7, confirmed: true })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.create).toHaveBeenCalledOnce(); expect(f.authorizations).toHaveLength(1);
  });
  it("a non-succeeded direct charge retains the actual intent and blocks another charge", async () => {
    const f = fixture(); mocks.create.mockResolvedValue({ id: "pi_action", status: "requires_action" });
    await expect(caller().chargeSavedCard({ bookingId: 7, confirmed: true })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.authorizations[0]).toMatchObject({ status: "pending_card", stripePaymentIntentId: "pi_action" });
    await expect(caller().chargeSavedCard({ bookingId: 7, confirmed: true })).rejects.toMatchObject({ code: "CONFLICT" }); expect(mocks.create).toHaveBeenCalledOnce();
  });
  it("a Stripe hold server error retains the pending reservation", async () => {
    const f = fixture(); mocks.create.mockRejectedValue(Object.assign(new Error("provider unavailable"), { statusCode: 500 }));
    await expect(caller().placeHold({ bookingId: 7, confirmed: true })).rejects.toThrow("did not confirm");
    expect(f.authorizations[0].status).toBe("pending_card");
    await expect(caller().placeHold({ bookingId: 7, confirmed: true })).rejects.toMatchObject({ code: "CONFLICT" }); expect(mocks.create).toHaveBeenCalledOnce();
  });
  it("a nonterminal hold intent retains its pending reservation and actual provider ID", async () => {
    const f = fixture(); mocks.create.mockResolvedValue({ id: "pi_processing", status: "processing" });
    await expect(caller().placeHold({ bookingId: 7, confirmed: true })).rejects.toThrow("did not authorize");
    expect(f.authorizations[0]).toMatchObject({ status: "pending_card", stripePaymentIntentId: "pi_processing" });
  });
  it("capture uses the existing hold and retains it active on ambiguous provider failure", async () => {
    const f = fixture(); f.profile.paymentStatus = "authorized";
    f.authorizations.push({ id: 40, bookingPaymentProfileId: 19, status: "authorized", stripePaymentIntentId: "pi_hold", amountCents: 10000 });
    mocks.capture.mockRejectedValue(new Error("connection lost"));
    await expect(caller().captureHold({ bookingId: 7, confirmed: true })).rejects.toThrow("connection lost");
    expect(mocks.capture).toHaveBeenCalledWith("pi_hold", { amount_to_capture: 10000 });
    expect(f.authorizations[0].status).toBe("authorized"); expect(mocks.create).not.toHaveBeenCalled();
  });
});
