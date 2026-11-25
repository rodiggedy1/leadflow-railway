import { describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";
import type Stripe from "stripe";
import { MysqlInvoiceRepository } from "./payableInvoiceRepository";
import { INVOICE_PAYMENT_MARKER, invoiceTokenHash, PayableInvoiceService } from "./payableInvoiceService";

// OFFLINE ONLY: the real service and repository run against this narrow SQL
// dispatcher. No database/provider connection exists. This is not a SQL engine
// or evidence about production transaction timing or concurrency.
type Row = Record<string, unknown>;
type Values = (string | number | null)[];
const TOKEN = "d".repeat(64);
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ORIGIN = "https://invoice.example.test";
function fixture(accountId = 17) {
  const state = {
    invoice: { id: 42, number: "OFFLINE-42", accountId, clientName: "Saved invoice customer", clientPhone: "+12025550123", clientEmail: "saved@example.test",
      periodFrom: "2026-11-01", periodTo: "2026-11-30", dueDate: "2026-12-10", currency: "usd", status: "open", activeAttemptId: null,
      requestId: A, payloadHash: "a".repeat(64), reviewHash: "b".repeat(64), tokenHash: invoiceTokenHash(TOKEN), tokenExpiresAt: Date.now() + 86_400_000 } as Row,
    lines: [
      { id: 1, occurrenceKey: "job:101", serviceDate: "2026-11-02", description: "Saved service", address: "Saved address", amountCents: 12_345, paidCents: 0, manualPaidCents: 0 },
      { id: 2, occurrenceKey: "booking:201:2026-11-20", serviceDate: "2026-11-20", description: "Saved service", address: "Saved address", amountCents: 6_789, paidCents: 0, manualPaidCents: 0 },
    ] as Row[],
    attempts: [] as Row[],
  };
  const sql: string[] = [];
  const execute = vi.fn(async (raw: string, values: Values = []) => {
    const query = raw.replace(/\s+/g, " ").trim(); sql.push(query);
    let result: Row[] | { affectedRows: number };
    if (query.startsWith("SELECT id, number, accountId,") && query.endsWith("FROM payable_invoices WHERE tokenHash = ? AND tokenExpiresAt > ? LIMIT 1 FOR UPDATE")) {
      result = state.invoice.tokenHash === values[0] && Number(state.invoice.tokenExpiresAt) > Number(values[1]) ? [state.invoice] : [];
    } else if (query.startsWith("SELECT id, number, accountId,") && query.endsWith("FROM payable_invoices WHERE id = ? LIMIT 1 FOR UPDATE")) {
      result = state.invoice.id === values[0] ? [state.invoice] : [];
    } else if (query === "SELECT id, occurrenceKey, serviceDate, description, address, amountCents, paidCents, manualPaidCents FROM payable_invoice_lines WHERE invoiceId = ? ORDER BY serviceDate, id LIMIT 1001 FOR UPDATE") {
      result = state.invoice.id === values[0] ? state.lines : [];
    } else if (query === "SELECT a.attemptId, a.lineId, a.paymentId, a.amountCents, a.paidAtMs, t.refundedCents FROM payable_invoice_allocations a INNER JOIN payable_invoice_attempts t ON t.id = a.attemptId AND t.invoiceId = a.invoiceId WHERE a.invoiceId = ? ORDER BY a.paidAtMs, a.attemptId, a.lineId LIMIT 1001 FOR UPDATE") {
      result = [];
    } else if (query === "SELECT invoiceId FROM payable_invoice_attempts WHERE id = ? LIMIT 1") {
      result = state.attempts.filter(row => row.id === values[0]).map(row => ({ invoiceId: row.invoiceId }));
    } else if (query.startsWith("SELECT id, invoiceId, requestId, selectedLineIds,")) {
      if (query.endsWith("FROM payable_invoice_attempts WHERE invoiceId = ? AND requestId = ? LIMIT 1 FOR UPDATE")) result = state.attempts.filter(row => row.invoiceId === values[0] && row.requestId === values[1]);
      else if (query.endsWith("FROM payable_invoice_attempts WHERE id = ? LIMIT 1") || query.endsWith("FROM payable_invoice_attempts WHERE id = ? LIMIT 1 FOR UPDATE")) result = state.attempts.filter(row => row.id === values[0]);
      else throw new Error(`Unexpected checkout attempt query: ${query}`);
    } else if (query === "INSERT INTO payable_invoice_attempts (id, invoiceId, requestId, selectedLineIds, amountCents, currency, state, createdAtMs) VALUES (?, ?, ?, ?, ?, 'usd', 'pending', ?)") {
      const [id, invoiceId, requestId, selectedLineIds, amountCents, createdAtMs] = values;
      state.attempts.push({ id, invoiceId, requestId, selectedLineIds, amountCents, createdAtMs, currency: "usd", state: "pending", sessionId: null, sessionUrl: null, paymentId: null, paidAtMs: null, refundedCents: 0 });
      result = { affectedRows: 1 };
    } else if (query === "UPDATE payable_invoices SET activeAttemptId = ? WHERE id = ? AND activeAttemptId IS NULL AND status IN ('open', 'partially_paid')") {
      const matches = state.invoice.id === values[1] && state.invoice.activeAttemptId === null && ["open", "partially_paid"].includes(String(state.invoice.status));
      if (matches) state.invoice.activeAttemptId = values[0]; result = { affectedRows: matches ? 1 : 0 };
    } else if (query === "UPDATE payable_invoice_attempts SET sessionId = ?, sessionUrl = ?, state = CASE WHEN state = 'paid' THEN 'paid' ELSE 'session_open' END WHERE id = ? AND invoiceId = ?") {
      const row = state.attempts.find(row => row.id === values[2] && row.invoiceId === values[3]);
      if (row) { row.sessionId = values[0]; row.sessionUrl = values[1]; if (row.state !== "paid") row.state = "session_open"; } result = { affectedRows: row ? 1 : 0 };
    } else if (query === "UPDATE payable_invoice_attempts SET state = 'expired' WHERE id = ? AND invoiceId = ? AND state IN ('pending', 'session_open')") {
      const row = state.attempts.find(row => row.id === values[0] && row.invoiceId === values[1] && ["pending", "session_open"].includes(String(row.state)));
      if (row) row.state = "expired"; result = { affectedRows: row ? 1 : 0 };
    } else if (query === "UPDATE payable_invoices SET activeAttemptId = NULL WHERE id = ? AND activeAttemptId = ?") {
      const matches = state.invoice.id === values[0] && state.invoice.activeAttemptId === values[1];
      if (matches) state.invoice.activeAttemptId = null; result = { affectedRows: matches ? 1 : 0 };
    } else {
      // Any source-period/contact/booking/payment-observation/claim re-audit fails,
      // including unselected sources. Only the above invoice-ledger SQL exists.
      throw new Error(`Checkout tried a non-ledger query: ${query}`);
    }
    return [structuredClone(result), []];
  });
  let snapshot: typeof state | null = null;
  const connection = { execute, beginTransaction: vi.fn(async () => { snapshot = structuredClone(state); }),
    commit: vi.fn(async () => { snapshot = null; }), rollback: vi.fn(async () => { if (snapshot) Object.assign(state, snapshot); snapshot = null; }), release: vi.fn() };
  const pool = { execute, getConnection: vi.fn(async () => connection) } as unknown as Pool;
  const repo = new MysqlInvoiceRepository(async () => pool);
  const readiness = vi.fn(async () => { throw new Error("Checkout must not call operational collection readiness"); });
  const sessions = new Map<string, Stripe.Checkout.Session>();
  const create = vi.fn(async (params: Stripe.Checkout.SessionCreateParams, _options: Stripe.RequestOptions) => {
    const id = `cs_test_saved_${sessions.size + 1}`;
    const session = { id, url: `https://checkout.stripe.com/c/pay/${id}`, mode: "payment", status: "open", payment_status: "unpaid", currency: "usd",
      amount_total: params.line_items![0].price_data!.unit_amount, client_reference_id: params.client_reference_id, metadata: params.metadata, livemode: false } as Stripe.Checkout.Session;
    sessions.set(id, session); return structuredClone(session);
  });
  const retrieve = vi.fn(async (id: string) => { const session = sessions.get(id); if (!session) throw new Error("Unknown offline session"); return structuredClone(session); });
  const expire = vi.fn(async (id: string) => { const session = sessions.get(id); if (!session) throw new Error("Unknown offline session"); session.status = "expired"; return structuredClone(session); });
  const stripe = vi.fn(() => ({ checkout: { sessions: { create, retrieve, expire } } } as unknown as Stripe));
  const service = new PayableInvoiceService({ repo, stripe, origin: ORIGIN, tokenSecret: "offline-only-secret-not-a-real-production-key", assertCollectionReady: readiness });
  const active = () => state.attempts.find(row => row.id === state.invoice.activeAttemptId)!;
  const noAudit = () => { expect(readiness).not.toHaveBeenCalled(); expect(sql.every(query => !/\b(?:leadflow_jobs|bookings|customer_portal_accounts|booking_payment_profiles|payment_authorizations|booking_cash_app_payments|payable_invoice_manual_payments)\b/.test(query))).toBe(true); };
  return { state, repo, service, readiness, sessions, create, retrieve, expire, stripe, sql, active, noAudit };
}

function exactCreate(h: ReturnType<typeof fixture>, amountCents: number, count = 1) {
  const row = h.active(); const metadata = { leadflowInvoice: INVOICE_PAYMENT_MARKER, invoiceId: "42", invoiceAttemptId: String(row.id) };
  expect(h.create).toHaveBeenLastCalledWith({ mode: "payment", payment_method_types: ["card"], client_reference_id: row.id,
    line_items: [{ price_data: { currency: "usd", unit_amount: amountCents, product_data: { name: "Maids in Black invoice OFFLINE-42", description: `${count} selected service date${count === 1 ? "" : "s"}` } }, quantity: 1 }],
    metadata, payment_intent_data: { metadata }, success_url: `${ORIGIN}/invoice/${TOKEN}?returned=1`, cancel_url: `${ORIGIN}/invoice/${TOKEN}`,
    expires_at: Math.floor(Number(row.createdAtMs) / 1000) + 24 * 60 * 60,
  }, { idempotencyKey: `leadflow:invoice:42:attempt:${row.id}` });
  h.noAudit();
}

describe("saved unpaid invoice → actual service → actual repository → mocked Stripe (offline)", () => {
  it.each([0, 17])("opens one saved unpaid date at its exact cents with no source reads for invoice account %s", async accountId => {
    const h = fixture(accountId);
    expect(await h.service.checkout(TOKEN, A, [2])).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_saved_1" });
    expect(h.active()).toMatchObject({ selectedLineIds: "[2]", amountCents: 6_789, state: "session_open", sessionId: "cs_test_saved_1" });
    expect(h.create).toHaveBeenCalledOnce(); expect(h.retrieve).not.toHaveBeenCalled(); expect(h.expire).not.toHaveBeenCalled(); exactCreate(h, 6_789);
  });
  it("keeps the all-unpaid total and canonical IDs with no source-period audit", async () => {
    const h = fixture(); await h.service.checkout(TOKEN, A, [2, 1]);
    expect(h.active()).toMatchObject({ selectedLineIds: "[1,2]", amountCents: 19_134 }); exactCreate(h, 19_134, 2);
  });
  it.each([A, B])("reuses the same saved selection with request %s without another create or source audit", async request => {
    const h = fixture(); const result = await h.service.checkout(TOKEN, A, [2]);
    expect(await h.service.checkout(TOKEN, request, [2])).toEqual(result);
    expect(h.create).toHaveBeenCalledOnce(); expect(h.retrieve).toHaveBeenCalledOnce(); expect(h.expire).not.toHaveBeenCalled(); h.noAudit();
  });
  it("switches dates using only saved cents and safely retires the old unpaid session without booking audits", async () => {
    const h = fixture(); await h.service.checkout(TOKEN, A, [1]);
    expect(await h.service.checkout(TOKEN, B, [2])).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_saved_2" });
    expect(h.state.attempts[0].state).toBe("expired"); expect(h.expire).toHaveBeenCalledWith("cs_test_saved_1"); expect(h.create).toHaveBeenCalledTimes(2); exactCreate(h, 6_789);
  });
  it("replaces a terminal unpaid session without re-auditing the source period", async () => {
    const h = fixture(); await h.service.checkout(TOKEN, A, [2]); h.sessions.get("cs_test_saved_1")!.status = "expired";
    expect(await h.service.checkout(TOKEN, B, [2])).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_saved_2" });
    expect(h.state.attempts[0].state).toBe("expired"); expect(h.expire).not.toHaveBeenCalled(); expect(h.create).toHaveBeenCalledTimes(2); exactCreate(h, 6_789);
  });
  it("retains immutable UUID/selection protection before touching the previous unpaid Stripe session", async () => {
    const h = fixture(); await h.service.checkout(TOKEN, A, [1]);
    await expect(h.service.checkout(TOKEN, A, [2])).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(h.create).toHaveBeenCalledOnce(); expect(h.expire).not.toHaveBeenCalled(); expect(h.retrieve).not.toHaveBeenCalled(); h.noAudit();
  });
  it("does not create Stripe for a saved date already paid on the invoice ledger", async () => {
    const h = fixture(); Object.assign(h.state.lines[1], { paidCents: 6_789, manualPaidCents: 6_789 }); h.state.invoice.status = "partially_paid";
    await expect(h.service.checkout(TOKEN, A, [2])).rejects.toMatchObject({ code: "BALANCE_CHANGED" });
    expect(h.stripe).not.toHaveBeenCalled(); expect(h.state.attempts).toHaveLength(0); h.noAudit();
  });
  it("does not accept another invoice's line ID or create Stripe for it", async () => {
    const h = fixture(); await expect(h.service.checkout(TOKEN, A, [999])).rejects.toMatchObject({ code: "BALANCE_CHANGED" });
    expect(h.stripe).not.toHaveBeenCalled(); expect(h.state.attempts).toHaveLength(0); h.noAudit();
  });
});
