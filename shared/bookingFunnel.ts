import { z } from "zod";

export const bookingFunnelStageSchema = z.enum(["lead", "payment_incomplete", "booked"]);
export type BookingFunnelStage = z.infer<typeof bookingFunnelStageSchema>;

export const bookingFunnelSourceSchema = z.enum(["book-page", "widget-popup"]);
export type BookingFunnelSource = z.infer<typeof bookingFunnelSourceSchema>;

export const beginBookingFunnelInputSchema = z.object({
  idempotencyKey: z.string().uuid(),
  source: bookingFunnelSourceSchema,
  customerName: z.string().trim().min(2).max(255),
  customerPhone: z.string().trim().min(10).max(30),
});
export type BeginBookingFunnelInput = z.infer<typeof beginBookingFunnelInputSchema>;

const progressiveFieldsSchema = z.object({
  customerName: z.string().trim().min(2).max(255).optional(),
  customerPhone: z.string().trim().min(10).max(30).optional(),
  customerEmail: z.string().trim().email().max(320).nullable().optional(),
  serviceId: z.string().trim().min(1).max(32).nullable().optional(),
  serviceName: z.string().trim().min(1).max(120).nullable().optional(),
  bedrooms: z.number().int().min(0).max(20).nullable().optional(),
  bathrooms: z.number().int().min(0).max(20).nullable().optional(),
  extras: z.array(z.object({ id: z.string().min(1).max(64), quantity: z.number().int().min(1).max(99) })).max(40).nullable().optional(),
  specialRequestNotes: z.array(z.string().trim().min(1).max(500)).max(20).nullable().optional(),
  address: z.string().trim().min(3).max(500).nullable().optional(),
  requestedLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  requestedLocalTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  requestedTimeZone: z.string().trim().min(1).max(64).nullable().optional(),
  recurrence: z.enum(["one-time", "weekly", "biweekly", "monthly"]).nullable().optional(),
  pricingVersion: z.string().trim().min(1).max(64).nullable().optional(),
  firstCleaningTotalCents: z.number().int().min(0).nullable().optional(),
  futureVisitTotalCents: z.number().int().min(0).nullable().optional(),
  priceSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const updateBookingFunnelInputSchema = z.object({
  publicFunnelNumber: z.string().trim().min(8).max(40),
  mutationToken: z.string().trim().min(32).max(128),
  expectedVersion: z.number().int().min(1),
  patch: progressiveFieldsSchema.refine((value) => Object.keys(value).length > 0, "At least one field is required."),
});
export type UpdateBookingFunnelInput = z.infer<typeof updateBookingFunnelInputSchema>;

export const reserveBookingFunnelInputSchema = z.object({
  publicFunnelNumber: z.string().trim().min(8).max(40),
  mutationToken: z.string().trim().min(32).max(128),
  expectedVersion: z.number().int().min(1),
  patch: progressiveFieldsSchema.refine((value) => Object.keys(value).length > 0, "At least one field is required."),
});
export type ReserveBookingFunnelInput = z.infer<typeof reserveBookingFunnelInputSchema>;

export const bookingFunnelListInputSchema = z.object({
  stage: bookingFunnelStageSchema.optional(),
  query: z.string().trim().max(255).optional(),
  limit: z.number().int().min(1).max(500).default(200),
}).optional();

export const bookingFunnelGetInputSchema = z.object({ id: z.number().int().positive() });

export const bookingFunnelFaqQuestionInputSchema = z.object({
  question: z.string().trim().min(2).max(700),
});

export const bookingFunnelPublicResultSchema = z.object({
  publicFunnelNumber: z.string(),
  mutationToken: z.string(),
  stage: bookingFunnelStageSchema,
  version: z.number().int().positive(),
  created: z.boolean(),
});
export type BookingFunnelPublicResult = z.infer<typeof bookingFunnelPublicResultSchema>;
