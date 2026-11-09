import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";
import { MysqlInvoiceRepository } from "./payableInvoiceRepository";
import { invoiceReviewHash } from "./payableInvoiceReview";
import type { InvoiceIssueInput } from "./payableInvoiceService";

// OFFLINE ONLY: this query-dispatch mock checks parameters and contact predicates;
// it is not a database engine or proof of production locking/SQL behavior.
// The repository, normalization, review hashes and collection policy remain real.
type Row = Record<string, unknown>;
type Values = Array<string | number | null>;
const PHONE = "+12025550123";
const EMAIL = "janice@example.test";
const OTHER_PHONE = "+12025550999";
const OTHER_EMAIL = "other@example.test";
const FROM = "2026-11-01";
const TO = "2026-11-07";
const DATE = "2026-11-03";
const KEY = `booking:201:first:${DATE}`;
const REQUEST = "11111111-1111-4111-8111-111111111111";
const CHECKOUT = "22222222-2222-4222-8222-222222222222";
const TOKEN = "a".repeat(64);
const emailOf = (v: unknown) => String(v ?? "").trim().toLowerCase();
const sqlDigits = (v: unknown) => String(v ?? "").replace(/[^0-9]/g, "");

function booking(overrides: Row = {}): Row {
  return { id: 201, requestedLocalDate: DATE, customerName: "Janice Matched", customerPhone: PHONE,
    customerEmail: OTHER_EMAIL, serviceName: "Cleaning", address: "Fixture address", firstCleaningTotalCents: 500,
    status: "completed", paymentStatus: "not_started", firstProjectionId: null, firstProjectionCount: 0, ...overrides };
}
function job(overrides: Row = {}): Row {
  return { id: 101, bookingId: null, jobDate: DATE, customerName: "Janice Matched", customerPhone: PHONE,
    customerEmail: OTHER_EMAIL, serviceName: "Cleaning", jobAddress: "Fixture address", jobTotalCents: 500,
    bookingStatus: "completed", missingFromLaunch27At: null, nativeId: null, firstProjectionId: null,
    firstProjectionCount: 0, ...overrides };
}
function fixture() {
  const state = { bookings: [booking()] as Row[], jobs: [] as Row[], invoices: [] as Row[], lines: [] as Row[],
    manual: [] as Row[], owned: [] as Row[], claims: [] as Row[], profiles: [] as Row[], cash: [] as Row[],
    authorizations: [] as Row[], attempts: [] as Row[], accounts: [] as Row[], allocations: [] as Row[],
    duplicateInvoice: false };
  function sourceRows(raw: Row[], sql: string, values: Values, alias: string, dateField: string) {
    expect(values).toHaveLength(5);
    const [from, to, email, local, full] = values;
    const listing = sql.includes(`LOWER(TRIM(${alias}.customerEmail)) = NULLIF(?, '')`);
    if (listing) expect(sql).toContain(`(LOWER(TRIM(${alias}.customerEmail)) = NULLIF(?, '') OR REGEXP_REPLACE(${alias}.customerPhone, '[^0-9]', '') IN (NULLIF(?, ''), NULLIF(?, '')))`);
    return raw.filter(row => {
      const inPeriod = String(row[dateField]) >= String(from) && String(row[dateField]) <= String(to);
      const emailMatch = (listing ? !!email : true) && emailOf(row.customerEmail) === email;
      const phoneMatch = !!local && [local, full].includes(sqlDigits(row.customerPhone));
      return inPeriod && (emailMatch || (phoneMatch && (listing || !emailOf(row.customerEmail))));
    });
  }
  const execute = vi.fn(async (raw: string, values: Values = []) => {
    const sql = raw.replace(/\s+/g, " ").trim();
    let result: Row[] | { affectedRows: number; insertId: number };
    if (sql.includes("FROM customer_portal_accounts")) result = state.accounts.filter(a => a.id === values[0]);
    else if (sql.startsWith("SELECT j.id, j.bookingId, j.jobDate,")) {
      expect(sql).toContain("j.customerName"); result = sourceRows(state.jobs, sql, values, "j", "jobDate");
    } else if (sql.startsWith("SELECT b.id, b.requestedLocalDate,")) {
      expect(sql).toContain("b.customerName"); result = sourceRows(state.bookings, sql, values, "b", "requestedLocalDate");
    } else if (sql.startsWith("SELECT id, paymentStatus FROM bookings")) result = state.bookings.filter(b => b.id === values[0]);
    else if (sql.includes("FROM booking_payment_profiles WHERE bookingId = ?")) result = state.profiles.filter(p => p.bookingId === values[0]);
    else if (sql.includes("FROM payment_authorizations a INNER JOIN booking_payment_profiles")) result = state.authorizations;
    else if (sql.includes("FROM booking_cash_app_payments WHERE bookingId = ?")) result = state.cash.filter(p => p.bookingId === values[0]);
    else if (sql.includes("FROM payable_invoice_manual_payments WHERE occurrenceKey = ?")) result = state.manual.filter(m => m.occurrenceKey === values[0]);
    else if (sql.includes("FROM payable_invoice_manual_payments WHERE requestId = ?")) result = state.manual.filter(m => m.requestId === values[0]).sort((a, b) => String(a.occurrenceKey).localeCompare(String(b.occurrenceKey)));
    else if (sql.includes("FROM payable_invoice_lines l INNER JOIN payable_invoices")) {
      const saved = state.lines.filter(l => l.occurrenceKey === values[0]).map(l => {
        const i = state.invoices.find(i => i.id === l.invoiceId)!;
        return { ...l, accountId: i.accountId, status: i.status };
      });
      result = [...state.owned.filter(l => l.occurrenceKey === values[0]), ...saved];
    } else if (sql === "SELECT invoiceId FROM payable_invoice_lines WHERE occurrenceKey = ?") result = [...state.lines, ...state.claims].filter(l => l.occurrenceKey === values[0]);
    else if (sql.startsWith("SELECT sourceServiceId FROM payable_invoice_lines")) result = state.lines.filter(l => l.invoiceId === values[0]);
    else if (sql.startsWith("SELECT id, occurrenceKey, serviceDate,")) result = state.lines.filter(l => l.invoiceId === values[0]);
    else if (sql.includes("FROM payable_invoice_allocations")) result = state.allocations;
    else if (sql.startsWith("SELECT id FROM payable_invoices WHERE requestId")) result = state.invoices.filter(i => i.requestId === values[0]);
    else if (sql.includes("FROM payable_invoices WHERE requestId = ?")) result = state.invoices.filter(i => i.requestId === values[0]);
    else if (sql.includes("FROM payable_invoices WHERE id = ?")) result = state.invoices.filter(i => i.id === values[0]);
    else if (sql.includes("FROM payable_invoices WHERE tokenHash = ?")) result = state.invoices.filter(i => i.tokenHash === values[0]);
    else if (sql.includes("FROM payable_invoice_attempts WHERE invoiceId = ? AND requestId = ?")) result = state.attempts.filter(a => a.invoiceId === values[0] && a.requestId === values[1]);
    else if (sql.startsWith("INSERT INTO payable_invoices (")) {
      if (state.duplicateInvoice) throw Object.assign(new Error("mock unique occurrence conflict"), { code: "ER_DUP_ENTRY" });
      const cols = ["number", "accountId", "clientName", "clientPhone", "clientEmail", "periodFrom", "periodTo", "dueDate", "status", "requestId", "payloadHash", "reviewHash", "tokenHash", "tokenExpiresAt", "createdAtMs", "paidAtMs"];
      state.invoices.push({ id: 42, currency: "usd", activeAttemptId: null, ...Object.fromEntries(cols.map((c, i) => [c, values[i]])) });
      result = { affectedRows: 1, insertId: 42 };
    } else if (sql.startsWith("INSERT INTO payable_invoice_lines (")) {
      const cols = ["invoiceId", "sourceServiceId", "occurrenceKey", "serviceDate", "description", "address", "amountCents", "paidCents", "manualPaidCents"];
      state.lines.push({ id: state.lines.length + 1, ...Object.fromEntries(cols.map((c, i) => [c, values[i]])) });
      result = { affectedRows: 1, insertId: state.lines.length };
    } else if (sql.startsWith("INSERT INTO payable_invoice_manual_payments (")) {
      const cols = ["occurrenceKey", "sourceServiceId", "accountId", "serviceDate", "amountCents", "requestId", "payloadHash", "reviewHash", "recordedByAgentId", "recordedAtMs"];
      state.manual.push(Object.fromEntries(cols.map((c, i) => [c, values[i]]))); result = { affectedRows: 1, insertId: 0 };
    } else if (sql.startsWith("INSERT INTO payable_invoice_attempts (")) {
      state.attempts.push({ id: values[0], invoiceId: values[1], requestId: values[2], selectedLineIds: values[3], amountCents: values[4], currency: "usd", state: "pending", createdAtMs: values[5] });
      result = { affectedRows: 1, insertId: 0 };
    } else if (sql.startsWith("UPDATE payable_invoices SET activeAttemptId = ?")) {
      expect(sql).toContain("activeAttemptId IS NULL AND status IN ('open', 'partially_paid')");
      const row = state.invoices.find(i => i.id === values[1] && i.activeAttemptId == null);
      if (row) row.activeAttemptId = values[0]; result = { affectedRows: row ? 1 : 0, insertId: 0 };
    } else throw new Error(`Unexpected offline SQL: ${sql}`);
    return [result, []];
  });
  const beginTransaction = vi.fn(async () => {}), commit = vi.fn(async () => {}), rollback = vi.fn(async () => {}), release = vi.fn();
  const connection = { execute, beginTransaction, commit, rollback, release };
  const getConnection = vi.fn(async () => connection);
  const pool = { execute, getConnection } as unknown as Pool;
  const repo = new MysqlInvoiceRepository(async () => pool);
  const writes = () => execute.mock.calls.filter(([sql]) => /^\s*(INSERT|UPDATE|DELETE)\b/.test(sql));
  const sourceCalls = () => execute.mock.calls.filter(([sql]) => sql.includes("FROM leadflow_jobs j FORCE INDEX") || sql.includes("FROM bookings b FORCE INDEX"));
  const noPortal = () => expect(execute.mock.calls.some(([sql]) => sql.includes("customer_portal_accounts"))).toBe(false);
  return { state, repo, execute, commit, rollback, release, getConnection, writes, sourceCalls, noPortal };
}

