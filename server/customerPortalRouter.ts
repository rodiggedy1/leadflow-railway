import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { bookings, customerPortalAccounts, customerPortalServiceRequests, stripeCustomers } from "../drizzle/schema";
import { getDb } from "./db";
import { getCustomerPortalSessionFromRequest } from "./_core/customerPortalAuth";
import { CUSTOMER_PORTAL_SERVICES, getCustomerPortalService, validateCustomerPortalSelections } from "../shared/customerPortalServices";
import { calculateCustomerPortalEstimate } from "../shared/customerPortalPricing";
import { createCustomerPortalRequestNumber } from "./customerPortalService";
import { getCustomerPortalSavedCard } from "./customerPortalPaymentService";
import { getStripeClient } from "./stripeClient";
import { adminAgentProcedure, publicProcedure, router } from "./_core/trpc";
import { getSessionCookieOptions } from "./_core/cookies";
import { signCustomerPortalSession } from "./_core/customerPortalAuth";
import { CUSTOMER_PORTAL_COOKIE_NAME, ONE_YEAR_MS } from "../shared/const";
import { requestCustomerPortalLoginCode, verifyCustomerPortalLoginCode } from "./customerPortalLoginService";
import { sendSms } from "./openphone";

const requestSchema = z.object({
  serviceId: z.string().trim().min(1).max(64),
  selections: z.record(z.string(), z.string().trim().max(1_000)),
  address: z.string().trim().min(5).max(500),
  requestedLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requestedLocalTime: z.string().trim().min(2).max(80),
  notes: z.string().trim().max(2_000).optional(),
});

