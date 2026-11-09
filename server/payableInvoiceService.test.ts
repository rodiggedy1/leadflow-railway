import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { invoiceReviewHash } from "./payableInvoiceReview";
import {
  invoiceBalance,
  invoiceCheckoutSchema,
  invoiceDate,
  invoiceIssueSchema,
  invoicePeriodSchema,
  invoiceTotal,
  safeSum,
  selectedBalance,
  InvoiceError,
  type InvoiceAttempt,
  type InvoiceClient,
  type InvoiceService,
  type PayableInvoice,
} from "../shared/payableInvoice";
import {
  INVOICE_PAYMENT_MARKER,
  invoiceTokenHash,
  PayableInvoiceService,
  type InvoiceIssueInput,
  type InvoiceRepository,
} from "./payableInvoiceService";

// TEST ONLY: no application storage, network provider, credentials, or setup imports.
const NOW = Date.parse("2026-11-08T12:00:00Z");
const TOKEN = "a".repeat(64);
const REQUEST = "11111111-1111-4111-8111-111111111111";
const OTHER_REQUEST = "22222222-2222-4222-8222-222222222222";
const ORIGIN = "https://invoice.example.test";
const TEST_ONLY_SECRET = "test-only-invoice-secret-not-a-real-key-2026";
const CLIENT: InvoiceClient = {
  id: 17,
  name: "ExampleClient",
  phone: "+12025550123",
  email: "exampleclient@example.test",
};

function servicesFixture(ids = ["owned:101", "owned:102"]): InvoiceService[] {
  return ids.map((id, index) => ({
    id,
    occurrenceKey: `occurrence:${index + 1}`,
    date: index === 0 ? "2026-11-02" : "2026-11-05",
    description: "Example service",
    address: "Example service address",
    amountCents: index === 0 ? 12_345 : 6_789,
    status: "completed",
    eligible: true,
    reason: null,
  }));
}

function invoiceFixture(): PayableInvoice {
  return {
    id: 42,
    number: "TEST-2026-0042",
    clientId: CLIENT.id,
    clientName: CLIENT.name,
    from: "2026-11-01",
    to: "2026-11-07",
    dueDate: "2026-11-20",
    currency: "usd",
    status: "partially_paid",
    lines: servicesFixture().map((row, index) => ({
      id: index + 1,
      occurrenceKey: row.occurrenceKey,
      date: row.date,
      description: row.description,
      address: row.address,
      amountCents: row.amountCents,
      paidCents: index === 0 ? 0 : 789,
    })),
    receipts: [],
    activeAttemptId: null,
  };
}

function issueFixture(ids = ["owned:101", "owned:102"], rows = servicesFixture()): InvoiceIssueInput {
  return {
    requestId: REQUEST,
    clientId: CLIENT.id,
    from: "2026-11-01",
    to: "2026-11-07",
    dueDate: "2026-11-20",
    serviceIds: ids,
    confirmedUnpaid: true,
    reviewHash: invoiceReviewHash(CLIENT, rows, "2026-11-01", "2026-11-07"),
  };
}

/** TEST ONLY repository: models atomic request identity and one-time settlement in memory. */
class TEST_ONLY_InvoiceRepository implements InvoiceRepository {
  invoice = invoiceFixture();
  serviceRows = servicesFixture();
  attempts = new Map<string, InvoiceAttempt>();
  tokenInvoices = new Map<string, PayableInvoice>([[invoiceTokenHash(TOKEN), this.invoice]]);
  issued = new Map<string, { payloadHash: string; tokenHash: string; invoice: PayableInvoice }>();
  settledPaymentIds = new Set<string>();
  settlementEffects = 0;