async function reviewed(h: ReturnType<typeof fixture>, phone = PHONE, email = EMAIL) {
  const snapshot = await h.repo.lookup(phone, email, FROM, TO);
  const input: InvoiceIssueInput & { phone?: string; email?: string } = { requestId: REQUEST, clientId: 0, phone, email,
    from: FROM, to: TO, dueDate: "2026-11-20", serviceIds: snapshot.services.map(s => s.id), confirmedUnpaid: true,
    reviewHash: invoiceReviewHash(snapshot.client, snapshot.services, FROM, TO) };
  const payload = createHash("sha256").update(JSON.stringify({ clientId: 0, billing: [snapshot.client.phone, snapshot.client.email, snapshot.client.name], from: FROM, to: TO, dueDate: input.dueDate,
    services: snapshot.services.slice().sort((a, b) => a.id.localeCompare(b.id)).map(s => [s.occurrenceKey, s.date, s.amountCents, s.paidCents ?? 0]) })).digest("hex");
  const issue = () => h.repo.issue(input, snapshot.client, snapshot.services, TOKEN, payload);
  return { snapshot, input, payload, issue };
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Offline tests forbid network calls"); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("invoice-owned matched contact snapshots (offline)", () => {
  it("returns an id-zero name/contact snapshot with a nonblank full review and no portal reads", async () => {
    const h = fixture();
    const found = await h.repo.lookup(" (202) 555-0123 ", " JANICE@example.test ", FROM, TO);
    expect(found.client).toEqual({ id: 0, name: "Janice Matched", phone: PHONE, email: EMAIL });
    expect(found.services).toMatchObject([{ id: KEY, amountCents: 500, eligible: true }]);
    expect(invoiceReviewHash(found.client, found.services, FROM, TO)).toMatch(/^[a-f0-9]{64}$/);
    expect(h.sourceCalls()).toHaveLength(2); expect(h.sourceCalls().map(([, v]) => v)).toEqual([
      [FROM, TO, EMAIL, "2025550123", "12025550123"], [FROM, TO, EMAIL, "2025550123", "12025550123"],
    ]);
    h.noPortal(); expect(h.writes()).toEqual([]); expect(h.getConnection).not.toHaveBeenCalled();
  });

  it.each([
    { label: "phone-only", phone: PHONE, email: "", contacts: { customerPhone: PHONE, customerEmail: OTHER_EMAIL } },
    { label: "email-only", phone: "", email: EMAIL, contacts: { customerPhone: OTHER_PHONE, customerEmail: EMAIL } },
  ])("uses the same OR contact rule at listing, issuance and reservation for $label", async ({ phone, email, contacts }) => {
    const h = fixture(); h.state.bookings = [booking(contacts)];
    const f = await reviewed(h, phone, email); const invoice = await f.issue();
    expect(invoice).toMatchObject({ clientId: 0, status: "open", clientName: "Janice Matched" });
    expect(h.state.invoices[0]).toMatchObject({ accountId: 0, clientPhone: phone, clientEmail: email });
    const admin = await h.repo.adminInvoice(42);
    expect(admin.client).toEqual({ id: 0, name: "Janice Matched", phone, email: email || null });
    await h.repo.assertCollectionReady(invoice);
    expect(await h.repo.reserve(42, CHECKOUT, [1])).toMatchObject({ amountCents: 500, state: "pending", lineIds: [1] });
    expect(h.sourceCalls().every(([sql]) => sql.includes("= NULLIF(?, '') OR"))).toBe(true);
    expect(h.sourceCalls().filter(([sql]) => sql.endsWith(" FOR UPDATE")).length).toBe(6);
    h.noPortal();
    expect(h.writes().every(([sql]) => /^\s*(?:INSERT INTO payable_invoice|UPDATE payable_invoices)/.test(sql))).toBe(true);
  });

  it("keeps both OR branches date-bounded and excludes blank contacts and suffix matches", async () => {
    const h = fixture(); h.state.bookings = [];
    h.state.jobs = [job(), job({ id: 102, customerPhone: OTHER_PHONE, customerEmail: EMAIL }),
      job({ id: 103, jobDate: "2026-10-31" }), job({ id: 104, jobDate: "2026-11-08", customerPhone: OTHER_PHONE, customerEmail: EMAIL }),
      job({ id: 105, customerPhone: "", customerEmail: "" }), job({ id: 106, customerPhone: "5550123", customerEmail: "xjanice@example.test" })];
    expect((await h.repo.contactServices(PHONE, EMAIL, FROM, TO)).services.map(s => s.id)).toEqual(["job:101", "job:102"]);
    h.noPortal();
  });

  it.each([{ phone: PHONE, email: "", name: PHONE }, { phone: "", email: EMAIL, name: EMAIL }])("uses supplied contact as display fallback, not a fabricated name: %j", async ({ phone, email, name }) => {
    const h = fixture(); h.state.bookings = []; h.state.jobs = [job({ customerName: " ", customerPhone: phone, customerEmail: email })];
    expect((await h.repo.contactServices(phone, email, FROM, TO)).client.name).toBe(name);
    h.state.jobs = []; expect((await h.repo.contactServices(phone, email, FROM, TO)).client).toMatchObject({ id: 0, name });
  });

  it("derives a stable job name from the same source reads regardless of source return order", async () => {
    const h = fixture(); h.state.bookings = []; h.state.jobs = [job({ id: 102, customerName: "Later name" }), job()];
    const before = await h.repo.contactServices(PHONE, EMAIL, FROM, TO); h.state.jobs.reverse();
    expect(await h.repo.contactServices(PHONE, EMAIL, FROM, TO)).toEqual(before);
    expect(before.client.name).toBe("Janice Matched"); expect(h.sourceCalls()).toHaveLength(4);
  });

  it.each([{ phone: "", email: "" }, { phone: "5550123", email: "" }, { phone: "", email: "not-email" },
    { phone: PHONE, email: "not-email" }, { phone: "invalid", email: EMAIL }])("rejects unusable contacts before service reads: %j", async ({ phone, email }) => {
    const h = fixture(); await expect(h.repo.contactServices(phone, email, FROM, TO)).rejects.toMatchObject({ code: "INVALID_CUSTOMER" });
    expect(h.execute).not.toHaveBeenCalled();
  });

  it("retains exact manual and paid invoice history from positive accounts without account-zero conflicts", async () => {
    const h = fixture(); h.state.bookings = []; h.state.jobs = [job(), job({ id: 102 })];
    h.state.manual = [{ occurrenceKey: "job:101", sourceServiceId: "job:101", accountId: 17, serviceDate: DATE, amountCents: 500 }];
    h.state.owned = [{ occurrenceKey: "job:102", sourceServiceId: "job:102", accountId: 18, serviceDate: DATE, amountCents: 500, paidCents: 500, manualPaidCents: 0, status: "paid" }];
    const found = await h.repo.lookup(PHONE, EMAIL, FROM, TO);
    expect(found.services).toMatchObject([{ paidCents: 500, paymentSource: "manual" }, { paidCents: 500, paymentSource: "stripe", eligible: false }]);
    h.noPortal(); expect(h.writes()).toEqual([]);
  });

  it.each([
    { kind: "manual", overrides: { sourceServiceId: "job:999" }, code: "MANUAL_PAYMENT_CONFLICT" },
    { kind: "manual", overrides: { serviceDate: TO }, code: "MANUAL_PAYMENT_CONFLICT" },
    { kind: "manual", overrides: { amountCents: 501 }, code: "MANUAL_PAYMENT_CONFLICT" },
    { kind: "owned", overrides: { sourceServiceId: "job:999" }, code: "INVALID_SNAPSHOT" },
    { kind: "owned", overrides: { serviceDate: TO }, code: "INVALID_SNAPSHOT" },
    { kind: "owned", overrides: { amountCents: 501 }, code: "INVALID_SNAPSHOT" },
  ])("preserves $kind exact occurrence/date/amount conflict checks: $overrides", async ({ kind, overrides, code }) => {
    const h = fixture(); h.state.bookings = []; h.state.jobs = [job()];
    h.state[kind as "manual" | "owned"] = [{ occurrenceKey: "job:101", sourceServiceId: "job:101", accountId: 17, serviceDate: DATE, amountCents: 500, paidCents: 0, ...overrides }];
    await expect(h.repo.lookup(PHONE, EMAIL, FROM, TO)).rejects.toMatchObject({ code }); expect(h.writes()).toEqual([]);
  });
});

