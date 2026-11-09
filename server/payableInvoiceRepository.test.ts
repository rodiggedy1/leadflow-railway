import { createHash } from "node:crypto";
import { invoiceReviewHash } from "./payableInvoiceReview";
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";
import { MysqlInvoiceRepository } from "./payableInvoiceRepository";

// OFFLINE ONLY: execute() dispatches fixture rows by query; it is not a SQL engine.
// These are mocked transaction contracts, not proof of actual MySQL/TiDB behavior.
// The actual repository and phone/domain helpers are never mocked.
type FakeRow = Record<string, unknown>;
type Values = (string | number | null)[];
const REQUEST = "11111111-1111-4111-8111-111111111111";
const ATTEMPT = "33333333-3333-4333-8333-333333333333";
const LATER_ATTEMPT = "44444444-4444-4444-8444-444444444444";
const PHONE = "+12025550123";
const EMAIL = "owner@example.test";
const FROM = "2026-11-01";
const TO = "2026-11-07";
const SESSION = "cs_test_owned";
const URL = "https://checkout.stripe.com/c/pay/test_owned";
const NOW = Date.parse("2026-11-08T12:00:00Z");

function accountRow(overrides: FakeRow = {}): FakeRow {
  return { id: 17, customerName: "Example owner", customerPhone: PHONE, customerEmail: EMAIL, ...overrides };
}
function invoiceRow(overrides: FakeRow = {}): FakeRow {
  return { id: 42, number: "TEST-42", accountId: 17, clientName: "Example owner", clientPhone: PHONE, clientEmail: EMAIL, periodFrom: FROM, periodTo: TO,
    dueDate: "2026-11-20", currency: "usd", status: "open", activeAttemptId: null, requestId: REQUEST,
    payloadHash: "b".repeat(64), tokenHash: "a".repeat(64), tokenExpiresAt: NOW + 90 * 86_400_000, ...overrides };
}
function attemptRow(overrides: FakeRow = {}): FakeRow {
  return { id: ATTEMPT, invoiceId: 42, requestId: REQUEST, selectedLineIds: "[1]", amountCents: 12_345,
    currency: "usd", state: "session_open", sessionId: SESSION, sessionUrl: URL, paymentId: null,
    createdAtMs: NOW, paidAtMs: null, ...overrides };
}
function lineRow(): FakeRow {
  return { id: 1, occurrenceKey: "job:101", serviceDate: "2026-11-02", description: "Example service",
    address: "Example address", amountCents: 12_345, paidCents: 0 };
}
function jobRow(overrides: FakeRow = {}): FakeRow {
  return { id: 101, bookingId: null, jobDate: "2026-11-02", customerPhone: PHONE, customerEmail: EMAIL,
    serviceName: "Example service", jobAddress: "Example address", jobTotalCents: 12_345,
    bookingStatus: "completed", missingFromLaunch27At: null, nativeId: null, nativeDate: null,
    nativePhone: null, nativeEmail: null, nativeStatus: null, nativeAmount: null, firstProjectionCount: 0, firstProjectionId: null, ...overrides };
}
function bookingRow(overrides: FakeRow = {}): FakeRow {
  return { id: 201, requestedLocalDate: "2026-11-03", customerPhone: PHONE, customerEmail: EMAIL,
    serviceName: "Example service", address: "Example address", firstCleaningTotalCents: 6_789,
    status: "completed", firstProjectionId: null, projectionPhone: null, projectionEmail: null,
    projectionStatus: null, projectionMissing: null, firstProjectionCount: 0, projectionAmount: null, paymentStatus: "not_started", ...overrides };
}

