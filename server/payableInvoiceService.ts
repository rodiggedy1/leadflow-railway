import { createHash, createHmac } from "node:crypto";
import type Stripe from "stripe";
import { InvoiceError, selectedBalance, safeSum, type InvoiceAttempt, type InvoiceClient, type InvoiceService, type PayableInvoice, type invoiceIssueSchema, type invoiceMarkPaidSchema } from "../shared/payableInvoice";
import { invoiceReviewHash } from "./payableInvoiceReview";
import type { z } from "zod";

export const INVOICE_PAYMENT_MARKER = "leadflow_invoice_v1";
export type InvoiceIssueInput = z.infer<typeof invoiceIssueSchema>;
export type InvoiceMarkPaidInput = z.infer<typeof invoiceMarkPaidSchema>;
export type InvoiceRepository = {
  lookup(phone: string, email: string, from: string, to: string): Promise<{ client: InvoiceClient | null; services: InvoiceService[] }>;
  services(clientId: number, from: string, to: string): Promise<{ client: InvoiceClient; services: InvoiceService[] }>;
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
  async markAlreadyPaid(input: InvoiceMarkPaidInput, agentId: number) {
    if (!this.deps.repo.markAlreadyPaid) throw new InvoiceError("INVOICE_STORAGE_UNAVAILABLE", 503, "Invoice payment records are unavailable.");
    if (!Number.isSafeInteger(agentId) || agentId <= 0) throw new InvoiceError("ADMIN_REQUIRED", 403, "An active staff administrator is required.");
    await this.deps.repo.markAlreadyPaid(input, agentId);
    const result = await this.deps.repo.services(input.clientId, input.from, input.to);
    return { ...result, reviewHash: invoiceReviewHash(result.client, result.services, input.from, input.to) };
  }
  async issue(input: InvoiceIssueInput) {
    const token = this.token(input.clientId, input.requestId);
    const replay = await this.deps.repo.replayIssue?.(input, invoiceTokenHash(token));
    if (replay) return { invoice: replay, url: `${this.deps.origin}/invoice/${token}` };
    const { client, services } = await this.deps.repo.services(input.clientId, input.from, input.to);
    if (input.reviewHash !== invoiceReviewHash(client, services, input.from, input.to)) throw new InvoiceError("REVIEW_CHANGED", 409, "Service dates, amounts or paid status changed. Pull bookings again before creating the invoice.");
    if (new Set(input.serviceIds).size !== input.serviceIds.length) throw new InvoiceError("INVALID_SELECTION", 400, "Select each service only once.");
    const selected = input.serviceIds.map(id => services.find(service => service.id === id));
    if (selected.some(service => !service || !service.eligible)) throw new InvoiceError("SERVICE_REVIEW_REQUIRED", 409, "Selected services need review before issuing.");
    const rows = selected as InvoiceService[];
    const total = safeSum(rows.map(row => row.amountCents));
    if (total < 50) throw new InvoiceError("INVALID_AMOUNT", 409, "Select a payable service total.");
    await this.deps.assertCollectionReady(rows);
    const payloadHash = createHash("sha256").update(JSON.stringify({ clientId: input.clientId, from: input.from, to: input.to, dueDate: input.dueDate, services: rows.slice().sort((a,b) => a.id.localeCompare(b.id)).map(row => [row.occurrenceKey,row.date,row.amountCents,row.paidCents ?? 0]) })).digest("hex");
    const invoice = await this.deps.repo.issue(input, client, rows, invoiceTokenHash(token), payloadHash);
    return { invoice, url: `${this.deps.origin}/invoice/${token}` };
  }
  async adminInvoice(invoiceId: number) {
    if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0 || !this.deps.repo.adminInvoice) throw new InvoiceError("NOT_FOUND", 404, "Invoice unavailable.");
    const result = await this.deps.repo.adminInvoice(invoiceId);
    return { ...result, url: `${this.deps.origin}/invoice/${this.token(result.client.id, result.requestId)}` };
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
  async checkout(token: string, requestId: string, lineIds: number[]) {
    const invoice = await this.view(token);
    await this.deps.assertCollectionReady(invoice);
    selectedBalance(invoice, lineIds);
    const attempt = await this.deps.repo.reserve(invoice.id, requestId, lineIds.slice().sort((a,b) => a-b));
    if (attempt.state === "paid") throw new InvoiceError("ALREADY_PAID", 409, "This payment has already been recorded. Refresh the invoice.");
    if (attempt.sessionId && attempt.sessionUrl) return { url: attempt.sessionUrl };
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