describe("matched issuance, replay and collection guards (offline)", () => {
  it.each(["amount", "name", "date", "paid", "hold", "new-service"])("rejects a stale full review after %s changes before any invoice write", async change => {
    const h = fixture(); const f = await reviewed(h);
    if (change === "amount") h.state.bookings[0].firstCleaningTotalCents = 501;
    if (change === "name") h.state.bookings[0].customerName = "Changed billing name";
    if (change === "date") h.state.bookings[0].requestedLocalDate = "2026-11-04";
    if (change === "paid") h.state.profiles = [{ bookingId: 201, paymentStatus: "captured" }];
    if (change === "hold") h.state.profiles = [{ bookingId: 201, paymentStatus: "authorized" }];
    if (change === "new-service") h.state.jobs = [job()];
    await expect(f.issue()).rejects.toMatchObject({ code: "REVIEW_CHANGED" });
    expect(h.writes()).toEqual([]); expect(h.rollback).toHaveBeenCalledOnce(); h.noPortal();
  });

  it("saves the normalized search contacts rather than the differing source billing email", async () => {
    const h = fixture(); const f = await reviewed(h, " (202) 555-0123 ", " JANICE@example.test ");
    expect((await f.issue()).lines).toMatchObject([{ occurrenceKey: KEY, date: DATE, amountCents: 500 }]);
    expect(h.state.invoices[0]).toMatchObject({ accountId: 0, clientPhone: PHONE, clientEmail: EMAIL, clientName: "Janice Matched" });
    const calls = h.sourceCalls().filter(([sql]) => sql.endsWith(" FOR UPDATE"));
    expect(calls[0][0]).toContain("FROM bookings b FORCE INDEX"); expect(calls[1][0]).toContain("FROM leadflow_jobs j FORCE INDEX");
    h.noPortal();
  });

  it("replays the original UUID after source change/deletion and rejects changed contacts, review, token or selection", async () => {
    const h = fixture(); const f = await reviewed(h); const invoice = await f.issue(); h.state.bookings = [];
    expect(await h.repo.replayIssue({ ...f.input, phone: "(202) 555-0123", email: " JANICE@example.test " }, TOKEN)).toEqual(invoice);
    for (const override of [{ phone: OTHER_PHONE }, { email: OTHER_EMAIL }, { phone: undefined }, { dueDate: "2026-11-21" },
      { from: "2026-11-02" }, { to: "2026-11-06" }, { clientId: 17 }, { reviewHash: "b".repeat(64) }, { serviceIds: ["job:101"] }]) {
      await expect(h.repo.replayIssue({ ...f.input, ...override }, TOKEN)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    }
    await expect(h.repo.replayIssue(f.input, "c".repeat(64))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await f.issue()).toEqual(invoice);
    const differentClient = { ...f.snapshot.client, email: OTHER_EMAIL };
    const differentPayload = createHash("sha256").update(JSON.stringify({ clientId: 0, billing: [differentClient.phone, differentClient.email, differentClient.name], from: FROM, to: TO, dueDate: f.input.dueDate, services: f.snapshot.services.map(s => [s.occurrenceKey, s.date, s.amountCents, s.paidCents ?? 0]) })).digest("hex");
    await expect(h.repo.issue({ ...f.input, email: OTHER_EMAIL }, differentClient, f.snapshot.services, TOKEN, differentPayload)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(h.writes().filter(([sql]) => sql.startsWith("INSERT INTO payable_invoices"))).toHaveLength(1); h.noPortal();
  });

  it("retains exact claim ownership and the unique-conflict fail-closed path", async () => {
    const h = fixture(); const f = await reviewed(h);
    h.state.claims = [{ occurrenceKey: KEY, invoiceId: 99 }];
    await expect(f.issue()).rejects.toMatchObject({ code: "SOURCE_ALREADY_INVOICED" }); expect(h.writes()).toEqual([]);
    h.state.claims = []; h.state.duplicateInvoice = true;
    await expect(f.issue()).rejects.toMatchObject({ code: "SOURCE_ALREADY_INVOICED" }); h.noPortal();
  });

  it.each(["amount", "date", "paid", "hold", "cancelled", "contact", "claim"])("blocks snapshot checkout after %s changes without reserving", async change => {
    const h = fixture(); const f = await reviewed(h); await f.issue(); h.execute.mockClear();
    if (change === "amount") h.state.bookings[0].firstCleaningTotalCents = 501;
    if (change === "date") h.state.bookings[0].requestedLocalDate = "2026-11-04";
    if (change === "paid") h.state.profiles = [{ bookingId: 201, paymentStatus: "captured" }];
    if (change === "hold") h.state.cash = [{ bookingId: 201, status: "pending" }];
    if (change === "cancelled") h.state.bookings[0].status = "cancelled";
    if (change === "contact") h.state.bookings[0].customerPhone = OTHER_PHONE;
    if (change === "claim") h.state.claims = [{ occurrenceKey: KEY, invoiceId: 99 }];
    await expect(h.repo.reserve(42, CHECKOUT, [1])).rejects.toBeDefined(); expect(h.writes()).toEqual([]); h.noPortal();
  });

  it("preserves invoice-level reservation and immutable request selection guards", async () => {
    const h = fixture(); const f = await reviewed(h); await f.issue();
    const attempt = await h.repo.reserve(42, CHECKOUT, [1]);
    expect(await h.repo.reserve(42, CHECKOUT, [1])).toEqual(attempt);
    await expect(h.repo.reserve(42, CHECKOUT, [2])).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(h.repo.reserve(42, "33333333-3333-4333-8333-333333333333", [1])).rejects.toMatchObject({ code: "CHECKOUT_IN_PROGRESS" });
    expect(h.writes().filter(([sql]) => sql.startsWith("INSERT INTO payable_invoice_attempts"))).toHaveLength(1); h.noPortal();
  });

  it("records explicit manual paid with account zero and replays without overwriting evidence", async () => {
    const h = fixture(); const f = await reviewed(h); await h.repo.markAlreadyPaid(f.input, 8);
    expect(h.state.manual[0]).toMatchObject({ accountId: 0, occurrenceKey: KEY, amountCents: 500, recordedByAgentId: 8 });
    expect((await h.repo.contactServices(PHONE, EMAIL, FROM, TO)).services[0]).toMatchObject({ paidCents: 500, paymentSource: "manual" });
    await h.repo.markAlreadyPaid(f.input, 8);
    await expect(h.repo.markAlreadyPaid({ ...f.input, email: OTHER_EMAIL }, 8)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(h.repo.markAlreadyPaid({ ...f.input, requestId: CHECKOUT }, 8)).rejects.toMatchObject({ code: "MANUAL_PAYMENT_CONFLICT" });
    expect(h.writes().filter(([sql]) => sql.startsWith("INSERT INTO payable_invoice_manual_payments"))).toHaveLength(1); h.noPortal();
  });

  it("rejects stale manual review and exact invoice claims without source writes", async () => {
    const h = fixture(); const f = await reviewed(h);
    await expect(h.repo.markAlreadyPaid({ ...f.input, reviewHash: "b".repeat(64) }, 8)).rejects.toMatchObject({ code: "REVIEW_CHANGED" });
    h.state.claims = [{ occurrenceKey: KEY, invoiceId: 99 }];
    await expect(h.repo.markAlreadyPaid(f.input, 8)).rejects.toMatchObject({ code: "SOURCE_ALREADY_INVOICED" });
    expect(h.writes()).toEqual([]); h.noPortal();
  });

  it("keeps positive-account email-first ownership and account claim checks unchanged", async () => {
    const h = fixture(); h.state.accounts = [{ id: 17, customerName: "Existing owner", customerPhone: PHONE, customerEmail: EMAIL }];
    h.state.bookings = [booking(), booking({ id: 202, customerEmail: EMAIL }), booking({ id: 203, customerEmail: "" })];
    expect((await h.repo.services(17, FROM, TO)).services.map(s => s.id)).toEqual([`booking:202:first:${DATE}`, `booking:203:first:${DATE}`]);
    expect(h.sourceCalls().every(([sql]) => sql.includes("COALESCE(TRIM(") && !sql.includes("= NULLIF(?, '') OR"))).toBe(true);
    h.state.manual = [{ occurrenceKey: `booking:202:first:${DATE}`, sourceServiceId: `booking:202:first:${DATE}`, accountId: 18, serviceDate: DATE, amountCents: 500 }];
    await expect(h.repo.services(17, FROM, TO)).rejects.toMatchObject({ code: "MANUAL_PAYMENT_CONFLICT" });
    expect(h.writes()).toEqual([]);
  });
});
