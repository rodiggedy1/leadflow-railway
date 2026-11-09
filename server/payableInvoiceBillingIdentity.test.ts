import { createHash } from "node:crypto";
import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import type { InvoiceService } from "../shared/payableInvoice";
import { MysqlInvoiceRepository } from "./payableInvoiceRepository";
import { invoiceReviewHash } from "./payableInvoiceReview";

// OFFLINE mock, NOT SQL-engine evidence: this dispatcher recognizes the old and
// new predicates and FILTERS synthetic candidates accordingly. It cannot prove
// MySQL index use, collation, locking, or isolation. Repository/helpers are real;
// no DB, network, providers, application startup, or environment configuration.
type Row = Record<string, unknown>;
type Values = (string | number | null)[];
type Kind = "job" | "booking";
const PHONE = "+12025550100";
const OTHER_PHONE = "+12025550199";
const EMAIL = "billing@example.test";
const FROM = "2026-10-01";
const TO = "2026-10-31";
const DATE = "2026-10-13";
const REQUEST = "11111111-1111-4111-8111-111111111111";
const email = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
const digits = (value: unknown) => String(value ?? "").replace(/[^0-9]/g, "");
const idFor = (kind: Kind) => kind === "job" ? "job:101" : `booking:201:first:${DATE}`;
function job(overrides: Row = {}): Row {
  return { id: 101, bookingId: null, jobDate: DATE, customerPhone: PHONE, customerEmail: EMAIL,
    serviceName: "Synthetic service", jobAddress: "Synthetic address", jobTotalCents: 23000,
    bookingStatus: "completed", missingFromLaunch27At: null, ...overrides };
}
function booking(overrides: Row = {}): Row {
  return { id: 201, requestedLocalDate: DATE, customerPhone: PHONE, customerEmail: EMAIL,
    serviceName: "Synthetic service", address: "Synthetic address", firstCleaningTotalCents: 23000,
    status: "completed", paymentStatus: "not_started", ...overrides };
}
function identityPredicate(alias: string): string {
  return `(LOWER(TRIM(${alias}.customerEmail)) = ? OR (COALESCE(TRIM(${alias}.customerEmail), '') = '' AND REGEXP_REPLACE(${alias}.customerPhone, '[^0-9]', '') IN (?, ?)))`;
}
function filtered(candidates: Row[], kind: Kind, sql: string, values: Values): Row[] {
  const alias = kind === "job" ? "j" : "b";
  const dateColumn = kind === "job" ? "jobDate" : "requestedLocalDate";
  const modern = sql.includes(identityPredicate(alias));
  const legacy = kind === "job"
    ? sql.includes("AND REGEXP_REPLACE(j.customerPhone, '[^0-9]', '') IN (?, ?)")
    : sql.includes("WHERE b.customerPhone = ? AND b.requestedLocalDate >= ? AND b.requestedLocalDate <= ?");
  if (!modern && !legacy) throw new Error(`Unrecognized source predicate: ${sql}`);
  const [from, to] = !modern && kind === "booking" ? values.slice(1, 3) : values;
  return candidates.filter(row => {
    if (String(row[dateColumn]) < String(from) || String(row[dateColumn]) > String(to)) return false;
    if (modern) return email(row.customerEmail) === values[2] ||
      (!email(row.customerEmail) && values.slice(3, 5).includes(digits(row.customerPhone)));
    return kind === "job" ? values.slice(2, 4).includes(digits(row.customerPhone)) : row.customerPhone === values[0];
  }).sort((a, b) => Number(a.id) - Number(b.id)).slice(0, 1001);
}
function fixture(kind: Kind = "job") {
  const state = {
    accounts: [{ id: 17, customerName: "Synthetic billing client", customerPhone: PHONE, customerEmail: EMAIL }] as Row[],
    jobs: kind === "job" ? [job()] : [] as Row[], bookings: kind === "booking" ? [booking()] : [] as Row[],
    invoices: [] as Row[], lines: [] as Row[],
  };
  const trace: Array<{ sql: string; values: Values }> = [];
  const projections = (b: Row) => state.jobs.filter(j => j.bookingId === b.id && j.jobDate === b.requestedLocalDate).sort((a, c) => Number(a.id) - Number(c.id));
  const execute = vi.fn(async (raw: string, values: Values = []) => {
    const sql = raw.replace(/\s+/g, " ").trim();
    trace.push({ sql, values: [...values] });
    let result: Row[] | { affectedRows: number; insertId: number };
    if (sql.includes("FROM customer_portal_accounts WHERE")) {
      result = state.accounts.filter(a => sql.includes("WHERE customerPhone = ?") ? a.customerPhone === values[0] : a.id === values[0]);
    } else if (sql.startsWith("SELECT j.id,") && sql.includes("FROM leadflow_jobs j FORCE INDEX")) {
      result = filtered(state.jobs, "job", sql, values).map(j => {
        const b = state.bookings.find(b => b.id === j.bookingId);
        const p = b ? projections(b) : [];
        return { ...j, nativeId: b?.id ?? null, nativeDate: b?.requestedLocalDate ?? null,
          nativePhone: b?.customerPhone ?? null, nativeEmail: b?.customerEmail ?? null,
          nativeStatus: b?.status ?? null, nativeAmount: b?.firstCleaningTotalCents ?? null,
          firstProjectionCount: p.length, firstProjectionId: p[0]?.id ?? null };
      });
    } else if (sql.startsWith("SELECT b.id,") && sql.includes("FROM bookings b FORCE INDEX")) {
      result = filtered(state.bookings, "booking", sql, values).map(b => {
        const p = projections(b);
        return { ...b, firstProjectionCount: p.length, firstProjectionId: p[0]?.id ?? null,
          projectionAmount: p[0]?.jobTotalCents ?? null, projectionPhone: p[0]?.customerPhone ?? null,
          projectionEmail: p[0]?.customerEmail ?? null, projectionStatus: p[0]?.bookingStatus ?? null,
          projectionMissing: p[0]?.missingFromLaunch27At ?? null };
      });
    } else if (sql.startsWith("SELECT id, paymentStatus FROM bookings WHERE id = ?")) {
      result = state.bookings.filter(b => b.id === values[0]);
    } else if (sql.includes("FROM booking_payment_profiles WHERE bookingId = ?") ||
      sql.includes("FROM payment_authorizations a INNER JOIN booking_payment_profiles") ||
      sql.includes("FROM booking_cash_app_payments WHERE bookingId = ?") ||
      sql.includes("FROM payable_invoice_manual_payments WHERE occurrenceKey = ?") ||
      sql.includes("FROM payable_invoice_allocations") || sql.includes("FROM payable_invoice_attempts WHERE")) {
      result = [];
    } else if (sql.startsWith("SELECT l.sourceServiceId,")) {
      result = state.lines.filter(l => l.occurrenceKey === values[0]).map(l => ({ ...l,
        accountId: state.invoices.find(i => i.id === l.invoiceId)?.accountId,
        status: state.invoices.find(i => i.id === l.invoiceId)?.status }));
    } else if (sql === "SELECT invoiceId FROM payable_invoice_lines WHERE occurrenceKey = ?") {
      result = state.lines.filter(l => l.occurrenceKey === values[0]);
    } else if (sql.includes("FROM payable_invoice_lines WHERE invoiceId = ?")) {
      result = state.lines.filter(l => l.invoiceId === values[0]);
    } else if (sql.includes("FROM payable_invoices WHERE")) {
      result = state.invoices.filter(i => sql.includes("WHERE requestId = ?") ? i.requestId === values[0] : i.id === values[0]);
    } else if (sql.startsWith("INSERT INTO payable_invoices (")) {
      const columns = ["number", "accountId", "clientName", "clientPhone", "clientEmail", "periodFrom", "periodTo", "dueDate", "status", "requestId", "payloadHash", "reviewHash", "tokenHash", "tokenExpiresAt", "createdAtMs", "paidAtMs"];
      state.invoices.push({ id: 42, currency: "usd", activeAttemptId: null, ...Object.fromEntries(columns.map((c, i) => [c, values[i]])) });
      result = { affectedRows: 1, insertId: 42 };
    } else if (sql.startsWith("INSERT INTO payable_invoice_lines (")) {
      const columns = ["invoiceId", "sourceServiceId", "occurrenceKey", "serviceDate", "description", "address", "amountCents", "paidCents", "manualPaidCents"];
      state.lines.push({ id: state.lines.length + 1, ...Object.fromEntries(columns.map((c, i) => [c, values[i]])) });
      result = { affectedRows: 1, insertId: state.lines.length };
    } else if (sql.startsWith("INSERT INTO payable_invoice_attempts (")) {
      result = { affectedRows: 1, insertId: 0 };
    } else if (sql.startsWith("UPDATE payable_invoices SET activeAttemptId = ?")) {
      const i = state.invoices.find(i => i.id === values[1] && i.activeAttemptId == null);
      if (i) i.activeAttemptId = values[0];
      result = { affectedRows: i ? 1 : 0, insertId: 0 };
    } else throw new Error(`Unexpected offline query: ${sql}`);
    return [result, []];
  });
  // Transaction call spies, not an emulation of database locks or rollback.
  const beginTransaction = vi.fn(async () => {}), commit = vi.fn(async () => {}), rollback = vi.fn(async () => {}), release = vi.fn();
  const getConnection = vi.fn(async () => ({ execute, beginTransaction, commit, rollback, release }));
  const pool = { execute, getConnection } as unknown as Pool;
  const repo = new MysqlInvoiceRepository(async () => pool);
  const source = () => (kind === "job" ? state.jobs : state.bookings)[0];
  const writes = () => trace.filter(t => /^(INSERT|UPDATE|DELETE)\b/.test(t.sql));
  function retain(s: InvoiceService) {
    state.invoices.push({ id: 42, number: "SYNTHETIC-42", accountId: 17, clientName: "Synthetic billing client",
      clientPhone: PHONE, clientEmail: EMAIL, periodFrom: FROM, periodTo: TO, dueDate: "2026-11-20",
      currency: "usd", status: "open", activeAttemptId: null, requestId: REQUEST });
    state.lines.push({ id: 1, invoiceId: 42, sourceServiceId: s.id, occurrenceKey: s.occurrenceKey,
      serviceDate: s.date, description: s.description, address: s.address, amountCents: s.amountCents, paidCents: 0, manualPaidCents: 0 });
  }
  return { state, trace, repo, source, writes, retain, getConnection, beginTransaction, commit, rollback, release };
}
function expectRolledBack(h: ReturnType<typeof fixture>) {
  expect(h.beginTransaction).toHaveBeenCalledTimes(1);
  expect(h.rollback).toHaveBeenCalledTimes(1);
  expect(h.commit).not.toHaveBeenCalled();
  expect(h.release).toHaveBeenCalledTimes(1);
  expect(h.writes()).toEqual([]);
}
async function reviewed(h: ReturnType<typeof fixture>) {
  const lookup = await h.repo.services(17, FROM, TO);
  expect(lookup.services).toHaveLength(1);
  expect(lookup.services[0].eligible).toBe(true);
  const input = { requestId: REQUEST, clientId: 17, from: FROM, to: TO, dueDate: "2026-11-20",
    serviceIds: lookup.services.map(s => s.id), confirmedUnpaid: true as const,
    reviewHash: invoiceReviewHash(lookup.client, lookup.services, FROM, TO) };
  const payload = createHash("sha256").update(JSON.stringify({ clientId: 17, from: FROM, to: TO,
    dueDate: input.dueDate, services: lookup.services.map(s => [s.occurrenceKey, s.date, s.amountCents, s.paidCents ?? 0]) })).digest("hex");
  return { lookup, input, payload };
}

