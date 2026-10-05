import { z } from "zod";

export const bookingFunnelStageSchema = z.enum(["lead", "payment_incomplete", "booked"]);
export type BookingFunnelStage = z.infer<typeof bookingFunnelStageSchema>;

export const bookingFunnelSourceSchema = z.enum(["book-page", "widget-popup"]);
export type BookingFunnelSource = z.infer<typeof bookingFunnelSourceSchema>;

export const customerBookingLinkPricingSchema = z.object({
  pricingMode: z.enum(["home", "hourly"]),
  serviceId: z.enum(["standard", "deep", "moveout"]),
  bedrooms: z.number().int().min(0).max(7),
  bathrooms: z.number().int().min(1).max(5),
  homeType: z.enum(["House", "Apartment", "Townhome", "Condo"]),
  condition: z.number().int().min(1).max(10),
  maidCount: z.number().int().min(1).max(4),
  hourCount: z.number().int().min(1).max(8),
  extras: z.array(z.object({ id: z.string().trim().min(1).max(80), quantity: z.number().int().min(1).max(50) })).max(50),
  recurrence: z.enum(["one-time", "weekly", "biweekly", "monthly"]),
  customPriceCents: z.number().int().min(1).max(1_000_000).optional(),
});
export type CustomerBookingLinkPricing = z.infer<typeof customerBookingLinkPricingSchema>;

export const createCustomerBookingLinkInputSchema = z.object({
  customerName: z.string().trim().min(2).max(255),
  customerPhone: z.string().trim().min(7).max(40),
  customerEmail: z.string().trim().email().max(320),
  address: z.string().trim().min(5).max(500),
  requestedLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requestedLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  pricing: customerBookingLinkPricingSchema,
  notes: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
});
export type CreateCustomerBookingLinkInput = z.infer<typeof createCustomerBookingLinkInputSchema>;

export const customerBookingLinkTokenInputSchema = z.object({ token: z.string().trim().min(8).max(40) });
export const submitCustomerBookingLinkInputSchema = z.object({
  token: z.string().trim().min(8).max(40),
  idempotencyKey: z.string().uuid(),
  customerName: z.string().trim().min(2).max(255),
  customerPhone: z.string().trim().min(7).max(40),
  customerEmail: z.string().trim().email().max(320),
  address: z.string().trim().min(5).max(500),
  requestedLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requestedLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  recurrence: z.enum(["one-time", "weekly", "biweekly", "monthly"]),
  pricing: customerBookingLinkPricingSchema,
  additionalServices: z.array(z.object({ id: z.string().trim().min(1).max(80), quantity: z.number().int().min(1).max(50) })).max(20).default([]),
});
export const updateCustomerBookingLinkInputSchema = z.object({
  token: z.string().trim().min(8).max(40),
  mutationToken: z.string().trim().min(32).max(128),
  recurrence: z.enum(["one-time", "weekly", "biweekly", "monthly"]),
});

export const beginBookingFunnelInputSchema = z.object({
  idempotencyKey: z.string().uuid(),
  source: bookingFunnelSourceSchema,
  portalLeadCard: z.literal(true).optional(),
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