  lookup = vi.fn(async (_phone: string, _email: string, _from: string, _to: string) => ({
    client: { ...CLIENT }, services: this.serviceRows,
  }));
  services = vi.fn(async (_clientId: number, _from: string, _to: string) => ({
    client: { ...CLIENT }, services: this.serviceRows,
  }));
  issue = vi.fn(async (
    input: InvoiceIssueInput,
    client: InvoiceClient,
    rows: InvoiceService[],
    tokenHash: string,
    payloadHash: string,
  ): Promise<PayableInvoice> => {
    const prior = this.issued.get(input.requestId);
    if (prior) {
      if (prior.payloadHash !== payloadHash || prior.tokenHash !== tokenHash) {
        throw new InvoiceError("REQUEST_CONFLICT", 409, "Request payload changed.");
      }
      return prior.invoice;
    }
    this.invoice = {
      ...invoiceFixture(),
      clientId: client.id,
      clientName: client.name,
      from: input.from,
      to: input.to,
      dueDate: input.dueDate,
      status: "open",
      lines: rows.map((row, index) => ({
        id: index + 1, occurrenceKey: row.occurrenceKey, date: row.date,
        description: row.description, address: row.address,
        amountCents: row.amountCents, paidCents: 0,
      })),
    };
    this.issued.set(input.requestId, { payloadHash, tokenHash, invoice: this.invoice });
    this.tokenInvoices.set(tokenHash, this.invoice);
    return this.invoice;
  });
  byToken = vi.fn(async (tokenHash: string) => this.tokenInvoices.get(tokenHash) ?? null);
  reserve = vi.fn(async (invoiceId: number, requestId: string, lineIds: number[]): Promise<InvoiceAttempt> => {
    if (invoiceId !== this.invoice.id) throw new InvoiceError("NOT_FOUND", 404, "Unknown invoice.");
    const sameRequest = [...this.attempts.values()].find(attempt => attempt.requestId === requestId);
    const active = this.invoice.activeAttemptId ? this.attempts.get(this.invoice.activeAttemptId) : undefined;
    const previous = sameRequest ?? active;
    if (previous) {
      if (JSON.stringify(previous.lineIds) !== JSON.stringify(lineIds)) {
        throw new InvoiceError("PAYMENT_ATTEMPT_CONFLICT", 409, "An existing attempt has a different selection.");
      }
      return previous;
    }
    const attempt: InvoiceAttempt = {
      id: `attempt-test-${this.attempts.size + 1}`, invoiceId, requestId,
      lineIds: [...lineIds], amountCents: selectedBalance(this.invoice, lineIds),
      currency: "usd", state: "pending", sessionId: null, sessionUrl: null, createdAt: NOW,
    };
    this.attempts.set(attempt.id, attempt);
    this.invoice.activeAttemptId = attempt.id;
    return attempt;
  });
  attachSession = vi.fn(async (attemptId: string, sessionId: string, url: string) => {
    const attempt = this.attempts.get(attemptId)!;
    attempt.sessionId = sessionId;
    attempt.sessionUrl = url;
    attempt.state = "session_open";
  });
  attempt = vi.fn(async (id: string) => this.attempts.get(id) ?? null);
  settle = vi.fn(async (attemptId: string, sessionId: string, paymentId: string, amountCents: number) => {
    const attempt = this.attempts.get(attemptId)!;
    if (attempt.state === "paid" || this.settledPaymentIds.has(paymentId)) return;
    if (amountCents !== attempt.amountCents) throw new InvoiceError("PAYMENT_IDENTITY_MISMATCH", 409, "Amount mismatch.");
    for (const id of attempt.lineIds) {
      const line = this.invoice.lines.find(row => row.id === id)!;
      line.paidCents = line.amountCents;
    }
    this.settledPaymentIds.add(paymentId);
    this.settlementEffects += 1;
    this.invoice.receipts.push({ paymentId, amountCents, paidAt: "2026-11-08T12:00:00.000Z", lineIds: [...attempt.lineIds] });
    this.invoice.status = invoiceBalance(this.invoice.lines) === 0 ? "paid" : "partially_paid";
    this.invoice.activeAttemptId = null;
    attempt.state = "paid";
    attempt.sessionId = sessionId;
  });
}

