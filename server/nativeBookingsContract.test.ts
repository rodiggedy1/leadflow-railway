import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const router = readFileSync(new URL("./bookingsRouter.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("./bookingsService.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../drizzle/0094_native_bookings.sql", import.meta.url), "utf8");
const widget = readFileSync(new URL("../client/src/components/BookingWidgetConfigPanel.tsx", import.meta.url), "utf8");
const stripeForm = readFileSync(new URL("../client/src/components/BookingStripeCardForm.tsx", import.meta.url), "utf8");
const experience = readFileSync(new URL("../client/src/components/BookingExperience.tsx", import.meta.url), "utf8");
const popup = readFileSync(new URL("../client/src/components/BookWithAIWidget.tsx", import.meta.url), "utf8");
const bookPage = readFileSync(new URL("../client/src/pages/Book.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");

describe("native booking source contract", () => {
  it("adds only idempotent native tables and no destructive migration", () => {
    for (const table of ["bookings", "booking_assignments", "booking_series"]) {
      expect(schema).toContain(`mysqlTable("${table}"`);
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS \`${table}\``);
    }
    expect(migration).toContain("uq_bookings_idempotency_key");
    expect(migration).toContain("uq_bookings_public_number");
    expect(migration).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE)\b/i);
  });

  it("exposes only the scoped public funnel writes and protects list/get", () => {
    expect(router).toContain("prepare: publicProcedure");
    expect(router).toContain("captureLead: publicProcedure");
    expect(router).toContain("updateLead: publicProcedure");
    expect(router).toContain("beginPayment: publicProcedure");
    expect(router).toContain("list: adminAgentProcedure");
    expect(router).toContain("get: adminAgentProcedure");
  });

  it("stores durable native requests without Launch27 or cleanerJobs", () => {
    for (const marker of ['status: "needs_attention"', 'availabilityStatus: "requested"', 'assignmentStatus: "unassigned"', 'paymentStatus: "not_started"', '"intent_pending"', "expiresAt: null"]) expect(service).toContain(marker);
    expect(service).not.toContain("cleanerJobs");
    expect(service).not.toContain("launch27");
  });

  it("uses one shared live experience for popup and full-page surfaces", () => {
    expect(experience).toContain('mode="live"');
    expect(popup).toContain('<BookingExperience surface="popup" />');
    expect(bookPage).toContain('<BookingExperience surface="full_page" />');
    expect(app).toContain('<Route path={"/book"} component={Book} />');
  });

  it("keeps the admin editor inert and reuses the secure Stripe booking flow", () => {
    expect(widget).toContain('mode === "live"');
    expect(widget).toContain("trpc.bookings.captureLead.useMutation()");
    expect(widget).toContain("trpc.bookings.beginPayment.useMutation()");
    expect(widget).toContain("<BookingStripeCardForm");
    expect(widget).toContain("config.confirmedTitle");
    expect(widget).not.toContain("Request received");
    expect(stripeForm).toContain("<PaymentElement");
    expect(stripeForm).toContain("stripe.confirmSetup");
    expect(stripeForm).toContain("confirmSaved.mutateAsync");
    expect(stripeForm).not.toContain("cardNumber");
    expect(stripeForm).not.toContain("cvc");
  });
});
