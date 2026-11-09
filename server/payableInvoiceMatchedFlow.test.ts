import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { InvoiceError, invoiceBalance, invoiceIssueSchema, invoiceMarkPaidSchema, selectedBalance, type InvoiceAttempt, type InvoiceClient, type InvoiceService, type PayableInvoice } from "../shared/payableInvoice";
import { INVOICE_PAYMENT_MARKER, invoiceTokenHash, PayableInvoiceService, type InvoiceIssueInput, type InvoiceMarkPaidInput, type InvoiceRepository } from "./payableInvoiceService";
import { invoiceReviewHash } from "./payableInvoiceReview";

// TEST ONLY: real service + in-memory contacts/storage + provider fake. No portal,
// application repository, startup, credentials, DB, delivery, or network imports.
const DAY = "2026-11-09";
const DUE = "2026-11-16";
const NOW = Date.parse(`${DAY}T12:00:00Z`);
const REQUEST = "11111111-1111-4111-8111-111111111111";
const CHECKOUT_REQUEST = "22222222-2222-4222-8222-222222222222";
const CLIENT: InvoiceClient = { id: 0, name: "Matched Booking Customer", phone: "+12025550109", email: "matched@example.test" };
const booking = (overrides: Partial<InvoiceService> = {}): InvoiceService => ({ id: "job:901", occurrenceKey: "job:901", date: DAY, description: "Matched $5 booking", address: "Test address", amountCents: 500, paidCents: 0, paymentSource: null, status: "completed", eligible: true, reason: null, ...overrides });

