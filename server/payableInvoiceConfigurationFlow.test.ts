import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import Stripe from "stripe";
import {
  InvoiceError,
  type InvoiceAttempt,
  type InvoiceClient,
  type InvoiceService,
  type PayableInvoice,
} from "../shared/payableInvoice";
import { invoiceConfiguration } from "./payableInvoiceConfig";
import { invoiceReviewHash } from "./payableInvoiceReview";
import {
  INVOICE_PAYMENT_MARKER,
  invoiceTokenHash,
  PayableInvoiceService,
  type InvoiceIssueInput,
  type InvoiceRepository,
} from "./payableInvoiceService";
import {
  INVOICE_API,
  registerPayableInvoiceRoutes,
  runtimeInvoiceService,
} from "./payableInvoiceRoutes";

// TEST ONLY: real configuration/routes/service, in-memory invoice records, and
// local Stripe webhook cryptography. All application storage/delivery is blocked.
const boundary = vi.hoisted(() => ({
  storage: vi.fn(() => { throw new Error("Application storage is forbidden in this test"); }),
  auth: vi.fn(() => { throw new Error("Real authentication is forbidden in this test"); }),
  delivery: vi.fn(() => { throw new Error("Real delivery is forbidden in this test"); }),
  outbox: vi.fn(() => { throw new Error("Real delivery storage is forbidden in this test"); }),
  runtimeRepo: null as unknown,
  repository: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: boundary.storage, getPool: boundary.storage }));
vi.mock("mysql2", () => { throw new Error("Database driver imports are forbidden"); });
vi.mock("mysql2/promise", () => { throw new Error("Database driver imports are forbidden"); });
vi.mock("drizzle-orm", () => ({ eq: boundary.storage }));
vi.mock("../drizzle/schema", () => ({ agents: {} }));
vi.mock("./_core/agentAuth", () => ({ getAgentFromRequest: boundary.auth }));
vi.mock("./_core/env", () => ({
  ENV: { cookieSecret: "short-test-only-jwt", stripeSecretKey: "sk_test_invoice_config_fake_only" },
}));
vi.mock("./payableInvoiceRepository", () => ({
  MysqlInvoiceRepository: vi.fn(function () {
    boundary.repository();
    if (!boundary.runtimeRepo) throw new Error("Runtime repository must be explicitly injected");
    return boundary.runtimeRepo;
  }),
}));
vi.mock("./payableInvoiceDelivery", () => ({
  generatePayableInvoicePdf: boundary.delivery,
  sendPayableInvoiceEmail: boundary.delivery,
}));
vi.mock("./payableInvoiceMailOutbox", () => ({
  InvoiceMailOutbox: vi.fn(function () { return { send: boundary.outbox }; }),
}));

const ORIGIN = "https://quote.maidinblack.com";
const STALE_ORIGIN = "https://maidsquotes-b55s3sg4.manus.space";
const STRIPE_KEY = "sk_test_invoice_config_fake_only";
const TOKEN_SECRET = "test-only-dedicated-invoice-signing-secret-2026";
const WEBHOOK_SECRET = "whsec_test_only_dedicated_invoice_2026";
const GLOBAL_WEBHOOK_SECRET = "whsec_test_only_old_global_not_for_invoices";
const SHORT_JWT = "short-test-only-jwt";
const DERIVED_SECRET = createHmac("sha256", STRIPE_KEY)
  .update("leadflow:invoice-token-key:v1").digest("hex");
const TOKEN = "a".repeat(64);
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-11-08T12:00:00Z");
const LOOKUP = {
  phone: "+12025550100", email: "exampleclient@example.test",
  from: "2026-11-01", to: "2026-11-07",
};
const CLIENT: InvoiceClient = {
  id: 17, name: "Example client", phone: LOOKUP.phone, email: LOOKUP.email,
};
const sdkRequests = vi.fn(async () => {
  throw new Error("Stripe SDK HTTP requests are forbidden; use the fake processor");
});

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  for (const [name, value] of Object.entries({
    NODE_ENV: "production",
    QUOTE_APP_URL: STALE_ORIGIN,
    JWT_SECRET: SHORT_JWT,
    STRIPE_SECRET_KEY: STRIPE_KEY,
    INVOICE_TOKEN_SECRET: undefined,
    INVOICE_STRIPE_WEBHOOK_SECRET: undefined,
    STRIPE_WEBHOOK_SECRET: undefined,
    PREVIEW_MODE: undefined,
    RAILWAY_PUBLIC_DOMAIN: undefined,
  })) vi.stubEnv(name, value);
});
afterEach(() => {
  try {
    expect(boundary.storage).not.toHaveBeenCalled();
    expect(boundary.auth).not.toHaveBeenCalled();
    expect(boundary.delivery).not.toHaveBeenCalled();
    expect(boundary.outbox).not.toHaveBeenCalled();
    expect(sdkRequests).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  }
});

