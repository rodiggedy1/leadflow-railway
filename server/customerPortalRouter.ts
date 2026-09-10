import { z } from "zod";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { bookings, cleanerJobs, cleanerPortalJobProgress, cleanerProfiles, customerPortalAccounts, customerPortalServiceRequests, leadflowBookingMessages, leadflowJobs, opsChatMessages, stripeCustomers } from "../drizzle/schema";
import { getDb, getOrCreateCleanerMagicLink } from "./db";
import { getCustomerPortalSessionFromRequest } from "./_core/customerPortalAuth";
import { CUSTOMER_PORTAL_SERVICES, getCustomerPortalService, validateCustomerPortalSelections } from "../shared/customerPortalServices";
import { calculateCustomerPortalEstimate } from "../shared/customerPortalPricing";
import { createCustomerPortalRequestNumber, ensureCustomerPortalAccountForLeadflowPhone, getOrCreateCustomerPortalMagicLink } from "./customerPortalService";
import { getCustomerPortalSavedCard } from "./customerPortalPaymentService";
import { getStripeClient } from "./stripeClient";
import { adminAgentProcedure, publicProcedure, router } from "./_core/trpc";
import { getSessionCookieOptions } from "./_core/cookies";
import { signCustomerPortalSession } from "./_core/customerPortalAuth";
import { CUSTOMER_PORTAL_COOKIE_NAME, ONE_YEAR_MS } from "../shared/const";
import { requestCustomerPortalLoginCode, verifyCustomerPortalLoginCode } from "./customerPortalLoginService";
import { sendSms } from "./openphone";
import { extractUSDigits } from "./utils/phone";
import { getCustomerPortalBusinessDate, isCustomerPortalLiveJob } from "../shared/customerPortalLiveStatus";
import { broadcastOpsUpdate } from "./sseBroadcast";

