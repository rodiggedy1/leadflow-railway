import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { bookingPaymentProfiles, bookings, customerPortalAccounts, customerPortalServiceRequests } from "../drizzle/schema";
import { getDb } from "./db";
import { getCustomerPortalSessionFromRequest } from "./_core/customerPortalAuth";
import { CUSTOMER_PORTAL_SERVICES, getCustomerPortalService, validateCustomerPortalSelections } from "../shared/customerPortalServices";
import { calculateCustomerPortalEstimate } from "../shared/customerPortalPricing";
import { createCustomerPortalRequestNumber } from "./customerPortalService";
import { adminAgentProcedure, publicProcedure, router } from "./_core/trpc";

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
    const [cleanings, requests, paymentProfiles] = await Promise.all([
      db.select().from(bookings).where(eq(bookings.customerPhone, account.customerPhone)).orderBy(desc(bookings.createdAt)).limit(100),
      db.select().from(customerPortalServiceRequests).where(eq(customerPortalServiceRequests.accountId, account.id)).orderBy(desc(customerPortalServiceRequests.createdAt)).limit(100),
      db.select({ paymentStatus: bookingPaymentProfiles.paymentStatus, cardBrand: bookingPaymentProfiles.cardBrand, cardLast4: bookingPaymentProfiles.cardLast4 }).from(bookingPaymentProfiles).innerJoin(bookings, eq(bookingPaymentProfiles.bookingId, bookings.id)).where(eq(bookings.customerPhone, account.customerPhone)).orderBy(desc(bookingPaymentProfiles.updatedAt)).limit(100),
    ]);
    const savedCard = paymentProfiles.find(profile => profile.paymentStatus === "card_on_file" && Boolean(profile.cardLast4));
    return { account: { name: account.customerName, phone: account.customerPhone, email: account.customerEmail }, cleanings, requests, savedCard: savedCard ? { brand: savedCard.cardBrand, last4: savedCard.cardLast4 } : null };
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
    const now = new Date();
    await db.insert(customerPortalServiceRequests).values({
      publicRequestNumber: createCustomerPortalRequestNumber(), accountId: account.id, serviceId: service.id, serviceName: service.name, status: "requested",
      customerName: account.customerName, customerPhone: account.customerPhone, customerEmail: account.customerEmail,
      customerRequest: input.notes?.trim() || service.fields.map(field => `${field.label}: ${input.selections[field.label]}`).join(" · "),
      scopeSelections: input.selections, address: input.address, requestedLocalDate: input.requestedLocalDate, requestedLocalTime: input.requestedLocalTime,
      estimatedTotalCents: estimate.estimatedCents, estimateRequiresReview: estimate.requiresReview ? 1 : 0, createdAt: now, updatedAt: now,
    });
    return { ok: true };
  }),
});
