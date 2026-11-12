import { createRequire } from "node:module";
import type { DatabaseSync as SQLiteDatabase } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";
import type { InvoiceClient, InvoiceExistingMarkPaidInput, PayableInvoice } from "../shared/payableInvoice";
import { MysqlInvoiceRepository } from "./payableInvoiceRepository";
import { invoiceExistingReviewHash } from "./payableInvoiceExistingReview";

// OFFLINE ONLY: real repository SQL runs through a SQLite-backed mysql2 fake.
// Index hints and FOR UPDATE are removed; this proves rollback and SQL/parameter
// contracts, NOT MySQL/TiDB locking, isolation, collation, or concurrent scheduling.
const REQUEST = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PHONE = "+12025550123", EMAIL = "owner@example.test", DATE = "2026-11-03";
type Values = Array<string | number | null>;
type Row = Record<string, unknown>;
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const openDatabases: SQLiteDatabase[] = [];
afterEach(() => { vi.restoreAllMocks(); openDatabases.splice(0).forEach(db => db.close()); });

function fixture() {
  const db = new DatabaseSync(":memory:"); openDatabases.push(db);
  db.function("REGEXP_REPLACE", (value, _pattern, replacement) => String(value ?? "").replace(/[^0-9]/g, String(replacement)));
  db.exec(`
    CREATE TABLE payable_invoices (id INTEGER PRIMARY KEY, number TEXT, accountId INTEGER, clientName TEXT, clientPhone TEXT, clientEmail TEXT, periodFrom TEXT, periodTo TEXT, dueDate TEXT, currency TEXT, status TEXT, activeAttemptId TEXT, requestId TEXT, payloadHash TEXT, reviewHash TEXT, tokenHash TEXT, tokenExpiresAt INTEGER, paidAtMs INTEGER, createdAtMs INTEGER);
    CREATE TABLE payable_invoice_lines (id INTEGER PRIMARY KEY, invoiceId INTEGER, sourceServiceId TEXT, occurrenceKey TEXT UNIQUE, serviceDate TEXT, description TEXT, address TEXT, amountCents INTEGER, paidCents INTEGER, manualPaidCents INTEGER);
    CREATE TABLE payable_invoice_manual_payments (occurrenceKey TEXT PRIMARY KEY, sourceServiceId TEXT, accountId INTEGER, serviceDate TEXT, amountCents INTEGER, requestId TEXT, payloadHash TEXT, reviewHash TEXT, recordedByAgentId INTEGER, recordedAtMs INTEGER, UNIQUE(requestId, occurrenceKey));
    CREATE TABLE payable_invoice_attempts (id TEXT PRIMARY KEY, invoiceId INTEGER, requestId TEXT, selectedLineIds TEXT, amountCents INTEGER, currency TEXT, state TEXT, sessionId TEXT, sessionUrl TEXT, paymentId TEXT, createdAtMs INTEGER, paidAtMs INTEGER, refundedCents INTEGER DEFAULT 0);
    CREATE TABLE payable_invoice_allocations (invoiceId INTEGER, attemptId TEXT, lineId INTEGER, paymentId TEXT, amountCents INTEGER, paidAtMs INTEGER);
    CREATE TABLE customer_portal_accounts (id INTEGER, customerName TEXT, customerPhone TEXT, customerEmail TEXT);
    CREATE TABLE leadflow_jobs (id INTEGER PRIMARY KEY, bookingId INTEGER, jobDate TEXT, customerPhone TEXT, customerEmail TEXT, customerName TEXT, serviceName TEXT, jobAddress TEXT, jobTotalCents INTEGER, bookingStatus TEXT, missingFromLaunch27At INTEGER);
    CREATE TABLE bookings (id INTEGER PRIMARY KEY, requestedLocalDate TEXT, customerPhone TEXT, customerEmail TEXT, customerName TEXT, serviceName TEXT, address TEXT, firstCleaningTotalCents INTEGER, status TEXT, paymentStatus TEXT);
    CREATE TABLE booking_payment_profiles (id INTEGER PRIMARY KEY, bookingId INTEGER, paymentStatus TEXT, stripePaymentIntentId TEXT, authorizedAt INTEGER, capturedAt INTEGER);
    CREATE TABLE payment_authorizations (id INTEGER PRIMARY KEY, bookingPaymentProfileId INTEGER, status TEXT, stripePaymentIntentId TEXT, authorizedAt INTEGER, capturedAt INTEGER, cancelledAt INTEGER);
    CREATE TABLE booking_cash_app_payments (id INTEGER PRIMARY KEY, bookingId INTEGER, status TEXT, stripePaymentIntentId TEXT, paidAt INTEGER);
  `);
  const insert = (table: string, row: Row) => db.prepare(`INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row) as Values);
  const read = (sql: string, values: Values = []) => db.prepare(sql).all(...values) as Row[];
  const header = (id = 42, overrides: Row = {}) => insert("payable_invoices", { id, number: `INV-${id}`, accountId: 0, clientName: "Example Owner", clientPhone: PHONE, clientEmail: EMAIL, periodFrom: "2026-11-01", periodTo: "2026-11-07", dueDate: "2026-11-20", currency: "usd", status: "open", activeAttemptId: null, requestId: OTHER, payloadHash: "a".repeat(64), reviewHash: "b".repeat(64), tokenHash: "c".repeat(64), tokenExpiresAt: 1999999999999, paidAtMs: null, createdAtMs: 100, ...overrides });
  const line = (id: number, invoiceId = 42, overrides: Row = {}) => {
    insert("payable_invoice_lines", { id, invoiceId, sourceServiceId: `job:${100 + id}`, occurrenceKey: `job:${100 + id}`, serviceDate: DATE, description: `Service ${id}`, address: "Fixture address", amountCents: 500 + id, paidCents: 0, manualPaidCents: 0, ...overrides });
    insert("leadflow_jobs", { id: 100 + id, bookingId: null, jobDate: DATE, customerPhone: PHONE, customerEmail: EMAIL, customerName: "Example Owner", serviceName: `Service ${id}`, jobAddress: "Fixture address", jobTotalCents: 500 + id, bookingStatus: "completed", missingFromLaunch27At: null });
  };
  header(); line(1); line(2);
  const trace: Array<{ sql: string; values: Values }> = [];
  let hook: ((sql: string, values: Values) => number | void) | undefined;
  let commitError = false;
  const execute = vi.fn(async (raw: string, values: Values = []) => {
    const sql = raw.replace(/\s+/g, " ").trim(); trace.push({ sql, values: [...values] });
    const affected = hook?.(sql, values);
    if (affected != null) return [{ affectedRows: affected, insertId: 0 }, []];
    const localSql = sql.replace(/ FORCE INDEX \([^)]+\)/g, "").replace(/ FOR UPDATE$/, "");
    if (sql.startsWith("SELECT")) return [db.prepare(localSql).all(...values), []];
    const result = db.prepare(localSql).run(...values);
    return [{ affectedRows: Number(result.changes), insertId: Number(result.lastInsertRowid) }, []];
  });
  const beginTransaction = vi.fn(async () => { trace.push({ sql: "BEGIN", values: [] }); db.exec("BEGIN"); });
  const commit = vi.fn(async () => { trace.push({ sql: "COMMIT", values: [] }); if (commitError) throw new Error("offline commit failure"); db.exec("COMMIT"); });
  const rollback = vi.fn(async () => { trace.push({ sql: "ROLLBACK", values: [] }); db.exec("ROLLBACK"); });
  const release = vi.fn();
  const pool = { execute, getConnection: async () => ({ execute, beginTransaction, commit, rollback, release }) } as unknown as Pool;
  const repo = new MysqlInvoiceRepository(async () => pool);
  const snapshot = () => Object.fromEntries(["payable_invoices", "payable_invoice_lines", "payable_invoice_manual_payments", "payable_invoice_allocations", "payable_invoice_attempts"].map(table => [table, read(`SELECT * FROM ${table}`)]));
  const reviewed = async (lineIds = [1], invoiceId = 42, requestId = REQUEST): Promise<InvoiceExistingMarkPaidInput> => {
    const view = await repo.adminInvoice(invoiceId);
    return { lineIds, requestId, reviewHash: invoiceExistingReviewHash(view.invoice, view.client), confirmed: true };
  };
  const writes = () => trace.filter(call => /^(INSERT|UPDATE|DELETE)/.test(call.sql));
  const stripePaid = (lineId: number, invoiceId = 42, paidCents?: number) => {
    const amount = paidCents ?? Number(read("SELECT amountCents FROM payable_invoice_lines WHERE id = ?", [lineId])[0].amountCents);
    const attempt = `paid-${lineId}`;
    insert("payable_invoice_attempts", { id: attempt, invoiceId, requestId: OTHER, selectedLineIds: JSON.stringify([lineId]), amountCents: amount, currency: "usd", state: "paid", sessionId: "cs_fixture", paymentId: `pi_fixture${lineId}`, createdAtMs: 100, paidAtMs: 200 });
    insert("payable_invoice_allocations", { invoiceId, attemptId: attempt, lineId, paymentId: `pi_fixture${lineId}`, amountCents: amount, paidAtMs: 200 });
    db.prepare("UPDATE payable_invoice_lines SET paidCents = ? WHERE id = ?").run(amount, lineId);
    const totals = read("SELECT SUM(amountCents) amount, SUM(paidCents) paid FROM payable_invoice_lines WHERE invoiceId = ?", [invoiceId])[0];
    db.prepare("UPDATE payable_invoices SET status = ?, paidAtMs = ? WHERE id = ?").run(totals.amount === totals.paid ? "paid" : "partially_paid", totals.amount === totals.paid ? 200 : null, invoiceId);
  };
  const native = (status = "not_started") => {
    const key = `booking:201:first:${DATE}`;
    db.prepare("UPDATE payable_invoice_lines SET sourceServiceId = ?, occurrenceKey = ? WHERE id = 1").run(key, key);
    db.prepare("DELETE FROM leadflow_jobs WHERE id = 101").run();
    insert("bookings", { id: 201, requestedLocalDate: DATE, customerPhone: PHONE, customerEmail: EMAIL, customerName: "Example Owner", serviceName: "Service 1", address: "Fixture address", firstCleaningTotalCents: 501, status: "completed", paymentStatus: status });
  };
  return { db, repo, trace, read, insert, header, line, snapshot, reviewed, writes, stripePaid, native, commit, rollback, release, setHook: (next: typeof hook) => { hook = next; }, failCommit: () => { commitError = true; } };
}

describe("saved-invoice manual paid: actual repository, offline transactional SQL fake", () => {
  it("marks only selected lines, atomically saves audit, preserves all immutable identities and issuance/token data", async () => {
    const h = fixture(), input = await h.reviewed();
    const before = h.snapshot(); h.trace.length = 0;
    await h.repo.markInvoicePaid(42, input, 7);
    const after = h.snapshot();
    expect(after.payable_invoices).toEqual(before.payable_invoices.map(row => ({ ...row, status: "partially_paid", paidAtMs: null })));
    expect(after.payable_invoice_lines).toEqual(before.payable_invoice_lines.map(row => row.id === 1 ? { ...row, paidCents: row.amountCents, manualPaidCents: row.amountCents } : row));
    expect(after.payable_invoice_allocations).toEqual(before.payable_invoice_allocations);
    expect(after.payable_invoice_attempts).toEqual(before.payable_invoice_attempts);
    expect(after.payable_invoice_manual_payments).toMatchObject([{ occurrenceKey: "job:101", sourceServiceId: "job:101", accountId: 0, serviceDate: DATE, amountCents: 501, requestId: REQUEST, reviewHash: input.reviewHash, recordedByAgentId: 7 }]);
    expect(String(after.payable_invoice_manual_payments[0].payloadHash)).toMatch(/^[a-f0-9]{64}$/);
    expect(h.writes()).toHaveLength(3);
    expect(h.trace[0].sql).toBe("BEGIN");
    expect(h.trace[1].sql).toMatch(/FROM payable_invoices WHERE id = \? LIMIT 1 FOR UPDATE$/);
    expect(h.trace.findIndex(call => call.sql.includes("WHERE requestId = ? ORDER BY occurrenceKey"))).toBeLessThan(h.trace.findIndex(call => call.sql.includes("FROM leadflow_jobs j")));
    expect(h.trace.findIndex(call => call.sql.startsWith("SELECT b.id, b.requestedLocalDate,"))).toBeLessThan(h.trace.findIndex(call => call.sql.startsWith("SELECT j.id, j.bookingId, j.jobDate,")));
    expect(h.trace.findIndex(call => call.sql === "SELECT invoiceId FROM payable_invoice_lines WHERE occurrenceKey = ?")).toBeLessThan(h.trace.findIndex(call => call.sql.startsWith("INSERT")));
    expect(h.trace.at(-1)?.sql).toBe("COMMIT");
  });

  it("fully pays all selected lines with one shared recorded time and one atomic header transition", async () => {
    const h = fixture(), input = await h.reviewed([2, 1]);
    await h.repo.markInvoicePaid(42, input, 7);
    const rows = h.read("SELECT * FROM payable_invoice_manual_payments ORDER BY occurrenceKey");
    expect(rows).toHaveLength(2); expect(rows[0].recordedAtMs).toBe(rows[1].recordedAtMs);
    expect(h.read("SELECT status, paidAtMs FROM payable_invoices")).toEqual([{ status: "paid", paidAtMs: rows[0].recordedAtMs }]);
    expect(h.read("SELECT paidCents, manualPaidCents FROM payable_invoice_lines ORDER BY id")).toEqual([{ paidCents: 501, manualPaidCents: 501 }, { paidCents: 502, manualPaidCents: 502 }]);
  });

  it.each(["second-line-cas", "header-cas", "ledger-count", "sql-failure", "commit-failure"])("rolls back all ledger/line/header writes on %s", async failure => {
    const h = fixture(), input = await h.reviewed([1, 2]), before = h.snapshot();
    let lines = 0;
    h.setHook(sql => {
      if (sql.startsWith("UPDATE payable_invoice_lines") && ++lines === 2 && failure === "second-line-cas") return 0;
      if (sql.startsWith("UPDATE payable_invoices SET status") && failure === "header-cas") return 0;
      if (sql.startsWith("INSERT INTO payable_invoice_manual_payments") && failure === "ledger-count") return 0;
      if (sql.startsWith("UPDATE payable_invoice_lines") && lines === 2 && failure === "sql-failure") throw new Error("offline injected failure");
    });
    if (failure === "commit-failure") h.failCommit();
    await expect(h.repo.markInvoicePaid(42, input, 7)).rejects.toThrow();
    expect(h.snapshot()).toEqual(before); expect(h.rollback).toHaveBeenCalledTimes(1);
    expect(h.release).toHaveBeenCalledTimes(2); // review transaction and failed mutation
  });

  it("replays exact UUID/selection/original hash after full payment without another write", async () => {
    const h = fixture(), input = await h.reviewed([2, 1]);
    await h.repo.markInvoicePaid(42, input, 7); const before = h.snapshot(), writes = h.writes().length;
    await h.repo.markInvoicePaid(42, { ...input, lineIds: [1, 2] }, 8);
    expect(h.snapshot()).toEqual(before); expect(h.writes()).toHaveLength(writes);
  });

  it("replays a manual subset after later unrelated Stripe payment/status/hash changes", async () => {
    const h = fixture(), input = await h.reviewed();
    await h.repo.markInvoicePaid(42, input, 7); h.stripePaid(2);
    const before = h.snapshot(), writes = h.writes().length;
    const current = await h.repo.adminInvoice(42);
    expect(current.invoice.status).toBe("paid"); expect(invoiceExistingReviewHash(current.invoice, current.client)).not.toBe(input.reviewHash);
    await h.repo.markInvoicePaid(42, input, 7);
    expect(h.snapshot()).toEqual(before); expect(h.writes()).toHaveLength(writes);
  });

  it.each(["void", "payment_review", "new-active-checkout"])("allows exact proven replay after later %s without overwriting state", async status => {
    const h = fixture(), input = await h.reviewed(); await h.repo.markInvoicePaid(42, input, 7);
    if (status === "new-active-checkout") {
      h.db.exec("UPDATE payable_invoices SET activeAttemptId = 'later' WHERE id = 42");
      h.insert("payable_invoice_attempts", { id: "later", invoiceId: 42, state: "pending" });
    } else h.db.prepare("UPDATE payable_invoices SET status = ? WHERE id = 42").run(status);
    const before = h.snapshot(), writes = h.writes().length;
    await h.repo.markInvoicePaid(42, input, 7);
    expect(h.snapshot()).toEqual(before); expect(h.writes()).toHaveLength(writes);
  });

  it("rejects a legacy ledger UUID even when the selected new invoice lines are unpaid", async () => {
    const h = fixture(), input = await h.reviewed();
    h.insert("payable_invoice_manual_payments", { occurrenceKey: "job:999", sourceServiceId: "job:999", accountId: 0, serviceDate: DATE, amountCents: 999, requestId: REQUEST, payloadHash: "e".repeat(64), reviewHash: "f".repeat(64), recordedByAgentId: 8, recordedAtMs: 99 });
    const before = h.snapshot(); await expect(h.repo.markInvoicePaid(42, input, 7)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(h.snapshot()).toEqual(before); expect(h.writes()).toHaveLength(0);
  });

  it.each(["paid-without-ledger", "partial-manual", "allocated-unpaid", "duplicate-allocation"])("uses invoiceView to reject corrupt %s before mutation", async kind => {
    const h = fixture(), input = await h.reviewed();
    if (kind === "paid-without-ledger") { h.db.exec("UPDATE payable_invoice_lines SET paidCents = 501 WHERE id = 1; UPDATE payable_invoices SET status = 'partially_paid'"); }
    if (kind === "partial-manual") h.db.exec("UPDATE payable_invoice_lines SET paidCents = 1, manualPaidCents = 1 WHERE id = 1; UPDATE payable_invoices SET status = 'partially_paid'");
    if (["allocated-unpaid", "duplicate-allocation"].includes(kind)) {
      h.stripePaid(1);
      if (kind === "allocated-unpaid") h.db.exec("UPDATE payable_invoice_lines SET paidCents = 0 WHERE id = 1; UPDATE payable_invoices SET status = 'open'");
      else h.insert("payable_invoice_allocations", { invoiceId: 42, attemptId: "paid-1", lineId: 1, paymentId: "pi_fixture1", amountCents: 501, paidAtMs: 200 });
    }
    const before = h.snapshot(); await expect(h.repo.markInvoicePaid(42, input, 7)).rejects.toMatchObject({ code: "CORRUPT_SNAPSHOT" });
    expect(h.snapshot()).toEqual(before); expect(h.writes()).toHaveLength(0);
  });

  it("rejects source ownership changing at the guarded current read, and rolls back the transaction", async () => {
    const h = fixture(), input = await h.reviewed(), before = h.snapshot();
    h.setHook(sql => { if (sql.startsWith("SELECT j.id, j.bookingId, j.jobDate,")) h.db.exec("UPDATE leadflow_jobs SET customerPhone = '+12025550999', customerEmail = 'other@example.test' WHERE id = 101"); });
    await expect(h.repo.markInvoicePaid(42, input, 7)).rejects.toMatchObject({ code: "SERVICE_REVIEW_REQUIRED" });
    expect(h.snapshot()).toEqual(before); expect(h.writes()).toHaveLength(0);
    expect(h.read("SELECT customerEmail FROM leadflow_jobs WHERE id = 101")).toEqual([{ customerEmail: EMAIL }]);
  });

  it("preserves original amount/date/source and guards them in the conditional line write", async () => {
    const h = fixture(), input = await h.reviewed(); h.trace.length = 0;
    await h.repo.markInvoicePaid(42, input, 7);
    const update = h.trace.find(call => call.sql.startsWith("UPDATE payable_invoice_lines"))!;
    expect(update.sql).toContain("WHERE invoiceId = ? AND id = ? AND paidCents = 0 AND manualPaidCents = 0 AND amountCents = ? AND sourceServiceId = ? AND occurrenceKey = ? AND serviceDate = ?");
    expect(update.values).toEqual([501, 501, 42, 1, 501, "job:101", "job:101", DATE]);
    const guardIndex = h.trace.findIndex(call => call.sql === "SELECT invoiceId FROM payable_invoice_lines WHERE occurrenceKey = ?");
    expect(guardIndex).toBeGreaterThan(0); expect(guardIndex).toBeLessThan(h.trace.findIndex(call => call.sql === update.sql));
    const header = h.trace.find(call => call.sql.startsWith("UPDATE payable_invoices SET status"))!;
    expect(header.sql).toContain("activeAttemptId IS NULL AND status IN ('open', 'partially_paid')");
  });

  it.each(["selection", "review", "invoice", "identity"])("rejects a repeated UUID with different %s", async kind => {
    const h = fixture(), input = await h.reviewed();
    await h.repo.markInvoicePaid(42, input, 7);
    let invoiceId = 42, next = input;
    if (kind === "selection") next = { ...input, lineIds: [2] };
    if (kind === "review") next = { ...input, reviewHash: "0".repeat(64) };
    if (kind === "invoice") { h.header(43); h.line(3, 43); invoiceId = 43; next = await h.reviewed([3], 43); }
    if (kind === "identity") h.db.prepare("UPDATE payable_invoices SET clientEmail = ? WHERE id = 42").run("changed@example.test");
    const before = h.snapshot();
    await expect(h.repo.markInvoicePaid(invoiceId, next, 7)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(h.snapshot()).toEqual(before);
  });

  it.each(["foreign-claim", "missing-claim", "bad-ledger-source", "bad-ledger-account", "bad-ledger-date", "bad-ledger-amount"])("never accepts replay with %s", async kind => {
    const h = fixture(), input = await h.reviewed(); await h.repo.markInvoicePaid(42, input, 7);
    if (kind === "foreign-claim") {
      h.db.prepare("UPDATE payable_invoice_lines SET invoiceId = 43 WHERE id = 1").run(); h.header(43, { status: "paid" });
      h.db.prepare("UPDATE payable_invoices SET status = 'open' WHERE id = 42").run();
    }
    if (kind === "missing-claim") { h.db.prepare("DELETE FROM payable_invoice_lines WHERE id = 1").run(); h.db.prepare("UPDATE payable_invoices SET status = 'open' WHERE id = 42").run(); }
    if (kind === "bad-ledger-source") h.db.prepare("UPDATE payable_invoice_manual_payments SET sourceServiceId = 'job:999'").run();
    if (kind === "bad-ledger-account") h.db.prepare("UPDATE payable_invoice_manual_payments SET accountId = 99").run();
    if (kind === "bad-ledger-date") h.db.prepare("UPDATE payable_invoice_manual_payments SET serviceDate = '2026-11-04'").run();
    if (kind === "bad-ledger-amount") h.db.prepare("UPDATE payable_invoice_manual_payments SET amountCents = 1").run();
    const before = h.snapshot(); await expect(h.repo.markInvoicePaid(42, input, 7)).rejects.toThrow(); expect(h.snapshot()).toEqual(before);
  });

  it("blocks another request for an already manually paid line without incrementing it", async () => {
    const h = fixture(), input = await h.reviewed(); await h.repo.markInvoicePaid(42, input, 7);
    const before = h.snapshot();
    await expect(h.repo.markInvoicePaid(42, { ...input, requestId: OTHER }, 7)).rejects.toMatchObject({ code: "BALANCE_CHANGED" });
    expect(h.snapshot()).toEqual(before);
  });

  it.each(["active", "orphan-pending", "orphan-session_open", "paid", "void", "payment_review", "stale-review"])("blocks new changes on %s", async kind => {
    const h = fixture(), input = await h.reviewed();
    if (kind === "active") h.db.prepare("UPDATE payable_invoices SET activeAttemptId = 'active' WHERE id = 42").run();
    if (kind.startsWith("orphan-")) h.insert("payable_invoice_attempts", { id: "orphan", invoiceId: 42, state: kind.slice(7) });
    if (kind === "paid") { h.stripePaid(1); h.stripePaid(2); }
    if (["void", "payment_review"].includes(kind)) h.db.prepare("UPDATE payable_invoices SET status = ? WHERE id = 42").run(kind);
    const before = h.snapshot();
    await expect(h.repo.markInvoicePaid(42, kind === "stale-review" ? { ...input, reviewHash: "0".repeat(64) } : input, 7)).rejects.toThrow();
    expect(h.snapshot()).toEqual(before); expect(h.writes()).toHaveLength(0);
  });

  it("protects selected Stripe/full/partial allocations and preserves unrelated Stripe receipts", async () => {
    const h = fixture(); h.stripePaid(2); const input = await h.reviewed([1]);
    const allocations = h.read("SELECT * FROM payable_invoice_allocations"), attempts = h.read("SELECT * FROM payable_invoice_attempts");
    await h.repo.markInvoicePaid(42, input, 7);
    expect(h.read("SELECT * FROM payable_invoice_allocations")).toEqual(allocations); expect(h.read("SELECT * FROM payable_invoice_attempts")).toEqual(attempts);
    expect((await h.repo.adminInvoice(42)).invoice.receipts).toMatchObject([{ paymentId: "pi_fixture2", amountCents: 502, lineIds: [2] }]);
    const partial = fixture(); partial.stripePaid(1, 42, 100); const current = await partial.reviewed(); const before = partial.snapshot();
    await expect(partial.repo.markInvoicePaid(42, current, 7)).rejects.toMatchObject({ code: "BALANCE_CHANGED" }); expect(partial.snapshot()).toEqual(before);
  });

  it.each(["native-captured", "cash-paid", "cash-pending", "hold-authorized", "intent-pending", "card-on-file"])("reuses the native collection policy for %s", async kind => {
    const h = fixture(); h.native(kind === "native-captured" ? "captured" : "not_started");
    if (kind.startsWith("cash-")) h.insert("booking_cash_app_payments", { id: 1, bookingId: 201, status: kind === "cash-paid" ? "paid" : "pending", paidAt: kind === "cash-paid" ? 1 : null });
    if (["hold-authorized", "intent-pending", "card-on-file"].includes(kind)) h.insert("booking_payment_profiles", { id: 1, bookingId: 201, paymentStatus: kind === "card-on-file" ? "card_on_file" : kind === "hold-authorized" ? "authorized" : "pending", stripePaymentIntentId: kind === "intent-pending" ? "pi_pending" : null, authorizedAt: kind === "hold-authorized" ? 1 : null, capturedAt: null });
    const input = await h.reviewed(), before = h.snapshot();
    if (kind === "card-on-file") {
      await h.repo.markInvoicePaid(42, input, 7); expect(h.read("SELECT manualPaidCents FROM payable_invoice_lines WHERE id = 1")).toEqual([{ manualPaidCents: 501 }]);
    } else { await expect(h.repo.markInvoicePaid(42, input, 7)).rejects.toMatchObject({ code: "SERVICE_REVIEW_REQUIRED" }); expect(h.snapshot()).toEqual(before); }
    expect(h.trace.some(call => call.sql.includes("FROM booking_cash_app_payments") && call.sql.endsWith("FOR UPDATE"))).toBe(true);
  });

  it.each(["amount", "date", "contact", "source-binding", "cancelled", "missing"])("rejects changed current source %s without changing snapshots", async kind => {
    const h = fixture(), input = await h.reviewed();
    const sql = { amount: "UPDATE leadflow_jobs SET jobTotalCents = 777 WHERE id = 101", date: "UPDATE leadflow_jobs SET jobDate = '2026-11-04' WHERE id = 101", contact: "UPDATE leadflow_jobs SET customerPhone = '+12025550999', customerEmail = 'other@example.test' WHERE id = 101", "source-binding": "UPDATE payable_invoice_lines SET sourceServiceId = 'job:999' WHERE id = 1", cancelled: "UPDATE leadflow_jobs SET bookingStatus = 'cancelled' WHERE id = 101", missing: "DELETE FROM leadflow_jobs WHERE id = 101" }[kind]!;
    h.db.exec(sql); const before = h.snapshot();
    await expect(h.repo.markInvoicePaid(42, input, 7)).rejects.toThrow(); expect(h.snapshot()).toEqual(before);
  });

  it("validates saved nonzero account/source binding through the existing guard", async () => {
    const h = fixture(); h.db.exec("UPDATE payable_invoices SET accountId = 17 WHERE id = 42");
    h.insert("customer_portal_accounts", { id: 17, customerName: "Example Owner", customerPhone: PHONE, customerEmail: EMAIL });
    const input = await h.reviewed(); await h.repo.markInvoicePaid(42, input, 7);
    expect(h.read("SELECT accountId FROM payable_invoice_manual_payments")).toEqual([{ accountId: 17 }]);
    expect(h.trace.some(call => call.sql.includes("customer_portal_accounts") && call.sql.endsWith("FOR UPDATE"))).toBe(true);
  });

  it("does not overwrite a preissuance manual ledger entry", async () => {
    const h = fixture(); h.db.exec("UPDATE payable_invoice_lines SET paidCents = amountCents, manualPaidCents = amountCents WHERE id = 1; UPDATE payable_invoices SET status = 'partially_paid'");
    h.insert("payable_invoice_manual_payments", { occurrenceKey: "job:101", sourceServiceId: "job:101", accountId: 0, serviceDate: DATE, amountCents: 501, requestId: OTHER, payloadHash: "e".repeat(64), reviewHash: "f".repeat(64), recordedByAgentId: 8, recordedAtMs: 99 });
    const input = await h.reviewed(), before = h.snapshot();
    await expect(h.repo.markInvoicePaid(42, input, 7)).rejects.toMatchObject({ code: "BALANCE_CHANGED" }); expect(h.snapshot()).toEqual(before);
  });

  it.each(["duplicate-lines", "foreign-line", "invalid-agent", "invalid-invoice", "bad-uuid", "unconfirmed"])("rejects %s safely", async kind => {
    const h = fixture(), input = await h.reviewed(); let next = input, agent = 7, invoiceId = 42;
    if (kind === "duplicate-lines") next = { ...input, lineIds: [1, 1] };
    if (kind === "foreign-line") { h.header(43); h.line(3, 43); next = { ...input, lineIds: [3] }; }
    if (kind === "invalid-agent") agent = 0;
    if (kind === "invalid-invoice") invoiceId = -1;
    if (kind === "bad-uuid") next = { ...input, requestId: "x' OR 1=1 --" };
    if (kind === "unconfirmed") next = { ...input, confirmed: false } as unknown as InvoiceExistingMarkPaidInput;
    const before = h.snapshot(), queryCount = h.trace.length;
    await expect(h.repo.markInvoicePaid(invoiceId, next, agent)).rejects.toThrow(); expect(h.snapshot()).toEqual(before);
    if (kind !== "foreign-line") expect(h.trace).toHaveLength(queryCount);
  });
});

describe("saved-invoice bounded snapshot search", () => {
  it("lists saved headers across all statuses without provider/contact secrets or per-invoice reads", async () => {
    const h = fixture(); h.header(43, { status: "void" }); h.line(3, 43); h.header(44, { status: "payment_review" }); h.line(4, 44);
    const result = await h.repo.listExisting({ search: "" });
    expect(result.invoices.map(invoice => invoice.id)).toEqual([44, 43, 42]); expect(result.nextBeforeId).toBeNull();
    expect(result.invoices[2]).toEqual({ id: 42, number: "INV-42", clientName: "Example Owner", from: "2026-11-01", to: "2026-11-07", dueDate: "2026-11-20", status: "open", amountCents: 1003, paidCents: 0, balanceCents: 1003 });
    expect(h.trace).toHaveLength(1);
    const sql = h.trace[0].sql;
    expect(sql).toContain("LEFT JOIN payable_invoice_lines l ON l.invoiceId = h.id"); expect(sql).toContain("ORDER BY i.id DESC LIMIT 51");
    expect(sql).not.toMatch(/tokenHash|sessionUrl|paymentId|customer_portal_accounts/);
    expect(JSON.stringify(result)).not.toContain(EMAIL); expect(JSON.stringify(result)).not.toContain(PHONE);
  });

  it("pages 50 headers with a sentinel cursor rather than truncating lines or doing 51 N+1 reads", async () => {
    const h = fixture();
    for (let id = 43; id <= 95; id++) { h.header(id); h.line(id, id); }
    const first = await h.repo.listExisting({ search: "" });
    expect(first.invoices).toHaveLength(50); expect(first.invoices[0].id).toBe(95); expect(first.nextBeforeId).toBe(46);
    const second = await h.repo.listExisting({ search: "", beforeId: first.nextBeforeId! });
    expect(second.invoices.map(invoice => invoice.id)).toEqual([45, 44, 43, 42]); expect(second.nextBeforeId).toBeNull(); expect(h.trace).toHaveLength(2);
    expect(h.trace[1].values).toEqual([46]); expect(h.trace[1].sql).toContain("WHERE i.id < ?");
  });

  it("searches literal name/number substrings, exact trimmed lowercase email, and full normalized phone", async () => {
    const h = fixture();
    h.db.prepare("UPDATE payable_invoices SET clientName = ?, clientEmail = ?, clientPhone = ?").run("Owner 50%_!\\ literal", " OWNER@EXAMPLE.TEST ", "(202) 555-0123");
    for (const search of ["50%_!\\", "inv-42", " owner@example.test ", "+1 (202) 555-0123"]) expect((await h.repo.listExisting({ search })).invoices.map(row => row.id)).toEqual([42]);
    for (const search of ["other@example.test", "5550123", "owner@example", "x' OR 1=1 --", "%anything"]) expect((await h.repo.listExisting({ search })).invoices).toEqual([]);
    const literal = h.trace[0]; expect(literal.values[0]).toBe("%50!%!_!!\\%"); expect(literal.sql).toContain("LIKE LOWER(?) ESCAPE '!'");
    const injection = h.trace.find(call => call.values.includes("x' or 1=1 --"))!;
    expect(injection.sql).not.toContain("x' OR"); expect(injection.sql).toContain("NULLIF(?, '')");
  });

  it.each(["no-lines", "too-many-lines", "bad-paid", "bad-manual", "huge-total", "wrong-status"])("fails visibly for corrupted or unbounded %s summaries", async kind => {
    const h = fixture();
    if (kind === "no-lines") h.db.exec("DELETE FROM payable_invoice_lines");
    if (kind === "too-many-lines") for (let id = 3; id <= 1001; id++) h.line(id);
    if (kind === "bad-paid") h.db.exec("UPDATE payable_invoice_lines SET paidCents = 99999 WHERE id = 1");
    if (kind === "bad-manual") h.db.exec("UPDATE payable_invoice_lines SET manualPaidCents = 1 WHERE id = 1");
    if (kind === "huge-total") h.db.exec("UPDATE payable_invoice_lines SET amountCents = 99999999");
    if (kind === "wrong-status") h.db.exec("UPDATE payable_invoices SET status = 'paid'");
    await expect(h.repo.listExisting({ search: "" })).rejects.toThrow(); expect(h.trace).toHaveLength(1);
  });

  it("rejects oversized search/cursor and safely defaults an empty search", async () => {
    const h = fixture(); await expect(h.repo.listExisting({ search: "x".repeat(321) })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(h.repo.listExisting({ search: "", beforeId: -1 })).rejects.toMatchObject({ code: "INVALID_REQUEST" }); expect(h.trace).toHaveLength(0);
    expect((await h.repo.listExisting({} as { search: string })).invoices).toHaveLength(1);
  });
});

describe("saved-invoice review hash", () => {
  it("is canonical across line/receipt/selection order and never mutates caller snapshots", async () => {
    const h = fixture(); h.stripePaid(1); h.stripePaid(2); const { invoice, client } = await h.repo.adminInvoice(42);
    const original = structuredClone({ invoice, client }), hash = invoiceExistingReviewHash(invoice, client);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(invoiceExistingReviewHash({ ...invoice, lines: invoice.lines.slice().reverse(), receipts: invoice.receipts.slice().reverse().map(receipt => ({ ...receipt, lineIds: receipt.lineIds.slice().reverse() })) }, client)).toBe(hash);
    expect({ invoice, client }).toEqual(original);
  });

  it("binds invoice identity, contacts, date/amount/manual/paid state, checkout ownership and receipts", async () => {
    const h = fixture(); h.stripePaid(2); const { invoice, client } = await h.repo.adminInvoice(42), hash = invoiceExistingReviewHash(invoice, client);
    const changes: Array<(i: PayableInvoice, c: InvoiceClient) => void> = [
      i => { i.id++; }, i => { i.number += "x"; }, i => { i.clientId++; }, i => { i.clientName += "x"; },
      i => { i.from = "2026-11-02"; }, i => { i.to = "2026-11-08"; }, i => { i.dueDate = "2026-11-21"; },
      i => { i.status = "payment_review"; }, i => { i.activeAttemptId = REQUEST; },
      (_i, c) => { c.phone = "+12025550999"; }, (_i, c) => { c.email = "changed@example.test"; }, (_i, c) => { c.name += "x"; },
      i => { i.lines[0].id++; }, i => { i.lines[0].occurrenceKey = "job:999"; }, i => { i.lines[0].date = "2026-11-04"; },
      i => { i.lines[0].amountCents++; }, i => { i.lines[0].paidCents++; }, i => { i.lines[0].manualPaidCents = 501; },
      i => { i.receipts[0].paymentId += "x"; }, i => { i.receipts[0].amountCents++; }, i => { i.receipts[0].refundedCents = 1; },
      i => { i.receipts[0].paidAt = "2026-11-04T00:00:00Z"; }, i => { i.receipts[0].lineIds = [1]; },
    ];
    for (const change of changes) { const next = structuredClone({ invoice, client }); change(next.invoice, next.client); expect(invoiceExistingReviewHash(next.invoice, next.client)).not.toBe(hash); }
  });
});