function harness() {
  const repo = new TEST_ONLY_InvoiceRepository();
  const create = vi.fn(async (_params: Stripe.Checkout.SessionCreateParams, _options?: Stripe.RequestOptions) => ({
    id: "cs_test_example", url: "https://checkout.stripe.com/c/pay/test_example",
  }));
  const retrieve = vi.fn(async (_id: string): Promise<Stripe.Checkout.Session> => paidSession());
  // Only these two operations exist; any other provider API use cannot silently pass.
  const stripeStub = { checkout: { sessions: { create, retrieve } } } as unknown as Stripe;
  const stripe = vi.fn(() => stripeStub);
  const assertCollectionReady = vi.fn(async (_rows: InvoiceService[] | PayableInvoice) => undefined);
  const service = new PayableInvoiceService({ repo, stripe, origin: ORIGIN, tokenSecret: TEST_ONLY_SECRET, assertCollectionReady, now: () => NOW });
  return { repo, service, stripe, create, retrieve, assertCollectionReady };
}

function paidSession(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: "cs_test_example", object: "checkout.session", mode: "payment", livemode: false,
    payment_status: "paid", amount_total: 18_345, currency: "usd",
    client_reference_id: "attempt-test-1", payment_intent: "pi_test_example",
    metadata: { leadflowInvoice: INVOICE_PAYMENT_MARKER, invoiceId: "42", invoiceAttemptId: "attempt-test-1" },
    ...overrides,
  } as Stripe.Checkout.Session;
}

function eventFixture(source: Stripe.Checkout.Session = paidSession(), type = "checkout.session.completed"): Stripe.Event {
  return { id: "evt_test_example", object: "event", type, livemode: false, data: { object: source } } as Stripe.Event;
}

async function reconciliationHarness() {
  const h = harness();
  await h.service.checkout(TOKEN, REQUEST, [1, 2]);
  return h;
}

function expectInvoiceError(action: () => unknown, code: string) {
  expect(action).toThrow(InvoiceError);
  expect(action).toThrow(expect.objectContaining({ code }));
}

describe("payable invoice validation", () => {
  it("accepts real calendar dates, including a leap day, and ordered periods", () => {
    expect(invoiceDate.parse("2026-11-08")).toBe("2026-11-08");
    expect(invoiceDate.parse("2024-02-29")).toBe("2024-02-29");
    expect(invoicePeriodSchema.safeParse({ from: "2026-11-01", to: "2026-11-08" }).success).toBe(true);
  });

  it.each(["2026-02-30", "2026-02-29", "2026-11-08T12:00:00Z", "2026-13-01", ""]) (
    "rejects invalid or time-bearing service date %s", value => {
      expect(invoiceDate.safeParse(value).success).toBe(false);
    },
  );

  it("rejects reversed issue periods, empty selections, and browser price fields", () => {
    expect(invoicePeriodSchema.safeParse({ from: "2026-11-08", to: "2026-11-01" }).success).toBe(false);
    expect(invoiceIssueSchema.safeParse({ ...issueFixture(), from: "2026-11-08", to: "2026-11-01" }).success).toBe(false);
    expect(invoiceIssueSchema.safeParse({ ...issueFixture(), serviceIds: [] }).success).toBe(false);
    expect(invoiceCheckoutSchema.safeParse({ requestId: REQUEST, lineIds: [] }).success).toBe(false);
    expect(invoiceIssueSchema.safeParse({ ...issueFixture(), amountCents: 1 }).success).toBe(false);
    expect(invoiceCheckoutSchema.safeParse({ requestId: REQUEST, lineIds: [1], amountCents: 1 }).success).toBe(false);
  });

  it("computes selected and all balances from integer cents, not face-value totals", () => {
    const invoice = invoiceFixture();
    expect(invoiceTotal(invoice.lines)).toBe(19_134);
    expect(invoiceBalance(invoice.lines)).toBe(18_345);
    expect(selectedBalance(invoice, [2])).toBe(6_000);
    expect(selectedBalance(invoice, [2, 1])).toBe(18_345);
  });

  it.each([[[]], [[1, 1]]])("rejects empty or duplicated line selections %j", ids => {
    expectInvoiceError(() => selectedBalance(invoiceFixture(), ids), "INVALID_SELECTION");
  });

  it("rejects unknown, paid, and void invoice lines", () => {
    const invoice = invoiceFixture();
    expectInvoiceError(() => selectedBalance(invoice, [999]), "BALANCE_CHANGED");
    invoice.lines[0].paidCents = invoice.lines[0].amountCents;
    expectInvoiceError(() => selectedBalance(invoice, [1]), "BALANCE_CHANGED");
    invoice.status = "void";
    expectInvoiceError(() => selectedBalance(invoice, [2]), "INVOICE_VOID");
  });

  it.each([[1.5], [-1], [Number.MAX_SAFE_INTEGER + 1], [99_999_999, 1], [Infinity], [NaN]])(
    "rejects fractional, negative, unsafe, or overflowing cents %j", (...values: number[]) => {
      expectInvoiceError(() => safeSum(values), "INVALID_AMOUNT");
    },
  );

  it("rejects malformed remaining balances and the card minimum", () => {
    const invoice = invoiceFixture();
    invoice.lines[0].amountCents = 49;
    expectInvoiceError(() => selectedBalance(invoice, [1]), "INVALID_AMOUNT");
    invoice.lines[0].amountCents = 50;
    expect(selectedBalance(invoice, [1])).toBe(50);
    invoice.lines[0].paidCents = 0.5;
    expectInvoiceError(() => selectedBalance(invoice, [1]), "INVALID_AMOUNT");
  });
});