describe("billing identity correction — real repository, offline filtering SQL mock", () => {
  it("captures both inclusive date-index-bounded email OR (no-email AND full-phone) predicates and values", async () => {
    const h = fixture();
    await h.repo.lookup("(202) 555-0100", " BILLING@example.test ", FROM, TO);
    expect(h.trace[0]).toEqual({ sql: "SELECT id, customerName, customerPhone, customerEmail FROM customer_portal_accounts WHERE customerPhone = ? LIMIT 2", values: [PHONE] });
    for (const [alias, table, index, date] of [["j", "leadflow_jobs", "idx_leadflow_jobs_job_date", "jobDate"], ["b", "bookings", "idx_bookings_requested_date", "requestedLocalDate"]]) {
      const query = h.trace.find(t => t.sql.includes(`FROM ${table} ${alias} FORCE INDEX`))!;
      expect(query.sql).toContain(`FORCE INDEX (${index})`);
      expect(query.sql).toContain(`WHERE ${alias}.${date} >= ? AND ${alias}.${date} <= ? AND ${identityPredicate(alias)}`);
      expect(query.values).toEqual([FROM, TO, EMAIL, "2025550100", "12025550100"]);
      expect(query.sql).toContain("LIMIT 1001");
      expect(query.sql).not.toMatch(/\bLIKE\b|RIGHT\s*\(|customerName\s*=/i);
    }
    expect(h.writes()).toEqual([]);
    expect(h.getConnection).not.toHaveBeenCalled();
  });

  it.each(["job", "booking"] as const)("%s: Oct 13 exact-email/different-phone 23000 appears without collapsing distinct 17000/23000 IDs", async kind => {
    const h = fixture(kind);
    if (kind === "job") h.state.jobs = [job({ id: 101, jobTotalCents: 17000 }), job({ id: 102, customerPhone: OTHER_PHONE })];
    else h.state.bookings = [booking({ id: 201, firstCleaningTotalCents: 17000 }), booking({ id: 202, customerPhone: OTHER_PHONE })];
    const lookup = await h.repo.lookup(PHONE, EMAIL, FROM, TO);
    const reread = await h.repo.services(17, FROM, TO);
    expect(reread).toEqual(lookup);
    expect(lookup.services.map(s => [s.id, s.date, s.amountCents, s.eligible])).toEqual(kind === "job"
      ? [["job:101", DATE, 17000, true], ["job:102", DATE, 23000, true]]
      : [[`booking:201:first:${DATE}`, DATE, 17000, true], [`booking:202:first:${DATE}`, DATE, 23000, true]]);
  });

  describe.each(["job", "booking"] as const)("%s identity parity", kind => {
    it.each([OTHER_PHONE, null, "", "not-a-phone"])("normalizes billing email and owns the service regardless of phone %s", async phone => {
      const h = fixture(kind);
      h.state.accounts[0].customerEmail = " BILLING@EXAMPLE.TEST ";
      Object.assign(h.source(), { customerPhone: phone, customerEmail: "  BiLLing@Example.Test  " });
      expect((await h.repo.lookup(PHONE, " BILLING@example.test ", FROM, TO)).services).toMatchObject([{ id: idFor(kind), eligible: true }]);
    });
    it.each([null, "", "   "])("email %s falls back only to the exact full normalized US phone", async absent => {
      for (const phone of [PHONE, "2025550100", "(202) 555-0100", "1 (202) 555-0100"]) {
        const h = fixture(kind);
        Object.assign(h.source(), { customerPhone: phone, customerEmail: absent });
        expect((await h.repo.services(17, FROM, TO)).services).toMatchObject([{ id: idFor(kind), eligible: true }]);
      }
    });
    it("filters conflicting nonempty emails, no-email wrong phones, suffix impostors, and outside-period candidates", async () => {
      const h = fixture(kind);
      const make = kind === "job" ? job : booking;
      const dateKey = kind === "job" ? "jobDate" : "requestedLocalDate";
      const candidates = [make({ id: 101, [dateKey]: FROM }), make({ id: 102, [dateKey]: TO }),
        make({ id: 103, customerEmail: "other@example.test" }), make({ id: 104, customerPhone: OTHER_PHONE, customerEmail: null }),
        make({ id: 105, customerPhone: OTHER_PHONE, customerEmail: "   " }),
        make({ id: 106, customerPhone: "+442025550100", customerEmail: "" }),
        make({ id: 107, [dateKey]: "2026-09-30", customerPhone: OTHER_PHONE }),
        make({ id: 108, [dateKey]: "2026-11-01", customerPhone: OTHER_PHONE })];
      if (kind === "job") h.state.jobs = candidates; else h.state.bookings = candidates;
      const services = (await h.repo.services(17, FROM, TO)).services;
      expect(services.map(s => [s.date, s.eligible])).toEqual([[FROM, true], [TO, true]]);
      expect(services.map(s => s.id)).toEqual(kind === "job" ? ["job:101", "job:102"] : [`booking:101:first:${FROM}`, `booking:102:first:${TO}`]);
    });
    it("rejects a stale service email at checkout before reserving any payment", async () => {
      const h = fixture(kind);
      const before = await reviewed(h);
      h.retain(before.lookup.services[0]);
      h.source().customerEmail = "conflict@example.test"; // phone still matches
      await expect(h.repo.reserve(42, REQUEST, [1])).rejects.toMatchObject({ code: "SERVICE_REVIEW_REQUIRED" });
      expectRolledBack(h);
    });
    it("allows checkout rechecks when the billing email stays the same but the service phone changes", async () => {
      const h = fixture(kind);
      const before = await reviewed(h);
      h.retain(before.lookup.services[0]);
      h.source().customerPhone = OTHER_PHONE;
      expect(await h.repo.reserve(42, REQUEST, [1])).toMatchObject({ invoiceId: 42, amountCents: 23000, state: "pending" });
      expect(h.commit).toHaveBeenCalledTimes(1);
      expect(h.rollback).not.toHaveBeenCalled();
      const sourceReads = h.trace.filter(t => /FROM (leadflow_jobs j|bookings b) FORCE INDEX/.test(t.sql) && t.sql.endsWith("FOR UPDATE"));
      expect(sourceReads).toHaveLength(2);
      expect(sourceReads[0].sql).toContain("FROM bookings b FORCE INDEX");
      expect(h.writes()).toHaveLength(2);
    });
    it("rejects a stale nonempty email during issuance's transaction-current reread", async () => {
      const h = fixture(kind);
      const { lookup, input, payload } = await reviewed(h);
      h.source().customerEmail = "different@example.test";
      await expect(h.repo.issue(input, lookup.client, lookup.services, "a".repeat(64), payload)).rejects.toMatchObject({ code: "REVIEW_CHANGED" });
      expectRolledBack(h);
    });
    it("issues the reviewed stable service after a phone-only change with the same billing email", async () => {
      const h = fixture(kind);
      const { lookup, input, payload } = await reviewed(h);
      h.source().customerPhone = OTHER_PHONE;
      const issued = await h.repo.issue(input, lookup.client, lookup.services, "a".repeat(64), payload);
      expect(issued.lines).toMatchObject([{ occurrenceKey: idFor(kind), date: DATE, amountCents: 23000, paidCents: 0 }]);
      expect(h.commit).toHaveBeenCalledTimes(1);
      expect(h.rollback).not.toHaveBeenCalled();
    });
  });

  it.each([[PHONE, "wrong@example.test", "CLIENT_IDENTITY_MISMATCH"], [OTHER_PHONE, EMAIL, "CLIENT_NOT_FOUND"]])("still requires the exact selected account phone/email pair (%s, %s)", async (phone, address, code) => {
    const h = fixture();
    await expect(h.repo.lookup(phone, address, FROM, TO)).rejects.toMatchObject({ code });
    expect(h.trace).toHaveLength(1);
    expect(h.writes()).toEqual([]);
  });

  it("merges only one trusted same-date native projection despite differing service phones", async () => {
    const h = fixture();
    h.state.bookings = [booking({ customerPhone: OTHER_PHONE })];
    h.state.jobs = [job({ bookingId: 201, customerPhone: null }), job({ id: 102, bookingId: 201, jobDate: "2026-10-14", customerPhone: OTHER_PHONE, jobTotalCents: 17000 })];
    expect((await h.repo.services(17, FROM, TO)).services.map(s => [s.id, s.amountCents, s.eligible])).toEqual([
      [`booking:201:first:${DATE}`, 23000, true], ["job:102", 17000, true],
    ]);
  });
  it.each([{ customerEmail: "conflict@example.test" }, { customerEmail: " ", customerPhone: OTHER_PHONE }])("real JS postcheck blocks an untrusted joined projection (%j), even though SQL selects its owned booking", async conflict => {
    const h = fixture();
    h.state.bookings = [booking()];
    h.state.jobs = [job({ bookingId: 201, ...conflict })];
    const services = (await h.repo.services(17, FROM, TO)).services;
    expect(services).toHaveLength(1);
    expect(services[0]).toMatchObject({ id: `booking:201:first:${DATE}`, eligible: false, reason: "Customer email/phone conflict: review required." });
  });
  it("real JS postcheck rejects an owned-email job linked to a conflicting native email or dangling booking", async () => {
    const h = fixture();
    h.state.bookings = [booking({ customerEmail: "conflict@example.test" })];
    h.state.jobs = [job({ bookingId: 201, customerPhone: OTHER_PHONE }), job({ id: 102, bookingId: 999, customerPhone: OTHER_PHONE })];
    expect((await h.repo.services(17, FROM, TO)).services).toMatchObject([
      { id: "job:101", eligible: false, reason: "Customer email/phone conflict: review required." },
      { id: "job:102", eligible: false, reason: "Customer email/phone conflict: review required." },
    ]);
  });
  it("does not make multiple projections or disagreeing amounts trusted through email matching", async () => {
    for (const jobs of [[job({ bookingId: 201, jobTotalCents: 17000 })], [job({ bookingId: 201 }), job({ id: 102, bookingId: 201 })]]) {
      const h = fixture(); h.state.bookings = [booking({ customerPhone: OTHER_PHONE })]; h.state.jobs = jobs;
      const services = (await h.repo.services(17, FROM, TO)).services;
      expect(services).toHaveLength(jobs.length + 1);
      expect(services.every(s => !s.eligible)).toBe(true);
    }
  });
});
