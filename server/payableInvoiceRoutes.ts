import express, { type Express, type Request } from "express";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { agents } from "../drizzle/schema";
import { getDb, getPool } from "./db";
import { getAgentFromRequest } from "./_core/agentAuth";
import { ENV } from "./_core/env";
import { getStripeClient } from "./stripeClient";
import { invoiceCheckoutSchema, invoiceIssueSchema, invoiceLookupSchema, invoiceMarkPaidSchema, invoiceSendSchema, InvoiceError } from "../shared/payableInvoice";
import { INVOICE_PAYMENT_MARKER, PayableInvoiceService } from "./payableInvoiceService";
import { MysqlInvoiceRepository } from "./payableInvoiceRepository";
import { generatePayableInvoicePdf, sendPayableInvoiceEmail } from "./payableInvoiceDelivery";
import { InvoiceMailOutbox } from "./payableInvoiceMailOutbox";
import { invoiceConfiguration, invoiceRuntimeOrigin } from "./payableInvoiceConfig";
export { invoiceRuntimeOrigin } from "./payableInvoiceConfig";

export const INVOICE_API = "/api/payable-invoices";
type Options = { service?: PayableInvoiceService; admin?: (req: Request) => Promise<boolean | number>; origin?: string; stripe?: () => Stripe; webhookSecret?: string; paymentsReady?: boolean; outbox?: InvoiceMailOutbox; send?: typeof sendPayableInvoiceEmail };

async function activeAdmin(req: Request): Promise<number | false> {
  const session = await getAgentFromRequest(req);
  if (!session?.isAdmin || !ENV.cookieSecret) return false;
  const db = await getDb();
  if (!db) return false;
  const [agent] = await db.select({ id: agents.id, isAdmin: agents.isAdmin, isActive: agents.isActive }).from(agents).where(eq(agents.id, session.agentId)).limit(1);
  return agent?.isAdmin && agent.isActive ? agent.id : false;
}
const stripeClient = () => {
  if (!ENV.stripeSecretKey) throw new InvoiceError("STRIPE_NOT_CONFIGURED", 503, "Secure payments are not configured.");
  return getStripeClient();
};
const pool = async () => { await getDb(); const value = getPool(); if (!value) throw new InvoiceError("INVOICE_STORAGE_UNAVAILABLE", 503, "Invoice storage is unavailable."); return value; };
let runtime: PayableInvoiceService | null = null;
export function runtimeInvoiceService() {
  if (runtime) return runtime;
  const repo = new MysqlInvoiceRepository(pool);
  const config = invoiceConfiguration();
  runtime = new PayableInvoiceService({ repo, stripe: stripeClient, origin: config.origin, tokenSecret: config.tokenSecret, assertCollectionReady: rows => repo.assertCollectionReady(rows) });
  return runtime;
}
export function isPayableInvoiceEvent(event: Stripe.Event): boolean {
  const object = event.data.object as { metadata?: Record<string, string> };
  return object.metadata?.leadflowInvoice === INVOICE_PAYMENT_MARKER;
}
/** Existing Stripe transport calls this only after verifying the raw signature. */
export async function reconcilePayableInvoiceEvent(event: Stripe.Event) { await runtimeInvoiceService().reconcile(event); }