describe("PayableInvoiceService issuance", () => {
  it("uses selected owned rows and integer amounts, with no browser price input", async () => {
    const h = harness();
    const result = await h.service.issue(issueFixture(["owned:102"]));
    expect(h.repo.services).toHaveBeenCalledWith(CLIENT.id, "2026-11-01", "2026-11-07");
    expect(result.invoice.lines).toHaveLength(1);
    expect(invoiceTotal(result.invoice.lines)).toBe(6_789);
    expect(h.repo.issue.mock.calls[0][2]).toEqual([h.repo.serviceRows[1]]);
    expect(h.assertCollectionReady).toHaveBeenCalledWith([h.repo.serviceRows[1]]);
    expect(h.stripe).not.toHaveBeenCalled();
  });

  it("rejects duplicate, unknown, and ineligible service IDs before issuing", async () => {
    const h = harness();
    await expect(h.service.issue(issueFixture(["owned:101", "owned:101"]))).rejects.toMatchObject({ code: "INVALID_SELECTION" });
    await expect(h.service.issue(issueFixture(["unknown:999"]))).rejects.toMatchObject({ code: "SERVICE_REVIEW_REQUIRED" });
    h.repo.serviceRows[0].eligible = false;
    await expect(h.service.issue(issueFixture(["owned:101"], h.repo.serviceRows))).rejects.toMatchObject({ code: "SERVICE_REVIEW_REQUIRED" });
    expect(h.repo.issue).not.toHaveBeenCalled();
  });

  it("keeps request identity, token, and payload replay stable despite selection order", async () => {
    const h = harness();
    const first = await h.service.issue(issueFixture());
    const replay = await h.service.issue(issueFixture(["owned:102", "owned:101"]));
    expect(replay).toEqual(first);
    expect(h.repo.issued.size).toBe(1);
    expect(h.repo.issue.mock.calls[0][3]).toBe(h.repo.issue.mock.calls[1][3]);
    expect(h.repo.issue.mock.calls[0][4]).toBe(h.repo.issue.mock.calls[1][4]);
    const token = first.url.split("/").pop()!;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(h.repo.issue.mock.calls[0][3]).toBe(invoiceTokenHash(token));
    expect(await h.service.view(token)).toBe(first.invoice);
  });

  it("lets repository request identity reject a changed issuance payload", async () => {
    const h = harness();
    await h.service.issue(issueFixture());
    await expect(h.service.issue({ ...issueFixture(), dueDate: "2026-11-21" })).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
    expect(h.repo.issued.size).toBe(1);
  });

  it("fails closed when collection ownership has not been approved", async () => {
    const h = harness();
    h.assertCollectionReady.mockRejectedValueOnce(new InvoiceError("COLLECTION_REVIEW_REQUIRED", 409, "Review required."));
    await expect(h.service.issue(issueFixture())).rejects.toMatchObject({ code: "COLLECTION_REVIEW_REQUIRED" });
    expect(h.repo.issue).not.toHaveBeenCalled();
    expect(h.stripe).not.toHaveBeenCalled();
  });

  it("treats imported and native source identities identically without origin branching", async () => {
    const results = [];
    for (const ids of [["imported:101", "imported:102"], ["native:101", "native:102"]]) {
      const h = harness();
      h.repo.serviceRows = servicesFixture(ids);
      const result = await h.service.issue(issueFixture(ids, h.repo.serviceRows));
      const token = result.url.split("/").pop()!;
      await h.service.checkout(token, OTHER_REQUEST, [1, 2]);
      results.push({ invoice: result.invoice, url: result.url, payloadHash: h.repo.issue.mock.calls[0][4], params: h.create.mock.calls[0][0] });
    }
    expect(results[0]).toEqual(results[1]);
  });
});