function fakeSql() {
  const state = {
    accounts: [accountRow()], emailAccounts: [{ id: 17, customerEmail: EMAIL }] as FakeRow[],
    jobs: [jobRow()] as FakeRow[], bookings: [] as FakeRow[], invoices: [invoiceRow()],
    attempts: [] as FakeRow[], lines: [lineRow()], allocations: [] as FakeRow[],
    issuedProjection: [] as FakeRow[], profiles: [] as FakeRow[], authorizations: [] as FakeRow[], cashApp: [] as FakeRow[], manual: [] as FakeRow[], claims: [{ invoiceId: 42, occurrenceKey: "job:101" }] as FakeRow[],
    commitError: null as Error | null,
  };
  const trace: string[] = [];
  const execute = vi.fn(async (rawSql: string, values: Values = []) => {
    const sql = rawSql.replace(/\s+/g, " ").trim();
    trace.push(sql);
    let result: FakeRow[] | { affectedRows: number; insertId: number };
    if (sql === "SELECT id, customerName, customerPhone, customerEmail FROM customer_portal_accounts WHERE customerPhone = ? LIMIT 2" ||
        sql === "SELECT id, customerName, customerPhone, customerEmail FROM customer_portal_accounts WHERE id = ? LIMIT 1" ||
        sql === "SELECT id, customerName, customerPhone, customerEmail FROM customer_portal_accounts WHERE id = ? LIMIT 1 FOR UPDATE") {
      result = state.accounts;
    } else if (sql === "SELECT id, customerEmail FROM customer_portal_accounts WHERE customerEmail = ? LIMIT 2") {
      result = state.emailAccounts;
    } else if (sql.startsWith("SELECT j.id, j.bookingId, j.jobDate,") && sql.includes("FROM leadflow_jobs j FORCE INDEX")) {
      result = state.jobs;
    } else if (sql.startsWith("SELECT b.id, b.requestedLocalDate,") && sql.includes("FROM bookings b FORCE INDEX")) {
      result = state.bookings;
    } else if (/^SELECT id, paymentStatus FROM bookings WHERE id = \? LIMIT 1(?: FOR UPDATE)?$/.test(sql)) {
      result = state.bookings.filter(row => row.id === values[0]).map(row => ({ id: row.id, paymentStatus: row.paymentStatus }));
    } else if (sql.startsWith("SELECT id, bookingId, paymentStatus, stripePaymentIntentId, authorizedAt, capturedAt FROM booking_payment_profiles WHERE bookingId = ? ORDER BY id")) {
      result = state.profiles.filter(row => row.bookingId === values[0]);
    } else if (sql.startsWith("SELECT a.id, a.status,") && sql.includes("WHERE p.bookingId = ? ORDER BY a.id")) {
      result = state.authorizations.filter(row => state.profiles.some(p => p.id === row.bookingPaymentProfileId && p.bookingId === values[0]));
    } else if (sql.startsWith("SELECT id, status, stripePaymentIntentId, paidAt FROM booking_cash_app_payments WHERE bookingId = ? ORDER BY id")) {
      result = state.cashApp.filter(row => row.bookingId === values[0]);
    } else if (sql.startsWith("SELECT occurrenceKey, sourceServiceId,") && sql.includes("FROM payable_invoice_manual_payments WHERE occurrenceKey = ?")) {
      result = state.manual.filter(row => row.occurrenceKey === values[0]);
    } else if (sql === "SELECT occurrenceKey, payloadHash FROM payable_invoice_manual_payments WHERE requestId = ? ORDER BY occurrenceKey FOR UPDATE") {
      result = state.manual.filter(row => row.requestId === values[0]).sort((a,b) => String(a.occurrenceKey).localeCompare(String(b.occurrenceKey)));
    } else if (sql.startsWith("SELECT l.sourceServiceId, l.serviceDate,") && sql.includes("WHERE l.occurrenceKey = ?")) {
      result = state.issuedProjection.filter(row => row.occurrenceKey === values[0]);
    } else if (sql === "SELECT invoiceId FROM payable_invoice_lines WHERE occurrenceKey = ?") {
      result = state.claims.filter(row => row.occurrenceKey === values[0]);
    } else if (sql.startsWith("INSERT INTO payable_invoice_manual_payments (")) {
      const columns = ["occurrenceKey", "sourceServiceId", "accountId", "serviceDate", "amountCents", "requestId", "payloadHash", "reviewHash", "recordedByAgentId", "recordedAtMs"];
      state.manual.push(Object.fromEntries(columns.map((col, i) => [col, values[i]])));
      result = { affectedRows: 1, insertId: 0 };
    } else if (sql === "SELECT id FROM payable_invoices WHERE requestId = ? LIMIT 1") {
      result = state.invoices.filter(row => row.requestId === values[0]).map(row => ({ id: row.id }));
    } else if (sql.startsWith("SELECT id, number, accountId,") && sql.endsWith("FROM payable_invoices WHERE id = ? LIMIT 1")) {
      result = state.invoices.filter(row => row.id === values[0]);
    } else if (sql.startsWith("INSERT INTO payable_invoices (")) {
      const cols = ["number", "accountId", "clientName", "clientPhone", "clientEmail", "periodFrom", "periodTo", "dueDate", "status", "requestId", "payloadHash", "tokenHash", "tokenExpiresAt", "createdAtMs", "paidAtMs"];
      state.invoices.push({ id: 42, currency: "usd", activeAttemptId: null, ...Object.fromEntries(cols.map((col,i) => [col, values[i]])) });
      result = { affectedRows: 1, insertId: 42 };
    } else if (sql.startsWith("INSERT INTO payable_invoice_lines (")) {
      const cols = ["invoiceId", "sourceServiceId", "occurrenceKey", "serviceDate", "description", "address", "amountCents", "paidCents", "manualPaidCents"];
      state.lines.push({ id: state.lines.length + 1, ...Object.fromEntries(cols.map((col,i) => [col, values[i]])) });
      result = { affectedRows: 1, insertId: state.lines.length };
    } else if (sql === "SELECT invoiceId FROM payable_invoice_attempts WHERE id = ? LIMIT 1") {
      result = state.attempts.filter(row => row.id === values[0]).map(row => ({ invoiceId: row.invoiceId }));
    } else if (sql.startsWith("SELECT id, number, accountId,") && sql.includes("FROM payable_invoices WHERE tokenHash = ? AND tokenExpiresAt > ? LIMIT 1 FOR UPDATE")) {
      result = state.invoices.filter(row => row.tokenHash === values[0] && Number(row.tokenExpiresAt) > Number(values[1]));
    } else if (sql === "SELECT id FROM payable_invoice_attempts WHERE paymentId = ? LIMIT 1") {
      result = state.attempts.filter(row => row.paymentId === values[0]).map(row => ({ id: row.id }));
    } else if (sql.startsWith("UPDATE payable_invoice_attempts SET refundedCents = ?")) {
      const matching = state.attempts.find(row => row.id === values[1] && row.invoiceId === values[2] && row.paymentId === values[3]);
      if (matching) matching.refundedCents = values[0];
      result = { affectedRows: matching ? 1 : 0, insertId: 0 };
    } else if (sql === "UPDATE payable_invoices SET status = 'payment_review', paidAtMs = NULL WHERE id = ?") {
      const matching = state.invoices.find(row => row.id === values[0]);
      if (matching) { matching.status = "payment_review"; matching.paidAtMs = null; }
      result = { affectedRows: matching ? 1 : 0, insertId: 0 };
    } else if (sql.startsWith("SELECT id, number, accountId,") && sql.includes("FROM payable_invoices WHERE id = ? LIMIT 1 FOR UPDATE")) {
      result = state.invoices.filter(row => row.id === values[0]);
    } else if (sql.startsWith("SELECT id, invoiceId, requestId, selectedLineIds,") && sql.includes("FROM payable_invoice_attempts")) {
      if (sql.endsWith("WHERE invoiceId = ? AND requestId = ? LIMIT 1 FOR UPDATE")) {
        result = state.attempts.filter(row => row.invoiceId === values[0] && row.requestId === values[1]);
      } else if (sql.endsWith("WHERE id = ? LIMIT 1 FOR UPDATE")) {
        result = state.attempts.filter(row => row.id === values[0]);
      } else {
        throw new Error(`Unexpected attempt read: ${sql}`);
      }
    } else if (sql === "SELECT id, occurrenceKey, serviceDate, description, address, amountCents, paidCents, manualPaidCents FROM payable_invoice_lines WHERE invoiceId = ? ORDER BY serviceDate, id LIMIT 1001 FOR UPDATE") {
      result = state.lines;
    } else if (sql === "SELECT a.attemptId, a.lineId, a.paymentId, a.amountCents, a.paidAtMs, t.refundedCents FROM payable_invoice_allocations a INNER JOIN payable_invoice_attempts t ON t.id = a.attemptId AND t.invoiceId = a.invoiceId WHERE a.invoiceId = ? ORDER BY a.paidAtMs, a.attemptId, a.lineId LIMIT 1001 FOR UPDATE") {
      result = state.allocations;
    } else if (sql === "INSERT INTO payable_invoice_attempts (id, invoiceId, requestId, selectedLineIds, amountCents, currency, state, createdAtMs) VALUES (?, ?, ?, ?, ?, 'usd', 'pending', ?)") {
      result = { affectedRows: 1, insertId: 0 };
    } else if (sql === "UPDATE payable_invoices SET activeAttemptId = ? WHERE id = ? AND activeAttemptId IS NULL AND status IN ('open', 'partially_paid')") {
      result = { affectedRows: 1, insertId: 0 };
    } else if (sql === "UPDATE payable_invoices SET activeAttemptId = NULL WHERE id = ? AND activeAttemptId = ?") {
      // One narrowly parameterized CAS spy, not general SQL execution/transactions.
      const matching = state.invoices.find(row => row.id === values[0] && row.activeAttemptId === values[1]);
      if (matching) matching.activeAttemptId = null;
      result = { affectedRows: matching ? 1 : 0, insertId: 0 };
    } else {
      throw new Error(`Unexpected fake query: ${sql}`);
    }
    return [result, []];
  });
  const beginTransaction = vi.fn(async () => { trace.push("BEGIN"); });
  const commit = vi.fn(async () => { trace.push("COMMIT"); if (state.commitError) throw state.commitError; });
  const rollback = vi.fn(async () => { trace.push("ROLLBACK"); });
  const release = vi.fn(() => { trace.push("RELEASE"); });
  const connection = { execute, beginTransaction, commit, rollback, release };
  const getConnection = vi.fn(async () => connection);
  const pool = { execute, getConnection } as unknown as Pool;
  const poolFactory = vi.fn(async () => pool);
  const repo = new MysqlInvoiceRepository(poolFactory);
  const mutations = () => execute.mock.calls.filter(([sql]) => /^(UPDATE|INSERT|DELETE)\b/.test(sql));
  return { state, trace, execute, beginTransaction, commit, rollback, release, getConnection, poolFactory, repo, mutations };
}

