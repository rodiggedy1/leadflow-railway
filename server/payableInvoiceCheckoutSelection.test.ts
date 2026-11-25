import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import {
  InvoiceError,
  invoiceBalance,
  selectedBalance,
  type InvoiceAttempt,
  type InvoiceClient,
  type InvoiceService,
  type PayableInvoice,
} from "../shared/payableInvoice";
import {
  INVOICE_PAYMENT_MARKER,
  invoiceTokenHash,
  PayableInvoiceService,
  type InvoiceRepository,
} from "./payableInvoiceService";

// OFFLINE ONLY: no DB, environment, real Stripe constructor, routes, or app startup.
// The fake mirrors MysqlInvoiceRepository.reserve/attachSession/expire/settle's
// retained UUID checks and owner/state/CAS guards; it is not a SQL-engine test.
const NOW = Date.parse("2026-11-16T12:00:00Z");
const TOKEN = "a".repeat(64);
const ORIGIN = "https://invoice.example.test";
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";
const CLIENT: InvoiceClient = { id: 17, name: "Offline owner", phone: "+12025550123", email: "owner@example.test" };
const copy = <T>(value: T): T => structuredClone(value);
const fail = (code: string, status = 409): never => { throw new InvoiceError(code, status, `OFFLINE ONLY ${code}`); };
const canonical = (ids: number[]) => {
  if (!ids.length || ids.length > 1000 || ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) fail("INVALID_SELECTION", 400);
  return ids.slice().sort((a, b) => a - b);
};
const validSessionId = (id: string) => /^cs_[A-Za-z0-9_]+$/.test(id) && id.length <= 255;
const validUrl = (url: string) => /^https:\/\/checkout\.stripe\.com\//.test(url) && url.length <= 2048;

function invoiceFixture(): PayableInvoice {
  return {
    id: 42, number: "OFFLINE-42", clientId: CLIENT.id, clientName: CLIENT.name,
    from: "2026-11-01", to: "2026-11-07", dueDate: "2026-11-20",
    currency: "usd", status: "open", activeAttemptId: null, receipts: [],
    lines: [12_345, 6_789, 4_321].map((amountCents, index) => ({
      id: index + 1, occurrenceKey: `job:${101 + index}`, date: `2026-11-0${index + 2}`,
      description: "Offline service", address: "Offline address", amountCents, paidCents: 0, manualPaidCents: 0,
    })),
  };
}

class OfflineRepository implements InvoiceRepository {
  invoice = invoiceFixture();
  attempts = new Map<string, InvoiceAttempt>();
  payments = new Map<string, string>();
  allocations = new Map<number, string>();
  settlementEffects = 0;
  collectionError: InvoiceError | null = null;
  beforeAttach: ((attemptId: string, sessionId: string, url: string) => Promise<void>) | null = null;
  beforeExpire: ((attemptId: string, sessionId: string) => Promise<void>) | null = null;

