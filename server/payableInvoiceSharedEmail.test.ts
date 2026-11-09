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
const ACCOUNT_ID = "SELECT id, customerName, customerPhone, customerEmail FROM customer_portal_accounts WHERE id = ? LIMIT 1";
const GLOBAL_EMAIL = /FROM customer_portal_accounts WHERE customerEmail\s*=\s*\?/i;

function account(overrides: Row = {}): Row {
  return { id: 17, customerName: "Selected customer", customerPhone: PHONE, customerEmail: EMAIL, ...overrides };
}
function job(overrides: Row = {}): Row {
  return { id: 101, bookingId: null, jobDate: FROM, customerPhone: PHONE, customerEmail: EMAIL,
    customerName: "Source customer", serviceName: "Owned visit", jobAddress: "Selected address", jobTotalCents: 12_345,
    bookingStatus: "completed", missingFromLaunch27At: null, nativeId: null, nativeDate: null,
    nativePhone: null, nativeEmail: null, nativeStatus: null, nativeAmount: null,
    firstProjectionCount: 0, firstProjectionId: null, ...overrides };
}
function booking(overrides: Row = {}): Row {
  return { id: 201, requestedLocalDate: FROM, customerPhone: PHONE, customerEmail: EMAIL,
    customerName: "Source customer", serviceName: "Native visit", address: "Selected address", firstCleaningTotalCents: 6_789,
    status: "completed", firstProjectionCount: 0, firstProjectionId: null,
    projectionAmount: null, projectionPhone: null, projectionEmail: null,
    projectionStatus: null, projectionMissing: null, paymentStatus: "not_started", ...overrides };
}
function fixture(lookupEmail = EMAIL) {
  const state = {
    accounts: [account(), account({ id: 18, customerName: "Other customer", customerPhone: OTHER_PHONE })],
    accountResult: null as Row[] | null,
    // Grouped source fixtures: listing filters every group by phone OR email.
    // Legacy billing keeps explicit selected-account rows to exercise JS guards.
    jobsByPhone: new Map<string, Row[]>([
      [PHONE, [job(), job({ id: 102, jobDate: TO })]],
      [OTHER_PHONE, [job({ id: 901, customerPhone: OTHER_PHONE })]],
    ]),
    bookingsByPhone: new Map<string, Row[]>([[PHONE, []], [OTHER_PHONE, [booking({ id: 902, customerPhone: OTHER_PHONE })]]]),
  };
  function sourceRows(groups: Map<string, Row[]>, sql: string, values: Values, alias: "j" | "b", date: string): Row[] {
    const listing = sql.includes(`LOWER(TRIM(${alias}.customerEmail)) = NULLIF(?, '')`);
    if (!listing) return groups.get(PHONE) ?? [];
    expect(sql).toContain(`REGEXP_REPLACE(${alias}.customerPhone, '[^0-9]', '') IN (NULLIF(?, ''), NULLIF(?, ''))`);
    return [...groups.values()].flat().filter(row => String(row[date]) >= String(values[0]) && String(row[date]) <= String(values[1]) && (
      (!!values[2] && String(row.customerEmail ?? "").trim().toLowerCase() === values[2]) ||
      values.slice(3, 5).filter(Boolean).includes(String(row.customerPhone ?? "").replace(/[^0-9]/g, ""))
    )).sort((a, b) => Number(a.id) - Number(b.id));
  }
  const trace: Array<{ sql: string; values: Values }> = [];
  const execute = vi.fn(async (rawSql: string, values: Values = []) => {
    const sql = rawSql.replace(/\s+/g, " ").trim();
    trace.push({ sql, values: [...values] });
    if (!sql.startsWith("SELECT ")) throw new Error("Mutation forbidden in read-only fixture");
    let result: Row[];
    if (sql === ACCOUNT_ID) {
      result = state.accountResult ?? state.accounts.filter(row => row.id === values[0]);
    } else if (sql.startsWith("SELECT j.id, j.bookingId, j.jobDate,") && sql.includes("FROM leadflow_jobs j FORCE INDEX")) {
      expect(values).toEqual([FROM, TO, lookupEmail, "2025550123", "12025550123"]);
      result = sourceRows(state.jobsByPhone, sql, values, "j", "jobDate");
    } else if (sql.startsWith("SELECT b.id, b.requestedLocalDate,") && sql.includes("FROM bookings b FORCE INDEX")) {
      expect(values).toEqual([FROM, TO, lookupEmail, "2025550123", "12025550123"]);
      result = sourceRows(state.bookingsByPhone, sql, values, "b", "requestedLocalDate");
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

function expectNoPortalRead(h: ReturnType<typeof fixture>) {
  expect(h.trace.some(({ sql }) => sql.includes("customer_portal_accounts"))).toBe(false);
}

describe("shared billing email contact snapshots and retained owned-account billing (offline)", () => {
  it("returns every normalized phone OR shared-email source at the boundary dates without selecting a portal account", async () => {
    const h = fixture();
    const result = await h.repo.lookup("(202) 555-0123", " BILLING@example.test ", FROM, TO);
    expect(h.state.accounts.map(row => row.customerEmail)).toEqual([EMAIL, EMAIL]);
    expect(result.client).toEqual({ id: 0, name: "Source customer", phone: PHONE, email: EMAIL });
    expect(result.services.map(s => [s.id, s.date, s.eligible])).toEqual([
      [`booking:902:first:${FROM}`, FROM, true], ["job:101", FROM, true], ["job:901", FROM, true], ["job:102", TO, true],
    ]);
    expectNoPortalRead(h);
    const jobs = h.trace.find(({ sql }) => sql.includes("FROM leadflow_jobs j FORCE INDEX"))!;
    expect(jobs.sql).toContain("j.jobDate >= ? AND j.jobDate <= ?");
    expect(jobs.sql).toContain("REGEXP_REPLACE(j.customerPhone, '[^0-9]', '') IN (NULLIF(?, ''), NULLIF(?, ''))");
    expect(jobs.sql).not.toMatch(/LIKE|RIGHT\s*\(/i);
    expect(jobs.sql).toContain("LOWER(TRIM(j.customerEmail)) = NULLIF(?, '') OR");
    expect(jobs.values).toEqual([FROM, TO, EMAIL, "2025550123", "12025550123"]);
    const native = h.trace.find(({ sql }) => sql.includes("FROM bookings b FORCE INDEX"))!;
    expect(native.sql).toContain("b.requestedLocalDate >= ? AND b.requestedLocalDate <= ?");
    expect(native.sql).toContain("LOWER(TRIM(b.customerEmail)) = NULLIF(?, '') OR");
    expect(native.sql).toContain("REGEXP_REPLACE(b.customerPhone, '[^0-9]', '') IN (NULLIF(?, ''), NULLIF(?, ''))");
    expect(native.values).toEqual([FROM, TO, EMAIL, "2025550123", "12025550123"]);
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

  it("real service lookup returns a reviewHash matching the contact reread without calling a portal, Stripe, or collection", async () => {
    const h = fixture();
    const stripe = vi.fn(() => { throw new Error("Stripe must not be called for lookup"); });
    const assertCollectionReady = vi.fn(async () => { throw new Error("Collection must not run for lookup"); });
    const service = new PayableInvoiceService({ repo: h.repo, stripe, assertCollectionReady,
      origin: "https://invoice.example.test", tokenSecret: "offline-only-secret".repeat(3) });
    const reviewed = await service.lookup(PHONE, EMAIL, FROM, TO);
    const reread = await h.repo.contactServices(reviewed.client.phone, reviewed.client.email || "", FROM, TO);
    expect(reread).toEqual({ client: reviewed.client, services: reviewed.services });
    expect(reviewed.reviewHash).toMatch(/^[a-f0-9]{64}$/);
    expect(reviewed.reviewHash).toBe(invoiceReviewHash(reread.client, reread.services, FROM, TO));
    expect(reviewed.services.map(s => s.id)).toEqual([`booking:902:first:${FROM}`, "job:101", "job:901", "job:102"]);
    expectNoPortalRead(h);
    expect(stripe).not.toHaveBeenCalled();
    expect(assertCollectionReady).not.toHaveBeenCalled();
    expectReadOnly(h);
  });

  it("snapshots supplied contacts and lists phone matches even when email differs from the account", async () => {
    const h = fixture("wrong@example.test");
    const result = await h.repo.lookup(PHONE, "wrong@example.test", FROM, TO);
    expect(result.client).toEqual({ id: 0, name: "Source customer", phone: PHONE, email: "wrong@example.test" });
    expect(result.services.map(s => s.id)).toEqual(["job:101", "job:102"]);
    expect(result.services.every(s => s.eligible)).toBe(true);
    expectNoPortalRead(h);
    expectReadOnly(h);
  });

  it("returns all contact matches with a billing snapshot despite duplicate portal phones", async () => {
    const h = fixture();
    h.state.accounts[1].customerPhone = PHONE;
    const result = await h.repo.lookup(PHONE, EMAIL, FROM, TO);
    expect(result.client).toEqual({ id: 0, name: "Source customer", phone: PHONE, email: EMAIL });
    expect(result.services.map(s => s.id)).toEqual([`booking:902:first:${FROM}`, "job:101", "job:901", "job:102"]);
    expect(result.services.every(s => s.eligible)).toBe(true);
    expectNoPortalRead(h);
    expectReadOnly(h);
  });

  it("does not read a malicious wrong-phone portal result when deriving the billing snapshot", async () => {
    const h = fixture();
    h.state.accountResult = [account({ customerPhone: OTHER_PHONE })];
    const result = await h.repo.lookup(PHONE, EMAIL, FROM, TO);
    expect(result.client).toEqual({ id: 0, name: "Source customer", phone: PHONE, email: EMAIL });
    expect(result.services.map(s => s.id)).toEqual([`booking:902:first:${FROM}`, "job:101", "job:901", "job:102"]);
    expect(result.services.every(s => s.eligible)).toBe(true);
    expectNoPortalRead(h);
    expectReadOnly(h);
  });

  it("lists matching phone OR email contacts while the owned-ID billing reread still blocks conflicting email", async () => {
    const h = fixture();
    h.state.jobsByPhone.set(PHONE, [job(), job({ id: 103, customerPhone: OTHER_PHONE }), job({ id: 104, customerEmail: "wrong@example.test" })]);
    const listing = await h.repo.lookup(PHONE, EMAIL, FROM, TO);
    expect(listing.services.map(s => s.id)).toEqual([`booking:902:first:${FROM}`, "job:101", "job:103", "job:104", "job:901"]);
    expect(listing.services.every(s => s.eligible)).toBe(true);
    expectNoPortalRead(h);
    const result = await h.repo.services(17, FROM, TO);
    expect(result.services.map(s => s.id)).toEqual(["job:101", "job:103", "job:104"]);
    expect(result.services[0].eligible).toBe(true);
    expect(result.services[1].eligible).toBe(true);
    expectIdentityConflict(result.services[2]);
    expectReadOnly(h);
  });

  it("uses billing-email ownership for native, linked-job and projection contacts without aliasing email conflicts", async () => {
    const h = fixture();
    h.state.bookingsByPhone.set(PHONE, [
      booking({ customerPhone: OTHER_PHONE, firstCleaningTotalCents: 12345 }),
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
      "job:101", "job:106",
    ]);
    expect(result.services.find(s => s.id === "job:101")!.eligible).toBe(true);
    for (const id of [`booking:201:first:${FROM}`, `booking:203:first:${FROM}`]) {
      expect(result.services.find(s => s.id === id)!.eligible).toBe(true);
    }
    for (const id of [`booking:202:first:${FROM}`, `booking:204:first:${FROM}`, "job:106"]) {
      expectIdentityConflict(result.services.find(s => s.id === id)!);
    }
    expectReadOnly(h);
  });

  it("uses no portal query in the contact lookup while retaining positive-ID source guards", () => {
    const source = readFileSync(new URL("./payableInvoiceRepository.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(GLOBAL_EMAIL);
    const contactReaders = source.slice(source.indexOf("  async lookup("), source.indexOf("  async services("));
    expect(contactReaders).toContain("this.contactServices(phoneInput, emailInput, from, to)");
    expect(contactReaders).toContain("const client = contactClient(phoneInput, emailInput)");
    expect(contactReaders).not.toContain("customer_portal_accounts");
    expect(source).toContain(ACCOUNT_ID);
    expect(source).toContain("accounts.length !== 1");
    expect(source).toContain("currentClient.phone !== client.phone || currentClient.email !== client.email");
    expect(source).toContain("j.jobDate >= ? AND j.jobDate <= ?");
    expect(source).toContain("b.requestedLocalDate >= ? AND b.requestedLocalDate <= ?");
    expect(source).toContain("COALESCE(TRIM(b.customerEmail), '') = '' AND");
  });
});