describe("PayableInvoiceService checkout", () => {
  it("aggregates the exact selected balance into one card-only payment item with no PII metadata", async () => {
    const h = harness();
    await h.service.checkout(TOKEN, REQUEST, [2, 1]);
    expect(h.repo.reserve).toHaveBeenCalledWith(42, REQUEST, [1, 2]);
    const [params, options] = h.create.mock.calls[0];
    expect(params.mode).toBe("payment");
    expect(params.payment_method_types).toEqual(["card"]);
    expect(params.line_items).toEqual([{
      price_data: { currency: "usd", unit_amount: 18_345, product_data: { name: "Maids in Black invoice TEST-2026-0042", description: "2 selected service dates" } }, quantity: 1,
    }]);
    expect(params.metadata).toEqual({ leadflowInvoice: INVOICE_PAYMENT_MARKER, invoiceId: "42", invoiceAttemptId: "attempt-test-1" });
    expect(params.payment_intent_data).toEqual({ metadata: params.metadata });
    expect(options).toEqual({ idempotencyKey: "leadflow:invoice:42:attempt:attempt-test-1" });
    expect(params.success_url).toBe(`${ORIGIN}/invoice/${TOKEN}?returned=1`);
    expect(params.cancel_url).toBe(`${ORIGIN}/invoice/${TOKEN}`);
    expect(params.expires_at).toBe(Math.floor(NOW / 1000) + 24 * 60 * 60);
    const serialized = JSON.stringify(params.metadata);
    for (const privateValue of [CLIENT.name, CLIENT.phone, CLIENT.email!, "Example service address"]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(params).not.toHaveProperty("setup_intent_data");
    expect(params).not.toHaveProperty("customer");
    expect(params).not.toHaveProperty("customer_creation");
    expect(params).not.toHaveProperty("saved_payment_method_options");
    expect(params.payment_intent_data).not.toHaveProperty("capture_method");
    expect(params.payment_intent_data).not.toHaveProperty("setup_future_usage");
    expect(params.payment_intent_data).not.toHaveProperty("off_session");
  });

  it("charges only the selected service balance", async () => {
    const h = harness();
    await h.service.checkout(TOKEN, REQUEST, [2]);
    expect(h.create.mock.calls[0][0].line_items?.[0].price_data?.unit_amount).toBe(6_000);
    expect(h.repo.attempts.size).toBe(1);
  });

  it("does not create duplicate sessions on replay or refresh with a new request ID", async () => {
    const h = harness();
    const first = await h.service.checkout(TOKEN, REQUEST, [1, 2]);
    expect(await h.service.checkout(TOKEN, REQUEST, [2, 1])).toEqual(first);
    expect(await h.service.checkout(TOKEN, OTHER_REQUEST, [1, 2])).toEqual(first);
    expect(h.repo.attempts.size).toBe(1);
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.repo.attachSession).toHaveBeenCalledTimes(1);
  });

  it("preserves an unresolved attempt after an unknown timeout and retries with the same provider identity", async () => {
    const h = harness();
    h.create.mockRejectedValueOnce(new Error("TEST ONLY unknown provider timeout"));
    await expect(h.service.checkout(TOKEN, REQUEST, [1, 2])).rejects.toThrow("unknown provider timeout");
    expect(h.repo.attempts.size).toBe(1);
    expect(h.repo.attempts.get("attempt-test-1")).toMatchObject({ state: "pending", sessionId: null });
    expect(h.repo.attachSession).not.toHaveBeenCalled();
    await h.service.checkout(TOKEN, OTHER_REQUEST, [2, 1]);
    expect(h.repo.attempts.size).toBe(1);
    expect(h.create.mock.calls[0]).toEqual(h.create.mock.calls[1]);
  });

  it.each([23, 24])("blocks new provider creation for an unresolved attempt aged %i hours", async hours => {
    const h = harness();
    const attempt = await h.repo.reserve(42, REQUEST, [1, 2]);
    attempt.createdAt = NOW - hours * 60 * 60 * 1000;
    await expect(h.service.checkout(TOKEN, OTHER_REQUEST, [1, 2])).rejects.toMatchObject({ code: "PAYMENT_REVIEW_REQUIRED" });
    expect(h.stripe).not.toHaveBeenCalled();
    expect(h.repo.attempts.size).toBe(1);
    expect(attempt.state).toBe("pending");
  });

  it("propagates the test-only atomic reservation conflict for a wrong subset", async () => {
    const h = harness();
    await h.repo.reserve(42, REQUEST, [1]);
    await expect(h.service.checkout(TOKEN, OTHER_REQUEST, [2])).rejects.toMatchObject({ code: "PAYMENT_ATTEMPT_CONFLICT" });
    await expect(h.service.checkout(TOKEN, REQUEST, [1, 2])).rejects.toMatchObject({ code: "PAYMENT_ATTEMPT_CONFLICT" });
    expect(h.stripe).not.toHaveBeenCalled();
    expect(h.repo.attempts.size).toBe(1);
  });

  it.each([null, "https://unsafe.example.test/session"])("retains the attempt when the provider URL is unavailable or invalid: %s", async url => {
    const h = harness();
    h.create.mockResolvedValueOnce({ id: "cs_test_example", url: url as unknown as string });
    await expect(h.service.checkout(TOKEN, REQUEST, [1])).rejects.toMatchObject({ code: "CHECKOUT_UNAVAILABLE" });
    expect(h.repo.attempts.size).toBe(1);
    expect(h.repo.attachSession).not.toHaveBeenCalled();
  });

  it("rejects invalid or missing tokens before reservation or provider access", async () => {
    const h = harness();
    await expect(h.service.checkout("invalid", REQUEST, [1])).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(h.service.checkout("b".repeat(64), REQUEST, [1])).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(h.repo.byToken).toHaveBeenCalledTimes(1);
    expect(h.repo.reserve).not.toHaveBeenCalled();
    expect(h.stripe).not.toHaveBeenCalled();
  });
});

