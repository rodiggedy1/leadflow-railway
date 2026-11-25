import { createHash, createHmac } from "node:crypto";
import type Stripe from "stripe";
import { InvoiceError, selectedBalance, safeSum, type InvoiceAttempt, type InvoiceClient, type InvoiceService, type PayableInvoice, type invoiceIssueSchema, type invoiceMarkPaidSchema } from "../shared/payableInvoice";
import { invoiceReviewHash } from "./payableInvoiceReview";
import type { z } from "zod";
import { invoiceExistingSearchSchema, invoiceExistingMarkPaidSchema, type InvoiceExistingSearchInput, type InvoiceExistingSearchResult, type InvoiceExistingMarkPaidInput, type InvoiceExistingView } from "../shared/payableInvoice";
import { invoiceExistingReviewHash } from "./payableInvoiceExistingReview";

export const INVOICE_PAYMENT_MARKER = "leadflow_invoice_v1";
export type InvoiceIssueInput = z.infer<typeof invoiceIssueSchema>;
export type InvoiceMarkPaidInput = z.infer<typeof invoiceMarkPaidSchema>;
export type InvoiceRepository = {
  lookup(phone: string, email: string, from: string, to: string): Promise<{ client: InvoiceClient | null; services: InvoiceService[] }>;
  services(clientId: number, from: string, to: string): Promise<{ client: InvoiceClient; services: InvoiceService[] }>;
  contactServices?: (phone: string, email: string, from: string, to: string) => Promise<{ client: InvoiceClient; services: InvoiceService[] }>;
  issue(input: InvoiceIssueInput, client: InvoiceClient, services: InvoiceService[], tokenHash: string, payloadHash: string): Promise<PayableInvoice>;
  byToken(tokenHash: string): Promise<PayableInvoice | null>;
  reserve(invoiceId: number, requestId: string, lineIds: number[]): Promise<InvoiceAttempt>;
  attachSession(attemptId: string, sessionId: string, url: string): Promise<void>;
  attempt(id: string): Promise<InvoiceAttempt | null>;
  settle(attemptId: string, sessionId: string, paymentId: string, amountCents: number): Promise<void>;
  expire?: (attemptId: string, sessionId: string) => Promise<void>;
  assertCollectionReady?: (servicesOrInvoice: InvoiceService[] | PayableInvoice) => Promise<void>;
  markAlreadyPaid?: (input: InvoiceMarkPaidInput, agentId: number) => Promise<void>;
  adminInvoice?: (invoiceId: number) => Promise<{ invoice: PayableInvoice; client: InvoiceClient; requestId: string }>;
  replayIssue?: (input: InvoiceIssueInput, tokenHash: string) => Promise<PayableInvoice | null>;
  recordAdjustment?: (paymentId: string, refundedCents: number) => Promise<void>;
  listExisting?: (input: InvoiceExistingSearchInput) => Promise<InvoiceExistingSearchResult>;
  markInvoicePaid?: (invoiceId: number, input: InvoiceExistingMarkPaidInput, agentId: number) => Promise<void | PayableInvoice>;
};
export type InvoiceDependencies = {
  repo: InvoiceRepository;
  stripe: () => Stripe;
  origin: string;
  tokenSecret: string;
  assertCollectionReady: (servicesOrInvoice: InvoiceService[] | PayableInvoice) => Promise<void>;
  now?: () => number;
};
export const invoiceTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export class PayableInvoiceService {
  constructor(private readonly deps: InvoiceDependencies) {
    const url = new URL(deps.origin);
    if (url.origin !== deps.origin || (url.protocol !== "https:" && url.hostname !== "localhost")) throw new Error("Invalid invoice origin");
  }
  private token(clientId: number, requestId: string) {
    if (this.deps.tokenSecret.length < 32) throw new InvoiceError("INVOICE_SIGNING_NOT_CONFIGURED", 503, "INVOICE_TOKEN_SECRET must be configured with at least 32 characters before creating invoice links.");
    return createHmac("sha256", this.deps.tokenSecret).update(`invoice:${clientId}:${requestId}`).digest("hex");
  }
  async lookup(phone: string, email: string, from: string, to: string) {
    const result = await this.deps.repo.lookup(phone, email, from, to);
    return { ...result, reviewHash: result.client ? invoiceReviewHash(result.client, result.services, from, to) : "" };
  }
  private billingServices(input: { clientId: number; phone?: string; email?: string; from: string; to: string }) {
    if (input.clientId > 0) return this.deps.repo.services(input.clientId, input.from, input.to);
    if (input.clientId !== 0 || !this.deps.repo.contactServices) throw new InvoiceError("INVALID_CUSTOMER", 400, "Enter a phone or email to find the invoice services.");
    return this.deps.repo.contactServices(input.phone || "", input.email || "", input.from, input.to);
  }
  async markAlreadyPaid(input: InvoiceMarkPaidInput, agentId: number) {
    if (!this.deps.repo.markAlreadyPaid) throw new InvoiceError("INVOICE_STORAGE_UNAVAILABLE", 503, "Invoice payment records are unavailable.");
    if (!Number.isSafeInteger(agentId) || agentId <= 0) throw new InvoiceError("ADMIN_REQUIRED", 403, "An active staff administrator is required.");
    await this.deps.repo.markAlreadyPaid(input, agentId);
    const result = await this.billingServices(input);
    return { ...result, reviewHash: invoiceReviewHash(result.client, result.services, input.from, input.to) };
  }
  async issue(input: InvoiceIssueInput) {
    const token = this.token(input.clientId, input.requestId);
    const replay = await this.deps.repo.replayIssue?.(input, invoiceTokenHash(token));
    if (replay) return { invoice: replay, url: `${this.deps.origin}/invoice/${token}` };
    const { client, services } = await this.billingServices(input);
    if (input.reviewHash !== invoiceReviewHash(client, services, input.from, input.to)) throw new InvoiceError("REVIEW_CHANGED", 409, "Service dates, amounts or paid status changed. Pull bookings again before creating the invoice.");
    if (new Set(input.serviceIds).size !== input.serviceIds.length) throw new InvoiceError("INVALID_SELECTION", 400, "Select each service only once.");
    const selected = input.serviceIds.map(id => services.find(service => service.id === id));
    if (selected.some(service => !service || !service.eligible)) throw new InvoiceError("SERVICE_REVIEW_REQUIRED", 409, "Selected services need review before issuing.");
    const rows = selected as InvoiceService[];
    const total = safeSum(rows.map(row => row.amountCents));
    if (total < 50) throw new InvoiceError("INVALID_AMOUNT", 409, "Select a payable service total.");
    await this.deps.assertCollectionReady(rows);
    const payloadHash = createHash("sha256").update(JSON.stringify({ clientId: input.clientId, ...(input.clientId === 0 ? { billing: [client.phone, client.email, client.name] } : {}), from: input.from, to: input.to, dueDate: input.dueDate, services: rows.slice().sort((a,b) => a.id.localeCompare(b.id)).map(row => [row.occurrenceKey,row.date,row.amountCents,row.paidCents ?? 0]) })).digest("hex");
    const invoice = await this.deps.repo.issue(input, client, rows, invoiceTokenHash(token), payloadHash);
    return { invoice, url: `${this.deps.origin}/invoice/${token}` };
  }
  async adminInvoice(invoiceId: number) {
    if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0 || !this.deps.repo.adminInvoice) throw new InvoiceError("NOT_FOUND", 404, "Invoice unavailable.");
    const result = await this.deps.repo.adminInvoice(invoiceId);
    return { ...result, url: `${this.deps.origin}/invoice/${this.token(result.client.id, result.requestId)}` };
  }
  async searchExisting(input: InvoiceExistingSearchInput): Promise<InvoiceExistingSearchResult> {
    if (!invoiceExistingSearchSchema.safeParse(input).success) throw new InvoiceError("INVALID_INPUT", 400, "Enter a valid invoice search.");
    if (!this.deps.repo.listExisting) throw new InvoiceError("INVOICE_STORAGE_UNAVAILABLE", 503, "Saved invoice records are unavailable.");
    return this.deps.repo.listExisting(input);
  }
  async existingInvoice(invoiceId: number): Promise<InvoiceExistingView> {
    const { invoice, client, url } = await this.adminInvoice(invoiceId);
    return { invoice, client, url, reviewHash: invoiceExistingReviewHash(invoice, client) };
  }
  async markExistingInvoicePaid(invoiceId: number, input: InvoiceExistingMarkPaidInput, agentId: number): Promise<InvoiceExistingView> {
    if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0 || !invoiceExistingMarkPaidSchema.safeParse(input).success) throw new InvoiceError("INVALID_INPUT", 400, "Select saved invoice lines and confirm payment was already received.");
    if (!Number.isSafeInteger(agentId) || agentId <= 0) throw new InvoiceError("ADMIN_REQUIRED", 403, "An active staff administrator is required.");
    if (!this.deps.repo.markInvoicePaid) throw new InvoiceError("INVOICE_STORAGE_UNAVAILABLE", 503, "Saved invoice payment records are unavailable.");
    // Verify retrieval and signing before committing a manual record. This does
    // not refresh Stripe, issue a replacement invoice, or send the existing link.
    await this.existingInvoice(invoiceId);
    await this.deps.repo.markInvoicePaid(invoiceId, input, agentId);
    return this.existingInvoice(invoiceId);
  }
  async view(token: string): Promise<PayableInvoice> {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new InvoiceError("NOT_FOUND", 404, "Invoice link unavailable or expired.");
    const invoice = await this.deps.repo.byToken(invoiceTokenHash(token));
    if (!invoice) throw new InvoiceError("NOT_FOUND", 404, "Invoice link unavailable or expired.");
    if (invoice.activeAttemptId) {
      const attempt = await this.deps.repo.attempt(invoice.activeAttemptId);
      if (!attempt || attempt.invoiceId !== invoice.id) throw new InvoiceError("PAYMENT_REVIEW_REQUIRED", 409, "Invoice payment state needs review.");
      return { ...invoice, activeLineIds: attempt.lineIds };
    }
    return invoice;
  }
  async refresh(token: string) {
    const invoice = await this.view(token);
    if (!invoice.activeAttemptId) return invoice;
    const attempt = await this.deps.repo.attempt(invoice.activeAttemptId);
    if (!attempt?.sessionId) return invoice;
    const session = await this.deps.stripe().checkout.sessions.retrieve(attempt.sessionId);
    this.verifySession(session, attempt);
    if (session.payment_status === "paid") { await this.settleSession(session, session.livemode); return this.view(token); }
    return invoice;
  }
  private verifySession(session: Stripe.Checkout.Session, attempt: InvoiceAttempt) {
    if ((attempt.sessionId && session.id !== attempt.sessionId) || session.mode !== "payment" || session.client_reference_id !== attempt.id || session.metadata?.invoiceAttemptId !== attempt.id || session.metadata?.invoiceId !== String(attempt.invoiceId) || session.metadata?.leadflowInvoice !== INVOICE_PAYMENT_MARKER || session.amount_total !== attempt.amountCents || session.currency !== attempt.currency) throw new InvoiceError("PAYMENT_IDENTITY_MISMATCH", 409, "Payment reconciliation needs review.");
  }
  async checkout(token: string, requestId: string, lineIds: number[]): Promise<{ url?: string; refresh?: boolean }> {
    let invoice = await this.view(token);
    selectedBalance(invoice, lineIds);
    const ids = lineIds.slice().sort((a,b) => a-b);
    let attempt: InvoiceAttempt;
    try {
      // Validate immutable request history before touching an existing checkout.
      attempt = await this.deps.repo.reserve(invoice.id, requestId, ids);
    } catch (error) {
      if (!(error instanceof InvoiceError) || error.code !== "CHECKOUT_IN_PROGRESS") throw error;
      invoice = await this.view(token);
      if (!invoice.activeAttemptId) throw error;
      const active = await this.deps.repo.attempt(invoice.activeAttemptId);
      if (!active || active.invoiceId !== invoice.id) throw new InvoiceError("PAYMENT_REVIEW_REQUIRED", 409, "Invoice payment state needs review.");
      if (JSON.stringify(active.lineIds) === JSON.stringify(ids)) {
        attempt = await this.deps.repo.reserve(invoice.id, active.requestId, ids);
      } else {
        const session = await this.checkoutSession(token, invoice, active);
        await this.retireCheckout(session, active);
        invoice = await this.view(token);
        if (ids.some(id => !invoice.lines.some(row => row.id === id && row.paidCents < row.amountCents))) return { refresh: true };
        selectedBalance(invoice, ids);
        // One captured predecessor only: a concurrent winner is never canceled here.
        attempt = await this.deps.repo.reserve(invoice.id, requestId, ids);
      }
    }
    if (attempt.state === "paid") throw new InvoiceError("ALREADY_PAID", 409, "This payment has already been recorded. Refresh the invoice.");
    if (attempt.sessionId) {
      const session = await this.checkoutSession(token, invoice, attempt);
      if (session.payment_status === "paid") { await this.settleSession(session, session.livemode); return { refresh: true }; }
      if (session.status === "open" && session.payment_status === "unpaid" && session.url && /^https:\/\/checkout\.stripe\.com\//.test(session.url)) return { url: session.url };
      await this.retireCheckout(session, attempt);
      if (requestId === attempt.requestId) return { refresh: true };
      invoice = await this.view(token);
      if (ids.some(id => !invoice.lines.some(row => row.id === id && row.paidCents < row.amountCents))) return { refresh: true };
      selectedBalance(invoice, ids);
      attempt = await this.deps.repo.reserve(invoice.id, requestId, ids);
      if (attempt.state === "paid") return { refresh: true };
    }
    return this.openCheckoutAttempt(token, invoice, attempt);
  }
  private async checkoutSession(token: string, invoice: PayableInvoice, attempt: InvoiceAttempt): Promise<Stripe.Checkout.Session> {
    if (!attempt.sessionId) {
      // A missing binding can hide a successful create. Recover its original key,
      // parameters and expiration before considering a replacement checkout.
      await this.openCheckoutAttempt(token, invoice, attempt);
      const bound = await this.deps.repo.attempt(attempt.id);
      if (!bound || bound.invoiceId !== invoice.id || !bound.sessionId) throw new InvoiceError("PAYMENT_REVIEW_REQUIRED", 409, "Checkout binding needs review.");
      attempt = bound;
    }
    const session = await this.deps.stripe().checkout.sessions.retrieve(attempt.sessionId!);
    this.verifySession(session, attempt);
    return session;
  }
  private async retireCheckout(session: Stripe.Checkout.Session, attempt: InvoiceAttempt): Promise<void> {
    attempt = { ...attempt, sessionId: session.id };
    if (session.payment_status === "paid") { await this.settleSession(session, session.livemode); return; }
    if (!this.deps.repo.expire) throw new InvoiceError("PAYMENT_REVIEW_REQUIRED", 409, "Checkout expiration needs review.");
    if (session.status === "open" && session.payment_status === "unpaid") {
      try { session = await this.deps.stripe().checkout.sessions.expire(session.id); }
      catch { session = await this.deps.stripe().checkout.sessions.retrieve(session.id); }
      this.verifySession(session, attempt);
      if (session.payment_status === "paid") { await this.settleSession(session, session.livemode); return; }
    }
    if (session.status !== "expired" || session.payment_status !== "unpaid") throw new InvoiceError("PAYMENT_PROCESSING", 409, "Your payment is still being confirmed. No new charge was created.");
    try { await this.deps.repo.expire(attempt.id, session.id); }
    catch (error) {
      if (!(error instanceof InvoiceError) || error.code !== "ALREADY_PAID") throw error;
      const recorded = await this.deps.repo.attempt(attempt.id);
      if (!recorded || recorded.invoiceId !== attempt.invoiceId || recorded.sessionId !== session.id || recorded.state !== "paid") throw error;
    }
  }
  private async openCheckoutAttempt(token: string, invoice: PayableInvoice, attempt: InvoiceAttempt): Promise<{ url?: string; refresh?: boolean }> {
    if (attempt.state === "paid") return { refresh: true };
    if (attempt.sessionId) {
      const session = await this.checkoutSession(token, invoice, attempt);
      if (session.payment_status === "paid") { await this.settleSession(session, session.livemode); return { refresh: true }; }
      if (session.status !== "open" || session.payment_status !== "unpaid" || !session.url || !/^https:\/\/checkout\.stripe\.com\//.test(session.url)) return { refresh: true };
      return { url: session.url };
    }
    const now = (this.deps.now ?? Date.now)();
    if (now - attempt.createdAt >= 23 * 60 * 60 * 1000) throw new InvoiceError("PAYMENT_REVIEW_REQUIRED", 409, "A previous payment attempt needs review. No new charge was created.");
    const metadata = { leadflowInvoice: INVOICE_PAYMENT_MARKER, invoiceId: String(invoice.id), invoiceAttemptId: attempt.id };
    const session = await this.deps.stripe().checkout.sessions.create({
      mode: "payment", payment_method_types: ["card"], client_reference_id: attempt.id,
      line_items: [{ price_data: { currency: "usd", unit_amount: attempt.amountCents, product_data: { name: `Maids in Black invoice ${invoice.number}`, description: `${attempt.lineIds.length} selected service date${attempt.lineIds.length === 1 ? "" : "s"}` } }, quantity: 1 }],
      metadata, payment_intent_data: { metadata },
      success_url: `${this.deps.origin}/invoice/${token}?returned=1`, cancel_url: `${this.deps.origin}/invoice/${token}`,
      expires_at: Math.floor(attempt.createdAt / 1000) + 24 * 60 * 60,
    }, { idempotencyKey: `leadflow:invoice:${invoice.id}:attempt:${attempt.id}` });
    if (!session.url || !/^https:\/\/checkout\.stripe\.com\//.test(session.url)) throw new InvoiceError("CHECKOUT_UNAVAILABLE", 503, "Secure checkout is not available yet. Your payment attempt is retained.");
    await this.deps.repo.attachSession(attempt.id, session.id, session.url);
    if ((await this.deps.repo.attempt(attempt.id))?.state === "paid") return { refresh: true };
    return { url: session.url };
  }
  async resume(token: string): Promise<{ url?: string; refresh?: boolean }> {
    const invoice = await this.view(token);
    await this.deps.assertCollectionReady(invoice);
    if (!invoice.activeAttemptId) return { refresh: true };
    const attempt = await this.deps.repo.attempt(invoice.activeAttemptId);
    if (!attempt || attempt.invoiceId !== invoice.id) throw new InvoiceError("PAYMENT_REVIEW_REQUIRED", 409, "Invoice payment state needs review.");
    if (!attempt.sessionId) return this.checkout(token, attempt.requestId, attempt.lineIds);
    const session = await this.deps.stripe().checkout.sessions.retrieve(attempt.sessionId);
    this.verifySession(session, attempt);
    if (session.status === "expired") {
      if (!this.deps.repo.expire) throw new InvoiceError("PAYMENT_REVIEW_REQUIRED", 409, "Checkout expiration needs review.");
      await this.deps.repo.expire(attempt.id, session.id);
      return { refresh: true };
    }
    if (session.payment_status === "paid") { await this.settleSession(session, session.livemode); return { refresh: true }; }
    if (session.status !== "open" || !session.url || !/^https:\/\/checkout\.stripe\.com\//.test(session.url)) throw new InvoiceError("PAYMENT_PROCESSING", 409, "Your payment is still being confirmed. No new charge was created.");
    return { url: session.url };
  }
  async reconcile(event: Stripe.Event): Promise<void> {
    if (event.account) throw new InvoiceError("PAYMENT_IDENTITY_MISMATCH", 409, "Connected-account invoice events require separate configuration.");
    const object = event.data.object;
    if (event.type === "charge.refunded" && object.object === "charge") {
      const charge = await this.deps.stripe().charges.retrieve(object.id);
      if (charge.metadata?.leadflowInvoice !== INVOICE_PAYMENT_MARKER) return;
      if (charge.livemode !== event.livemode || charge.currency !== "usd") throw new InvoiceError("PAYMENT_IDENTITY_MISMATCH", 409, "Payment adjustment identity needs review.");
      const paymentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (!paymentId || !this.deps.repo.recordAdjustment) throw new InvoiceError("PAYMENT_REVIEW_REQUIRED", 409, "Payment adjustment needs review.");
      await this.deps.repo.recordAdjustment(paymentId, charge.amount_refunded);
      return;
    }
    if (event.type === "payment_intent.succeeded" && object.object === "payment_intent") {
      if (object.metadata?.leadflowInvoice !== INVOICE_PAYMENT_MARKER) return;
      const attempt = await this.deps.repo.attempt(object.metadata.invoiceAttemptId || "");
      if (!attempt?.sessionId) throw new InvoiceError("PAYMENT_PROCESSING", 503, "Checkout binding is still being saved; retry the signed event.");
      const session = await this.deps.stripe().checkout.sessions.retrieve(attempt.sessionId);
      if ((typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id) !== object.id) throw new InvoiceError("PAYMENT_IDENTITY_MISMATCH", 409, "Payment identity needs review.");
      await this.settleSession(session, event.livemode);
      return;
    }
    if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return;
    const source = object as Stripe.Checkout.Session;
    if (source.metadata?.leadflowInvoice !== INVOICE_PAYMENT_MARKER) return;
    const session = await this.deps.stripe().checkout.sessions.retrieve(source.id);
    await this.settleSession(session, event.livemode);
  }
  private async settleSession(session: Stripe.Checkout.Session, livemode: boolean): Promise<void> {
    if (session.metadata?.leadflowInvoice !== INVOICE_PAYMENT_MARKER || session.payment_status !== "paid") return;
    const attempt = await this.deps.repo.attempt(session.metadata.invoiceAttemptId || "");
    if (!attempt || session.livemode !== livemode) throw new InvoiceError("PAYMENT_IDENTITY_MISMATCH", 409, "Payment identity needs review.");
    this.verifySession(session, attempt);
    const paymentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (!paymentId) throw new InvoiceError("PAYMENT_IDENTITY_MISMATCH", 409, "Payment reference unavailable.");
    await this.deps.repo.settle(attempt.id, session.id, paymentId, attempt.amountCents);
  }
}