function readyEnvironment() {
  vi.stubEnv("INVOICE_TOKEN_SECRET", TOKEN_SECRET);
  vi.stubEnv("INVOICE_STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
}
function safeResponse(body: unknown) {
  const text = JSON.stringify(body);
  for (const value of [STRIPE_KEY, TOKEN_SECRET, DERIVED_SECRET, WEBHOOK_SECRET, GLOBAL_WEBHOOK_SECRET, SHORT_JWT, STALE_ORIGIN]) {
    expect(text).not.toContain(value);
  }
  expect(text).not.toMatch(/private storage|private processor|exampleclient@example\.test/);
}
function fixture(isAdmin = true, directTokenSecret?: string) {
  const rows: InvoiceService[] = [{
    id: "leadflow_jobs:101", occurrenceKey: "leadflow_jobs:101:2026-11-02",
    date: "2026-11-02", description: "Example service", address: "Example street",
    amountCents: 10000, paidCents: 0, status: "completed", eligible: true, reason: null,
  }];
  const invoice: PayableInvoice = {
    id: 42, number: "TEST-2026-0042", clientId: CLIENT.id, clientName: CLIENT.name,
    from: LOOKUP.from, to: LOOKUP.to, dueDate: "2026-11-20", currency: "usd", status: "open",
    lines: rows.map((row, index) => ({ ...row, id: index + 1, paidCents: 0 })),
    receipts: [], activeAttemptId: null,
  };
  const attempt: InvoiceAttempt = {
    id: "attempt_test_configuration", invoiceId: invoice.id, requestId: REQUEST_ID,
    lineIds: [1], amountCents: 10000, currency: "usd", state: "pending",
    sessionId: null, sessionUrl: null, createdAt: NOW,
  };
  const session = {
    id: "cs_test_invoice_configuration", object: "checkout.session", mode: "payment",
    amount_total: attempt.amountCents, currency: "usd", payment_status: "paid", status: "complete",
    livemode: false, client_reference_id: attempt.id, payment_intent: "pi_test_invoice_configuration",
    url: "https://checkout.stripe.com/c/pay/test-only-configuration",
    metadata: {
      leadflowInvoice: INVOICE_PAYMENT_MARKER,
      invoiceId: String(invoice.id), invoiceAttemptId: attempt.id,
    },
  } as Stripe.Checkout.Session;
  const repo = {
    lookup: vi.fn(async () => ({ client: CLIENT, services: rows })),
    services: vi.fn(async () => ({ client: CLIENT, services: rows })),
    issue: vi.fn(async (
      _input: InvoiceIssueInput, _client: InvoiceClient, _rows: InvoiceService[],
      _tokenHash: string, _payloadHash: string,
    ) => invoice),
    replayIssue: vi.fn(async (_input: InvoiceIssueInput, _tokenHash: string): Promise<PayableInvoice | null> => null),
    byToken: vi.fn(async (_tokenHash: string) => invoice),
    reserve: vi.fn(async (_invoiceId: number, _requestId: string, _lineIds: number[]) => attempt),
    attachSession: vi.fn(async (_attemptId: string, _sessionId: string, _url: string) => undefined),
    attempt: vi.fn(async (_id: string): Promise<InvoiceAttempt | null> => attempt),
    settle: vi.fn(async (_attemptId: string, _sessionId: string, _paymentId: string, _amount: number) => undefined),
    expire: vi.fn(async (_attemptId: string, _sessionId: string) => undefined),
    markAlreadyPaid: vi.fn(async (_input: unknown, _agentId: number) => undefined),
    adminInvoice: vi.fn(async (_id: number) => ({ invoice, client: CLIENT, requestId: REQUEST_ID })),
    assertCollectionReady: vi.fn(async (_value: InvoiceService[] | PayableInvoice) => undefined),
  } satisfies InvoiceRepository;
  const create = vi.fn(async (_params: Stripe.Checkout.SessionCreateParams, _options?: Stripe.RequestOptions) => session);
  const retrieve = vi.fn(async (_id: string) => session);
  const sdk = new Stripe(STRIPE_KEY, {
    maxNetworkRetries: 0,
    httpClient: { getClientName: () => "test-only-no-network", makeRequest: sdkRequests },
  });
  const constructEvent = vi.spyOn(sdk.webhooks, "constructEvent");
  const stripe = vi.fn(() => ({
    webhooks: sdk.webhooks, checkout: { sessions: { create, retrieve } },
  }) as unknown as Stripe);
  const config = invoiceConfiguration();
  const service = new PayableInvoiceService({
    repo, stripe, origin: config.origin, tokenSecret: directTokenSecret ?? config.tokenSecret,
    assertCollectionReady: repo.assertCollectionReady, now: () => NOW,
  });
  const admin = vi.fn(async () => isAdmin ? 19 : false);
  const app = express();
  // Intentionally no origin, readiness, or webhook-secret override: production
  // defaults must use the existing Stripe credential and optional invoice settings.
  registerPayableInvoiceRoutes(app, { service, admin, stripe });
  const issue: InvoiceIssueInput = {
    requestId: REQUEST_ID, clientId: CLIENT.id, from: LOOKUP.from, to: LOOKUP.to,
    serviceIds: rows.map(row => row.id), confirmedUnpaid: true, dueDate: invoice.dueDate,
    reviewHash: invoiceReviewHash(CLIENT, rows, LOOKUP.from, LOOKUP.to),
  };
  const markPaid = {
    requestId: REQUEST_ID, clientId: CLIENT.id, from: LOOKUP.from, to: LOOKUP.to,
    serviceIds: issue.serviceIds, reviewHash: issue.reviewHash,
  };
  return { app, repo, service, stripe, create, retrieve, sdk, constructEvent, admin, rows, invoice, attempt, session, issue, markPaid };
}
type Fixture = ReturnType<typeof fixture>;
function expectCalledOnceWith(mock: { mock: { calls: unknown[][] } }, ...args: unknown[]) {
  expect(mock.mock.calls).toEqual([args]);
}
function noPaymentEffects(f: Fixture) {
  for (const method of [
    f.repo.issue, f.repo.reserve, f.repo.attachSession, f.repo.settle,
    f.repo.markAlreadyPaid, f.repo.expire, f.repo.assertCollectionReady,
    f.stripe, f.create, f.retrieve,
  ]) expect(method).not.toHaveBeenCalled();
}
function eventPayload(f: Fixture, marked = true) {
  const event = {
    id: "evt_test_configuration", object: "event", type: "checkout.session.completed",
    livemode: false, data: { object: {
      ...f.session, metadata: marked ? f.session.metadata : { unrelated: "old-payment-flow" },
    } },
  };
  // Whitespace, ordering and non-ASCII content make JSON reserialization invalid
  // for this signature even when the parsed object has identical semantics.
  return ` \n${JSON.stringify({ ...event, testNote: "local cryptography café" }, null, 2)}\n `;
}
function signature(f: Fixture, payload: string, secret = WEBHOOK_SECRET) {
  return f.sdk.webhooks.generateTestHeaderString({ payload, secret });
}
function webhook(f: Fixture, payload: string, header?: string) {
  const post = request(f.app).post(`${INVOICE_API}/stripe-webhook`)
    .set("Content-Type", "application/json");
  if (header !== undefined) post.set("stripe-signature", header);
  return post.send(payload);
}

describe("confirmed production invoice configuration flow", () => {
  it("looks up canonical same-origin bookings before either new secret exists", async () => {
    const f = fixture();
    const response = await request(f.app).post(`${INVOICE_API}/admin/lookup`)
      .set("Origin", ORIGIN).send(LOOKUP).expect(200);
    expect(response.body.client.id).toBe(CLIENT.id);
    expect(response.body.services[0].id).toBe("leadflow_jobs:101");
    expect(response.body.reviewHash).toBe(f.issue.reviewHash);
    expectCalledOnceWith(f.repo.lookup, LOOKUP.phone, LOOKUP.email, LOOKUP.from, LOOKUP.to);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    noPaymentEffects(f);
  });

  it.each([
    ["stale quote app", STALE_ORIGIN], ["missing", undefined],
    ["opaque null", "null"], ["arbitrary website", "https://attacker.example.test"],
  ])("rejects %s origin with a safe, helpful 403 before lookup", async (_label, origin) => {
    const f = fixture();
    const post = request(f.app).post(`${INVOICE_API}/admin/lookup`);
    if (origin !== undefined) post.set("Origin", origin);
    const response = await post.send(LOOKUP).expect(403);
    expect(response.body.error).toMatch(/^ORIGIN_(?:NOT_ALLOWED|REQUIRED)$/);
    expect(response.body.message).toMatch(/configured LeadFlow domain/i);
    safeResponse(response.body);
    expect(f.repo.lookup).not.toHaveBeenCalled();
    noPaymentEffects(f);
  });

  it.each(["status", "lookup", "issue", "mark-paid"])("retains the active-admin guard on %s", async action => {
    const f = fixture(false);
    const response = action === "status"
      ? await request(f.app).get(`${INVOICE_API}/admin/status`).expect(403)
      : await request(f.app).post(`${INVOICE_API}/admin/${action}`).set("Origin", ORIGIN)
        .send(action === "issue" ? f.issue : action === "mark-paid" ? f.markPaid : LOOKUP).expect(403);
    expect(response.body.error).toBe("ADMIN_REQUIRED");
    expect(response.body.message).toMatch(/active administrator/i);
    expect(f.repo.lookup).not.toHaveBeenCalled();
    noPaymentEffects(f);
  });

  it("reports ready without either optional dedicated secret and exposes no server key or legacy credentials", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", GLOBAL_WEBHOOK_SECRET);
    const f = fixture();
    const response = await request(f.app).get(`${INVOICE_API}/admin/status`).expect(200);
    expect(response.body).toEqual({ paymentsReady: true, message: "" });
    safeResponse(response.body);
    noPaymentEffects(f);
  });

  it.each(["stripe", "stripe-and-dedicated-secrets", "short-token"])("blocks direct issue/checkout/resume POSTs with %s configuration invalid", async missing => {
    readyEnvironment();
    if (missing.startsWith("stripe")) vi.stubEnv("STRIPE_SECRET_KEY", undefined);
    if (missing === "stripe-and-dedicated-secrets") {
      vi.stubEnv("INVOICE_TOKEN_SECRET", undefined);
      vi.stubEnv("INVOICE_STRIPE_WEBHOOK_SECRET", undefined);
    }
    if (missing === "short-token") vi.stubEnv("INVOICE_TOKEN_SECRET", "short-test-only-token");
    const f = fixture();
    const issueSpy = vi.spyOn(f.service, "issue");
    const checkoutSpy = vi.spyOn(f.service, "checkout");
    const resumeSpy = vi.spyOn(f.service, "resume");
    for (const [path, body] of [
      ["admin/issue", f.issue],
      [`${TOKEN}/checkout`, { requestId: REQUEST_ID, lineIds: [1] }],
      [`${TOKEN}/resume`, {}],
    ] as const) {
      const response = await request(f.app).post(`${INVOICE_API}/${path}`)
        .set("Origin", ORIGIN).send(body).expect(503);
      expect(response.body.error).toBe("INVOICE_PAYMENTS_NOT_CONFIGURED");
      expect(response.body.message).toMatch(/no invoice or payment attempt was created/i);
      safeResponse(response.body);
    }
    for (const spy of [issueSpy, checkoutSpy, resumeSpy]) expect(spy).not.toHaveBeenCalled();
    expect(f.repo.services).not.toHaveBeenCalled();
    expect(f.repo.byToken).not.toHaveBeenCalled();
    expect(f.repo.replayIssue).not.toHaveBeenCalled();
    noPaymentEffects(f);
  });

  it("keeps mark-already-paid available under the injected active admin without signing/payment setup", async () => {
    const f = fixture();
    const response = await request(f.app).post(`${INVOICE_API}/admin/mark-paid`)
      .set("Origin", ORIGIN).send(f.markPaid).expect(200);
    expectCalledOnceWith(f.repo.markAlreadyPaid, f.markPaid, 19);
    expect(response.body.reviewHash).toBe(f.issue.reviewHash);
    expect(f.stripe).not.toHaveBeenCalled();
    expect(f.repo.issue).not.toHaveBeenCalled();
    expect(f.repo.reserve).not.toHaveBeenCalled();
  });

  it("keeps existing capability view available with missing Stripe key and no admin login", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", undefined);
    const f = fixture(false);
    await expect(f.service.view(TOKEN)).resolves.toBe(f.invoice);
    const response = await request(f.app).get(`${INVOICE_API}/${TOKEN}`).expect(200);
    expect(response.body.invoice.id).toBe(f.invoice.id);
    expect(response.body.paymentsReady).toBe(false);
    expect(response.body.message).toMatch(/contact Maids in Black/i);
    expect(f.repo.byToken).toHaveBeenCalledWith(invoiceTokenHash(TOKEN));
    expect(f.admin).not.toHaveBeenCalled();
    noPaymentEffects(f);
  });

  it("becomes ready with both new secrets plus only the existing Stripe key, irrespective of short JWT and absent global webhook", async () => {
    readyEnvironment();
    const f = fixture();
    const response = await request(f.app).get(`${INVOICE_API}/admin/status`).expect(200);
    expect(response.body).toMatchObject({ paymentsReady: true, message: "" });
    expect(process.env.JWT_SECRET).toBe(SHORT_JWT);
    expect(process.env.QUOTE_APP_URL).toBe(STALE_ORIGIN);
    expect(process.env.STRIPE_WEBHOOK_SECRET).toBeUndefined();
    safeResponse(response.body);
    noPaymentEffects(f);
  });

  it("issues a real service token with the dedicated HMAC secret and canonical invoice URL", async () => {
    readyEnvironment();
    const f = fixture();
    const response = await request(f.app).post(`${INVOICE_API}/admin/issue`)
      .set("Origin", ORIGIN).send(f.issue).expect(200);
    const input = `invoice:${CLIENT.id}:${REQUEST_ID}`;
    const expectedToken = createHmac("sha256", TOKEN_SECRET).update(input).digest("hex");
    const legacyToken = createHmac("sha256", SHORT_JWT).update(input).digest("hex");
    expect(response.body.url).toBe(`${ORIGIN}/invoice/${expectedToken}`);
    expect(response.body.url).not.toContain(legacyToken);
    expect(response.body.url).not.toContain(STALE_ORIGIN);
    expect(f.repo.issue.mock.calls[0][3]).toBe(invoiceTokenHash(expectedToken));
    expect(f.repo.assertCollectionReady).toHaveBeenCalledWith(f.rows);
    expect(f.stripe).not.toHaveBeenCalled();
  });

  it("allows ready checkout and resume using only the fake processor and canonical return URLs", async () => {
    readyEnvironment();
    const f = fixture();
    const response = await request(f.app).post(`${INVOICE_API}/${TOKEN}/checkout`)
      .set("Origin", ORIGIN).send({ requestId: REQUEST_ID, lineIds: [1] }).expect(200);
    expect(response.body.url).toBe(f.session.url);
    expectCalledOnceWith(f.repo.reserve, f.invoice.id, REQUEST_ID, [1]);
    expect(f.create.mock.calls[0][0]).toMatchObject({
      success_url: `${ORIGIN}/invoice/${TOKEN}?returned=1`, cancel_url: `${ORIGIN}/invoice/${TOKEN}`,
    });
    f.invoice.activeAttemptId = f.attempt.id;
    f.attempt.sessionId = f.session.id;
    f.session.payment_status = "unpaid";
    f.session.status = "open";
    await request(f.app).post(`${INVOICE_API}/${TOKEN}/resume`)
      .set("Origin", ORIGIN).send({}).expect(200);
    expect(f.retrieve).toHaveBeenCalledWith(f.session.id);
    expect(f.repo.settle).not.toHaveBeenCalled();
  });

  it("issues without either dedicated secret, charges only 40000 remaining cents, and settles once through trusted refresh", async () => {
    const f = fixture();
    f.rows.splice(0, f.rows.length, ...[188000, 17000, 23000].map((amountCents, index) => ({
      id: `leadflow_jobs:${101 + index}`, occurrenceKey: `leadflow_jobs:${101 + index}:2026-11-0${2 + index}`,
      date: `2026-11-0${2 + index}`, description: "Example service", address: "Example street",
      amountCents, paidCents: index === 0 ? amountCents : 0,
      status: "completed", eligible: true, reason: null,
    })));
    f.invoice.lines = f.rows.map((row, index) => ({ ...row, id: index + 1, paidCents: row.paidCents! }));
    f.invoice.status = "partially_paid";
    f.issue.serviceIds = f.rows.map(row => row.id);
    f.issue.reviewHash = invoiceReviewHash(CLIENT, f.rows, LOOKUP.from, LOOKUP.to);
    f.attempt.lineIds = [2, 3];
    f.attempt.amountCents = 40000;
    f.session.amount_total = 40000;
    f.session.payment_status = "unpaid";
    f.session.status = "open";
    f.repo.attachSession.mockImplementation(async (_id, sessionId, url) => {
      f.invoice.activeAttemptId = f.attempt.id;
      f.attempt.sessionId = sessionId;
      f.attempt.sessionUrl = url;
      f.attempt.state = "session_open";
    });
    f.repo.settle.mockImplementation(async () => {
      for (const line of f.invoice.lines) if (f.attempt.lineIds.includes(line.id)) line.paidCents = line.amountCents;
      f.invoice.receipts.push({ paymentId: "pi_test_invoice_configuration", amountCents: 40000,
        paidAt: "2026-11-08T12:00:00Z", lineIds: [2, 3] });
      f.invoice.activeAttemptId = null;
      f.invoice.status = "paid";
      f.attempt.state = "paid";
    });
    expect(process.env.INVOICE_TOKEN_SECRET).toBeUndefined();
    expect(process.env.INVOICE_STRIPE_WEBHOOK_SECRET).toBeUndefined();
    expect(process.env.JWT_SECRET).toBe(SHORT_JWT);
    const issued = await request(f.app).post(`${INVOICE_API}/admin/issue`)
      .set("Origin", ORIGIN).send(f.issue).expect(200);
    const token = createHmac("sha256", DERIVED_SECRET).update(`invoice:${CLIENT.id}:${REQUEST_ID}`).digest("hex");
    expect(issued.body.url).toBe(`${ORIGIN}/invoice/${token}`);
    expect(f.repo.issue.mock.calls[0][3]).toBe(invoiceTokenHash(token));
    expect(token).not.toBe(createHmac("sha256", SHORT_JWT).update(`invoice:${CLIENT.id}:${REQUEST_ID}`).digest("hex"));
    const checkout = await request(f.app).post(`${INVOICE_API}/${token}/checkout`)
      .set("Origin", ORIGIN).send({ requestId: REQUEST_ID, lineIds: [2, 3] }).expect(200);
    expect(checkout.body.url).toBe(f.session.url);
    safeResponse(checkout.body);
    expectCalledOnceWith(f.repo.reserve, f.invoice.id, REQUEST_ID, [2, 3]);
    expect(f.create.mock.calls[0][0]).toMatchObject({
      mode: "payment", client_reference_id: f.attempt.id,
      line_items: [{ price_data: { currency: "usd", unit_amount: 40000 }, quantity: 1 }],
      metadata: { leadflowInvoice: INVOICE_PAYMENT_MARKER, invoiceId: "42", invoiceAttemptId: f.attempt.id },
      success_url: `${ORIGIN}/invoice/${token}?returned=1`, cancel_url: `${ORIGIN}/invoice/${token}`,
    });
    expect(f.create.mock.calls[0][1]).toEqual({ idempotencyKey: `leadflow:invoice:42:attempt:${f.attempt.id}` });
    expect(f.repo.settle).not.toHaveBeenCalled();
    f.session.payment_status = "paid";
    f.session.status = "complete";
    const refreshed = await request(f.app).get(`${INVOICE_API}/${token}`).expect(200);
    expectCalledOnceWith(f.retrieve, f.session.id);
    expectCalledOnceWith(f.repo.settle, f.attempt.id, f.session.id, "pi_test_invoice_configuration", 40000);
    expect(refreshed.body).toMatchObject({ paymentsReady: true, invoice: { status: "paid", activeAttemptId: null } });
    expect(refreshed.body.invoice.lines.map((line: { paidCents: number }) => line.paidCents)).toEqual([188000, 17000, 23000]);
    const again = await request(f.app).get(`${INVOICE_API}/${token}`).expect(200);
    expect(again.body.invoice.receipts).toHaveLength(1);
    expect(f.retrieve).toHaveBeenCalledOnce();
    expect(f.repo.settle).toHaveBeenCalledOnce();
    expect(f.create).toHaveBeenCalledOnce();
  });

  it.each(["invoice", "attempt", "amount", "currency", "reference", "session"])("keeps trusted refresh %s identity guard without optional secrets", async kind => {
    const f = fixture();
    f.invoice.activeAttemptId = f.attempt.id;
    f.attempt.sessionId = f.session.id;
    if (kind === "invoice") f.session.metadata!.invoiceId = "99";
    if (kind === "attempt") f.session.metadata!.invoiceAttemptId = "other-attempt";
    if (kind === "amount") f.session.amount_total = 10001;
    if (kind === "currency") f.session.currency = "eur";
    if (kind === "reference") f.session.payment_intent = null;
    if (kind === "session") f.session.id = "cs_test_other";
    const response = await request(f.app).get(`${INVOICE_API}/${TOKEN}`).expect(409);
    expect(response.body.error).toBe("PAYMENT_IDENTITY_MISMATCH");
    safeResponse(response.body);
    expect(f.retrieve).toHaveBeenCalledOnce();
    expect(f.repo.settle).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });

  it("retains the refund/payment-review checkout guard without optional secrets", async () => {
    const f = fixture();
    f.invoice.status = "payment_review";
    f.invoice.receipts = [{ paymentId: "pi_test_refunded", amountCents: 10000,
      refundedCents: 5000, paidAt: "2026-11-08T12:00:00Z", lineIds: [1] }];
    const response = await request(f.app).post(`${INVOICE_API}/${TOKEN}/checkout`)
      .set("Origin", ORIGIN).send({ requestId: REQUEST_ID, lineIds: [1] }).expect(409);
    expect(response.body.error).toBe("PAYMENT_REVIEW_REQUIRED");
    safeResponse(response.body);
    expect(f.repo.reserve).not.toHaveBeenCalled();
    expect(f.stripe).not.toHaveBeenCalled();
    expect(f.repo.settle).not.toHaveBeenCalled();
  });

  it("safely reports a throwing fake processor instead of attempting the real provider", async () => {
    readyEnvironment();
    const f = fixture();
    f.create.mockRejectedValueOnce(new Error("private processor failure exampleclient@example.test"));
    const response = await request(f.app).post(`${INVOICE_API}/${TOKEN}/checkout`)
      .set("Origin", ORIGIN).send({ requestId: REQUEST_ID, lineIds: [1] }).expect(503);
    expect(response.body.error).toBe("INVOICE_UNAVAILABLE");
    safeResponse(response.body);
    expect(f.repo.attachSession).not.toHaveBeenCalled();
    expect(f.repo.settle).not.toHaveBeenCalled();
  });
});

