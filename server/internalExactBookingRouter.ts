import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { bookingRecurringFrequencySchema, bookingServiceIdSchema } from "../shared/booking";
import { bookingArrivalPreferenceSchema } from "../shared/bookingArrival";
import { PUBLIC_BOOKING_PRICING_VERSION } from "../shared/publicBookingPricing";
import { bookingsAgentProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { NativeBookingInputError } from "./bookingsService";
import { abandonInternalExactCashApp, confirmInternalExactSetup, finalizeInternalExact, prepareInternalExact, prepareInternalExactCashApp, settleInternalExactCashApp, startInternalExactSetup } from "./internalExactBookingService";

const extra = (idMax: number) => z.object({ id: z.string().trim().min(1).max(idMax), quantity: z.number().int().min(1).max(50) }).strict();
export const internalExactPrepareInputSchema = z.object({
  idempotencyKey: z.string().uuid(),
  paymentMethod: z.enum(["card", "cashapp", "invoice"]),
  withoutPayment: z.boolean(),
  companyNotes: z.string().trim().max(4_000).nullable(),
  booking: z.object({
    surface: z.literal("popup"),
    customer: z.object({ fullName: z.string().trim().min(2).max(255), phone: z.string().trim().min(7).max(40), email: z.string().trim().email().max(320) }).strict(),
    service: z.object({ serviceId: bookingServiceIdSchema, bedrooms: z.number().int().min(0).max(7), bathrooms: z.number().int().min(1).max(20), extras: z.array(extra(64)).max(20), specialRequestNotes: z.array(z.string().trim().min(1).max(1_000)).max(20) }).strict(),
    address: z.string().trim().min(5).max(500),
    requestedSchedule: z.object({ localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).strict(),
    recurrence: bookingRecurringFrequencySchema,
    acceptedPricing: z.object({ version: z.literal(PUBLIC_BOOKING_PRICING_VERSION), totalCents: z.number().int().min(0).max(10_000_000) }).strict(),
    pricing: z.object({
      pricingMode: z.enum(["home", "hourly"]), serviceId: bookingServiceIdSchema,
      bedrooms: z.number().int().min(0).max(7), bathrooms: z.number().int().min(1).max(5),
      homeType: z.enum(["House", "Apartment", "Townhome", "Condo"]), condition: z.number().int().min(1).max(10),
      maidCount: z.number().int().min(1).max(4), hourCount: z.number().int().min(1).max(8),
      customPriceCents: z.number().int().min(1).max(1_000_000).optional(), extras: z.array(extra(80)).max(50),
      recurrence: bookingRecurringFrequencySchema, arrivalPreference: bookingArrivalPreferenceSchema,
    }).strict(),
  }).strict(),
}).strict().refine(input => input.withoutPayment === (input.paymentMethod === "invoice"), { message: "Book without payment requires the unpaid invoice option.", path: ["paymentMethod"] });
const bookingInput = z.object({ bookingId: z.number().int().positive() }).strict();
const cashInput = bookingInput.extend({ paymentIntentId: z.string().trim().min(1).max(255) }).strict();

async function dbRequired() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." });
  return db;
}
async function safeInput<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof NativeBookingInputError || error instanceof RangeError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    throw error;
  }
}
export const internalExactBookingRouter = router({
  prepare: bookingsAgentProcedure.input(internalExactPrepareInputSchema).mutation(({ input, ctx }) => safeInput(async () => prepareInternalExact(await dbRequired(), input, ctx.agent))),
  startSetup: bookingsAgentProcedure.input(bookingInput).mutation(async ({ input, ctx }) => startInternalExactSetup(await dbRequired(), input.bookingId, ctx.agent)),
  confirmSetup: bookingsAgentProcedure.input(bookingInput.extend({ paymentMethodId: z.string().trim().min(1).max(255), consentAccepted: z.literal(true), deferConfirmation: z.literal(true), wallet: z.enum(["apple_pay", "google_pay"]).optional() }).strict()).mutation(async ({ input, ctx }) => confirmInternalExactSetup(await dbRequired(), input, ctx.agent)),
  finalize: bookingsAgentProcedure.input(bookingInput).mutation(async ({ input, ctx }) => finalizeInternalExact(await dbRequired(), input.bookingId, ctx.agent)),
  prepareCashApp: bookingsAgentProcedure.input(bookingInput).mutation(async ({ input, ctx }) => prepareInternalExactCashApp(await dbRequired(), input.bookingId, ctx.agent)),
  settleCashApp: bookingsAgentProcedure.input(cashInput).mutation(async ({ input, ctx }) => settleInternalExactCashApp(await dbRequired(), input, ctx.agent)),
  abandonCashApp: bookingsAgentProcedure.input(cashInput).mutation(async ({ input, ctx }) => abandonInternalExactCashApp(await dbRequired(), input, ctx.agent)),
});