  constructor(readonly trace: string[]) {}
  lookup = vi.fn(async () => ({ client: copy(CLIENT), services: [] as InvoiceService[] }));
  services = vi.fn(async () => ({ client: copy(CLIENT), services: [] as InvoiceService[] }));
  issue = vi.fn(async (): Promise<PayableInvoice> => { throw new Error("OFFLINE ONLY issue is outside checkout scope"); });
  byToken = vi.fn(async (hash: string) => {
    this.trace.push("repo:view");
    return hash === invoiceTokenHash(TOKEN) ? copy(this.invoice) : null;
  });
  attempt = vi.fn(async (id: string) => {
    this.trace.push(`repo:attempt:${id}`);
    const attempt = this.attempts.get(id);
    return attempt ? copy(attempt) : null;
  });
  assertCollectionReady = vi.fn(async (_invoice: InvoiceService[] | PayableInvoice) => {
    this.trace.push("repo:collection");
    if (this.collectionError) throw this.collectionError;
    if (["void", "payment_review"].includes(this.invoice.status)) fail("PAYMENT_REVIEW_REQUIRED");
  });
  reserve = vi.fn(async (invoiceId: number, requestId: string, lineIds: number[]): Promise<InvoiceAttempt> => {
    this.trace.push(`repo:reserve:${requestId}:${lineIds.join(",")}`);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) fail("INVALID_REQUEST", 400);
    const ids = canonical(lineIds);
    if (invoiceId !== this.invoice.id) fail("NOT_FOUND", 404);
    const old = [...this.attempts.values()].find(attempt => attempt.invoiceId === invoiceId && attempt.requestId === requestId);
    if (old) {
      // Exact history FIRST, even if a different attempt currently owns the invoice.
      if (JSON.stringify(old.lineIds) !== JSON.stringify(ids)) fail("IDEMPOTENCY_CONFLICT");
      if (old.state === "expired") fail("PAYMENT_REVIEW_REQUIRED");
      if (old.state !== "paid" && this.invoice.activeAttemptId !== old.id) fail("PAYMENT_REVIEW_REQUIRED");
      this.trace.push(`repo:replay:${old.id}`);
      return copy(old);
    }
    if (this.invoice.activeAttemptId !== null) fail("CHECKOUT_IN_PROGRESS");
    const amountCents = selectedBalance(this.invoice, ids);
    if (this.collectionError) throw this.collectionError;
    if (ids.some(id => this.invoice.lines.find(line => line.id === id)!.paidCents !== 0)) fail("PAYMENT_REVIEW_REQUIRED");
    const id = `offline_attempt_${this.attempts.size + 1}`;
    const attempt: InvoiceAttempt = { id, invoiceId, requestId, lineIds: ids, amountCents, currency: "usd", state: "pending", sessionId: null, sessionUrl: null, createdAt: NOW };
    // Synchronous mutation before resolving models one atomic invoice reservation.
    this.attempts.set(id, attempt);
    this.invoice.activeAttemptId = id;
    this.trace.push(`repo:reserved:${id}`);
    return copy(attempt);
  });
  attachSession = vi.fn(async (id: string, sessionId: string, url: string) => {
    this.trace.push(`repo:attach:${id}:${sessionId}`);
    if (this.beforeAttach) await this.beforeAttach(id, sessionId, url);
    if (!validSessionId(sessionId) || !validUrl(url)) fail("PAYMENT_IDENTITY_MISMATCH");
    const attempt = this.owned(id);
    if (attempt.sessionId !== null && (attempt.sessionId !== sessionId || (attempt.sessionUrl !== null && attempt.sessionUrl !== url))) fail("PAYMENT_IDENTITY_MISMATCH");
    if (attempt.state !== "paid" && (this.invoice.activeAttemptId !== id || !["pending", "session_open"].includes(attempt.state))) fail("PAYMENT_REVIEW_REQUIRED");
    attempt.sessionId = sessionId;
    attempt.sessionUrl = url;
    if (attempt.state !== "paid") attempt.state = "session_open";
    this.trace.push(`repo:attached:${id}`);
  });
  expire = vi.fn(async (id: string, sessionId: string) => {
    this.trace.push(`repo:expire:${id}:${sessionId}`);
    if (this.beforeExpire) await this.beforeExpire(id, sessionId);
    if (!validSessionId(sessionId)) fail("PAYMENT_IDENTITY_MISMATCH");
    const attempt = this.owned(id);
    if (attempt.sessionId !== sessionId) fail("PAYMENT_IDENTITY_MISMATCH");
    if (attempt.state === "paid") fail("ALREADY_PAID");
    if (attempt.state !== "expired" && this.invoice.activeAttemptId !== id) fail("PAYMENT_REVIEW_REQUIRED");
    attempt.state = "expired";
    // Idempotent old expiration can clear only its own reservation, never a winner.
    if (this.invoice.activeAttemptId === id) this.invoice.activeAttemptId = null;
    this.trace.push(`repo:expired:${id}`);
  });
  settle = vi.fn(async (id: string, sessionId: string, paymentId: string, amountCents: number) => {
    this.trace.push(`repo:settle:${id}:${sessionId}`);
    if (!validSessionId(sessionId) || !/^pi_[A-Za-z0-9_]+$/.test(paymentId) || paymentId.length > 255 || !Number.isSafeInteger(amountCents)) fail("PAYMENT_IDENTITY_MISMATCH");
    const attempt = this.owned(id);
    if (amountCents !== attempt.amountCents || (attempt.sessionId !== null && attempt.sessionId !== sessionId)) fail("PAYMENT_IDENTITY_MISMATCH");
    if (attempt.state === "paid") {
      if (this.payments.get(id) !== paymentId || attempt.sessionId !== sessionId) fail("PAYMENT_IDENTITY_MISMATCH");
      return;
    }
    if (this.invoice.activeAttemptId !== id || !["pending", "session_open"].includes(attempt.state)) fail("PAYMENT_REVIEW_REQUIRED");
    if (selectedBalance(this.invoice, attempt.lineIds) !== amountCents || attempt.lineIds.some(lineId => this.invoice.lines.find(line => line.id === lineId)!.paidCents !== 0 || this.allocations.has(lineId))) fail("PAYMENT_IDENTITY_MISMATCH");
    if ([...this.payments.values()].includes(paymentId)) fail("PAYMENT_IDENTITY_MISMATCH");
    for (const lineId of attempt.lineIds) {
      this.invoice.lines.find(line => line.id === lineId)!.paidCents = this.invoice.lines.find(line => line.id === lineId)!.amountCents;
      this.allocations.set(lineId, id);
    }
    attempt.state = "paid";
    attempt.sessionId = sessionId;
    this.payments.set(id, paymentId);
    this.settlementEffects += 1;
    this.invoice.receipts.push({ paymentId, amountCents, paidAt: new Date(NOW).toISOString(), lineIds: [...attempt.lineIds] });
    if (this.invoice.status !== "payment_review") this.invoice.status = invoiceBalance(this.invoice.lines) === 0 ? "paid" : "partially_paid";
    this.invoice.activeAttemptId = null;
    this.trace.push(`repo:settled:${id}`);
  });
  private owned(id: string): InvoiceAttempt {
    const attempt = this.attempts.get(id);
    if (!attempt) fail("NOT_FOUND", 404);
    if (attempt.invoiceId !== this.invoice.id) fail("PAYMENT_IDENTITY_MISMATCH");
    return attempt;
  }
}

