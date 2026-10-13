import { describe, expect, it } from "vitest";
import { createCustomerBookingLinkInputSchema } from "../shared/bookingFunnel";

const pricing = {
  pricingMode: "home" as const,
  serviceId: "standard" as const,
  bedrooms: 2,
  bathrooms: 2,
  homeType: "House" as const,
  condition: 5,
  maidCount: 1,
  hourCount: 1,
  extras: [],
  recurrence: "one-time" as const,
};

const baseInput = {
  customerName: "Sarah Johnson",
  customerPhone: "302-981-6191",
  requestedLocalDate: "2026-10-20",
  requestedLocalTime: "10:30",
  pricing,
};

describe("create customer booking link input", () => {
  it("accepts a quote without email or address", () => {
    const result = createCustomerBookingLinkInputSchema.safeParse(baseInput);
    expect(result.success).toBe(true);
  });

  it("still validates email and address when supplied", () => {
    expect(createCustomerBookingLinkInputSchema.safeParse({
      ...baseInput,
      customerEmail: "not-an-email",
      address: "123",
    }).success).toBe(false);
  });
});