function expectRolledBack(h: ReturnType<typeof fakeSql>) {
  expect(h.commit).not.toHaveBeenCalled();
  expect(h.rollback).toHaveBeenCalledTimes(1);
  expect(h.release).toHaveBeenCalledTimes(1);
  expect(h.trace.slice(-2)).toEqual(["ROLLBACK", "RELEASE"]);
}

describe("MysqlInvoiceRepository offline mocked transaction contracts", () => {
  it("uses exact normalized account phone/email and full US digit source predicates, not suffix matching", async () => {
    const h = fakeSql();
    expect(h.poolFactory).not.toHaveBeenCalled();
    h.state.jobs = [jobRow({ customerPhone: "(202) 555-0123", customerEmail: " OWNER@example.test " })];
    const result = await h.repo.lookup("(202) 555-0123", " OWNER@example.test ", FROM, TO);
    expect(result.client).toMatchObject({ id: 17, phone: PHONE, email: EMAIL });
    expect(result.services).toMatchObject([{ id: "job:101", eligible: true, amountCents: 12_345 }]);
    expect(h.execute.mock.calls[0]).toEqual([
      "SELECT id, customerName, customerPhone, customerEmail FROM customer_portal_accounts WHERE customerPhone = ? LIMIT 2", [PHONE],
    ]);
    expect(h.execute.mock.calls[1][1]).toEqual([EMAIL]);
    const [sql, params] = h.execute.mock.calls[2];
    expect(sql).toContain("FROM leadflow_jobs j FORCE INDEX");
    expect(sql).toContain("REGEXP_REPLACE(j.customerPhone, '[^0-9]', '') IN (?, ?)");
    expect(sql).not.toMatch(/LIKE|RIGHT\s*\(/i);
    expect(params).toEqual([FROM, TO, "2025550123", "12025550123"]);
    expect(h.execute.mock.calls[3][1]).toEqual([PHONE, FROM, TO]);
    expect(h.getConnection).not.toHaveBeenCalled();
    expect(h.mutations()).toEqual([]);
  });

  it("rejects wrong or ambiguous phone/email ownership before reading service sources", async () => {
    const cases: Array<{ accounts?: FakeRow[]; emailAccounts?: FakeRow[]; email?: string; code: string }> = [
      { accounts: [accountRow({ customerPhone: "+12025550124" })], code: "CLIENT_IDENTITY_MISMATCH" },
      { email: "other@example.test", code: "CLIENT_IDENTITY_MISMATCH" },
      { accounts: [accountRow(), accountRow({ id: 18 })], code: "CLIENT_NOT_FOUND" },
      { emailAccounts: [{ id: 18, customerEmail: EMAIL }], code: "CLIENT_IDENTITY_MISMATCH" },
      { emailAccounts: [{ id: 17, customerEmail: "collation-conflict@example.test" }], code: "CLIENT_IDENTITY_MISMATCH" },
    ];
    for (const fixture of cases) {
      const h = fakeSql();
      if (fixture.accounts) h.state.accounts = fixture.accounts;
      if (fixture.emailAccounts) h.state.emailAccounts = fixture.emailAccounts;
      await expect(h.repo.lookup(PHONE, fixture.email ?? EMAIL, FROM, TO)).rejects.toMatchObject({ code: fixture.code });
      expect(h.execute.mock.calls.every(([sql]) => sql.includes("FROM customer_portal_accounts"))).toBe(true);
      expect(h.mutations()).toEqual([]);
    }
  });

  it("rejects an oversized source period explicitly rather than silently omitting historical jobs", async () => {
    const h = fakeSql();
    h.state.jobs = Array.from({ length: 1001 }, (_, i) => jobRow({ id: i + 1 }));
    await expect(h.repo.services(17, FROM, TO)).rejects.toMatchObject({ code: "PERIOD_TOO_LARGE" });
    expect(h.execute.mock.calls[2][0]).toContain("LIMIT 1001");
    expect(h.mutations()).toEqual([]);
  });

  it("rejects an oversized native period explicitly rather than silently omitting bookings", async () => {
    const h = fakeSql();
    h.state.jobs = [];
    h.state.bookings = Array.from({ length: 1001 }, (_, i) => bookingRow({ id: i + 1 }));
    await expect(h.repo.services(17, FROM, TO)).rejects.toMatchObject({ code: "PERIOD_TOO_LARGE" });
    expect(h.execute.mock.calls[3][0]).toContain("LIMIT 1001");
    expect(h.mutations()).toEqual([]);
  });

  it("marks conflicting linked-job and native-projection ownership ineligible, including dangling links", async () => {
    const h = fakeSql();
    h.state.jobs = [
      jobRow({ bookingId: 201, nativeId: 201, nativeDate: "2026-11-01", nativePhone: PHONE,
        nativeEmail: "other@example.test", nativeStatus: "completed", firstProjectionId: 99 }),
      jobRow({ id: 102, bookingId: 999 }),
    ];
    h.state.bookings = [bookingRow({ firstProjectionId: 103, projectionAmount: 6789, firstProjectionCount: 1, projectionPhone: "+12025550124",
      projectionEmail: EMAIL, projectionStatus: "completed" })];
    const result = await h.repo.services(17, FROM, TO);
    expect(result.services).toHaveLength(3);
    expect(result.services.map(row => row.id).sort()).toEqual(["booking:201:first:2026-11-03", "job:101", "job:102"]);
    for (const row of result.services) {
      expect(row.eligible).toBe(false);
      expect(row.reason).toBe("Customer email/phone conflict: review required.");
    }
    expect(h.mutations()).toEqual([]);
  });

  it("locks the invoice before the attempt and uses a canonical selection plus invoice-level CAS", async () => {
    const h = fakeSql();
    const result = await h.repo.reserve(42, REQUEST, [1]);
    expect(h.trace[0]).toBe("BEGIN");
    expect(h.execute.mock.calls[0][0]).toMatch(/FROM payable_invoices WHERE id = \? LIMIT 1 FOR UPDATE$/);
    expect(h.execute.mock.calls[0][1]).toEqual([42]);
    expect(h.execute.mock.calls[1][0]).toMatch(/FROM payable_invoice_attempts WHERE invoiceId = \? AND requestId = \? LIMIT 1 FOR UPDATE$/);
    expect(result).toMatchObject({ invoiceId: 42, requestId: REQUEST, lineIds: [1], amountCents: 12_345, state: "pending" });
    const [insert, cas] = h.mutations();
    expect(insert[1]).toEqual([result.id, 42, REQUEST, "[1]", 12_345, result.createdAt]);
    expect(cas[0]).toContain("activeAttemptId IS NULL AND status IN ('open', 'partially_paid')");
    expect(cas[1]).toEqual([result.id, 42]);
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.rollback).not.toHaveBeenCalled();
    expect(h.trace.slice(-2)).toEqual(["COMMIT", "RELEASE"]);
  });

  it("rejects a competing invoice-level reservation before balance reads or attempt inserts", async () => {
    const h = fakeSql();
    h.state.invoices[0].activeAttemptId = LATER_ATTEMPT;
    await expect(h.repo.reserve(42, REQUEST, [1])).rejects.toMatchObject({ code: "CHECKOUT_IN_PROGRESS" });
    expect(h.execute).toHaveBeenCalledTimes(2);
    expect(h.mutations()).toEqual([]);
    expectRolledBack(h);
  });

  it("returns immutable paid UUID replay before balance reads even on a fully paid invoice", async () => {
    const h = fakeSql();
    h.state.invoices = [invoiceRow({ status: "paid" })];
    h.state.attempts = [attemptRow({ state: "paid", paymentId: "pi_test_owned", paidAtMs: NOW })];
    h.state.lines = []; // Any balance read would be corrupt and must not happen.
    expect(await h.repo.reserve(42, REQUEST, [1])).toMatchObject({ id: ATTEMPT, state: "paid", amountCents: 12_345 });
    expect(h.execute).toHaveBeenCalledTimes(2);
    expect(h.execute.mock.calls.some(([sql]) => sql.includes("FROM payable_invoice_lines"))).toBe(false);
    expect(h.mutations()).toEqual([]);
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it("propagates commit failure and invokes rollback then release after attempted writes", async () => {
    const h = fakeSql();
    const failure = new Error("TEST ONLY commit failed");
    h.state.commitError = failure;
    await expect(h.repo.reserve(42, REQUEST, [1])).rejects.toBe(failure);
    expect(h.mutations()).toHaveLength(2);
    expect(h.beginTransaction).toHaveBeenCalledTimes(1);
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.rollback).toHaveBeenCalledTimes(1);
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.trace.slice(-3)).toEqual(["COMMIT", "ROLLBACK", "RELEASE"]);
  });

  it("rejects attachment to a different stored session ID without mutation and locks invoice first", async () => {
    const h = fakeSql();
    h.state.invoices[0].activeAttemptId = ATTEMPT;
    h.state.attempts = [attemptRow()];
    const before = structuredClone(h.state.attempts);
    await expect(h.repo.attachSession(ATTEMPT, "cs_test_wrong", URL)).rejects.toMatchObject({ code: "PAYMENT_IDENTITY_MISMATCH" });
    expect(h.execute.mock.calls[0]).toEqual(["SELECT invoiceId FROM payable_invoice_attempts WHERE id = ? LIMIT 1", [ATTEMPT]]);
    expect(h.execute.mock.calls[1][0]).toMatch(/FROM payable_invoices.*FOR UPDATE$/);
    expect(h.execute.mock.calls[2][0]).toMatch(/FROM payable_invoice_attempts.*FOR UPDATE$/);
    expect(h.state.attempts).toEqual(before);
    expect(h.mutations()).toEqual([]);
    expectRolledBack(h);
  });

  it("rejects expiration of a paid attempt without changing the payment or reservation", async () => {
    const h = fakeSql();
    h.state.invoices[0].activeAttemptId = LATER_ATTEMPT;
    h.state.attempts = [attemptRow({ state: "paid", paymentId: "pi_test_owned", paidAtMs: NOW })];
    await expect(h.repo.expire(ATTEMPT, SESSION)).rejects.toMatchObject({ code: "ALREADY_PAID" });
    expect(h.state.invoices[0].activeAttemptId).toBe(LATER_ATTEMPT);
    expect(h.state.attempts[0].state).toBe("paid");
    expect(h.mutations()).toEqual([]);
    expectRolledBack(h);
  });

  it("uses the old attempt ID CAS on stale expired replay and never clears a later reservation", async () => {
    const h = fakeSql();
    h.state.invoices[0].activeAttemptId = LATER_ATTEMPT;
    h.state.attempts = [attemptRow({ state: "expired" })];
    await h.repo.expire(ATTEMPT, SESSION);
    await h.repo.expire(ATTEMPT, SESSION);
    expect(h.mutations()).toEqual([
      ["UPDATE payable_invoices SET activeAttemptId = NULL WHERE id = ? AND activeAttemptId = ?", [42, ATTEMPT]],
      ["UPDATE payable_invoices SET activeAttemptId = NULL WHERE id = ? AND activeAttemptId = ?", [42, ATTEMPT]],
    ]);
    expect(h.state.invoices[0].activeAttemptId).toBe(LATER_ATTEMPT);
    expect(h.state.attempts[0].state).toBe("expired");
    expect(h.commit).toHaveBeenCalledTimes(2);
    expect(h.rollback).not.toHaveBeenCalled();
    expect(h.release).toHaveBeenCalledTimes(2);
  });
});


