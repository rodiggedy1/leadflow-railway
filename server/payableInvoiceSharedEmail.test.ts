import { readFileSync } from "node:fs";
import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { MysqlInvoiceRepository } from "./payableInvoiceRepository";
import { PayableInvoiceService } from "./payableInvoiceService";
import { invoiceReviewHash } from "./payableInvoiceReview";

// Offline fixture dispatcher only: no SQL engine, database, provider, or mutations.
// The repository, service, identity helpers, and review hashing are real.
type Row = Record<string, unknown>;
type Values = (string | number | null)[];
const PHONE = "+12025550123";
const OTHER_PHONE = "+12025550124";
const EMAIL = "billing@example.test";
const FROM = "2026-07-22";
const TO = "2026-11-07";
const ACCOUNT_PHONE = "SELECT id, customerName, customerPhone, customerEmail FROM customer_portal_accounts WHERE customerPhone = ? LIMIT 2";
const ACCOUNT_ID = "SELECT id, customerName, customerPhone, customerEmail FROM customer_portal_accounts WHERE id = ? LIMIT 1";
const GLOBAL_EMAIL = /FROM customer_portal_accounts WHERE customerEmail\s*=\s*\?/i;

function account(overrides: Row = {}): Row {
  return { id: 17, customerName: "Selected customer", customerPhone: PHONE, customerEmail: EMAIL, ...overrides };
}
function job(overrides: Row = {}): Row {
  return { id: 101, bookingId: null, jobDate: FROM, customerPhone: PHONE, customerEmail: EMAIL,
    serviceName: "Owned visit", jobAddress: "Selected address", jobTotalCents: 12_345,
    bookingStatus: "completed", missingFromLaunch27At: null, nativeId: null, nativeDate: null,
    nativePhone: null, nativeEmail: null, nativeStatus: null, nativeAmount: null,
    firstProjectionCount: 0, firstProjectionId: null, ...overrides };
}
function booking(overrides: Row = {}): Row {
  return { id: 201, requestedLocalDate: FROM, customerPhone: PHONE, customerEmail: EMAIL,
    serviceName: "Native visit", address: "Selected address", firstCleaningTotalCents: 6_789,
    status: "completed", firstProjectionCount: 0, firstProjectionId: null,
    projectionAmount: null, projectionPhone: null, projectionEmail: null,
    projectionStatus: null, projectionMissing: null, paymentStatus: "not_started", ...overrides };
}
function fixture() {
  const state = {
    accounts: [account(), account({ id: 18, customerName: "Other customer", customerPhone: OTHER_PHONE })],
    accountResult: null as Row[] | null,
    // Explicit per-phone result sets, not a simulation of SQL filtering.
    jobsByPhone: new Map<string, Row[]>([
      [PHONE, [job(), job({ id: 102, jobDate: TO })]],
      [OTHER_PHONE, [job({ id: 901, customerPhone: OTHER_PHONE })]],
    ]),
    bookingsByPhone: new Map<string, Row[]>([[PHONE, []], [OTHER_PHONE, [booking({ id: 902, customerPhone: OTHER_PHONE })]]]),
  };
  const trace: Array<{ sql: string; values: Values }> = [];
  const execute = vi.fn(async (rawSql: string, values: Values = []) => {
    const sql = rawSql.replace(/\s+/g, " ").trim();
    trace.push({ sql, values: [...values] });
    if (!sql.startsWith("SELECT ")) throw new Error("Mutation forbidden in read-only fixture");
    let result: Row[];
    if (sql === ACCOUNT_PHONE) {
      result = state.accountResult ?? state.accounts.filter(row => row.customerPhone === values[0]);
    } else if (sql === ACCOUNT_ID) {
      result = state.accountResult ?? state.accounts.filter(row => row.id === values[0]);
    } else if (GLOBAL_EMAIL.test(sql)) {
      // Both accounts share the email: the old global veto must fail this fixture.
      result = state.accounts.map(row => ({ id: row.id, customerEmail: row.customerEmail }));
    } else if (sql.startsWith("SELECT j.id, j.bookingId, j.jobDate,") && sql.includes("FROM leadflow_jobs j FORCE INDEX")) {
      expect(values).toEqual([FROM, TO, "2025550123", "12025550123"]);
      result = state.jobsByPhone.get(PHONE) ?? [];
    } else if (sql.startsWith("SELECT b.id, b.requestedLocalDate,") && sql.includes("FROM bookings b FORCE INDEX")) {
      expect(values).toEqual([PHONE, FROM, TO]);
      result = state.bookingsByPhone.get(String(values[0])) ?? [];
    } else if (sql.startsWith("SELECT id, paymentStatus FROM bookings WHERE id = ? LIMIT 1")) {
      result = [...state.bookingsByPhone.values()].flat().filter(row => row.id === values[0]);
    } else if (sql.includes("FROM booking_payment_profiles WHERE bookingId = ?") ||
               sql.includes("FROM payment_authorizations a INNER JOIN booking_payment_profiles") ||
               sql.includes("FROM booking_cash_app_payments WHERE bookingId = ?") ||
               sql.includes("FROM payable_invoice_manual_payments WHERE occurrenceKey = ?") ||
               sql.includes("FROM payable_invoice_lines l INNER JOIN payable_invoices")) {
      result = [];
    } else {
      throw new Error(`Unexpected offline query: ${sql}`);
    }
    return [result, []];
  });
  const getConnection = vi.fn(async () => { throw new Error("Transaction forbidden in lookup tests"); });
  const pool = { execute, getConnection } as unknown as Pool;
  const repo = new MysqlInvoiceRepository(async () => pool);
  return { state, trace, execute, getConnection, repo };
}
function expectReadOnly(h: ReturnType<typeof fixture>) {
  expect(h.trace.filter(({ sql }) => GLOBAL_EMAIL.test(sql))).toEqual([]);
  expect(h.trace.every(({ sql }) => sql.startsWith("SELECT "))).toBe(true);
  expect(h.getConnection).not.toHaveBeenCalled();
}
function expectIdentityConflict(service: { eligible: boolean; reason: string | null }) {
  expect(service.eligible).toBe(false);
  expect(service.reason).toBe("Customer email/phone conflict: review required.");
}