class TEST_ONLY_MatchedRepository implements InvoiceRepository {
  client = { ...CLIENT };
  rows = [booking()];
  invoice: PayableInvoice | null = null;
  storedTokenHash = "";
  attempts: InvoiceAttempt[] = [];
  allocationEffects = 0;
  manualEffects = 0;
  manualRequests: string[] = [];
  issued: { requestId: string; tokenHash: string; payloadHash: string; invoice: PayableInvoice }[] = [];
  snapshot = () => ({ client: { ...this.client }, services: this.rows.map(row => ({ ...row })) });
  lookup = vi.fn(async (_phone: string, _email: string, _from: string, _to: string) => this.snapshot());
  services = vi.fn(async (_clientId: number, _from: string, _to: string) => this.snapshot());
  contactServices = vi.fn(async (_phone: string, _email: string, _from: string, _to: string) => this.snapshot());
  issue = vi.fn(async (input: InvoiceIssueInput, client: InvoiceClient, rows: InvoiceService[], tokenHash: string, payloadHash: string): Promise<PayableInvoice> => {
    const prior = this.issued.find(row => row.requestId === input.requestId);
    if (prior) {
      if (prior.tokenHash !== tokenHash || prior.payloadHash !== payloadHash) throw new InvoiceError("REQUEST_CONFLICT", 409, "Request payload changed.");
      return prior.invoice;
    }
    this.storedTokenHash = tokenHash;
    this.invoice = { id: 901, number: "TEST-MATCHED-901", clientId: client.id, clientName: client.name, from: input.from, to: input.to, dueDate: input.dueDate, currency: "usd", status: "open", receipts: [], activeAttemptId: null,
      lines: rows.map((row, index) => ({ id: index + 1, occurrenceKey: row.occurrenceKey, date: row.date, description: row.description, address: row.address, amountCents: row.amountCents, paidCents: row.paidCents || 0, manualPaidCents: row.paymentSource === "manual" ? row.paidCents || 0 : 0 })) };
    this.issued.push({ requestId: input.requestId, tokenHash, payloadHash, invoice: this.invoice });
    return this.invoice;
  });
  byToken = vi.fn(async (hash: string) => hash === this.storedTokenHash ? this.invoice : null);
  reserve = vi.fn(async (invoiceId: number, requestId: string, lineIds: number[]): Promise<InvoiceAttempt> => {
    const invoice = this.invoice!;
    const existing = this.attempts.find(row => row.requestId === requestId || row.id === invoice.activeAttemptId);
    if (existing) return existing;
    const attempt: InvoiceAttempt = { id: "attempt-matched-1", invoiceId, requestId, lineIds: lineIds.slice(), amountCents: selectedBalance(invoice, lineIds), currency: "usd", state: "pending", sessionId: null, sessionUrl: null, createdAt: NOW };
    this.attempts.push(attempt); invoice.activeAttemptId = attempt.id;
    return attempt;
  });
  attachSession = vi.fn(async (id: string, sessionId: string, url: string) => { const attempt = this.attempts.find(row => row.id === id)!; attempt.sessionId = sessionId; attempt.sessionUrl = url; attempt.state = "session_open"; });
  attempt = vi.fn(async (id: string) => this.attempts.find(row => row.id === id) || null);
  settle = vi.fn(async (id: string, sessionId: string, paymentId: string, amountCents: number) => {
    const attempt = this.attempts.find(row => row.id === id)!;
    const invoice = this.invoice!;
    if (attempt.state === "paid" || invoice.receipts.some(row => row.paymentId === paymentId)) return;
    if (sessionId !== attempt.sessionId || amountCents !== attempt.amountCents) throw new Error("TEST ONLY invalid allocation");
    attempt.lineIds.forEach(lineId => { const line = invoice.lines.find(row => row.id === lineId)!; line.paidCents = line.amountCents; });
    invoice.receipts.push({ paymentId, amountCents, paidAt: `${DAY}T12:00:00Z`, lineIds: attempt.lineIds.slice() });
    invoice.status = invoiceBalance(invoice.lines) === 0 ? "paid" : "partially_paid";
    invoice.activeAttemptId = null; attempt.state = "paid"; this.allocationEffects++;
  });
  markAlreadyPaid = vi.fn(async (input: InvoiceMarkPaidInput, _agentId: number) => {
    if (this.manualRequests.includes(input.requestId)) return;
    if (input.reviewHash !== invoiceReviewHash(this.client, this.rows, input.from, input.to)) throw new InvoiceError("REVIEW_CHANGED", 409, "Pull bookings again.");
    const selected = input.serviceIds.map(id => this.rows.find(row => row.id === id));
    if (selected.some(row => !row || !row.eligible || (row.paidCents || 0) >= row.amountCents)) throw new InvoiceError("BALANCE_CHANGED", 409, "Payment selection changed.");
    selected.forEach(row => { row!.paidCents = row!.amountCents; row!.paymentSource = "manual"; });
    this.manualRequests.push(input.requestId); this.manualEffects++;
  });
}
function harness() {
  const repo = new TEST_ONLY_MatchedRepository();
  const create = vi.fn(async (_params: Stripe.Checkout.SessionCreateParams, _options?: Stripe.RequestOptions) => ({ id: "cs_test_matched", url: "https://checkout.stripe.com/c/pay/test_matched" }));
  const retrieve = vi.fn(async (_id: string): Promise<Stripe.Checkout.Session> => ({ id: "cs_test_matched", object: "checkout.session", mode: "payment", livemode: false, payment_status: "paid", amount_total: repo.attempts[0].amountCents, currency: "usd", client_reference_id: "attempt-matched-1", payment_intent: "pi_test_matched", metadata: { leadflowInvoice: INVOICE_PAYMENT_MARKER, invoiceId: "901", invoiceAttemptId: "attempt-matched-1" } } as unknown as Stripe.Checkout.Session));
  const stripe = vi.fn(() => ({ checkout: { sessions: { create, retrieve } } } as unknown as Stripe));
  const assertCollectionReady = vi.fn(async (_source: InvoiceService[] | PayableInvoice) => {});
  const service = new PayableInvoiceService({ repo, stripe, assertCollectionReady, origin: "https://invoice.example.test", tokenSecret: "test-only-matched-secret-not-a-real-key-2026", now: () => NOW });
  return { repo, service, stripe, create, retrieve, assertCollectionReady };
}
const issueInput = (repo: TEST_ONLY_MatchedRepository): InvoiceIssueInput => invoiceIssueSchema.parse({ requestId: REQUEST, clientId: repo.client.id, ...(repo.client.id === 0 ? { phone: repo.client.phone, email: repo.client.email || "" } : {}), from: DAY, to: DAY, dueDate: DUE, serviceIds: repo.rows.filter(row => row.eligible && row.amountCents > (row.paidCents || 0)).map(row => row.id), confirmedUnpaid: true, reviewHash: invoiceReviewHash(repo.client, repo.rows, DAY, DAY) });
const markInput = (repo: TEST_ONLY_MatchedRepository, ids = ["job:901"]): InvoiceMarkPaidInput => { const { dueDate: _due, confirmedUnpaid: _confirmed, ...input } = issueInput(repo); return invoiceMarkPaidSchema.parse({ ...input, serviceIds: ids }); };