class OfflineStripe {
  sessions = new Map<string, Stripe.Checkout.Session>();
  keys = new Map<string, { params: Stripe.Checkout.SessionCreateParams; sessionId: string }>();
  afterCreate: ((session: Stripe.Checkout.Session) => Promise<void>) | null = null;
  onRetrieve: ((id: string) => Promise<void>) | null = null;
  onExpire: ((id: string) => Promise<void>) | null = null;
  constructor(readonly trace: string[]) {}
  create = vi.fn(async (params: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions): Promise<Stripe.Checkout.Session> => {
    const key = options?.idempotencyKey;
    if (!key) throw new Error("OFFLINE ONLY missing idempotency key");
    this.trace.push(`stripe:create:${key}`);
    const old = this.keys.get(key);
    let session: Stripe.Checkout.Session;
    if (old) {
      if (JSON.stringify(old.params) !== JSON.stringify(params)) throw new Error("OFFLINE ONLY changed Stripe idempotent creation params");
      session = this.get(old.sessionId);
    } else {
      const id = `cs_test_offline_${this.sessions.size + 1}`;
      session = {
        id, object: "checkout.session", mode: params.mode, livemode: false,
        status: "open", payment_status: "unpaid", currency: params.line_items![0].price_data!.currency,
        amount_total: params.line_items![0].price_data!.unit_amount,
        amount_subtotal: params.line_items![0].price_data!.unit_amount,
        client_reference_id: params.client_reference_id, metadata: copy(params.metadata),
        payment_intent: `pi_test_offline_${this.sessions.size + 1}`,
        url: `https://checkout.stripe.com/c/pay/test_offline_${this.sessions.size + 1}`,
        created: Math.floor(NOW / 1000), expires_at: params.expires_at,
        success_url: params.success_url, cancel_url: params.cancel_url,
        payment_method_types: copy(params.payment_method_types),
      } as Stripe.Checkout.Session;
      this.sessions.set(id, session);
      this.keys.set(key, { params: copy(params), sessionId: id });
      this.trace.push(`stripe:created:${id}`);
    }
    // The provider can persist a session and then lose the response.
    if (this.afterCreate) await this.afterCreate(session);
    return copy(session);
  });
  retrieve = vi.fn(async (id: string): Promise<Stripe.Checkout.Session> => {
    this.trace.push(`stripe:retrieve:${id}`);
    if (this.onRetrieve) await this.onRetrieve(id);
    const session = copy(this.get(id));
    this.trace.push(`stripe:retrieved:${id}:${session.status}:${session.payment_status}`);
    return session;
  });
  expire = vi.fn(async (id: string): Promise<Stripe.Checkout.Session> => {
    this.trace.push(`stripe:expire:${id}`);
    if (this.onExpire) await this.onExpire(id);
    const session = this.get(id);
    if (session.payment_status === "paid" || session.status !== "open") throw new Error("OFFLINE ONLY session is not expirable");
    session.status = "expired";
    this.trace.push(`stripe:expired:${id}`);
    return copy(session);
  });
  get(id: string): Stripe.Checkout.Session {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`OFFLINE ONLY unknown session ${id}`);
    return session;
  }
  pay(id: string) { Object.assign(this.get(id), { status: "complete", payment_status: "paid" }); }
  client(): Stripe { return { checkout: { sessions: { create: this.create, retrieve: this.retrieve, expire: this.expire } } } as unknown as Stripe; }
}

