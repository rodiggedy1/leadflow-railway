import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { bookingFunnelRecords, bookings, customerPortalAccounts, customerPortalServiceRequests } from "../drizzle/schema";
import { CUSTOMER_PORTAL_COOKIE_NAME } from "../shared/const";
import { CUSTOMER_PORTAL_SERVICES, calculateCustomerPortalEstimate, getCustomerPortalService, validateCustomerPortalSelections } from "../shared/customerPortalServices";
import { getSessionCookieOptions } from "./_core/cookies";
import { getCustomerPortalSessionFromRequest, signCustomerPortalSession } from "./_core/customerPortalAuth";
import { adminAgentProcedure, publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { broadcastOpsUpdate } from "./sseBroadcast";
import { createCustomerPortalHandoff, createCustomerPortalRequestNumber, ensureCustomerPortalAccount, redeemCustomerPortalHandoff } from "./customerPortalService";
import { verifyBookingFunnelMutationToken } from "./bookingFunnelService";
import { ENV } from "./_core/env";

const accessCodeSchema = z.object({ code: z.string().trim().min(32).max(128) });
const requestInputSchema = z.object({
  serviceId: z.string().trim().min(1).max(64),
  selections: z.record(z.string(), z.string().trim().max(1_000)),
  address: z.string().trim().min(5).max(500),
  requestedLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requestedLocalTime: z.string().trim().min(2).max(80),
  notes: z.string().trim().max(2_000).optional(),
});

function mapPortalRequest(row: typeof customerPortalServiceRequests.$inferSelect) {
  return {
    id: row.id,
    publicRequestNumber: row.publicRequestNumber,
    serviceId: row.serviceId,
    serviceName: row.serviceName,
    status: row.status,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    customerEmail: row.customerEmail,
    customerRequest: row.customerRequest,
    scopeSelections: row.scopeSelections as Record<string, string>,
    address: row.address,
    requestedLocalDate: row.requestedLocalDate,
    requestedLocalTime: row.requestedLocalTime,
    estimatedTotalCents: row.estimatedTotalCents,
    estimateRequiresReview: Boolean(row.estimateRequiresReview),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function requireCustomerPortalSession(req: Parameters<typeof getCustomerPortalSessionFromRequest>[0]) {
  const session = await getCustomerPortalSessionFromRequest(req);
  if (!session) throw new Error("CUSTOMER_PORTAL_UNAUTHENTICATED");
  return session;
}

export const customerPortalRouter = router({
  services: publicProcedure.query(() => CUSTOMER_PORTAL_SERVICES),

  ensureFromFunnel: publicProcedure.input(z.object({ publicFunnelNumber: z.string().trim().min(1).max(40), mutationToken: z.string().trim().min(1).max(512) })).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("Customer portal is unavailable.");
    const records = await db.select().from(bookingFunnelRecords).where(eq(bookingFunnelRecords.publicFunnelNumber, input.publicFunnelNumber)).limit(1);
    const record = records[0];
    if (!record || !verifyBookingFunnelMutationToken(ENV.cookieSecret, input.mutationToken, record.publicFunnelNumber, record.idempotencyKey)) throw new Error("Booking record is unavailable.");
    const account = await ensureCustomerPortalAccount(db, { customerName: record.customerName, customerPhone: record.customerPhone, customerEmail: record.customerEmail });
    return { accountId: account.id };
  }),

  redeemHandoff: publicProcedure.input(accessCodeSchema).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("Customer portal is unavailable.");
    const account = await redeemCustomerPortalHandoff(db, input.code);
    if (!account) throw new Error("This portal link has expired. Please return to your booking confirmation.");
    const token = await signCustomerPortalSession({ accountId: account.id, customerName: account.customerName, customerPhone: account.customerPhone });
    ctx.res.cookie(CUSTOMER_PORTAL_COOKIE_NAME, token, { ...getSessionCookieOptions(ctx.req), maxAge: 365 * 24 * 60 * 60 * 1_000 });
    return { customerName: account.customerName };
  }),

  me: publicProcedure.query(async ({ ctx }) => {
    const session = await getCustomerPortalSessionFromRequest(ctx.req);
    if (!session) return { account: null, cleanings: [], requests: [] };
    const db = await getDb();
    if (!db) throw new Error("Customer portal is unavailable.");
    const accounts = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.id, session.accountId)).limit(1);
    const account = accounts[0];
    if (!account || account.customerPhone !== session.customerPhone) return { account: null, cleanings: [], requests: [] };
    const [cleanings, requests] = await Promise.all([
      db.select().from(bookings).where(eq(bookings.customerPhone, account.customerPhone)).orderBy(desc(bookings.createdAt)).limit(100),
      db.select().from(customerPortalServiceRequests).where(eq(customerPortalServiceRequests.accountId, account.id)).orderBy(desc(customerPortalServiceRequests.createdAt)).limit(100),
    ]);
    return {
      account: { name: account.customerName, phone: account.customerPhone, email: account.customerEmail },
      cleanings: cleanings.map((booking) => ({ id: booking.id, publicBookingNumber: booking.publicBookingNumber, serviceName: booking.serviceName, status: booking.status, paymentStatus: booking.paymentStatus, requestedLocalDate: booking.requestedLocalDate, requestedLocalTime: booking.requestedLocalTime, address: booking.address, firstCleaningTotalCents: booking.firstCleaningTotalCents, recurrence: booking.recurrence })),
      requests: requests.map(mapPortalRequest),
    };
  }),

  createRequest: publicProcedure.input(requestInputSchema).mutation(async ({ ctx, input }) => {
    const session = await requireCustomerPortalSession(ctx.req);
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
    const details = service.fields.map((field) => `${field.label}: ${input.selections[field.label]}`).join(" · ");
    const now = new Date();
    const result = await db.insert(customerPortalServiceRequests).values({
      publicRequestNumber: createCustomerPortalRequestNumber(),
      accountId: account.id,
      serviceId: service.id,
      serviceName: service.name,
      status: "requested",
      customerName: account.customerName,
      customerPhone: account.customerPhone,
      customerEmail: account.customerEmail,
      customerRequest: input.notes ? `${details}. Notes: ${input.notes}` : details,
      scopeSelections: input.selections,
      address: input.address,
      requestedLocalDate: input.requestedLocalDate,
      requestedLocalTime: input.requestedLocalTime,
      estimatedTotalCents: estimate.estimatedTotalCents,
      estimateRequiresReview: estimate.requiresReview ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
    const id = Number((result as { insertId?: number }).insertId ?? (result as Array<{ insertId?: number }>)[0]?.insertId);
    const rows = await db.select().from(customerPortalServiceRequests).where(eq(customerPortalServiceRequests.id, id)).limit(1);
    if (!rows[0]) throw new Error("Service request could not be saved.");
    broadcastOpsUpdate("booking_funnel_update");
    return mapPortalRequest(rows[0]);
  }),

  adminRequests: adminAgentProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), query: z.string().trim().max(255).optional(), limit: z.number().int().min(1).max(500).default(200) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Customer portal is unavailable.");
      const rows = input?.date
        ? await db.select().from(customerPortalServiceRequests).where(eq(customerPortalServiceRequests.requestedLocalDate, input.date)).orderBy(desc(customerPortalServiceRequests.createdAt)).limit(input.limit)
        : await db.select().from(customerPortalServiceRequests).orderBy(desc(customerPortalServiceRequests.createdAt)).limit(input?.limit ?? 200);
      const query = input?.query?.toLowerCase();
      return rows.filter((row) => !query || `${row.publicRequestNumber} ${row.customerName} ${row.customerPhone} ${row.serviceName} ${row.address}`.toLowerCase().includes(query)).map(mapPortalRequest);
    }),

});

export async function createPortalHandoffForBookingCustomer(input: { customerName: string; customerPhone: string; customerEmail?: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("Customer portal is unavailable.");
  const account = await ensureCustomerPortalAccount(db, input);
  return createCustomerPortalHandoff(db, account);
}