describe("matched-contact invoice creation without a portal account", () => {
  it.each(["both", "phone only", "email only"])("looks up, schemas and issues the single Nov 9 $5 booking using %s", async mode => {
    const h = harness();
    if (mode === "phone only") h.repo.client.email = null;
    if (mode === "email only") h.repo.client.phone = "";
    const pulled = await h.service.lookup(h.repo.client.phone, h.repo.client.email || "", DAY, DAY);
    expect(pulled.client).toEqual(h.repo.client); expect(pulled.client!.id).toBe(0); expect(pulled.reviewHash).toMatch(/^[a-f0-9]{64}$/);
    const input = issueInput(h.repo); expect(input.reviewHash).toBe(pulled.reviewHash);
    const result = await h.service.issue(input);
    expect(h.repo.contactServices).toHaveBeenCalledWith(input.phone, input.email, DAY, DAY); expect(h.repo.services).not.toHaveBeenCalled();
    expect(h.repo.issue).toHaveBeenCalledWith(input, pulled.client, pulled.services, expect.stringMatching(/^[a-f0-9]{64}$/), expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(result.invoice).toMatchObject({ clientId: 0, clientName: CLIENT.name, dueDate: DUE }); expect(result.invoice.lines.map(row => [row.date, row.amountCents, row.paidCents])).toEqual([[DAY, 500, 0]]);
    const token = result.url.split("/").pop()!; expect(result.url).toBe(`https://invoice.example.test/invoice/${token}`); expect(h.repo.storedTokenHash).toBe(invoiceTokenHash(token)); expect(await h.service.view(token)).toBe(result.invoice);
    expect(h.stripe).not.toHaveBeenCalled(); expect(h.repo.settle).not.toHaveBeenCalled();
  });
  it("checks out exactly 500 cents and allocates retrieved fake-paid confirmation only once", async () => {
    const h = harness(); const result = await h.service.issue(issueInput(h.repo)); const token = result.url.split("/").pop()!;
    const checkout = await h.service.checkout(token, CHECKOUT_REQUEST, [1]);
    expect(checkout.url).toBe("https://checkout.stripe.com/c/pay/test_matched");
    expect(h.create.mock.calls[0][0].line_items).toEqual([{ price_data: { currency: "usd", unit_amount: 500, product_data: { name: "Maids in Black invoice TEST-MATCHED-901", description: "1 selected service date" } }, quantity: 1 }]);
    expect(h.create.mock.calls[0][1]).toEqual({ idempotencyKey: "leadflow:invoice:901:attempt:attempt-matched-1" });
    expect(await h.service.checkout(token, CHECKOUT_REQUEST, [1])).toEqual(checkout); expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.repo.allocationEffects).toBe(0);
    const event = { id: "evt_test_matched", object: "event", type: "checkout.session.completed", livemode: false, data: { object: { id: "cs_test_matched", metadata: { leadflowInvoice: INVOICE_PAYMENT_MARKER }, payment_status: "unpaid", amount_total: 1 } } } as unknown as Stripe.Event;
    await h.service.reconcile(event); await h.service.reconcile(event); await h.service.refresh(token);
    expect(h.retrieve).toHaveBeenCalledWith("cs_test_matched"); expect(h.repo.settle).toHaveBeenCalledWith("attempt-matched-1", "cs_test_matched", "pi_test_matched", 500);
    expect(h.repo.allocationEffects).toBe(1); expect(result.invoice.receipts).toEqual([{ paymentId: "pi_test_matched", amountCents: 500, paidAt: `${DAY}T12:00:00Z`, lineIds: [1] }]);
    expect(result.invoice.status).toBe("paid"); expect(invoiceBalance(result.invoice.lines)).toBe(0);
  });
  it("uses the full mixed paid snapshot but issues only eligible unpaid remainder rows", async () => {
    const h = harness(); h.repo.rows.push(booking({ id: "job:902", occurrenceKey: "job:902", amountCents: 700, paidCents: 700, paymentSource: "manual" }), booking({ id: "job:903", occurrenceKey: "job:903", amountCents: 800, paidCents: 800, paymentSource: "stripe" }), booking({ id: "job:904", occurrenceKey: "job:904", amountCents: 900, paidCents: 400 }), booking({ id: "job:905", occurrenceKey: "job:905", eligible: false, reason: "Needs review" }));
    const input = issueInput(h.repo); expect(input.serviceIds).toEqual(["job:901", "job:904"]);
    expect(input.reviewHash).not.toBe(invoiceReviewHash(h.repo.client, h.repo.rows.filter(row => input.serviceIds.includes(row.id)), DAY, DAY));
    const result = await h.service.issue(input); expect(result.invoice.lines.map(row => [row.occurrenceKey, row.amountCents, row.paidCents])).toEqual([["job:901", 500, 0], ["job:904", 900, 400]]);
    await h.service.checkout(result.url.split("/").pop()!, CHECKOUT_REQUEST, [1, 2]); expect(h.create.mock.calls[0][0].line_items![0].price_data!.unit_amount).toBe(1000);
  });
  it.each(["phone", "email", "name", "paid service"])("rejects stale review when matched %s changes before issuance", async kind => {
    const h = harness(); h.repo.rows.push(booking({ id: "job:902", occurrenceKey: "job:902", paidCents: 500, paymentSource: "manual" })); const input = issueInput(h.repo);
    if (kind === "phone") h.repo.client.phone = "+12025550999";
    else if (kind === "email") h.repo.client.email = "changed@example.test";
    else if (kind === "name") h.repo.client.name = "Changed matched name";
    else h.repo.rows[1].description = "Changed paid booking";
    await expect(h.service.issue(input)).rejects.toMatchObject({ code: "REVIEW_CHANGED", status: 409 }); expect(h.repo.issue).not.toHaveBeenCalled(); expect(h.stripe).not.toHaveBeenCalled();
  });
  it.each(["phone", "email"])("rejects changed request %s with the original review hash", async field => {
    const h = harness(); const input = { ...issueInput(h.repo), [field]: field === "phone" ? "+12025550999" : "other@example.test" };
    h.repo.contactServices.mockResolvedValueOnce({ ...h.repo.snapshot(), client: { ...h.repo.client, [field]: input[field as "phone" | "email"] } as InvoiceClient });
    await expect(h.service.issue(invoiceIssueSchema.parse(input))).rejects.toMatchObject({ code: "REVIEW_CHANGED", status: 409 }); expect(h.repo.issue).not.toHaveBeenCalled(); expect(h.stripe).not.toHaveBeenCalled();
  });
  it.each(["phone", "email", "name"])("rejects same UUID and same service IDs after billing %s changes even with a fresh valid hash", async field => {
    const h = harness(); const original = issueInput(h.repo); const first = await h.service.issue(original);
    expect(await h.service.issue(original)).toEqual(first); expect(h.repo.issued).toHaveLength(1);
    if (field === "phone") h.repo.client.phone = "+12025550999";
    else if (field === "email") h.repo.client.email = "changed@example.test";
    else h.repo.client.name = "Changed billing name";
    const changed = issueInput(h.repo); expect(changed.requestId).toBe(original.requestId); expect(changed.serviceIds).toEqual(original.serviceIds); expect(changed.reviewHash).not.toBe(original.reviewHash);
    await expect(h.service.issue(changed)).rejects.toMatchObject({ code: "REQUEST_CONFLICT", status: 409 });
    expect(h.repo.issue.mock.calls[2][3]).toBe(h.repo.issue.mock.calls[0][3]); expect(h.repo.issue.mock.calls[2][4]).not.toBe(h.repo.issue.mock.calls[0][4]);
    expect(h.repo.issued).toHaveLength(1); expect(h.repo.invoice).toBe(first.invoice); expect(h.stripe).not.toHaveBeenCalled();
  });
  it("keeps historical positive-ID request hashing unchanged when only the contact snapshot changes", async () => {
    const h = harness(); h.repo.client.id = 42; const original = issueInput(h.repo); const first = await h.service.issue(original);
    h.repo.client.phone = "+12025550999"; h.repo.client.email = "changed@example.test"; h.repo.client.name = "Changed historical name";
    const refreshed = issueInput(h.repo); expect(refreshed.reviewHash).not.toBe(original.reviewHash); expect(await h.service.issue(refreshed)).toEqual(first);
    expect(h.repo.issue.mock.calls[1][4]).toBe(h.repo.issue.mock.calls[0][4]); expect(h.repo.contactServices).not.toHaveBeenCalled(); expect(h.repo.services).toHaveBeenCalledTimes(2);
  });
  it("refreshes id-zero manual-paid state with matched contacts and only the explicit selected ID", async () => {
    const h = harness(); h.repo.rows.push(booking({ id: "job:902", occurrenceKey: "job:902", amountCents: 600 })); const input = markInput(h.repo);
    const refreshed = await h.service.markAlreadyPaid(input, 7);
    expect(h.repo.markAlreadyPaid).toHaveBeenCalledWith(input, 7); expect(h.repo.contactServices).toHaveBeenCalledWith(CLIENT.phone, CLIENT.email, DAY, DAY); expect(h.repo.services).not.toHaveBeenCalled();
    expect(refreshed.services.map(row => [row.id, row.amountCents, row.paidCents])).toEqual([["job:901", 500, 500], ["job:902", 600, 0]]);
    expect(refreshed.reviewHash).toBe(invoiceReviewHash(refreshed.client, refreshed.services, DAY, DAY)); expect(refreshed.reviewHash).not.toBe(input.reviewHash);
    await h.service.markAlreadyPaid(input, 7); expect(h.repo.manualEffects).toBe(1);
    const remaining = await h.service.issue(issueInput(h.repo)); expect(remaining.invoice.lines.map(row => row.occurrenceKey)).toEqual(["job:902"]); expect(h.stripe).not.toHaveBeenCalled(); expect(h.repo.reserve).not.toHaveBeenCalled();
  });
  it("rejects stale manual-paid hash before fake allocation and refresh", async () => {
    const h = harness(); const input = markInput(h.repo); h.repo.rows[0].amountCents = 600;
    await expect(h.service.markAlreadyPaid(input, 7)).rejects.toMatchObject({ code: "REVIEW_CHANGED" }); expect(h.repo.manualEffects).toBe(0); expect(h.repo.contactServices).not.toHaveBeenCalled(); expect(h.stripe).not.toHaveBeenCalled();
  });
  it("preserves positive-ID issuance and manual-paid refresh without adding contacts", async () => {
    const h = harness(); h.repo.client.id = 42; const issue = issueInput(h.repo); const mark = markInput(h.repo);
    expect(issue).not.toHaveProperty("phone"); expect(issue).not.toHaveProperty("email"); expect(mark).not.toHaveProperty("phone"); expect(mark).not.toHaveProperty("email");
    await h.service.issue(issue); await h.service.markAlreadyPaid(mark, 7); expect(h.repo.services).toHaveBeenCalledTimes(2); expect(h.repo.services).toHaveBeenCalledWith(42, DAY, DAY); expect(h.repo.contactServices).not.toHaveBeenCalled(); expect(h.stripe).not.toHaveBeenCalled();
  });
  it("fails closed for id-zero when the optional matched-contact repository contract is absent", async () => {
    const h = harness(); const input = issueInput(h.repo); Object.assign(h.repo, { contactServices: undefined });
    await expect(h.service.issue(input)).rejects.toMatchObject({ code: "INVALID_CUSTOMER", status: 400 }); expect(h.repo.services).not.toHaveBeenCalled(); expect(h.repo.issue).not.toHaveBeenCalled();
  });
});