describe("existing collection and manual already-paid repository guarantees", () => {
  it.each(["captured", "charge_pending", "authorized", "capture_pending"])("makes an exact native %s payment ineligible", async paymentStatus => {
    const h = fakeSql(); h.state.jobs = []; h.state.bookings = [bookingRow()];
    h.state.profiles = [{ id: 301, bookingId: 201, paymentStatus }];
    const result = await h.repo.services(17, FROM, TO);
    expect(result.services[0].eligible).toBe(false);
    expect(result.services[0].reason).toMatch(/already/);
    if (paymentStatus === "captured") expect(result.services[0]).toMatchObject({ paidCents: 6789, paymentSource: "stripe" });
    expect(h.mutations()).toEqual([]);
  });
  it("reads native holds by exact profile ID and does not match a different booking or fuzzy label", async () => {
    const h = fakeSql(); h.state.jobs = []; h.state.bookings = [bookingRow()];
    h.state.profiles = [{ id: 301, bookingId: 201, paymentStatus: "card_on_file" }];
    h.state.authorizations = [{ id: 401, bookingPaymentProfileId: 999, status: "captured", jobLabel: "Example service" }];
    expect((await h.repo.services(17, FROM, TO)).services[0].eligible).toBe(true);
    h.state.authorizations.push({ id: 402, bookingPaymentProfileId: 301, status: "pending_card" });
    expect((await h.repo.services(17, FROM, TO)).services[0].eligible).toBe(false);
    const sql = h.execute.mock.calls.find(([sql]) => sql.includes("FROM payment_authorizations"))![0];
    expect(sql).toContain("p.id = a.bookingPaymentProfileId"); expect(sql).not.toMatch(/jobLabel|customerPhone/);
  });
  it("rejects paid or unresolved Cash App records for the exact booking", async () => {
    for (const status of ["paid", "pending"]) {
      const h = fakeSql(); h.state.jobs = []; h.state.bookings = [bookingRow()];
      h.state.cashApp = [{ id: 501, bookingId: 201, status, stripePaymentIntentId: "pi_cash" }];
      expect((await h.repo.services(17, FROM, TO)).services[0].eligible).toBe(false);
    }
  });
  it("recognizes its own occurrence claim at checkout but rejects another invoice", async () => {
    const h = fakeSql();
    await h.repo.assertCollectionReady({ id: 42, clientId: 17 } as never);
    expect(h.commit).toHaveBeenCalledTimes(1);
    h.state.claims[0].invoiceId = 99;
    await expect(h.repo.assertCollectionReady({ id: 42, clientId: 17 } as never)).rejects.toMatchObject({ code: "SOURCE_ALREADY_INVOICED" });
  });
  it("rejects checkout after a service amount changes using transaction-current source reads", async () => {
    const h = fakeSql(); h.state.jobs = [jobRow({ jobTotalCents: 20000 })];
    await expect(h.repo.reserve(42, REQUEST, [1])).rejects.toMatchObject({ code: "SERVICE_REVIEW_REQUIRED" });
    expect(h.mutations()).toEqual([]); expectRolledBack(h);
    expect(h.execute.mock.calls.find(([sql]) => sql.includes("FROM leadflow_jobs j FORCE INDEX"))![0]).toMatch(/FOR UPDATE$/);
  });
  it("retains and blocks every ambiguous first-date projection rather than choosing one", async () => {
    const h = fakeSql();
    h.state.bookings = [bookingRow({ firstProjectionId: 101, firstProjectionCount: 2, projectionAmount: 6789, projectionPhone: PHONE, projectionEmail: EMAIL, projectionStatus: "completed" })];
    h.state.jobs = [101,102].map(id => jobRow({ id, bookingId: 201, nativeId: 201, nativeDate: "2026-11-03", jobDate: "2026-11-03", nativePhone: PHONE, nativeEmail: EMAIL, nativeStatus: "completed", nativeAmount: 6789, jobTotalCents: 6789, firstProjectionId: 101, firstProjectionCount: 2 }));
    const services = (await h.repo.services(17, FROM, TO)).services;
    expect(services).toHaveLength(3); expect(services.every(s => !s.eligible)).toBe(true);
    expect(services.map(s => s.id).sort()).toEqual(["booking:201:first:2026-11-03", "job:101", "job:102"]);
  });
  it("unifies one verified first service but preserves distinct later visits", async () => {
    const h = fakeSql();
    h.state.bookings = [bookingRow({ firstProjectionId: 101, firstProjectionCount: 1, projectionAmount: 6789, projectionPhone: PHONE, projectionEmail: EMAIL, projectionStatus: "completed" })];
    h.state.jobs = [jobRow({ bookingId: 201, nativeId: 201, nativeDate: "2026-11-03", jobDate: "2026-11-03", nativePhone: PHONE, nativeEmail: EMAIL, nativeStatus: "completed", nativeAmount: 6789, jobTotalCents: 6789, firstProjectionId: 101, firstProjectionCount: 1 }), jobRow({ id: 102, bookingId: 201, nativeId: 201, nativeDate: "2026-11-03", jobDate: "2026-11-04", nativePhone: PHONE, nativeEmail: EMAIL, nativeStatus: "completed" })];
    expect((await h.repo.services(17, FROM, TO)).services.map(s => s.id)).toEqual(["booking:201:first:2026-11-03", "job:102"]);
  });
  it("records explicit manual paid atomically, replays the same request and never overwrites a claim", async () => {
    const h = fakeSql(); h.state.claims = [];
    const before = await h.repo.services(17, FROM, TO);
    const reviewHash = invoiceReviewHash(before.client, before.services, FROM, TO);
    const input = { clientId: 17, from: FROM, to: TO, serviceIds: ["job:101"], requestId: REQUEST, reviewHash };
    await h.repo.markAlreadyPaid(input, 8);
    const marked = await h.repo.services(17, FROM, TO);
    expect(marked.services[0]).toMatchObject({ eligible: true, paidCents: 12345, paymentSource: "manual" });
    expect(h.state.manual[0]).toMatchObject({ occurrenceKey: "job:101", accountId: 17, recordedByAgentId: 8, reviewHash });
    await h.repo.markAlreadyPaid(input, 8);
    expect((await h.repo.services(17, FROM, TO)).services[0].paidCents).toBe(12345);
    expect(h.mutations().filter(([sql]) => sql.startsWith("INSERT INTO payable_invoice_manual_payments"))).toHaveLength(1);
    await expect(h.repo.markAlreadyPaid({ ...input, requestId: LATER_ATTEMPT }, 8)).rejects.toMatchObject({ code: "MANUAL_PAYMENT_CONFLICT" });
  });
  it("rejects a stale manual review and source already claimed by an invoice", async () => {
    const h = fakeSql(); h.state.claims = [];
    const input = { clientId: 17, from: FROM, to: TO, serviceIds: ["job:101"], requestId: REQUEST, reviewHash: "a".repeat(64) };
    await expect(h.repo.markAlreadyPaid(input, 8)).rejects.toMatchObject({ code: "REVIEW_CHANGED" });
    expect(h.mutations()).toEqual([]);
    h.state.claims = [{ invoiceId: 42, occurrenceKey: "job:101" }];
    await expect(h.repo.markAlreadyPaid(input, 8)).rejects.toMatchObject({ code: "SOURCE_ALREADY_INVOICED" });
  });
  it("includes manual-paid invoice lines without fabricating Stripe receipts", async () => {
    const h = fakeSql(); h.state.invoices[0].status = "paid";
    h.state.lines[0].paidCents = 12345; h.state.lines[0].manualPaidCents = 12345;
    const invoice = await h.repo.adminById(42);
    expect(invoice!.lines[0]).toMatchObject({ paidCents: 12345, manualPaidCents: 12345 });
    expect(invoice!.receipts).toEqual([]);
    await expect(h.repo.reserve(42, REQUEST, [1])).rejects.toMatchObject({ code: "BALANCE_CHANGED" });
  });
  it("keeps refund evidence monotonic and preserves all allocations/occurrence claims", async () => {
    const h = fakeSql(); h.state.attempts = [attemptRow({ state: "paid", paymentId: "pi_owned", paidAtMs: NOW, refundedCents: 0 })];
    const retainedLines = structuredClone(h.state.lines), retainedClaims = structuredClone(h.state.claims);
    await h.repo.recordAdjustment("pi_owned", 3000);
    await h.repo.recordAdjustment("pi_owned", 1000);
    expect(h.state.attempts[0].refundedCents).toBe(3000); expect(h.state.invoices[0].status).toBe("payment_review");
    expect(h.state.lines).toEqual(retainedLines); expect(h.state.claims).toEqual(retainedClaims);
    await expect(h.repo.recordAdjustment("pi_owned", 12346)).rejects.toMatchObject({ code: "PAYMENT_IDENTITY_MISMATCH" });
  });
  it("uses a current locking read for public token views and allocation receipts", async () => {
    const h = fakeSql(); h.state.invoices[0].tokenExpiresAt = Date.now() + 100000;
    expect((await h.repo.byToken("a".repeat(64)))!.id).toBe(42);
    expect(h.execute.mock.calls[0][0]).toMatch(/tokenHash = .*FOR UPDATE$/);
    expect(h.execute.mock.calls.find(([sql]) => sql.includes("FROM payable_invoice_allocations"))![0]).toMatch(/FOR UPDATE$/);
  });
});