const CS_OFFICE_SMS_NUMBER = "+12028885362";

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
    await ensureCustomerPortalAccountForLeadflowPhone(db, input.phone);
    const result = await requestCustomerPortalLoginCode(db, {
      phone: input.phone,
    }, {
      sendCode: (phone, code) => sendSms({ to: phone, content: `Your Maids in Black sign-in code is ${code}. It expires in 10 minutes.` }),
    });
    return { ok: result.sent };
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
  cancelStaffRequest: adminAgentProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("Customer portal is unavailable.");
    const rows = await db.select({ id: customerPortalServiceRequests.id }).from(customerPortalServiceRequests).where(eq(customerPortalServiceRequests.id, input.id)).limit(1);
    if (!rows[0]) throw new Error("Service request not found.");
    await db.update(customerPortalServiceRequests).set({ status: "cancelled", updatedAt: new Date() }).where(eq(customerPortalServiceRequests.id, input.id));
    return { id: input.id, status: "cancelled" as const };
  }),
  staffMagicLink: adminAgentProcedure.input(z.object({
    customerName: z.string().trim().min(1).max(250),
    customerPhone: z.string().trim().min(1).max(40),
    customerEmail: z.string().trim().max(320).nullable().optional(),
  })).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("Customer portal is unavailable.");
    const url = await getOrCreateCustomerPortalMagicLink(db, input);
    return { url };
  }),
  messages: publicProcedure.query(async ({ ctx }) => {
    const session = await getCustomerPortalSessionFromRequest(ctx.req);
    if (!session) return [];
    const db = await getDb();
    if (!db) throw new Error("Customer portal is unavailable.");
    const accounts = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.id, session.accountId)).limit(1);
    const account = accounts[0];
    if (!account || account.customerPhone !== session.customerPhone) return [];
    const phoneDigits = extractUSDigits(account.customerPhone);
    if (!phoneDigits) return [];
    return db.select({
      id: leadflowBookingMessages.id,
      leadflowJobId: leadflowBookingMessages.leadflowJobId,
      senderRole: leadflowBookingMessages.senderRole,
      body: leadflowBookingMessages.body,
      notificationStatus: leadflowBookingMessages.notificationStatus,
      createdAt: leadflowBookingMessages.createdAt,
      jobDate: leadflowJobs.jobDate,
      serviceName: leadflowJobs.serviceName,
      jobAddress: leadflowJobs.jobAddress,
    }).from(leadflowBookingMessages).innerJoin(leadflowJobs, eq(leadflowBookingMessages.leadflowJobId, leadflowJobs.id)).where(and(
      ne(leadflowJobs.bookingStatus, "missing_from_launch27"),
      sql`RIGHT(REGEXP_REPLACE(${leadflowJobs.customerPhone}, '[^0-9]', ''), 10) = ${phoneDigits}`,
    )).orderBy(asc(leadflowJobs.jobDate), asc(leadflowBookingMessages.createdAt), asc(leadflowBookingMessages.id));
  }),
  replyToMessageThread: publicProcedure.input(z.object({
    leadflowJobId: z.number().int().positive(),
    body: z.string().trim().min(1).max(1_000),
  })).mutation(async ({ ctx, input }) => {
    const session = await getCustomerPortalSessionFromRequest(ctx.req);
    if (!session) throw new Error("CUSTOMER_PORTAL_UNAUTHENTICATED");
    const db = await getDb();
    if (!db) throw new Error("Customer portal is unavailable.");
    const accounts = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.id, session.accountId)).limit(1);
    const account = accounts[0];
    if (!account || account.customerPhone !== session.customerPhone) throw new Error("CUSTOMER_PORTAL_UNAUTHENTICATED");
    const phoneDigits = extractUSDigits(account.customerPhone);
    if (!phoneDigits) throw new Error("CUSTOMER_PORTAL_UNAUTHENTICATED");
    const jobs = await db.select({ id: leadflowJobs.id, customerName: leadflowJobs.customerName, teamId: leadflowJobs.teamId, jobDate: leadflowJobs.jobDate, serviceName: leadflowJobs.serviceName, jobAddress: leadflowJobs.jobAddress }).from(leadflowJobs).where(and(
      eq(leadflowJobs.id, input.leadflowJobId),
      ne(leadflowJobs.bookingStatus, "cancelled"), ne(leadflowJobs.bookingStatus, "rescheduled"), ne(leadflowJobs.bookingStatus, "missing_from_launch27"),
      sql`RIGHT(REGEXP_REPLACE(${leadflowJobs.customerPhone}, '[^0-9]', ''), 10) = ${phoneDigits}`,
    )).limit(1);
    const job = jobs[0];
    if (!job) throw new Error("BOOKING_NOT_FOUND");
    const now = new Date();
    const cleanerRows = job.teamId === null ? [] : await db.select({ id: cleanerProfiles.id, name: cleanerProfiles.name, phone: cleanerProfiles.phone }).from(cleanerProfiles).where(and(eq(cleanerProfiles.launch27TeamId, job.teamId), eq(cleanerProfiles.isActive, 1))).limit(1);
    const cleaner = cleanerRows[0] ?? null;
    const result = await db.insert(leadflowBookingMessages).values({ leadflowJobId: job.id, senderRole: "customer", body: input.body, customerPortalAccountId: account.id, cleanerProfileId: cleaner?.id ?? null, notificationStatus: "pending", createdAt: now });
    const messageId = Number(result[0].insertId);
    const officeMessage = [
      "Customer portal message",
      `${job.customerName} · ${account.customerPhone}`,
      `Booking: ${job.serviceName || "Home cleaning"} · ${job.jobDate}`,
      job.jobAddress ? `Address: ${job.jobAddress}` : null,
      `Message: ${input.body}`,
    ].filter((line): line is string => Boolean(line)).join("\n");
    try {
      await db.insert(opsChatMessages).values({
        channel: "command",
        cleanerJobId: null,
        authorName: "Customer Portal",
        authorRole: "system",
        body: officeMessage,
        quickAction: "customer_portal_message",
        metadata: JSON.stringify({ leadflowJobId: job.id, customerName: job.customerName, customerPhone: account.customerPhone, jobDate: job.jobDate }),
      });
      broadcastOpsUpdate("new_message", { channel: "command" });
    } catch (error) {
      console.error("[CustomerPortalMessages] Command Chat office notice failed:", error);
    }
    try {
      const officeSms = await sendSms({ to: CS_OFFICE_SMS_NUMBER, content: officeMessage });
      if (!officeSms.success) console.error("[CustomerPortalMessages] Customer Service office SMS failed:", officeSms.error);
    } catch (error) {
      console.error("[CustomerPortalMessages] Customer Service office SMS failed:", error);
    }
    let cleanerPortalLink: string | null = null;
    let notificationError: string | null = null;
    if (!cleaner?.phone) {
      notificationError = "The assigned cleaner has no cellphone number.";
    } else {
      try {
        const cleanerMagicLink = await getOrCreateCleanerMagicLink(cleaner.id);
        cleanerPortalLink = `${cleanerMagicLink}&job=${encodeURIComponent(`leadflow:${job.id}`)}`;
      } catch (error) {
        console.error("[CustomerPortalMessages] Cleaner portal link generation failed; sending the response without a link.", error);
      }
      const content = cleanerPortalLink
        ? `${job.customerName} sent you a response: ${input.body}\n\nReply in your portal: ${cleanerPortalLink}`
        : `${job.customerName} sent you a response: ${input.body}`;
      const sms = await sendSms({ to: cleaner.phone, content });
      if (sms.success) {
        await db.update(leadflowBookingMessages).set({ notificationStatus: "sent", notificationMessageId: sms.messageId ?? null, notificationError: null, notificationSentAt: new Date() }).where(eq(leadflowBookingMessages.id, messageId));
        return { id: messageId, leadflowJobId: job.id, senderRole: "customer" as const, body: input.body, createdAt: now, notificationSent: true };
      }
      notificationError = sms.error ?? "The cleaner notification could not be sent.";
    }
    await db.update(leadflowBookingMessages).set({ notificationStatus: "failed", notificationError }).where(eq(leadflowBookingMessages.id, messageId));
    return { id: messageId, leadflowJobId: job.id, senderRole: "customer" as const, body: input.body, createdAt: now, notificationSent: false, notificationError };
  }),
  me: publicProcedure.query(async ({ ctx }) => {
    const session = await getCustomerPortalSessionFromRequest(ctx.req);
    if (!session) return { account: null, cleanings: [], leadflowJobs: [], requests: [] };
    const db = await getDb();
    if (!db) throw new Error("Customer portal is unavailable.");
    const accounts = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.id, session.accountId)).limit(1);
    const account = accounts[0];
    if (!account || account.customerPhone !== session.customerPhone) return { account: null, cleanings: [], leadflowJobs: [], requests: [] };
    const phoneDigits = extractUSDigits(account.customerPhone);
    const [cleanings, portalLeadflowJobs, requests, savedCard] = await Promise.all([
      db.select().from(bookings).where(eq(bookings.customerPhone, account.customerPhone)).orderBy(desc(bookings.createdAt)).limit(100),
      phoneDigits ? db.select({
        id: leadflowJobs.id,
        launch27BookingId: leadflowJobs.launch27BookingId,
        jobDate: leadflowJobs.jobDate,
        serviceDateTime: leadflowJobs.serviceDateTime,
        serviceName: leadflowJobs.serviceName,
        bedrooms: leadflowJobs.bedrooms,
        bathrooms: leadflowJobs.bathrooms,
        extras: leadflowJobs.extras,
        frequency: leadflowJobs.frequency,
        bookingStatus: leadflowJobs.bookingStatus,
        teamName: leadflowJobs.teamName,
        jobAddress: leadflowJobs.jobAddress,
        customerNotes: leadflowJobs.customerNotes,
        jobTotalCents: leadflowJobs.jobTotalCents,
        hasStripeCard: leadflowJobs.hasStripeCard,
      }).from(leadflowJobs).where(and(sql`RIGHT(REGEXP_REPLACE(${leadflowJobs.customerPhone}, '[^0-9]', ''), 10) = ${phoneDigits}`, ne(leadflowJobs.bookingStatus, "missing_from_launch27"))).orderBy(asc(leadflowJobs.jobDate), asc(leadflowJobs.serviceDateTime), asc(leadflowJobs.id)).limit(100) : Promise.resolve([]),
      db.select().from(customerPortalServiceRequests).where(eq(customerPortalServiceRequests.accountId, account.id)).orderBy(desc(customerPortalServiceRequests.createdAt)).limit(100),
      getCustomerPortalSavedCard(db, account.customerPhone),
    ]);
    return { account: { name: account.customerName, phone: account.customerPhone, email: account.customerEmail }, cleanings, leadflowJobs: portalLeadflowJobs, requests, savedCard: savedCard ? { brand: savedCard.brand, last4: savedCard.last4 } : null };
  }),
  todayJobStatus: publicProcedure.query(async ({ ctx }) => {
    const session = await getCustomerPortalSessionFromRequest(ctx.req);
    if (!session) return { job: null };
    const db = await getDb();
    if (!db) throw new Error("Customer portal is unavailable.");
    const accounts = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.id, session.accountId)).limit(1);
    const account = accounts[0];
    if (!account || account.customerPhone !== session.customerPhone) return { job: null };
    const phoneDigits = extractUSDigits(account.customerPhone);
    if (!phoneDigits) return { job: null };
    ctx.res.set("Cache-Control", "no-store");
    const rows = await db.select({
      bookingId: cleanerJobs.bookingId,
      jobDate: cleanerJobs.jobDate,
      serviceDateTime: cleanerJobs.serviceDateTime,
      serviceType: cleanerJobs.serviceType,
      teamName: cleanerJobs.teamName,
      jobStatus: cleanerJobs.jobStatus,
      bookingStatus: cleanerJobs.bookingStatus,
      delayMinutes: cleanerJobs.delayMinutes,
      etaTimestamp: cleanerJobs.etaTimestamp,
      etaTimeStr: cleanerJobs.etaTimeStr,
    }).from(cleanerJobs).where(and(
      eq(cleanerJobs.jobDate, getCustomerPortalBusinessDate()),
      sql`REGEXP_REPLACE(${cleanerJobs.customerPhone}, '[^0-9]', '') = ${phoneDigits}`,
    )).orderBy(asc(cleanerJobs.serviceDateTime), desc(cleanerJobs.updatedAt)).limit(20);
    return { job: rows.find(isCustomerPortalLiveJob) ?? null };
  }),
  todayIsolatedProgress: publicProcedure.input(z.object({ leadflowJobId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const session = await getCustomerPortalSessionFromRequest(ctx.req);
    if (!session) return { progress: null };
    const db = await getDb();
    if (!db) throw new Error("Customer portal is unavailable.");
    const accounts = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.id, session.accountId)).limit(1);
    const account = accounts[0];
    if (!account || account.customerPhone !== session.customerPhone) return { progress: null };
    const phoneDigits = extractUSDigits(account.customerPhone);
    if (!phoneDigits) return { progress: null };
    const jobRows = await db.select({ id: leadflowJobs.id }).from(leadflowJobs).where(and(
      eq(leadflowJobs.id, input.leadflowJobId),
      eq(leadflowJobs.jobDate, getCustomerPortalBusinessDate()),
      ne(leadflowJobs.bookingStatus, "missing_from_launch27"),
      sql`RIGHT(REGEXP_REPLACE(${leadflowJobs.customerPhone}, '[^0-9]', ''), 10) = ${phoneDigits}`,
    )).limit(1);
    const job = jobRows[0];
    if (!job) return { progress: null };
    try {
      const rows = await db.select({ jobStatus: cleanerPortalJobProgress.jobStatus, etaTimestamp: cleanerPortalJobProgress.etaTimestamp, etaTimeStr: cleanerPortalJobProgress.etaTimeStr }).from(cleanerPortalJobProgress).where(eq(cleanerPortalJobProgress.leadflowJobId, job.id)).limit(1);
      return { progress: rows[0] ?? null };
    } catch (error) {
      console.error("[CustomerPortal] isolated same-day progress is unavailable", error);
      return { progress: null };
    }
  }),
  updateLeadflowJobCustomerNote: publicProcedure.input(z.object({
    id: z.number().int().positive(),
    note: z.string().trim().max(2_000),
  })).mutation(async ({ ctx, input }) => {
    const session = await getCustomerPortalSessionFromRequest(ctx.req);
    if (!session) throw new Error("CUSTOMER_PORTAL_UNAUTHENTICATED");
    const db = await getDb();
    if (!db) throw new Error("Customer portal is unavailable.");
    const accounts = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.id, session.accountId)).limit(1);
    const account = accounts[0];
    if (!account || account.customerPhone !== session.customerPhone) throw new Error("CUSTOMER_PORTAL_UNAUTHENTICATED");
    const phoneDigits = extractUSDigits(account.customerPhone);
    if (!phoneDigits) throw new Error("CUSTOMER_PORTAL_UNAUTHENTICATED");
    const rows = await db.select({ id: leadflowJobs.id }).from(leadflowJobs).where(and(
      eq(leadflowJobs.id, input.id),
      ne(leadflowJobs.bookingStatus, "missing_from_launch27"),
      sql`RIGHT(REGEXP_REPLACE(${leadflowJobs.customerPhone}, '[^0-9]', ''), 10) = ${phoneDigits}`,
    )).limit(1);
    if (!rows[0]) throw new Error("BOOKING_NOT_FOUND");
    await db.update(leadflowJobs).set({ customerNotes: input.note || null }).where(eq(leadflowJobs.id, input.id));
    return { id: input.id, customerNotes: input.note || null };
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
    const isLawnCareBooking = service.id === "lawn-yard-care";
    const validationError = validateCustomerPortalSelections(service, input.selections);
    if (validationError) throw new Error(validationError);
    const estimate = calculateCustomerPortalEstimate(service.id, input.selections);
    const savedCard = await getCustomerPortalSavedCard(db, account.customerPhone);
    if (!savedCard) throw new Error("Choose a saved card or add a new card before sending this request.");
    const now = new Date();
    const publicRequestNumber = createCustomerPortalRequestNumber();
    const customerRequest = input.notes?.trim() || service.fields.map(field => `${field.label}: ${input.selections[field.label]}`).join(" · ");
    const amount = `$${(estimate.estimatedCents / 100).toFixed(0)}`;
    await db.insert(customerPortalServiceRequests).values({
      publicRequestNumber, accountId: account.id, serviceId: service.id, serviceName: service.name, status: "requested",
      customerName: account.customerName, customerPhone: account.customerPhone, customerEmail: account.customerEmail,
      customerRequest,
      scopeSelections: input.selections, address: input.address, requestedLocalDate: input.requestedLocalDate, requestedLocalTime: input.requestedLocalTime,
      estimatedTotalCents: estimate.estimatedCents, estimateRequiresReview: estimate.requiresReview ? 1 : 0, paymentBrand: savedCard.brand, paymentLast4: savedCard.last4, stripePaymentMethodId: savedCard.stripePaymentMethodId, createdAt: now, updatedAt: now,
    });
    const officeMessage = [
      isLawnCareBooking ? "New lawn & yard care booking" : "Customer portal service request",
      `${account.customerName} · ${account.customerPhone}`,
      `Service: ${service.name}`,
      `Preferred appointment: ${input.requestedLocalDate} · ${input.requestedLocalTime}`,
      `Address: ${input.address}`,
      `Request: ${customerRequest}`,
      `Portal request: ${publicRequestNumber}`,
    ].join("\n");
    try {
      await db.insert(opsChatMessages).values({
        channel: "command",
        cleanerJobId: null,
        authorName: isLawnCareBooking ? "🎉 New Booking" : "Customer Portal",
        authorRole: "system",
        body: isLawnCareBooking ? `🎉 New booking! ${account.customerName} — ${amount} · ${service.name} · ${input.requestedLocalDate} ${input.requestedLocalTime}` : officeMessage,
        quickAction: isLawnCareBooking ? "announce_booking" : "customer_portal_service_request",
        metadata: JSON.stringify(isLawnCareBooking ? { personName: account.customerName, amount, note: `${service.name} · ${input.requestedLocalDate} ${input.requestedLocalTime}`, publicRequestNumber, serviceId: service.id } : { publicRequestNumber, serviceId: service.id, customerName: account.customerName, customerPhone: account.customerPhone, requestedLocalDate: input.requestedLocalDate }),
      });
      broadcastOpsUpdate("new_message", { channel: "command" });
    } catch (error) {
      console.error("[CustomerPortalRequests] Command Chat office notice failed:", error);
    }
    if (isLawnCareBooking) {
      try {
        const firstName = account.customerName.trim().split(/\s+/)[0] || "there";
        const customerSms = await sendSms({ to: account.customerPhone, content: `Hi ${firstName} — your ${service.name} is booked with Maids in Black!\n\nPreferred appointment: ${input.requestedLocalDate} · ${input.requestedLocalTime}\nEstimated total: ${amount}\n\nYour card is securely on file and will not be charged today. We’ll confirm your appointment details shortly.\n\n— Maids in Black` });
        if (!customerSms.success) console.error("[CustomerPortalRequests] Lawn-care customer SMS failed:", customerSms.error);
      } catch (error) {
        console.error("[CustomerPortalRequests] Lawn-care customer SMS failed:", error);
      }
    }
    try {
      const officeSms = await sendSms({ to: CS_OFFICE_SMS_NUMBER, content: officeMessage });
      if (!officeSms.success) console.error("[CustomerPortalRequests] Customer Service office SMS failed:", officeSms.error);
    } catch (error) {
      console.error("[CustomerPortalRequests] Customer Service office SMS failed:", error);
    }
    return { ok: true, publicRequestNumber };
  }),
});