export const customerPortalRouter = router({
  services: publicProcedure.query(() => CUSTOMER_PORTAL_SERVICES),
  requestLoginCode: publicProcedure.input(z.object({ phone: z.string().trim().min(1).max(40) })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("Customer portal is unavailable.");
    ctx.res.set("Cache-Control", "no-store");
    ctx.res.set("Referrer-Policy", "no-referrer");
    await requestCustomerPortalLoginCode(db, {
      phone: input.phone,
      requestIp: ctx.req.ip || ctx.req.socket.remoteAddress || "unknown",
    }, {
      sendCode: (phone, code) => sendSms({ to: phone, content: `Your Maids in Black sign-in code is ${code}. It expires in 10 minutes.` }),
    });
    return { ok: true, resendAfterSeconds: 60 };
  }),
  verifyLoginCode: publicProcedure.input(z.object({ phone: z.string().trim().min(1).max(40), code: z.string().trim().regex(/^\d{6}$/) })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("Customer portal is unavailable.");
    ctx.res.set("Cache-Control", "no-store");
    ctx.res.set("Referrer-Policy", "no-referrer");
    const account = await verifyCustomerPortalLoginCode(db, input);
    if (!account) return { ok: false };
    const token = await signCustomerPortalSession({ accountId: account.id, customerName: account.customerName, customerPhone: account.customerPhone });
    ctx.res.cookie(CUSTOMER_PORTAL_COOKIE_NAME, token, { ...getSessionCookieOptions(ctx.req), sameSite: "lax", maxAge: ONE_YEAR_MS });
    return { ok: true };
  }),
  staffRequests: adminAgentProcedure.input(z.object({ limit: z.number().int().min(1).max(200).default(200) })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("Customer portal is unavailable.");
    return db.select().from(customerPortalServiceRequests).orderBy(desc(customerPortalServiceRequests.createdAt)).limit(input.limit);
  }),
  me: publicProcedure.query(async ({ ctx }) => {
    const session = await getCustomerPortalSessionFromRequest(ctx.req);
    if (!session) return { account: null, cleanings: [], requests: [] };
    const db = await getDb();
    if (!db) throw new Error("Customer portal is unavailable.");
    const accounts = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.id, session.accountId)).limit(1);
    const account = accounts[0];
    if (!account || account.customerPhone !== session.customerPhone) return { account: null, cleanings: [], requests: [] };
    const [cleanings, requests, savedCard] = await Promise.all([
      db.select().from(bookings).where(eq(bookings.customerPhone, account.customerPhone)).orderBy(desc(bookings.createdAt)).limit(100),
      db.select().from(customerPortalServiceRequests).where(eq(customerPortalServiceRequests.accountId, account.id)).orderBy(desc(customerPortalServiceRequests.createdAt)).limit(100),
      getCustomerPortalSavedCard(db, account.customerPhone),
    ]);
    return { account: { name: account.customerName, phone: account.customerPhone, email: account.customerEmail }, cleanings, requests, savedCard: savedCard ? { brand: savedCard.brand, last4: savedCard.last4 } : null };
  }),
  startNewCardSetup: publicProcedure.mutation(async ({ ctx }) => {
    const session = await getCustomerPortalSessionFromRequest(ctx.req);
    if (!session) throw new Error("CUSTOMER_PORTAL_UNAUTHENTICATED");
    const db = await getDb();
    if (!db) throw new Error("Customer portal is unavailable.");
    const accounts = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.id, session.accountId)).limit(1);
    const account = accounts[0];
    if (!account || account.customerPhone !== session.customerPhone) throw new Error("CUSTOMER_PORTAL_UNAUTHENTICATED");
    const stripe = getStripeClient();
    const savedCard = await getCustomerPortalSavedCard(db, account.customerPhone);
    const customer = savedCard?.stripeCustomerId ? await stripe.customers.retrieve(savedCard.stripeCustomerId) : await stripe.customers.create({ name: account.customerName, phone: account.customerPhone, email: account.customerEmail ?? undefined, metadata: { source: "customer_portal" } });
    if ("deleted" in customer && customer.deleted) throw new Error("Saved payment profile is unavailable.");
    await db.insert(stripeCustomers).values({ phone: account.customerPhone, name: account.customerName, stripeCustomerId: customer.id, stripePaymentMethodId: savedCard?.stripePaymentMethodId ?? null, cardBrand: savedCard?.brand ?? null, cardLast4: savedCard?.last4 ?? null, cardExpMonth: savedCard?.expMonth ?? null, cardExpYear: savedCard?.expYear ?? null, cardSavedAt: savedCard ? Date.now() : null }).onDuplicateKeyUpdate({ set: { name: account.customerName, stripeCustomerId: customer.id } });
    const setupIntent = await stripe.setupIntents.create({ customer: customer.id, usage: "off_session", payment_method_types: ["card"], metadata: { customerPortalAccountId: String(account.id) } });
    if (!setupIntent.client_secret) throw new Error("Stripe could not prepare secure card entry.");
    return { clientSecret: setupIntent.client_secret, setupIntentId: setupIntent.id };
  }),
  confirmNewCardSetup: publicProcedure.input(z.object({ setupIntentId: z.string().trim().min(1).max(255), paymentMethodId: z.string().trim().min(1).max(255) })).mutation(async ({ ctx, input }) => {
    const session = await getCustomerPortalSessionFromRequest(ctx.req);
    if (!session) throw new Error("CUSTOMER_PORTAL_UNAUTHENTICATED");
    const db = await getDb();
    if (!db) throw new Error("Customer portal is unavailable.");
    const accounts = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.id, session.accountId)).limit(1);
    const account = accounts[0];
    if (!account || account.customerPhone !== session.customerPhone) throw new Error("CUSTOMER_PORTAL_UNAUTHENTICATED");
    const [customer] = await db.select().from(stripeCustomers).where(eq(stripeCustomers.phone, account.customerPhone)).limit(1);
    if (!customer) throw new Error("Start secure card entry before confirming it.");
    const stripe = getStripeClient();
    const setupIntent = await stripe.setupIntents.retrieve(input.setupIntentId);
    if (setupIntent.status !== "succeeded" || setupIntent.payment_method !== input.paymentMethodId || setupIntent.customer !== customer.stripeCustomerId || setupIntent.metadata.customerPortalAccountId !== String(account.id)) throw new Error("Stripe did not verify this card for your portal.");
    const paymentMethod = await stripe.paymentMethods.retrieve(input.paymentMethodId);
    if (paymentMethod.type !== "card" || !paymentMethod.card || paymentMethod.customer !== customer.stripeCustomerId) throw new Error("Stripe card does not belong to your portal.");
    await db.update(stripeCustomers).set({ stripePaymentMethodId: paymentMethod.id, cardBrand: paymentMethod.card.brand, cardLast4: paymentMethod.card.last4, cardExpMonth: paymentMethod.card.exp_month, cardExpYear: paymentMethod.card.exp_year, cardSavedAt: Date.now() }).where(eq(stripeCustomers.id, customer.id));
    return { brand: paymentMethod.card.brand, last4: paymentMethod.card.last4 };
  }),
  createRequest: publicProcedure.input(requestSchema).mutation(async ({ ctx, input }) => {
    const session = await getCustomerPortalSessionFromRequest(ctx.req);
    if (!session) throw new Error("CUSTOMER_PORTAL_UNAUTHENTICATED");
    const db = await getDb();
    if (!db) throw new Error("Customer portal is unavailable.");
    const accounts = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.id, session.accountId)).limit(1);
    const account = accounts[0];
    if (!account || account.customerPhone !== session.customerPhone) throw new Error("CUSTOMER_PORTAL_UNAUTHENTICATED");
    const service = getCustomerPortalService(input.serviceId);
    if (!service) throw new Error("Choose a supported service.");
    const validationError = validateCustomerPortalSelections(service, input.selections);
    if (validationError) throw new Error(validationError);
    const estimate = calculateCustomerPortalEstimate(service.id, input.selections);
    const savedCard = await getCustomerPortalSavedCard(db, account.customerPhone);
    if (!savedCard) throw new Error("Choose a saved card or add a new card before sending this request.");
    const now = new Date();
    await db.insert(customerPortalServiceRequests).values({
      publicRequestNumber: createCustomerPortalRequestNumber(), accountId: account.id, serviceId: service.id, serviceName: service.name, status: "requested",
      customerName: account.customerName, customerPhone: account.customerPhone, customerEmail: account.customerEmail,
      customerRequest: input.notes?.trim() || service.fields.map(field => `${field.label}: ${input.selections[field.label]}`).join(" · "),
      scopeSelections: input.selections, address: input.address, requestedLocalDate: input.requestedLocalDate, requestedLocalTime: input.requestedLocalTime,
      estimatedTotalCents: estimate.estimatedCents, estimateRequiresReview: estimate.requiresReview ? 1 : 0, paymentBrand: savedCard.brand, paymentLast4: savedCard.last4, stripePaymentMethodId: savedCard.stripePaymentMethodId, createdAt: now, updatedAt: now,
    });
    return { ok: true };
  }),
});