/** Registration is inert: no database, Stripe, email or migration calls. */
export function registerPayableInvoiceRoutes(app: Express, options: Options = {}): void {
  const origin = options.origin ?? invoiceRuntimeOrigin();
  const admin = options.admin ?? activeAdmin;
  const stripe = options.stripe ?? stripeClient;
  const service = () => options.service ?? runtimeInvoiceService();
  const ready = () => options.paymentsReady ?? invoiceConfiguration().paymentsReady;
  const paymentMessage = () => ready() ? "" : invoiceConfiguration().message || "Invoice payment setup is incomplete. Booking lookup remains available.";
  const requirePayments = () => { if (!ready()) throw new InvoiceError("INVOICE_PAYMENTS_NOT_CONFIGURED", 503, "Secure invoice payment setup is incomplete. No invoice or payment attempt was created."); };
  const outbox = options.outbox ?? new InvoiceMailOutbox(pool);
  const router = express.Router();
  const fail = (res: express.Response, error: unknown) => {
    if (error instanceof InvoiceError) return res.status(error.status).json({ success: false, error: error.code, message: error.message });
    return res.status(503).json({ success: false, error: "INVOICE_UNAVAILABLE", message: "Invoice data is temporarily unavailable. No new payment has been confirmed." });
  };
  router.use((req, res, next) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
    if (req.headers.origin && req.headers.origin !== origin) return void res.status(403).json({ success: false, error: "ORIGIN_NOT_ALLOWED", message: "Open the invoice workspace on its configured LeadFlow domain and try again." });
    if (Object.keys(req.query).length) return void res.status(400).json({ success: false, error: "INVALID_QUERY" });
    next();
  });
  router.post("/stripe-webhook", express.raw({ type: "application/json", limit: "256kb", inflate: false }), async (req, res) => {
    const secret = options.webhookSecret ?? invoiceConfiguration().webhookSecret;
    if (!secret) return void res.status(503).json({ success: false, error: "INVOICE_WEBHOOK_NOT_CONFIGURED", message: "The signed invoice webhook is not configured." });
    let event: Stripe.Event;
    try {
      const signature = req.headers["stripe-signature"];
      if (typeof signature !== "string" || !Buffer.isBuffer(req.body)) throw new Error("Signature missing");
      event = stripe().webhooks.constructEvent(req.body, signature, secret);
    } catch { return void res.status(400).json({ success: false, error: "INVALID_SIGNATURE" }); }
    if (!isPayableInvoiceEvent(event)) return void res.json({ received: true, ignored: true });
    try { await service().reconcile(event); res.json({ received: true }); } catch (error) { fail(res, error); }
  });
  router.use(express.json({ limit: "256kb", inflate: false, strict: true }));
  router.use(async (req, res, next) => {
    if (!req.path.startsWith("/admin/")) return next();
    try { const identity = await admin(req); if (!identity) return void res.status(403).json({ success: false, error: "ADMIN_REQUIRED", message: "Sign in with an active administrator account." }); res.locals.invoiceAgentId = typeof identity === "number" ? identity : null; next(); } catch (error) { fail(res, error); }
  });
  const requireOrigin = (req: Request, res: express.Response): boolean => {
    if (req.headers.origin === origin) return true;
    res.status(403).json({ success: false, error: "ORIGIN_REQUIRED", message: "This invoice action must be submitted from its configured LeadFlow domain." }); return false;
  };
  router.get("/admin/status", (_req, res) => { res.json({ paymentsReady: ready(), message: paymentMessage() }); });
  router.post("/admin/lookup", async (req, res) => {
    if (!requireOrigin(req, res)) return;
    const parsed = invoiceLookupSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ success: false, error: "INVALID_INPUT", message: "Enter a valid client phone, email and service-date period." });
    try { res.json(await service().lookup(parsed.data.phone, parsed.data.email, parsed.data.from, parsed.data.to)); } catch (error) { fail(res, error); }
  });
  router.post("/admin/mark-paid", async (req, res) => {
    if (!requireOrigin(req, res)) return;
    const parsed = invoiceMarkPaidSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ success: false, error: "INVALID_INPUT", message: "Review the selected services before recording them as already paid." });
    try { res.json(await service().markAlreadyPaid(parsed.data, res.locals.invoiceAgentId)); } catch (error) { fail(res, error); }
  });
  router.post("/admin/issue", async (req, res) => {
    if (!requireOrigin(req, res)) return;
    const parsed = invoiceIssueSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ success: false, error: "INVALID_INPUT", message: "Review the client, dates and service totals before issuing." });
    try { requirePayments(); res.json(await service().issue(parsed.data)); } catch (error) { fail(res, error); }
  });
  router.get("/admin/:id/pdf", async (req, res) => {
    try { const { invoice, url } = await service().adminInvoice(Number(req.params.id)); const pdf = await generatePayableInvoicePdf(invoice, url); res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="Invoice-${invoice.id}.pdf"` }); res.send(Buffer.from(pdf)); } catch (error) { fail(res, error); }
  });
  router.post("/admin/:id/send", async (req, res) => {
    if (!requireOrigin(req, res)) return;
    const parsed = invoiceSendSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ success: false, error: "INVALID_INPUT", message: "Confirm sending this invoice to its verified billing email." });
    try {
      const { invoice, client, url } = await service().adminInvoice(Number(req.params.id));
      if (!client.email) throw new InvoiceError("CLIENT_IDENTITY_MISMATCH", 409, "The billing email must be verified before sending.");
      res.json(await outbox.send(parsed.data.requestId, invoice.id, client.email, url, () => (options.send ?? sendPayableInvoiceEmail)(invoice, url, client.email!)));
    } catch (error) { fail(res, error); }
  });
  router.get("/:token", async (req, res) => {
    try { res.json({ invoice: await service().refresh(req.params.token), paymentsReady: ready(), message: ready() ? "" : "Secure invoice payment setup is incomplete. Please contact Maids in Black." }); } catch (error) { fail(res, error); }
  });
  router.post("/:token/resume", async (req, res) => {
    if (!requireOrigin(req, res)) return;
    try { requirePayments(); res.json(await service().resume(req.params.token)); } catch (error) { fail(res, error); }
  });
  router.post("/:token/checkout", async (req, res) => {
    if (!requireOrigin(req, res)) return;
    const parsed = invoiceCheckoutSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ success: false, error: "INVALID_INPUT", message: "Select the service dates you want to pay." });
    try { requirePayments(); res.json(await service().checkout(req.params.token, parsed.data.requestId, parsed.data.lineIds)); } catch (error) { fail(res, error); }
  });
  const parserError: express.ErrorRequestHandler = (error, _req, res, _next) => { res.status(error?.type === "entity.too.large" ? 413 : 400).json({ success: false, error: "INVALID_BODY", message: "The request could not be read." }); };
  router.use(parserError);
  app.use(INVOICE_API, router);
}