describe("shared billing email remains scoped to the exact owned account (offline)", () => {
  it("selects account 17 by exact normalized phone/email and loads only its boundary-date jobs", async () => {
    const h = fixture();
    const result = await h.repo.lookup("(202) 555-0123", " BILLING@example.test ", FROM, TO);
    expect(h.state.accounts.map(row => row.customerEmail)).toEqual([EMAIL, EMAIL]);
    expect(result.client).toMatchObject({ id: 17, phone: PHONE, email: EMAIL });
    expect(result.services.map(s => [s.id, s.date, s.eligible])).toEqual([["job:101", FROM, true], ["job:102", TO, true]]);
    expect(result.services.some(s => s.id === "job:901" || s.id.startsWith("booking:902:"))).toBe(false);
    expect(h.trace[0]).toEqual({ sql: ACCOUNT_PHONE, values: [PHONE] });
    const jobs = h.trace.find(({ sql }) => sql.includes("FROM leadflow_jobs j FORCE INDEX"))!;
    expect(jobs.sql).toContain("j.jobDate >= ? AND j.jobDate <= ?");
    expect(jobs.sql).toContain("REGEXP_REPLACE(j.customerPhone, '[^0-9]', '') IN (?, ?)");
    expect(jobs.sql).not.toMatch(/LIKE|RIGHT\s*\(/i);
    expect(jobs.values).toEqual([FROM, TO, "2025550123", "12025550123"]);
    const native = h.trace.find(({ sql }) => sql.includes("FROM bookings b FORCE INDEX"))!;
    expect(native.sql).toContain("b.customerPhone = ? AND b.requestedLocalDate >= ? AND b.requestedLocalDate <= ?");
    expect(native.values).toEqual([PHONE, FROM, TO]);
    expectReadOnly(h);
  });

  it("services(17) succeeds using the immutable account ID despite the globally shared email", async () => {
    const h = fixture();
    const result = await h.repo.services(17, FROM, TO);
    expect(h.trace[0]).toEqual({ sql: ACCOUNT_ID, values: [17] });
    expect(result.client.id).toBe(17);
    expect(result.services.map(s => s.id)).toEqual(["job:101", "job:102"]);
    expect(result.services.every(s => s.eligible)).toBe(true);
    expectReadOnly(h);
  });

  it("real service lookup returns a reviewHash matching the owned-ID reread without calling Stripe or collection", async () => {
    const h = fixture();
    const stripe = vi.fn(() => { throw new Error("Stripe must not be called for lookup"); });
    const assertCollectionReady = vi.fn(async () => { throw new Error("Collection must not run for lookup"); });
    const service = new PayableInvoiceService({ repo: h.repo, stripe, assertCollectionReady,
      origin: "https://invoice.example.test", tokenSecret: "offline-only-secret".repeat(3) });
    const reviewed = await service.lookup(PHONE, EMAIL, FROM, TO);
    const reread = await h.repo.services(reviewed.client.id, FROM, TO);
    expect(reread).toEqual({ client: reviewed.client, services: reviewed.services });
    expect(reviewed.reviewHash).toMatch(/^[a-f0-9]{64}$/);
    expect(reviewed.reviewHash).toBe(invoiceReviewHash(reread.client, reread.services, FROM, TO));
    expect(reviewed.services.map(s => s.id)).toEqual(["job:101", "job:102"]);
    expect(stripe).not.toHaveBeenCalled();
    expect(assertCollectionReady).not.toHaveBeenCalled();
    expectReadOnly(h);
  });

  it("rejects a mismatched submitted email before any service reads", async () => {
    const h = fixture();
    await expect(h.repo.lookup(PHONE, "wrong@example.test", FROM, TO)).rejects.toMatchObject({ code: "CLIENT_IDENTITY_MISMATCH" });
    expect(h.trace).toEqual([{ sql: ACCOUNT_PHONE, values: [PHONE] }]);
    expectReadOnly(h);
  });

  it("still rejects duplicate account phones even when both rows share the billing email", async () => {
    const h = fixture();
    h.state.accounts[1].customerPhone = PHONE;
    await expect(h.repo.lookup(PHONE, EMAIL, FROM, TO)).rejects.toMatchObject({ code: "CLIENT_NOT_FOUND" });
    expect(h.trace).toEqual([{ sql: ACCOUNT_PHONE, values: [PHONE] }]);
    expectReadOnly(h);
  });

  it("rejects a malicious account result with the wrong phone before service reads", async () => {
    const h = fixture();
    h.state.accountResult = [account({ customerPhone: OTHER_PHONE })];
    await expect(h.repo.lookup(PHONE, EMAIL, FROM, TO)).rejects.toMatchObject({ code: "CLIENT_IDENTITY_MISMATCH" });
    expect(h.trace).toEqual([{ sql: ACCOUNT_PHONE, values: [PHONE] }]);
    expectReadOnly(h);
  });

  it("retains wrong-phone and wrong-email job rows as ineligible, never merged into owned visits", async () => {
    const h = fixture();
    h.state.jobsByPhone.set(PHONE, [job(), job({ id: 103, customerPhone: OTHER_PHONE }), job({ id: 104, customerEmail: "wrong@example.test" })]);
    for (const result of [await h.repo.lookup(PHONE, EMAIL, FROM, TO), await h.repo.services(17, FROM, TO)]) {
      expect(result.services.map(s => s.id)).toEqual(["job:101", "job:103", "job:104"]);
      expect(result.services[0].eligible).toBe(true);
      result.services.slice(1).forEach(expectIdentityConflict);
    }
    expectReadOnly(h);
  });

  it("preserves native, linked-job and projection phone/email ownership checks instead of aliasing conflicts", async () => {
    const h = fixture();
    h.state.bookingsByPhone.set(PHONE, [
      booking({ customerPhone: OTHER_PHONE }),
      booking({ id: 202, customerEmail: "wrong@example.test" }),
      booking({ id: 203, firstProjectionId: 103, firstProjectionCount: 1, projectionAmount: 6789,
        projectionPhone: OTHER_PHONE, projectionEmail: EMAIL, projectionStatus: "completed" }),
      booking({ id: 204, firstProjectionId: 104, firstProjectionCount: 1, projectionAmount: 6789,
        projectionPhone: PHONE, projectionEmail: "wrong@example.test", projectionStatus: "completed" }),
    ]);
    h.state.jobsByPhone.set(PHONE, [job(),
      job({ id: 105, bookingId: 201, nativeId: 201, nativeDate: FROM, nativePhone: OTHER_PHONE,
        nativeEmail: EMAIL, nativeStatus: "completed", nativeAmount: 12345, firstProjectionId: 105, firstProjectionCount: 1 }),
      job({ id: 106, bookingId: 202, nativeId: 202, nativeDate: FROM, nativePhone: PHONE,
        nativeEmail: "wrong@example.test", nativeStatus: "completed", nativeAmount: 12345, firstProjectionId: 106, firstProjectionCount: 1 }),
    ]);
    const result = await h.repo.services(17, FROM, TO);
    expect(result.services.map(s => s.id)).toEqual([
      `booking:201:first:${FROM}`, `booking:202:first:${FROM}`, `booking:203:first:${FROM}`, `booking:204:first:${FROM}`,
      "job:101", "job:105", "job:106",
    ]);
    expect(result.services.find(s => s.id === "job:101")!.eligible).toBe(true);
    result.services.filter(s => s.id !== "job:101").forEach(expectIdentityConflict);
    expectReadOnly(h);
  });

  it("removes only global email queries while retaining exact-pair and owned-ID source guards", () => {
    const source = readFileSync(new URL("./payableInvoiceRepository.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(GLOBAL_EMAIL);
    expect(source).toContain(ACCOUNT_PHONE);
    expect(source).toContain(ACCOUNT_ID);
    expect(source).toContain("accounts.length !== 1");
    expect(source).toContain("client.phone !== phone || client.email !== email");
    expect(source).toContain("currentClient.phone !== client.phone || currentClient.email !== client.email");
    expect(source).toContain("j.jobDate >= ? AND j.jobDate <= ?");
    expect(source).toContain("b.customerPhone = ? AND b.requestedLocalDate >= ? AND b.requestedLocalDate <= ?");
  });
});
