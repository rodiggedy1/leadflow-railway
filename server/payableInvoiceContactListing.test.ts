import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";
import { invoiceLookupSchema } from "../shared/payableInvoice";
import { MysqlInvoiceRepository } from "./payableInvoiceRepository";
import { invoiceReviewHash } from "./payableInvoiceReview";
import { PayableInvoiceService } from "./payableInvoiceService";

// OFFLINE ONLY: this mock evaluates the actual SQL contact/date predicates and
// parameter order against fixture rows. It models only the SELECTs used here;
// it is not a MySQL engine or proof of database collation/transaction behavior.
// Repository, service, identity, amount, and collection helpers remain real.
type Row = Record<string, unknown>;
type Values = Array<string | number | null>;
const PHONE = "+12025550123";
const EMAIL = "owner@example.test";
const OTHER_PHONE = "+12025550999";
const OTHER_EMAIL = "different@example.test";
const FROM = "2026-11-01";
const TO = "2026-11-07";
const emailOf = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
// Deliberately simulates SQL REGEXP_REPLACE, not application normalization.
const sqlDigits = (value: unknown) => String(value ?? "").replace(/[^0-9]/g, "");

function account(overrides: Row = {}): Row {
  return { id: 17, customerName: "Fixture owner", customerPhone: PHONE, customerEmail: EMAIL, ...overrides };
}
function job(overrides: Row = {}): Row {
  return { id: 101, bookingId: null, jobDate: "2026-11-03", customerPhone: PHONE, customerEmail: EMAIL,
    customerName: "Fixture owner", serviceName: "Same service label", jobAddress: "Same fixture address", jobTotalCents: 12_345,
    bookingStatus: "completed", missingFromLaunch27At: null, ...overrides };
}
function booking(overrides: Row = {}): Row {
  return { id: 201, requestedLocalDate: "2026-11-03", customerPhone: PHONE, customerEmail: EMAIL,
    customerName: "Fixture owner", serviceName: "Same service label", address: "Same fixture address", firstCleaningTotalCents: 6_789,
    status: "completed", paymentStatus: "not_started", ...overrides };
}