describe("real service defers dedicated signing validation until link issuance", () => {
  it.each([undefined, "", "short-test-only-token", "t".repeat(31)])("constructs and looks up with invalid signing key %j, but issue fails typed before storage", async secret => {
    vi.stubEnv("INVOICE_TOKEN_SECRET", secret);
    const f = fixture(true, secret ?? "");
    expect(f.service).toBeInstanceOf(PayableInvoiceService);
    await expect(f.service.lookup(LOOKUP.phone, LOOKUP.email, LOOKUP.from, LOOKUP.to))
      .resolves.toMatchObject({ client: CLIENT, reviewHash: f.issue.reviewHash });
    let failure: unknown;
    try { await f.service.issue(f.issue); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(InvoiceError);
    expect(failure).toMatchObject({ code: "INVOICE_SIGNING_NOT_CONFIGURED", status: 503 });
    expect((failure as InvoiceError).message).toContain("INVOICE_TOKEN_SECRET");
    expect(f.repo.replayIssue).not.toHaveBeenCalled();
    expect(f.repo.services).not.toHaveBeenCalled();
    noPaymentEffects(f);
  });

  it("rejects admin link regeneration with a typed signing error, without mutation or providers", async () => {
    const f = fixture(true, "");
    await expect(f.service.adminInvoice(f.invoice.id)).rejects.toBeInstanceOf(InvoiceError);
    await expect(f.service.adminInvoice(f.invoice.id)).rejects.toMatchObject({
      code: "INVOICE_SIGNING_NOT_CONFIGURED", status: 503,
    });
    noPaymentEffects(f);
  });
});

describe("dedicated raw invoice Stripe webhook, cryptography only", () => {
  it("returns 503 without the dedicated webhook secret even if the old global secret signs the payload", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", GLOBAL_WEBHOOK_SECRET);
    const f = fixture();
    const fakeReconcile = vi.spyOn(f.service, "reconcile").mockResolvedValue(undefined);
    const payload = eventPayload(f);
    const response = await webhook(f, payload, signature(f, payload, GLOBAL_WEBHOOK_SECRET)).expect(503);
    expect(response.body.error).toBe("INVOICE_WEBHOOK_NOT_CONFIGURED");
    safeResponse(response.body);
    expect(f.constructEvent).not.toHaveBeenCalled();
    expect(fakeReconcile).not.toHaveBeenCalled();
    noPaymentEffects(f);
  });

  it("verifies the exact raw bytes with the real SDK and forwards a valid invoice event to fake reconciliation", async () => {
    vi.stubEnv("INVOICE_STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
    const f = fixture();
    const fakeReconcile = vi.spyOn(f.service, "reconcile").mockResolvedValue(undefined);
    const payload = eventPayload(f);
    const header = signature(f, payload);
    const response = await webhook(f, payload, header).expect(200);
    expect(response.body).toEqual({ received: true });
    expect(f.constructEvent).toHaveBeenCalledOnce();
    const [raw, receivedSignature, secret] = f.constructEvent.mock.calls[0];
    expect(Buffer.isBuffer(raw)).toBe(true);
    expect(raw).toEqual(Buffer.from(payload, "utf8"));
    expect(receivedSignature).toBe(header);
    expect(secret).toBe(WEBHOOK_SECRET);
    expectCalledOnceWith(fakeReconcile, JSON.parse(payload));
    expect(f.repo.settle).not.toHaveBeenCalled();
    expect(f.retrieve).not.toHaveBeenCalled();
  });

  it.each(["old-secret", "missing", "tampered", "reserialized"])("rejects %s signature/body without reconciliation", async kind => {
    readyEnvironment();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", GLOBAL_WEBHOOK_SECRET);
    const f = fixture();
    const fakeReconcile = vi.spyOn(f.service, "reconcile").mockResolvedValue(undefined);
    const original = eventPayload(f);
    const header = kind === "missing" ? undefined : signature(f, original,
      kind === "old-secret" ? GLOBAL_WEBHOOK_SECRET : WEBHOOK_SECRET);
    const payload = kind === "tampered" ? original.replace("café", "cafe")
      : kind === "reserialized" ? JSON.stringify(JSON.parse(original)) : original;
    const response = await webhook(f, payload, header).expect(400);
    expect(response.body.error).toBe("INVALID_SIGNATURE");
    safeResponse(response.body);
    expect(fakeReconcile).not.toHaveBeenCalled();
    expect(f.repo.settle).not.toHaveBeenCalled();
    expect(f.retrieve).not.toHaveBeenCalled();
  });

  it("ignores a correctly signed event without the dedicated invoice marker", async () => {
    vi.stubEnv("INVOICE_STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
    const f = fixture();
    const fakeReconcile = vi.spyOn(f.service, "reconcile").mockResolvedValue(undefined);
    const payload = eventPayload(f, false);
    const response = await webhook(f, payload, signature(f, payload)).expect(200);
    expect(response.body).toEqual({ received: true, ignored: true });
    expect(f.constructEvent).toHaveBeenCalledOnce();
    expect(fakeReconcile).not.toHaveBeenCalled();
    expect(f.repo.settle).not.toHaveBeenCalled();
    expect(f.retrieve).not.toHaveBeenCalled();
  });

  it("returns retriable 503 rather than 200 for a signed invoice reconciliation failure", async () => {
    vi.stubEnv("INVOICE_STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
    const f = fixture();
    const fakeReconcile = vi.spyOn(f.service, "reconcile")
      .mockRejectedValueOnce(new Error("private storage commit failure exampleclient@example.test"));
    const payload = eventPayload(f);
    const response = await webhook(f, payload, signature(f, payload)).expect(503);
    expect(response.body.error).toBe("INVOICE_UNAVAILABLE");
    expect(response.body.received).not.toBe(true);
    safeResponse(response.body);
    expect(fakeReconcile).toHaveBeenCalledOnce();
    expect(f.repo.settle).not.toHaveBeenCalled();
  });

  it("reconciles real service signed confirmation with missing token key, without lookup or link creation", async () => {
    vi.stubEnv("INVOICE_STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
    const f = fixture();
    f.attempt.sessionId = f.session.id;
    const payload = eventPayload(f);
    await webhook(f, payload, signature(f, payload)).expect(200);
    expect(process.env.INVOICE_TOKEN_SECRET).toBeUndefined();
    expectCalledOnceWith(f.retrieve, f.session.id);
    expectCalledOnceWith(f.repo.settle,
      f.attempt.id, f.session.id, "pi_test_invoice_configuration", f.attempt.amountCents,
    );
    expect(f.repo.lookup).not.toHaveBeenCalled();
    expect(f.repo.byToken).not.toHaveBeenCalled();
    expect(f.repo.services).not.toHaveBeenCalled();
    expect(f.repo.issue).not.toHaveBeenCalled();
    expect(f.repo.reserve).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });

  it("does not settle an unpaid processor confirmation", async () => {
    vi.stubEnv("INVOICE_STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
    const f = fixture();
    f.session.payment_status = "unpaid";
    const payload = eventPayload(f);
    await webhook(f, payload, signature(f, payload)).expect(200);
    expectCalledOnceWith(f.retrieve, f.session.id);
    expect(f.repo.settle).not.toHaveBeenCalled();
  });

  it("keeps real service reconciliation retriable when the fake processor throws", async () => {
    vi.stubEnv("INVOICE_STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
    const f = fixture();
    f.retrieve.mockRejectedValueOnce(new Error("private processor confirmation failure"));
    const payload = eventPayload(f);
    const response = await webhook(f, payload, signature(f, payload)).expect(503);
    expect(response.body.error).toBe("INVOICE_UNAVAILABLE");
    safeResponse(response.body);
    expect(f.repo.settle).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });
});

describe("runtime service uses dedicated production configuration", () => {
  it("initializes the actual runtime service from INVOICE_TOKEN_SECRET, never the legacy JWT or quote URL", async () => {
    readyEnvironment();
    const f = fixture();
    boundary.runtimeRepo = f.repo;
    try {
      const runtime = runtimeInvoiceService();
      expect(runtime).toBeInstanceOf(PayableInvoiceService);
      const app = express();
      // No service override here: the runtime factory must construct the real
      // service from env and the explicitly mocked repository constructor.
      registerPayableInvoiceRoutes(app, { admin: async () => 19, stripe: f.stripe });
      const response = await request(app).post(`${INVOICE_API}/admin/issue`)
        .set("Origin", ORIGIN).send(f.issue).expect(200);
      const expectedToken = createHmac("sha256", TOKEN_SECRET)
        .update(`invoice:${CLIENT.id}:${REQUEST_ID}`).digest("hex");
      expect(response.body.url).toBe(`${ORIGIN}/invoice/${expectedToken}`);
      expect(f.repo.issue.mock.calls[0][3]).toBe(invoiceTokenHash(expectedToken));
      expect(boundary.repository).toHaveBeenCalledOnce();
      expect(f.stripe).not.toHaveBeenCalled();
      expect(f.repo.reserve).not.toHaveBeenCalled();
    } finally {
      boundary.runtimeRepo = null;
    }
  });
});