describe("matched invoice strict identity schemas", () => {
  it.each([{ phone: CLIENT.phone }, { email: CLIENT.email }, { phone: CLIENT.phone, email: CLIENT.email }])("accepts id-zero issue and explicit manual-paid contacts %j", contacts => {
    const repo = new TEST_ONLY_MatchedRepository(); const { phone: _phone, email: _email, ...issue } = issueInput(repo); const { phone: _markPhone, email: _markEmail, ...mark } = markInput(repo);
    expect(invoiceIssueSchema.parse({ ...issue, ...contacts })).toEqual({ ...issue, ...contacts }); expect(invoiceMarkPaidSchema.parse({ ...mark, ...contacts })).toEqual({ ...mark, ...contacts });
  });
  it.each([{}, { phone: "", email: "" }, { phone: "   ", email: " " }, { email: "not-an-email" }])("rejects id-zero without a usable contact %j", contacts => {
    const repo = new TEST_ONLY_MatchedRepository(); const { phone: _phone, email: _email, ...issue } = issueInput(repo); const { phone: _markPhone, email: _markEmail, ...mark } = markInput(repo);
    expect(invoiceIssueSchema.safeParse({ ...issue, ...contacts }).success).toBe(false); expect(invoiceMarkPaidSchema.safeParse({ ...mark, ...contacts }).success).toBe(false);
  });
  it.each([-1, 0.5])("rejects unsupported client identity %s", clientId => {
    const repo = new TEST_ONLY_MatchedRepository(); expect(invoiceIssueSchema.safeParse({ ...issueInput(repo), clientId }).success).toBe(false); expect(invoiceMarkPaidSchema.safeParse({ ...markInput(repo), clientId }).success).toBe(false);
  });
  it("keeps prices browser-forbidden and creation confirmation exact", () => {
    const input = issueInput(new TEST_ONLY_MatchedRepository()); expect(invoiceIssueSchema.safeParse({ ...input, amountCents: 1 }).success).toBe(false); expect(invoiceIssueSchema.safeParse({ ...input, confirmedUnpaid: false }).success).toBe(false);
  });
});