const harnesses: ReturnType<typeof fixture>[] = [];
function fixture() {
  const state = { accounts: [] as Row[], jobs: [] as Row[], bookings: [] as Row[],
    manual: [] as Row[], owned: [] as Row[], profiles: [] as Row[], authorizations: [] as Row[], cashApp: [] as Row[] };
  function projections(b: Row) {
    return state.jobs.filter(j => j.bookingId === b.id && j.jobDate === b.requestedLocalDate)
      .sort((a, c) => Number(a.id) - Number(c.id));
  }
  function selected(raw: Row[], sql: string, values: Values, alias: "j" | "b", dateField: string) {
    const [from, to, email, local, full] = values;
    expect(values).toHaveLength(5);
    expect(sql).toContain(`WHERE ${alias}.${dateField} >= ? AND ${alias}.${dateField} <= ?`);
    const listing = sql.includes(`LOWER(TRIM(${alias}.customerEmail)) = NULLIF(?, '')`);
    if (listing) {
      expect(sql).toContain(`AND (LOWER(TRIM(${alias}.customerEmail)) = NULLIF(?, '') OR REGEXP_REPLACE(${alias}.customerPhone, '[^0-9]', '') IN (NULLIF(?, ''), NULLIF(?, '')))`);
      expect(sql).not.toContain(`COALESCE(TRIM(${alias}.customerEmail), '') = '' AND`);
    } else {
      expect(sql).toContain(`AND (LOWER(TRIM(${alias}.customerEmail)) = ? OR (COALESCE(TRIM(${alias}.customerEmail), '') = '' AND REGEXP_REPLACE(${alias}.customerPhone, '[^0-9]', '') IN (?, ?)))`);
    }
    expect(sql).not.toMatch(/LIKE|RIGHT\s*\(|SUBSTRING|SOUNDEX/i);
    return raw.filter(row => {
      const inPeriod = String(row[dateField]) >= String(from) && String(row[dateField]) <= String(to);
      const emailMatches = listing ? !!email && emailOf(row.customerEmail) === email : emailOf(row.customerEmail) === email;
      const phoneMatches = [local, full].some(value => (!listing || !!value) && sqlDigits(row.customerPhone) === value);
      return inPeriod && (emailMatches || (phoneMatches && (listing || !emailOf(row.customerEmail))));
    }).sort((a, b) => Number(a.id) - Number(b.id)).slice(0, 1001);
  }
  const execute = vi.fn(async (rawSql: string, values: Values = []) => {
    const sql = rawSql.replace(/\s+/g, " ").trim();
    if (!sql.startsWith("SELECT ")) throw new Error(`Listing attempted a write: ${sql}`);
    let result: Row[];
    if (sql.includes("FROM customer_portal_accounts")) {
      if (sql.includes("WHERE id = ?")) result = state.accounts.filter(a => a.id === values[0]).slice(0, 1);
      else throw new Error(`Unexpected account SELECT: ${sql}`);
    } else if (sql.startsWith("SELECT j.id, j.bookingId, j.jobDate,") && sql.includes("FROM leadflow_jobs j FORCE INDEX")) {
      result = selected(state.jobs, sql, values, "j", "jobDate").map(j => {
        const b = state.bookings.find(b => b.id === j.bookingId);
        const p = b ? projections(b) : [];
        return { ...j, nativeId: b?.id ?? null, nativeDate: b?.requestedLocalDate ?? null,
          nativePhone: b?.customerPhone ?? null, nativeEmail: b?.customerEmail ?? null,
          nativeStatus: b?.status ?? null, nativeAmount: b?.firstCleaningTotalCents ?? null,
          firstProjectionCount: p.length, firstProjectionId: p[0]?.id ?? null };
      });
    } else if (sql.startsWith("SELECT b.id, b.requestedLocalDate,") && sql.includes("FROM bookings b FORCE INDEX")) {
      result = selected(state.bookings, sql, values, "b", "requestedLocalDate").map(b => {
        const p = projections(b);
        return { ...b, firstProjectionCount: p.length, firstProjectionId: p[0]?.id ?? null,
          projectionAmount: p[0]?.jobTotalCents ?? null, projectionPhone: p[0]?.customerPhone ?? null,
          projectionEmail: p[0]?.customerEmail ?? null, projectionStatus: p[0]?.bookingStatus ?? null,
          projectionMissing: p[0]?.missingFromLaunch27At ?? null };
      });
    } else if (/^SELECT id, paymentStatus FROM bookings WHERE id = \? LIMIT 1$/.test(sql)) {
      result = state.bookings.filter(b => b.id === values[0]).map(b => ({ id: b.id, paymentStatus: b.paymentStatus }));
    } else if (sql.includes("FROM booking_payment_profiles WHERE bookingId = ?")) {
      result = state.profiles.filter(p => p.bookingId === values[0]);
    } else if (sql.includes("FROM payment_authorizations a INNER JOIN booking_payment_profiles p ON p.id = a.bookingPaymentProfileId")) {
      result = state.authorizations.filter(a => state.profiles.some(p => p.id === a.bookingPaymentProfileId && p.bookingId === values[0]));
    } else if (sql.includes("FROM booking_cash_app_payments WHERE bookingId = ?")) {
      result = state.cashApp.filter(p => p.bookingId === values[0]);
    } else if (sql.includes("FROM payable_invoice_manual_payments WHERE occurrenceKey = ?")) {
      result = state.manual.filter(p => p.occurrenceKey === values[0]);
    } else if (sql.includes("FROM payable_invoice_lines l INNER JOIN payable_invoices i ON i.id = l.invoiceId WHERE l.occurrenceKey = ?")) {
      result = state.owned.filter(p => p.occurrenceKey === values[0]);
    } else throw new Error(`Unexpected offline SELECT: ${sql}`);
    return [result, []];
  });
  const getConnection = vi.fn(async () => { throw new Error("Listing must not start a transaction"); });
  const pool = { execute, getConnection } as unknown as Pool;
  const repo = new MysqlInvoiceRepository(async () => pool);
  const stripe = vi.fn(() => { throw new Error("Listing must not access a provider"); });
  const assertCollectionReady = vi.fn(async () => { throw new Error("Listing must not initiate collection"); });
  const service = new PayableInvoiceService({ repo, stripe, assertCollectionReady,
    origin: "https://invoice.example.test", tokenSecret: "offline-fixture-secret-".repeat(2) });
  const sourceCalls = () => execute.mock.calls.filter(([sql]) => sql.includes("FROM leadflow_jobs j FORCE INDEX") || sql.includes("FROM bookings b FORCE INDEX"));
  const h = { state, execute, getConnection, repo, stripe, assertCollectionReady, service, sourceCalls };
  harnesses.push(h);
  return h;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Offline tests forbid network calls"); }));
});
afterEach(() => {
  for (const h of harnesses.splice(0)) {
    expect(h.execute.mock.calls.every(([sql]) => /^\s*SELECT\b/.test(sql))).toBe(true);
    expect(h.execute.mock.calls.some(([sql]) => /\b(?:INSERT|UPDATE|DELETE)\b|FOR UPDATE/i.test(sql))).toBe(false);
    expect(h.getConnection).not.toHaveBeenCalled();
    expect(h.stripe).not.toHaveBeenCalled();
    expect(h.assertCollectionReady).not.toHaveBeenCalled();
  }
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

function expectContactSnapshot(h: ReturnType<typeof fixture>, result: Awaited<ReturnType<PayableInvoiceService["lookup"]>>, phone = PHONE, email: string | null = EMAIL, name = "Fixture owner") {
  expect(result.client).toEqual({ id: 0, name, phone, email });
  expect(result.reviewHash).toMatch(/^[a-f0-9]{64}$/);
  expect(result.reviewHash).toBe(invoiceReviewHash(result.client!, result.services, FROM, TO));
  expect(h.execute.mock.calls.some(([sql]) => sql.includes("customer_portal_accounts"))).toBe(false);
}

describe("offline exact invoice contact listing", () => {
  it.each([
    { label: "phone correct, email different", contacts: { customerPhone: "(202) 555-0123", customerEmail: OTHER_EMAIL } },
    { label: "email correct, phone different", contacts: { customerPhone: OTHER_PHONE, customerEmail: " OWNER@example.test " } },
  ])("lists both owned source kinds when $label, without a portal account", async ({ contacts }) => {
    const h = fixture(); h.state.jobs = [job(contacts)]; h.state.bookings = [booking(contacts)];
    const result = await h.service.lookup("(202) 555-0123", " OWNER@example.test ", FROM, TO);
    expectContactSnapshot(h, result);
    expect(result.services.map(s => s.id)).toEqual(["booking:201:first:2026-11-03", "job:101"]);
    expect(result.services.every(s => s.eligible)).toBe(true);
    expect(result.services.map(s => s.amountCents)).toEqual([6_789, 12_345]);
    expect(h.sourceCalls().map(([, values]) => values)).toEqual([
      [FROM, TO, EMAIL, "2025550123", "12025550123"], [FROM, TO, EMAIL, "2025550123", "12025550123"],
    ]);
  });

  it.each([
    { label: "phone-only", phone: PHONE, email: "", contacts: { customerPhone: PHONE, customerEmail: OTHER_EMAIL }, params: [FROM, TO, "", "2025550123", "12025550123"] },
    { label: "email-only", phone: "", email: " OWNER@example.test ", contacts: { customerPhone: OTHER_PHONE, customerEmail: EMAIL }, params: [FROM, TO, EMAIL, "", ""] },
  ])("supports $label without accidental matches to blank contacts", async ({ phone, email, contacts, params }) => {
    const h = fixture();
    h.state.jobs = [job(contacts), job({ id: 102, customerPhone: "", customerEmail: "" }),
      job({ id: 103, customerPhone: null, customerEmail: null }), job({ id: 104, customerPhone: OTHER_PHONE, customerEmail: " " })];
    h.state.bookings = [booking(contacts), booking({ id: 202, customerPhone: "", customerEmail: "" }),
      booking({ id: 203, customerPhone: null, customerEmail: null }), booking({ id: 204, customerPhone: OTHER_PHONE, customerEmail: " " })];
    const result = await h.service.lookup(phone, email, FROM, TO);
    expectContactSnapshot(h, result, phone ? PHONE : "", email ? EMAIL : null);
    expect(result.services.map(s => s.id)).toEqual(["booking:201:first:2026-11-03", "job:101"]);
    expect(result.services.every(s => s.eligible)).toBe(true);
    expect(h.sourceCalls().map(([, values]) => values)).toEqual([params, params]);
  });

  it("applies inclusive dates to both OR branches in both tables", async () => {
    const h = fixture();
    const dates = ["2026-10-31", FROM, "2026-11-04", TO, "2026-11-08"];
    for (const [index, date] of dates.entries()) {
      const contacts = index % 2 ? { customerPhone: PHONE, customerEmail: OTHER_EMAIL } : { customerPhone: OTHER_PHONE, customerEmail: EMAIL };
      h.state.jobs.push(job({ id: 100 + index, jobDate: date, ...contacts }));
      h.state.bookings.push(booking({ id: 200 + index, requestedLocalDate: date, ...contacts }));
    }
    const result = await h.repo.lookup(PHONE, EMAIL, FROM, TO);
    expect(result.services.map(s => s.id)).toEqual([
      `booking:201:first:${FROM}`, "job:101", "booking:202:first:2026-11-04", "job:102", `booking:203:first:${TO}`, "job:103",
    ]);
    const single = await h.repo.lookup(PHONE, EMAIL, TO, TO);
    expect(single.services.map(s => s.date)).toEqual([TO, TO]);
  });

  it("does not infer ownership from names, labels, phone suffixes, extra digits, or similar emails", async () => {
    const h = fixture();
    const contacts = [
      { customerPhone: "+13025550123", customerEmail: "owner+alias@example.test" },
      { customerPhone: "5550123", customerEmail: "xowner@example.test" },
      { customerPhone: "912025550123", customerEmail: OTHER_EMAIL },
      { customerPhone: OTHER_PHONE, customerEmail: "owner@example.test.evil" },
    ];
    h.state.jobs = contacts.map((c, i) => job({ id: i + 1, ...c }));
    h.state.bookings = contacts.map((c, i) => booking({ id: i + 1, ...c }));
    expect((await h.repo.lookup(PHONE, EMAIL, FROM, TO)).services).toEqual([]);
  });

  it.each([
    { label: "exact phone", phone: PHONE, email: "" },
    { label: "exact email", phone: "", email: " OWNER@example.test " },
    { label: "both exact contacts", phone: PHONE, email: EMAIL },
  ])("returns a source-named billing snapshot from $label without reading an existing account", async ({ phone, email }) => {
    const h = fixture(); h.state.accounts = [account()]; h.state.jobs = [job()];
    const result = await h.service.lookup(phone, email, FROM, TO);
    expectContactSnapshot(h, result, phone ? PHONE : "", email ? EMAIL : null);
    expect(await h.repo.contactServices(phone, email, FROM, TO)).toEqual({ client: result.client, services: result.services });
    expect(h.execute.mock.calls.some(([sql]) => sql.includes("customer_portal_accounts"))).toBe(false);
  });

  it("returns the same reviewed billing snapshot when accounts are absent, duplicated, or contact-mismatched", async () => {
    for (const accounts of [[], [account(), account({ id: 18 })], [account({ customerEmail: OTHER_EMAIL })]]) {
      const h = fixture(); h.state.accounts = accounts; h.state.jobs = [job({ customerEmail: OTHER_EMAIL })];
      const result = await h.service.lookup(PHONE, EMAIL, FROM, TO);
      expectContactSnapshot(h, result);
      expect(result.services).toMatchObject([{ id: "job:101", eligible: true }]);
    }
  });

  it("keeps stable distinct occurrence IDs for same-label visits and aliases only a verified first projection", async () => {
    const h = fixture();
    h.state.bookings = [booking({ id: 101 })];
    h.state.jobs = [job({ id: 9, bookingId: 101, jobTotalCents: 6_789 }),
      job({ id: 101 }), job({ id: 102, bookingId: 101, jobDate: "2026-11-04" })];
    const before = (await h.repo.lookup(PHONE, EMAIL, FROM, TO)).services;
    h.state.jobs.reverse(); h.state.bookings.reverse();
    const after = (await h.repo.lookup(PHONE, EMAIL, FROM, TO)).services;
    expect(after).toEqual(before);
    expect(before.map(s => s.id)).toEqual(["booking:101:first:2026-11-03", "job:101", "job:102"]);
    expect(new Set(before.map(s => s.occurrenceKey)).size).toBe(3);
  });

  it("coalesces one verified first projection when each source matches a different supplied contact", async () => {
    const h = fixture();
    h.state.bookings = [booking({ customerPhone: OTHER_PHONE })];
    h.state.jobs = [job({ bookingId: 201, customerEmail: OTHER_EMAIL, jobTotalCents: 6_789 })];
    const result = await h.service.lookup(PHONE, EMAIL, FROM, TO);
    expectContactSnapshot(h, result);
    expect(result.services).toMatchObject([{ id: "booking:201:first:2026-11-03", amountCents: 6_789, eligible: true }]);
    expect(result.services).toHaveLength(1);
  });

  it.each(["native", "projection"] as const)("blocks a linked first-service %s matching neither contact rather than coalescing it", async kind => {
    const h = fixture();
    const conflict = { customerPhone: OTHER_PHONE, customerEmail: OTHER_EMAIL };
    h.state.bookings = [booking(kind === "native" ? conflict : {})];
    h.state.jobs = [job({ bookingId: 201, jobTotalCents: 6_789, ...(kind === "projection" ? conflict : {}) })];
    const result = await h.service.lookup(PHONE, EMAIL, FROM, TO);
    expectContactSnapshot(h, result);
    expect(result.services).toHaveLength(1);
    expect(result.services[0]).toMatchObject({ id: kind === "native" ? "job:101" : "booking:201:first:2026-11-03",
      eligible: false, reason: "Customer email/phone conflict: review required." });
  });

  it.each([
    { phone: " (202) 555-0123 ", email: "", expected: { phone: PHONE, email: null, name: PHONE } },
    { phone: "", email: " OWNER@example.test ", expected: { phone: "", email: EMAIL, name: EMAIL } },
  ])("uses the normalized supplied contact as the name fallback without portal or source names: %j", async ({ phone, email, expected }) => {
    const h = fixture();
    h.state.accounts = [account()]; h.state.jobs = [job({ customerName: " " })];
    const result = await h.service.lookup(phone, email, FROM, TO);
    expectContactSnapshot(h, result, expected.phone, expected.email, expected.name);
    expect(result.services).toMatchObject([{ id: "job:101", eligible: true }]);
  });

  it("preserves manual, partially paid retained invoice, and captured native amounts without an account", async () => {
    const h = fixture(); h.state.jobs = [job(), job({ id: 102, jobTotalCents: 20_000 })]; h.state.bookings = [booking()];
    h.state.manual = [{ occurrenceKey: "job:101", sourceServiceId: "job:101", accountId: 81,
      serviceDate: "2026-11-03", amountCents: 12_345 }];
    h.state.owned = [{ occurrenceKey: "job:102", sourceServiceId: "job:102", accountId: 82,
      serviceDate: "2026-11-03", amountCents: 20_000, paidCents: 5_000, manualPaidCents: 0, status: "partially_paid" }];
    h.state.profiles = [{ id: 301, bookingId: 201, paymentStatus: "captured" }];
    const before = structuredClone(h.state);
    const result = await h.service.lookup(PHONE, EMAIL, FROM, TO);
    expectContactSnapshot(h, result);
    expect(result.services).toMatchObject([
      { id: "booking:201:first:2026-11-03", amountCents: 6_789, paidCents: 6_789, paymentSource: "stripe", eligible: false },
      { id: "job:101", amountCents: 12_345, paidCents: 12_345, paymentSource: "manual" },
      { id: "job:102", amountCents: 20_000, paidCents: 5_000, paymentSource: "stripe", eligible: false },
    ]);
    expect(h.state).toEqual(before);
  });

  it.each([
    { label: "manual source", kind: "manual", overrides: { sourceServiceId: "job:999" }, code: "MANUAL_PAYMENT_CONFLICT" },
    { label: "manual date", kind: "manual", overrides: { serviceDate: FROM }, code: "MANUAL_PAYMENT_CONFLICT" },
    { label: "manual amount", kind: "manual", overrides: { amountCents: 1 }, code: "MANUAL_PAYMENT_CONFLICT" },
    { label: "retained source", kind: "owned", overrides: { sourceServiceId: "job:999" }, code: "INVALID_SNAPSHOT" },
    { label: "retained date", kind: "owned", overrides: { serviceDate: TO }, code: "INVALID_SNAPSHOT" },
    { label: "retained amount", kind: "owned", overrides: { amountCents: 1 }, code: "INVALID_SNAPSHOT" },
    { label: "excess paid amount", kind: "owned", overrides: { paidCents: 12_346 }, code: "CORRUPT_SNAPSHOT" },
  ])("retains $label snapshot validation even without an account", async ({ kind, overrides, code }) => {
    const h = fixture(); h.state.jobs = [job()];
    const row = { occurrenceKey: "job:101", sourceServiceId: "job:101", accountId: 81,
      serviceDate: "2026-11-03", amountCents: 12_345, paidCents: 0, manualPaidCents: 0, status: "open", ...overrides };
    h.state[kind as "manual" | "owned"] = [row];
    await expect(h.repo.lookup(PHONE, EMAIL, FROM, TO)).rejects.toMatchObject({ code });
  });

  it("preserves account-bound email-first billing predicates and portal-account requirements", async () => {
    const h = fixture(); h.state.accounts = [account()];
    const contacts = [
      { customerPhone: PHONE, customerEmail: OTHER_EMAIL },
      { customerPhone: OTHER_PHONE, customerEmail: EMAIL },
      { customerPhone: PHONE, customerEmail: "" },
    ];
    h.state.jobs = contacts.map((c, i) => job({ id: 101 + i, ...c }));
    h.state.bookings = contacts.map((c, i) => booking({ id: 201 + i, ...c }));
    expect((await h.repo.lookup(PHONE, EMAIL, FROM, TO)).services).toHaveLength(6);
    const billed = await h.repo.services(17, FROM, TO);
    expect(billed.client.id).toBe(17);
    expect(billed.services.map(s => s.id)).toEqual(["booking:202:first:2026-11-03", "booking:203:first:2026-11-03", "job:102", "job:103"]);
    await expect(h.repo.services(99, FROM, TO)).rejects.toMatchObject({ code: "CLIENT_NOT_FOUND" });
  });

  it("still rejects an account-bound retained claim belonging to another account", async () => {
    const h = fixture(); h.state.accounts = [account()]; h.state.jobs = [job()];
    h.state.owned = [{ occurrenceKey: "job:101", sourceServiceId: "job:101", accountId: 18,
      serviceDate: "2026-11-03", amountCents: 12_345, paidCents: 100, status: "open" }];
    await expect(h.repo.services(17, FROM, TO)).rejects.toMatchObject({ code: "INVALID_SNAPSHOT" });
  });

  it.each([
    { phone: PHONE }, { email: EMAIL }, { phone: " (202) 555-0123 ", email: " OWNER@example.test " },
  ])("accepts a schema request supplying at least one usable contact: %j", contacts => {
    const result = invoiceLookupSchema.safeParse({ ...contacts, from: FROM, to: TO });
    expect(result.success).toBe(true);
    if (result.success) { expect(typeof result.data.phone).toBe("string"); expect(typeof result.data.email).toBe("string"); }
  });

  it.each([{}, { phone: " ", email: " " }, { email: "not-an-email" }, { email: "owner@example" }])("rejects missing/invalid sole contacts in the schema: %j", contacts => {
    expect(invoiceLookupSchema.safeParse({ ...contacts, from: FROM, to: TO }).success).toBe(false);
  });

  it.each([{ from: TO, to: FROM }, { from: "2026-11-31", to: "2026-12-01" }])("rejects invalid periods without reading service sources: %j", async period => {
    const h = fixture();
    await expect(h.repo.lookup(PHONE, EMAIL, period.from, period.to)).rejects.toMatchObject({ code: "INVALID_PERIOD" });
    expect(h.sourceCalls()).toEqual([]);
  });
});