describe("atomic reviewed invoice issuance", () => {
  async function fixture(manual = false) {
    const h = fakeSql(); h.state.invoices = []; h.state.lines = []; h.state.claims = [];
    if (manual) h.state.manual = [{ occurrenceKey: "job:101", sourceServiceId: "job:101", accountId: 17, serviceDate: "2026-11-02", amountCents: 12345, requestId: LATER_ATTEMPT }];
    const lookup = await h.repo.services(17, FROM, TO);
    const input = { requestId: REQUEST, clientId: 17, from: FROM, to: TO, serviceIds: ["job:101"], confirmedUnpaid: true as const, dueDate: "2026-11-20", reviewHash: invoiceReviewHash(lookup.client, lookup.services, FROM, TO) };
    const payload = createHash("sha256").update(JSON.stringify({ clientId: 17, from: FROM, to: TO, dueDate: input.dueDate, services: lookup.services.map(s => [s.occurrenceKey, s.date, s.amountCents, s.paidCents ?? 0]) })).digest("hex");
    return { h, input, lookup, payload };
  }
  it("issues only after current source validation inside the write transaction", async () => {
    const { h, input, lookup, payload } = await fixture();
    const issued = await h.repo.issue(input, lookup.client, lookup.services, "a".repeat(64), payload);
    expect(issued).toMatchObject({ id: 42, status: "open" }); expect(issued.lines[0].paidCents).toBe(0);
    const firstWrite = h.trace.findIndex(sql => sql.startsWith("INSERT INTO payable_invoices"));
    expect(h.trace.slice(0, firstWrite).some(sql => sql.includes("FROM leadflow_jobs j FORCE INDEX") && sql.endsWith("FOR UPDATE"))).toBe(true);
    expect(h.trace.slice(-2)).toEqual(["COMMIT", "RELEASE"]);
  });
  it("snapshots pre-marked manual paid services as paid with no invented receipt", async () => {
    const { h, input, lookup, payload } = await fixture(true);
    const issued = await h.repo.issue(input, lookup.client, lookup.services, "a".repeat(64), payload);
    expect(issued.status).toBe("paid"); expect(issued.lines[0]).toMatchObject({ paidCents: 12345, manualPaidCents: 12345 });
    expect(issued.receipts).toEqual([]); expect(h.state.invoices[0].paidAtMs).toEqual(expect.any(Number));
  });
  it("rejects stale reviewed amount atomically before inserting the invoice", async () => {
    const { h, input, lookup, payload } = await fixture(); h.state.jobs[0].jobTotalCents = 12346;
    await expect(h.repo.issue(input, lookup.client, lookup.services, "a".repeat(64), payload)).rejects.toMatchObject({ code: "REVIEW_CHANGED" });
    expect(h.mutations()).toEqual([]); expectRolledBack(h);
  });
});