function harness() {
  const trace: string[] = [];
  const repo = new OfflineRepository(trace);
  const provider = new OfflineStripe(trace);
  const stripe = vi.fn(() => provider.client());
  const service = new PayableInvoiceService({
    repo, stripe, origin: ORIGIN, tokenSecret: "offline-only-invoice-secret-not-real-2026",
    assertCollectionReady: repo.assertCollectionReady, now: () => NOW,
  });
  return { repo, provider, service, stripe, trace };
}
type Harness = ReturnType<typeof harness>;
async function start(h: Harness, lineIds = [1, 2, 3], requestId = UUID_A) {
  const result = await h.service.checkout(TOKEN, requestId, lineIds);
  const attempt = h.repo.attempts.get(h.repo.invoice.activeAttemptId!)!;
  expect(result).toEqual({ url: attempt.sessionUrl });
  return copy(attempt);
}
function expectedParams(attempt: InvoiceAttempt): Stripe.Checkout.SessionCreateParams {
  const metadata = { leadflowInvoice: INVOICE_PAYMENT_MARKER, invoiceId: String(attempt.invoiceId), invoiceAttemptId: attempt.id };
  return {
    mode: "payment", payment_method_types: ["card"], client_reference_id: attempt.id,
    line_items: [{ price_data: { currency: "usd", unit_amount: attempt.amountCents, product_data: {
      name: "Maids in Black invoice OFFLINE-42", description: `${attempt.lineIds.length} selected service date${attempt.lineIds.length === 1 ? "" : "s"}`,
    } }, quantity: 1 }],
    metadata, payment_intent_data: { metadata },
    success_url: `${ORIGIN}/invoice/${TOKEN}?returned=1`, cancel_url: `${ORIGIN}/invoice/${TOKEN}`,
    expires_at: Math.floor(attempt.createdAt / 1000) + 24 * 60 * 60,
  };
}
function expectCreate(h: Harness, attempt: InvoiceAttempt) {
  expect(h.provider.create).toHaveBeenCalledWith(expectedParams(attempt), { idempotencyKey: `leadflow:invoice:42:attempt:${attempt.id}` });
}
function active(h: Harness) { return h.repo.attempts.get(h.repo.invoice.activeAttemptId!)!; }
function expectRetained(h: Harness, attempt: InvoiceAttempt) {
  expect(h.repo.invoice.activeAttemptId).toBe(attempt.id);
  expect(h.repo.attempts.get(attempt.id)!.state).toBe("session_open");
  expect(h.repo.expire).not.toHaveBeenCalled();
  expect(h.provider.sessions.size).toBe(1);
}
function expectRetirementBeforeReplacement(h: Harness, old: InvoiceAttempt, replacement: InvoiceAttempt) {
  const remoteExpired = h.trace.findIndex(item => item === `stripe:expired:${old.sessionId}` || item === `stripe:retrieved:${old.sessionId}:expired:unpaid`);
  const localExpire = h.trace.indexOf(`repo:expire:${old.id}:${old.sessionId}`);
  const localExpired = h.trace.indexOf(`repo:expired:${old.id}`);
  const replacementReserve = h.trace.indexOf(`repo:reserved:${replacement.id}`);
  expect(remoteExpired).toBeGreaterThanOrEqual(0);
  expect(localExpire).toBeGreaterThan(remoteExpired);
  expect(localExpired).toBeGreaterThanOrEqual(localExpire);
  expect(replacementReserve).toBeGreaterThan(localExpired);
  expect(h.repo.reserve.mock.calls.filter(([, request]) => request === replacement.requestId)).toHaveLength(2); // preflight conflict + one final reserve
}
function event(session: Stripe.Checkout.Session): Stripe.Event {
  return { id: `evt_test_${session.id}`, object: "event", type: "checkout.session.completed", livemode: false, data: { object: copy(session) } } as Stripe.Event;
}
async function webhookPay(h: Harness, sessionId: string) {
  h.provider.pay(sessionId);
  await h.service.reconcile(event(h.provider.get(sessionId)));
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

// Each case starts from owned immutable invoice lines and only calls /checkout's service path.
describe("PayableInvoiceService offline checkout selection replacement", () => {
  it("changes old all-services to one service in one call, with exact cents, canonical IDs and expire-before-reserve ordering", async () => {
    const h = harness();
    const old = await start(h, [3, 1, 2]);
    const result = await h.service.checkout(TOKEN, UUID_B, [2]);
    const next = active(h);
    expect(result).toEqual({ url: next.sessionUrl });
    expect(next).toMatchObject({ requestId: UUID_B, lineIds: [2], amountCents: 6_789 });
    expect(h.repo.attempts.get(old.id)!.state).toBe("expired");
    expect(h.provider.expire).toHaveBeenCalledWith(old.sessionId);
    expectCreate(h, old); expectCreate(h, next);
    expectRetirementBeforeReplacement(h, old, next);
    expect(h.provider.sessions.size).toBe(2);
  });

  it("changes a subset to a disjoint subset without retaining the old amount", async () => {
    const h = harness(); const old = await start(h, [1]);
    await h.service.checkout(TOKEN, UUID_B, [3, 2]);
    expect(active(h)).toMatchObject({ lineIds: [2, 3], amountCents: 11_110 });
    expectCreate(h, active(h)); expectRetirementBeforeReplacement(h, old, active(h));
  });

  it("changes a subset to all services with one replacement for the complete canonical selection", async () => {
    const h = harness(); const old = await start(h, [2]);
    await h.service.checkout(TOKEN, UUID_B, [3, 1, 2]);
    expect(active(h)).toMatchObject({ lineIds: [1, 2, 3], amountCents: 23_455 });
    expectCreate(h, active(h)); expectRetirementBeforeReplacement(h, old, active(h));
  });

  it("reuses the verified provider URL for identical IDs in another order/new UUID and revalidates the original reservation", async () => {
    const h = harness(); const old = await start(h, [2, 1]);
    const providerUrl = "https://checkout.stripe.com/c/pay/test_verified_url";
    h.provider.get(old.sessionId!).url = providerUrl;
    expect(await h.service.checkout(TOKEN, UUID_B, [1, 2])).toEqual({ url: providerUrl });
    expect(h.repo.reserve.mock.calls.slice(1)).toEqual([[42, UUID_B, [1, 2]], [42, UUID_A, [1, 2]]]);
    expect(h.provider.retrieve).toHaveBeenCalledWith(old.sessionId);
    expect(h.provider.create).toHaveBeenCalledTimes(1);
    expect(h.provider.expire).not.toHaveBeenCalled();
    expect(h.repo.attempts.size).toBe(1);
  });

  it("does not duplicate the session on an exact UUID replay", async () => {
    const h = harness(); const old = await start(h, [1, 2]);
    expect(await h.service.checkout(TOKEN, UUID_A, [2, 1])).toEqual({ url: old.sessionUrl });
    expect(h.provider.create).toHaveBeenCalledTimes(1);
    expect(h.provider.retrieve).toHaveBeenCalledWith(old.sessionId);
    expect(h.provider.expire).not.toHaveBeenCalled();
    expect(h.repo.attempts.size).toBe(1);
  });

  it("rejects wrong retrieved session identity before any expiration, replacement, or settlement", async () => {
    const mismatches: Partial<Stripe.Checkout.Session>[] = [
      { id: "cs_test_wrong" }, { amount_total: 1 }, { currency: "eur" }, { mode: "setup" },
      { client_reference_id: "wrong" }, { metadata: { leadflowInvoice: INVOICE_PAYMENT_MARKER, invoiceId: "43", invoiceAttemptId: "offline_attempt_1" } },
      { metadata: { leadflowInvoice: "wrong", invoiceId: "42", invoiceAttemptId: "offline_attempt_1" } },
    ];
    for (const mismatch of mismatches) {
      const h = harness(); const old = await start(h, [1]);
      Object.assign(h.provider.get(old.sessionId!), mismatch);
      await expect(h.service.checkout(TOKEN, UUID_B, [2])).rejects.toMatchObject({ code: "PAYMENT_IDENTITY_MISMATCH" });
      expectRetained(h, old);
      expect(h.provider.expire).not.toHaveBeenCalled();
      expect(h.repo.settle).not.toHaveBeenCalled();
    }
  });

  it("retires a naturally expired unpaid predecessor and uses the fresh incoming UUID without calling Stripe expire", async () => {
    const h = harness(); const old = await start(h, [1]);
    h.provider.get(old.sessionId!).status = "expired";
    await h.service.checkout(TOKEN, UUID_B, [2]);
    expect(active(h)).toMatchObject({ requestId: UUID_B, lineIds: [2] });
    expect(h.provider.expire).not.toHaveBeenCalled();
    expectRetirementBeforeReplacement(h, old, active(h));
  });

  it("returns refresh for the attached same UUID's expired session, then permits an explicit fresh-UUID retry", async () => {
    const h = harness(); const old = await start(h, [1]);
    h.provider.get(old.sessionId!).status = "expired";
    expect(await h.service.checkout(TOKEN, UUID_A, [1])).toEqual({ refresh: true });
    expect(h.repo.invoice.activeAttemptId).toBeNull();
    expect(h.repo.attempts.get(old.id)!.state).toBe("expired");
    expect(h.provider.sessions.size).toBe(1);
    await h.service.checkout(TOKEN, UUID_B, [1]);
    expect(active(h)).toMatchObject({ requestId: UUID_B, lineIds: [1] });
    expect(h.provider.sessions.size).toBe(2);
  });

  it("uses an incoming fresh UUID when the same selection's attached session naturally expires", async () => {
    const h = harness(); const old = await start(h, [1, 2]);
    h.provider.get(old.sessionId!).status = "expired";
    const result = await h.service.checkout(TOKEN, UUID_B, [2, 1]);
    expect(active(h)).toMatchObject({ requestId: UUID_B, lineIds: [1, 2] });
    expect(result).toEqual({ url: active(h).sessionUrl });
    expect(h.provider.expire).not.toHaveBeenCalled();
    expect(h.provider.sessions.size).toBe(2);
  });

  it("fails closed when Stripe expiration throws and the same captured session is still open", async () => {
    const h = harness(); const old = await start(h, [1]);
    h.provider.onExpire = async () => { throw new Error("OFFLINE ONLY expire denied"); };
    await expect(h.service.checkout(TOKEN, UUID_B, [2])).rejects.toBeInstanceOf(Error);
    expect(h.provider.retrieve.mock.calls.filter(([id]) => id === old.sessionId).length).toBeGreaterThanOrEqual(2);
    expectRetained(h, old);
  });

  it("fails closed on unknown expiration outcome plus failed recovery retrieve", async () => {
    const h = harness(); const old = await start(h, [1]);
    h.provider.onExpire = async () => {
      h.provider.onRetrieve = async () => { throw new Error("OFFLINE ONLY retrieval unavailable"); };
      throw new Error("OFFLINE ONLY unknown expiration timeout");
    };
    await expect(h.service.checkout(TOKEN, UUID_B, [2])).rejects.toBeInstanceOf(Error);
    expect(h.provider.retrieve.mock.calls.every(([id]) => id === old.sessionId)).toBe(true);
    expectRetained(h, old);
  });

  it("continues after an expiration timeout only when recovery verifies the captured session expired and unpaid", async () => {
    const h = harness(); const old = await start(h, [1]);
    h.provider.onExpire = async id => { h.provider.get(id).status = "expired"; throw new Error("OFFLINE ONLY response lost after expiration"); };
    await h.service.checkout(TOKEN, UUID_B, [2]);
    expect(active(h)).toMatchObject({ requestId: UUID_B, lineIds: [2] });
    expectRetirementBeforeReplacement(h, old, active(h));
    expect(h.provider.retrieve.mock.calls.every(([id]) => id === old.sessionId)).toBe(true);
  });

  it("settles a paid predecessor before replacement and refreshes when any requested line overlaps", async () => {
    const h = harness(); const old = await start(h, [1, 2]);
    h.provider.pay(old.sessionId!);
    expect(await h.service.checkout(TOKEN, UUID_B, [2, 3])).toEqual({ refresh: true });
    expect(h.repo.settlementEffects).toBe(1);
    expect(h.repo.invoice.lines.map(line => line.paidCents)).toEqual([12_345, 6_789, 0]);
    expect(h.repo.invoice.receipts).toHaveLength(1);
    expect(h.provider.expire).not.toHaveBeenCalled();
    expect(h.repo.expire).not.toHaveBeenCalled();
    expect(h.provider.sessions.size).toBe(1);
  });

  it("settles an already paid disjoint predecessor then continues the requested unpaid selection in one call", async () => {
    const h = harness(); const old = await start(h, [1]);
    h.provider.pay(old.sessionId!);
    await h.service.checkout(TOKEN, UUID_B, [3, 2]);
    expect(active(h)).toMatchObject({ requestId: UUID_B, lineIds: [2, 3], amountCents: 11_110 });
    expect(h.repo.settlementEffects).toBe(1);
    expect(h.trace.indexOf(`repo:reserved:${active(h).id}`)).toBeGreaterThan(h.trace.indexOf(`repo:settled:${old.id}`));
    expect(h.provider.expire).not.toHaveBeenCalled();
    expect(h.repo.expire).not.toHaveBeenCalled();
  });

  it("classifies payment during provider expiration as paid and refreshes overlapping desired lines", async () => {
    const h = harness(); const old = await start(h, [1]);
    h.provider.onExpire = async id => { h.provider.pay(id); throw new Error("OFFLINE ONLY payment won expiration race"); };
    expect(await h.service.checkout(TOKEN, UUID_B, [1, 2])).toEqual({ refresh: true });
    expect(h.repo.settlementEffects).toBe(1);
    expect(h.repo.expire).not.toHaveBeenCalled();
    expect(h.provider.sessions.size).toBe(1);
    expect(h.provider.retrieve.mock.calls.every(([id]) => id === old.sessionId)).toBe(true);
  });

  it("continues a disjoint selection after payment wins provider expiration", async () => {
    const h = harness(); const old = await start(h, [1]);
    h.provider.onExpire = async id => { h.provider.pay(id); throw new Error("OFFLINE ONLY payment won expiration race"); };
    await h.service.checkout(TOKEN, UUID_B, [2]);
    expect(active(h)).toMatchObject({ lineIds: [2], amountCents: 6_789 });
    expect(h.repo.settlementEffects).toBe(1);
    expect(h.repo.expire).not.toHaveBeenCalled();
    expect(h.provider.sessions.size).toBe(2);
  });

  it("handles webhook settlement just before local expire's paid guard without overwriting paid allocations", async () => {
    const h = harness(); const old = await start(h, [1]);
    h.repo.beforeExpire = async () => { h.repo.beforeExpire = null; await webhookPay(h, old.sessionId!); };
    expect(await h.service.checkout(TOKEN, UUID_B, [1, 2])).toEqual({ refresh: true });
    expect(h.repo.expire).toHaveBeenCalledWith(old.id, old.sessionId);
    expect(h.repo.attempts.get(old.id)!.state).toBe("paid");
    expect(h.repo.settlementEffects).toBe(1);
    expect(h.repo.invoice.receipts).toHaveLength(1);
    expect(h.provider.sessions.size).toBe(1);
    expect(h.repo.invoice.activeAttemptId).toBeNull();
  });

  it("verifies stored paid evidence after local expire ALREADY_PAID and continues a disjoint selection", async () => {
    const h = harness(); const old = await start(h, [1]);
    h.repo.beforeExpire = async () => { h.repo.beforeExpire = null; await webhookPay(h, old.sessionId!); };
    await h.service.checkout(TOKEN, UUID_B, [2]);
    expect(active(h)).toMatchObject({ lineIds: [2], amountCents: 6_789 });
    const expireAt = h.trace.indexOf(`repo:expire:${old.id}:${old.sessionId}`);
    expect(h.trace.slice(expireAt + 1)).toContain(`repo:attempt:${old.id}`);
    expect(h.repo.settlementEffects).toBe(1);
    expect(h.repo.invoice.lines[0].paidCents).toBe(12_345);
    expect(h.provider.sessions.size).toBe(2);
  });

  it("does not trust ALREADY_PAID from local expire without a stored paid attempt", async () => {
    const h = harness(); const old = await start(h, [1]);
    h.repo.beforeExpire = async () => { fail("ALREADY_PAID"); };
    await expect(h.service.checkout(TOKEN, UUID_B, [2])).rejects.toBeInstanceOf(InvoiceError);
    expect(h.repo.attempts.get(old.id)!.state).toBe("session_open");
    expect(h.repo.invoice.activeAttemptId).toBe(old.id);
    expect(h.repo.settlementEffects).toBe(0);
    expect(h.provider.sessions.size).toBe(1);
  });

  it("recovers pending create-timeout selection changes using exactly the original Stripe params and key", async () => {
    const h = harness();
    h.provider.afterCreate = async () => { h.provider.afterCreate = null; throw new Error("OFFLINE ONLY create response lost"); };
    await expect(h.service.checkout(TOKEN, UUID_A, [2, 1])).rejects.toThrow("create response lost");
    const old = copy(active(h));
    expect(old).toMatchObject({ state: "pending", sessionId: null, lineIds: [1, 2] });
    expect(h.provider.sessions.size).toBe(1);
    await h.service.checkout(TOKEN, UUID_B, [3]);
    expect(h.provider.create.mock.calls[1]).toEqual(h.provider.create.mock.calls[0]);
    expectCreate(h, old);
    expect(h.repo.attempts.get(old.id)).toMatchObject({ state: "expired", sessionId: "cs_test_offline_1" });
    expect(h.provider.expire).toHaveBeenCalledWith("cs_test_offline_1");
    expect(h.provider.retrieve).toHaveBeenCalledWith("cs_test_offline_1");
    expect(active(h)).toMatchObject({ requestId: UUID_B, lineIds: [3], amountCents: 4_321 });
    expect(h.provider.sessions.size).toBe(2);
  });

  it("recovers pending attach-timeout selection changes with the original creation params/key and verified session", async () => {
    const h = harness();
    h.repo.beforeAttach = async () => { h.repo.beforeAttach = null; throw new Error("OFFLINE ONLY attach transaction timeout"); };
    await expect(h.service.checkout(TOKEN, UUID_A, [1])).rejects.toThrow("attach transaction timeout");
    const old = copy(active(h));
    expect(old).toMatchObject({ state: "pending", sessionId: null });
    await h.service.checkout(TOKEN, UUID_B, [2]);
    expect(h.provider.create.mock.calls[1]).toEqual(h.provider.create.mock.calls[0]);
    expectCreate(h, old);
    expect(h.provider.retrieve).toHaveBeenCalledWith("cs_test_offline_1");
    expect(h.repo.attempts.get(old.id)).toMatchObject({ state: "expired", sessionId: "cs_test_offline_1" });
    expect(active(h)).toMatchObject({ lineIds: [2], amountCents: 6_789 });
    expect(h.provider.sessions.size).toBe(2);
  });

  it("recovers a pending same-selection retry idempotently, without a second successful provider session", async () => {
    const h = harness();
    h.provider.afterCreate = async () => { h.provider.afterCreate = null; throw new Error("OFFLINE ONLY create response lost"); };
    await expect(h.service.checkout(TOKEN, UUID_A, [2, 1])).rejects.toThrow("create response lost");
    const result = await h.service.checkout(TOKEN, UUID_B, [1, 2]);
    expect(result).toEqual({ url: active(h).sessionUrl });
    expect(h.provider.create.mock.calls[1]).toEqual(h.provider.create.mock.calls[0]);
    expect(active(h)).toMatchObject({ requestId: UUID_A, lineIds: [1, 2], state: "session_open" });
    expect(h.provider.sessions.size).toBe(1);
    expect(h.repo.attempts.size).toBe(1);
    expect(h.provider.expire).not.toHaveBeenCalled();
  });

  it("preserves the 23-hour pending-recovery guard for both same and different selections", async () => {
    for (const hours of [23, 24]) for (const desired of [[1], [2]]) {
      const h = harness(); const old = await h.repo.reserve(42, UUID_A, [1]);
      h.repo.attempts.get(old.id)!.createdAt = NOW - hours * 60 * 60 * 1000;
      await expect(h.service.checkout(TOKEN, UUID_B, desired)).rejects.toMatchObject({ code: "PAYMENT_REVIEW_REQUIRED" });
      expect(h.provider.create).not.toHaveBeenCalled();
      expect(h.provider.expire).not.toHaveBeenCalled();
      expect(h.repo.expire).not.toHaveBeenCalled();
      expect(h.repo.invoice.activeAttemptId).toBe(old.id);
      expect(h.repo.attempts.size).toBe(1);
    }
  });

  it("rejects old expired, paid, and non-owner UUID history before touching a current checkout", async () => {
    for (const state of ["expired", "paid", "pending"] as const) {
      const h = harness(); const old = await start(h, [1]);
      if (state === "paid") await webhookPay(h, old.sessionId!);
      else {
        h.provider.get(old.sessionId!).status = "expired";
        await h.repo.expire(old.id, old.sessionId!);
        if (state === "pending") h.repo.attempts.get(old.id)!.state = "pending";
      }
      const winner = await start(h, [2], UUID_B);
      h.provider.expire.mockClear(); h.provider.retrieve.mockClear(); h.repo.expire.mockClear();
      h.repo.reserve.mockClear();
      // The unchanged service preflight rejects a paid line even before UUID
      // lookup. Either terminal-history case must leave the current checkout alone.
      const expectedCode = state === "paid" ? "BALANCE_CHANGED" : "PAYMENT_REVIEW_REQUIRED";
      await expect(h.service.checkout(TOKEN, UUID_A, [1])).rejects.toMatchObject({ code: expectedCode });
      if (state === "paid") expect(h.repo.reserve).not.toHaveBeenCalled();
      else expect(h.repo.reserve).toHaveBeenLastCalledWith(42, UUID_A, [1]);
      expect(h.repo.invoice.activeAttemptId).toBe(winner.id);
      expect(h.repo.attempts.get(winner.id)!.state).toBe("session_open");
      expect(h.provider.retrieve).not.toHaveBeenCalled();
      expect(h.provider.expire).not.toHaveBeenCalled();
      expect(h.repo.expire).not.toHaveBeenCalled();
      expect(h.provider.sessions.size).toBe(2);
    }
  });

  it("rejects an old same UUID with a different payload before cancellation of either active or newer checkout", async () => {
    const h = harness(); const old = await start(h, [1]);
    await expect(h.service.checkout(TOKEN, UUID_A, [2])).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(h.provider.expire).not.toHaveBeenCalled();
    h.provider.get(old.sessionId!).status = "expired";
    await h.repo.expire(old.id, old.sessionId!);
    const winner = await start(h, [3], UUID_B);
    h.repo.expire.mockClear(); h.provider.retrieve.mockClear();
    await expect(h.service.checkout(TOKEN, UUID_A, [2])).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(h.repo.invoice.activeAttemptId).toBe(winner.id);
    expect(h.provider.expire).not.toHaveBeenCalled();
    expect(h.provider.retrieve).not.toHaveBeenCalled();
    expect(h.repo.expire).not.toHaveBeenCalled();
    expect(h.provider.sessions.size).toBe(2);
  });

  it("allows A to B to A again only with fresh UUIDs and retains every predecessor", async () => {
    const h = harness(); const first = await start(h, [1], UUID_A);
    await h.service.checkout(TOKEN, UUID_B, [2]); const second = copy(active(h));
    await h.service.checkout(TOKEN, UUID_C, [1]); const third = active(h);
    expect(third).toMatchObject({ requestId: UUID_C, lineIds: [1], amountCents: 12_345 });
    expect(h.repo.attempts.get(first.id)!.state).toBe("expired");
    expect(h.repo.attempts.get(second.id)!.state).toBe("expired");
    expect(h.provider.expire.mock.calls).toEqual([[first.sessionId], [second.sessionId]]);
    expect(h.provider.sessions.size).toBe(3);
    expect(h.repo.attempts.size).toBe(3);
  });

  it("deterministically prevents a second switch that captured A from expiring concurrent winner B", async () => {
    const h = harness(); const old = await start(h, [1]);
    const firstCaptured = deferred(), secondCaptured = deferred(), releaseFirst = deferred(), releaseSecond = deferred();
    let captures = 0;
    h.provider.onRetrieve = async id => {
      if (id !== old.sessionId) return;
      const capture = ++captures;
      if (capture === 1) { firstCaptured.resolve(); await releaseFirst.promise; }
      if (capture === 2) { secondCaptured.resolve(); await releaseSecond.promise; }
    };
    const first = h.service.checkout(TOKEN, UUID_B, [2]);
    await firstCaptured.promise;
    const second = h.service.checkout(TOKEN, UUID_C, [3]).then(value => ({ value }), error => ({ error }));
    await secondCaptured.promise;
    releaseFirst.resolve();
    await first;
    const winner = copy(active(h));
    releaseSecond.resolve();
    const outcome = await second;
    expect(outcome).toMatchObject({ error: { code: "CHECKOUT_IN_PROGRESS" } });
    expect(h.repo.invoice.activeAttemptId).toBe(winner.id);
    expect(h.repo.attempts.get(winner.id)!.state).toBe("session_open");
    expect(h.provider.get(winner.sessionId!).status).toBe("open");
    expect(h.provider.expire.mock.calls.every(([id]) => id === old.sessionId)).toBe(true);
    expect(h.repo.expire.mock.calls.every(([id, sessionId]) => id === old.id && sessionId === old.sessionId)).toBe(true);
    expect(h.repo.reserve.mock.calls.filter(([, request]) => request === UUID_C)).toHaveLength(2);
    expect(h.provider.sessions.size).toBe(2);
    expect(h.repo.attempts.size).toBe(2);
  });

  it("creates only one successful session for concurrent duplicate same-UUID calls", async () => {
    const h = harness(); const created = deferred(), release = deferred();
    let firstCreate = true;
    h.provider.afterCreate = async () => {
      if (firstCreate) { firstCreate = false; created.resolve(); await release.promise; }
    };
    const first = h.service.checkout(TOKEN, UUID_A, [2, 1]);
    await created.promise;
    const second = await h.service.checkout(TOKEN, UUID_A, [1, 2]);
    release.resolve();
    expect(await first).toEqual(second);
    expect(h.provider.sessions.size).toBe(1);
    expect(h.provider.keys.size).toBe(1);
    expect(h.repo.attempts.size).toBe(1);
    expect(h.provider.create.mock.calls[1]).toEqual(h.provider.create.mock.calls[0]);
    expect(active(h)).toMatchObject({ requestId: UUID_A, state: "session_open", lineIds: [1, 2] });
    expect(h.provider.expire).not.toHaveBeenCalled();
  });

  it("does not replace a complete but unpaid session for either identical or changed selection", async () => {
    for (const desired of [[1], [2]]) {
      const h = harness(); const old = await start(h, [1]);
      h.provider.get(old.sessionId!).status = "complete";
      await expect(h.service.checkout(TOKEN, UUID_B, desired)).rejects.toMatchObject({ code: "PAYMENT_PROCESSING" });
      expectRetained(h, old);
      expect(h.provider.expire).not.toHaveBeenCalled();
      expect(h.repo.settle).not.toHaveBeenCalled();
    }
  });

  it("returns refresh when the original session becomes paid while attachment finishes, without duplicate allocation", async () => {
    const h = harness();
    h.repo.beforeAttach = async (_attemptId, sessionId) => {
      h.repo.beforeAttach = null;
      await webhookPay(h, sessionId);
    };
    expect(await h.service.checkout(TOKEN, UUID_A, [1])).toEqual({ refresh: true });
    expect(h.repo.attempts.get("offline_attempt_1")!.state).toBe("paid");
    expect(h.repo.settlementEffects).toBe(1);
    expect(h.repo.invoice.receipts).toHaveLength(1);
    expect(h.repo.invoice.activeAttemptId).toBeNull();
    expect(h.provider.sessions.size).toBe(1);
    await h.service.reconcile(event(h.provider.get("cs_test_offline_1")));
    expect(h.repo.settlementEffects).toBe(1);
    expect(h.provider.expire).not.toHaveBeenCalled();
  });
});