// Signature verification belongs to the HTTP route; these are post-verification service events.
describe("PayableInvoiceService reconciliation", () => {
  it("retrieves provider-paid status and settles duplicate deliveries only once in the repository", async () => {
    const h = await reconciliationHarness();
    const event = eventFixture(paidSession({ payment_status: "unpaid", amount_total: 1 }));
    await h.service.reconcile(event);
    await h.service.reconcile(event);
    expect(h.retrieve).toHaveBeenCalledWith("cs_test_example");
    expect(h.repo.settle).toHaveBeenCalledWith("attempt-test-1", "cs_test_example", "pi_test_example", 18_345);
    expect(h.repo.settlementEffects).toBe(1);
    expect(h.repo.invoice.receipts).toHaveLength(1);
    expect(h.repo.invoice.receipts[0].amountCents).toBe(18_345);
    expect(invoiceBalance(h.repo.invoice.lines)).toBe(0);
  });

  it("accepts asynchronous paid success and an expanded payment reference before session attachment", async () => {
    const h = harness();
    await h.repo.reserve(42, REQUEST, [1, 2]);
    h.retrieve.mockResolvedValueOnce(paidSession({ payment_intent: { id: "pi_test_expanded" } as Stripe.PaymentIntent }));
    await h.service.reconcile(eventFixture(paidSession(), "checkout.session.async_payment_succeeded"));
    expect(h.repo.settle).toHaveBeenCalledWith("attempt-test-1", "cs_test_example", "pi_test_expanded", 18_345);
    expect(h.repo.settlementEffects).toBe(1);
  });

  it.each([
    ["session", { id: "cs_test_wrong" }],
    ["amount", { amount_total: 18_344 }],
    ["currency", { currency: "eur" }],
    ["invoice", { metadata: { leadflowInvoice: INVOICE_PAYMENT_MARKER, invoiceId: "43", invoiceAttemptId: "attempt-test-1" } }],
    ["attempt", { metadata: { leadflowInvoice: INVOICE_PAYMENT_MARKER, invoiceId: "42", invoiceAttemptId: "attempt-test-missing" } }],
    ["reference", { client_reference_id: "attempt-test-wrong" }],
    ["mode", { mode: "setup" }],
    ["live event", { livemode: true }],
    ["missing payment", { payment_intent: null }],
  ] as Array<[string, Partial<Stripe.Checkout.Session>]>) (
    "rejects a retrieved paid session with wrong %s", async (_name, overrides) => {
      const h = await reconciliationHarness();
      h.retrieve.mockResolvedValueOnce(paidSession(overrides));
      await expect(h.service.reconcile(eventFixture())).rejects.toMatchObject({ code: "PAYMENT_IDENTITY_MISMATCH" });
      expect(h.repo.settle).not.toHaveBeenCalled();
      expect(h.repo.settlementEffects).toBe(0);
      expect(invoiceBalance(h.repo.invoice.lines)).toBe(18_345);
    },
  );

  it("ignores unrelated event types and unmarked source objects without provider reads", async () => {
    const h = harness();
    await h.service.reconcile(eventFixture(paidSession(), "payment_intent.succeeded"));
    await h.service.reconcile(eventFixture(paidSession({ metadata: {} })));
    expect(h.stripe).not.toHaveBeenCalled();
    expect(h.repo.settle).not.toHaveBeenCalled();
  });

  it.each([
    { payment_status: "unpaid" },
    { payment_status: "no_payment_required" },
    { metadata: {} },
  ] as Array<Partial<Stripe.Checkout.Session>>)("ignores retrieved unpaid or unmarked sessions %j", async overrides => {
    const h = await reconciliationHarness();
    h.retrieve.mockResolvedValueOnce(paidSession(overrides));
    await h.service.reconcile(eventFixture());
    expect(h.repo.attempt).not.toHaveBeenCalled();
    expect(h.repo.settle).not.toHaveBeenCalled();
  });
});