describe("retained invoice paid source projection", () => {
  it("shows a paid service as paid from its exact retained invoice claim", async () => {
    const h = fakeSql();
    h.state.issuedProjection = [{ occurrenceKey: "job:101", sourceServiceId: "job:101", serviceDate: "2026-11-02", amountCents: 12345, paidCents: 12345, manualPaidCents: 0, accountId: 17, status: "paid" }];
    expect((await h.repo.services(17, FROM, TO)).services[0]).toMatchObject({ paidCents: 12345, paymentSource: "stripe", eligible: false, reason: "Already paid on the existing invoice." });
  });
  it("allows an existing invoice to collect its own unpaid claim", async () => {
    const h = fakeSql();
    h.state.issuedProjection = [{ occurrenceKey: "job:101", sourceServiceId: "job:101", serviceDate: "2026-11-02", amountCents: 12345, paidCents: 0, manualPaidCents: 0, accountId: 17, status: "open" }];
    expect((await h.repo.services(17, FROM, TO)).services[0].eligible).toBe(false);
    expect(await h.repo.reserve(42, REQUEST, [1])).toMatchObject({ amountCents: 12345, state: "pending" });
  });
  it("rejects a retained claim assigned to another customer instead of guessing identity", async () => {
    const h = fakeSql();
    h.state.issuedProjection = [{ occurrenceKey: "job:101", sourceServiceId: "job:101", serviceDate: "2026-11-02", amountCents: 12345, paidCents: 0, accountId: 18, status: "open" }];
    await expect(h.repo.services(17, FROM, TO)).rejects.toMatchObject({ code: "INVALID_SNAPSHOT" });
  });
});