// Additional offline resume contracts; provider objects remain test-only stubs.
describe("PayableInvoiceService resume", () => {
  it("exposes the active attempt's selected line IDs without provider access", async () => {
    const h = harness();
    await h.repo.reserve(42, REQUEST, [1]);
    expect(await h.service.view(TOKEN)).toMatchObject({ activeAttemptId: "attempt-test-1", activeLineIds: [1] });
    expect(h.repo.attempt).toHaveBeenCalledWith("attempt-test-1");
    expect(h.stripe).not.toHaveBeenCalled();
  });

  it("resumes a retrieved and verified open session at the same URL without a new create", async () => {
    const h = await reconciliationHarness();
    const url = h.repo.attempts.get("attempt-test-1")!.sessionUrl!;
    h.retrieve.mockResolvedValueOnce(paidSession({ status: "open", payment_status: "unpaid", url }));
    expect(await h.service.resume(TOKEN)).toEqual({ url });
    expect(h.retrieve).toHaveBeenCalledWith("cs_test_example");
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.repo.reserve).toHaveBeenCalledTimes(1);
    expect(h.repo.attachSession).toHaveBeenCalledTimes(1);
    expect(h.repo.settle).not.toHaveBeenCalled();
  });

  it("expires only the matching verified session through an optional test-only fake without a new charge", async () => {
    const h = await reconciliationHarness();
    const expire = vi.fn(async (attemptId: string, sessionId: string) => {
      const attempt = h.repo.attempts.get(attemptId)!;
      if (attempt.sessionId !== sessionId || attempt.state === "paid") throw new Error("TEST ONLY invalid expiration");
      attempt.state = "expired";
      if (h.repo.invoice.activeAttemptId === attemptId) h.repo.invoice.activeAttemptId = null;
    });
    Object.assign(h.repo, { expire });
    h.retrieve.mockResolvedValueOnce(paidSession({ status: "expired", payment_status: "unpaid" }));
    expect(await h.service.resume(TOKEN)).toEqual({ refresh: true });
    expect(expire).toHaveBeenCalledTimes(1);
    expect(expire).toHaveBeenCalledWith("attempt-test-1", "cs_test_example");
    expect(h.repo.attempts.get("attempt-test-1")!.state).toBe("expired");
    expect(h.repo.invoice.activeAttemptId).toBeNull();
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.repo.settle).not.toHaveBeenCalled();
  });

  it("retains an expired session for review if the optional expiration contract is absent", async () => {
    const h = await reconciliationHarness();
    h.retrieve.mockResolvedValueOnce(paidSession({ status: "expired", payment_status: "unpaid" }));
    await expect(h.service.resume(TOKEN)).rejects.toMatchObject({ code: "PAYMENT_REVIEW_REQUIRED" });
    expect(h.repo.invoice.activeAttemptId).toBe("attempt-test-1");
    expect(h.repo.attempts.get("attempt-test-1")!.state).toBe("session_open");
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.repo.settle).not.toHaveBeenCalled();
  });

  it("confirms a paid resume once and repeated refreshes do not allocate again", async () => {
    const h = await reconciliationHarness();
    expect(await h.service.resume(TOKEN)).toEqual({ refresh: true });
    expect(await h.service.resume(TOKEN)).toEqual({ refresh: true });
    await h.service.reconcile(eventFixture());
    expect(h.repo.settlementEffects).toBe(1);
    expect(h.repo.invoice.receipts).toHaveLength(1);
    expect(h.repo.invoice.receipts[0]).toMatchObject({ amountCents: 18_345, lineIds: [1, 2] });
    expect(invoiceBalance(h.repo.invoice.lines)).toBe(0);
    expect(h.repo.invoice.activeAttemptId).toBeNull();
    expect(h.create).toHaveBeenCalledTimes(1);
  });

  it("rejects wrong retrieved session identity, currency, mode, amount, or reference before allocating", async () => {
    const invalid: Partial<Stripe.Checkout.Session>[] = [
      { id: "cs_test_wrong" }, { currency: "eur" }, { mode: "setup" },
      { amount_total: 18_344 }, { client_reference_id: "attempt-test-wrong" },
    ];
    for (const overrides of invalid) {
      const h = await reconciliationHarness();
      h.retrieve.mockResolvedValueOnce(paidSession(overrides));
      await expect(h.service.resume(TOKEN)).rejects.toMatchObject({ code: "PAYMENT_IDENTITY_MISMATCH" });
      expect(h.repo.settle).not.toHaveBeenCalled();
      expect(h.repo.settlementEffects).toBe(0);
      expect(h.repo.invoice.activeAttemptId).toBe("attempt-test-1");
      expect(h.create).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects a connected-account event even after the route's signature-verification boundary", async () => {
    const h = await reconciliationHarness();
    const event = { ...eventFixture(), account: "acct_test_connected" } as Stripe.Event;
    await expect(h.service.reconcile(event)).rejects.toMatchObject({ code: "PAYMENT_IDENTITY_MISMATCH" });
    expect(h.retrieve).not.toHaveBeenCalled();
    expect(h.repo.settle).not.toHaveBeenCalled();
    expect(h.repo.settlementEffects).toBe(0);
  });
});
