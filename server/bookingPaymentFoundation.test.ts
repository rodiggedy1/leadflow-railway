import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BookingPaymentStateError,
  assertBookingPaymentTransition,
  bookingPaymentIdempotencyKey,
  bookingPaymentMetadata,
} from "./bookingPaymentService";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("booking payment foundation", () => {
  it("keeps payment state separate from appointment confirmation", () => {
    expect(() => assertBookingPaymentTransition("not_started", "setup_pending")).not.toThrow();
    expect(() => assertBookingPaymentTransition("setup_pending", "card_on_file")).not.toThrow();
    expect(() => assertBookingPaymentTransition("card_on_file", "authorization_pending")).not.toThrow();
    expect(() => assertBookingPaymentTransition("authorized", "capture_pending")).not.toThrow();
    expect(() => assertBookingPaymentTransition("card_on_file", "captured")).toThrow(BookingPaymentStateError);
  });

  it("uses only booking-bound stable idempotency keys and metadata", () => {
    expect(bookingPaymentIdempotencyKey(42, "setup", 3)).toBe("leadflow:booking:42:setup:v3");
    expect(bookingPaymentIdempotencyKey(42, "authorization", 3)).toBe("leadflow:booking:42:authorization:v3");
    expect(bookingPaymentMetadata(42, 9)).toEqual({
      source: "leadflow_booking",
      bookingId: "42",
      bookingPaymentProfileId: "9",
    });
    expect(() => bookingPaymentIdempotencyKey(0, "setup", 1)).toThrow(BookingPaymentStateError);
    expect(() => bookingPaymentMetadata(42, 0)).toThrow(BookingPaymentStateError);
  });

  it("adds only checksum-locked additive booking-payment persistence", () => {
    const schema = read("drizzle/schema.ts");
    const manifest = JSON.parse(read("server/versioned-migrations/manifest.json"));
    expect(schema).toContain('bookingId: int("bookingId")');
    expect(schema).toContain('mysqlTable("booking_payment_profiles"');
    expect(schema).toContain('mysqlTable("stripe_webhook_events"');
    expect(schema).toContain('bookingPaymentProfileId: int("bookingPaymentProfileId")');
    expect(schema).toContain('captureBefore: bigint("captureBefore"');
    for (const id of ["0010_add_booking_funnel_booking_id", "0011_create_booking_payment_profiles", "0012_add_payment_authorization_booking_link", "0013_create_stripe_webhook_events"]) {
      const migration = manifest.migrations.find((entry: { id: string }) => entry.id === id);
      expect(migration).toBeDefined();
      const sql = read(`server/versioned-migrations/${migration.sqlFile}`);
      expect(migration.sha256).toBe(createHash("sha256").update(sql).digest("hex"));
      expect(sql).not.toMatch(/^\s*(DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/im);
    }
  });

  it("keeps the booking Stripe client server-only and free of raw card input", () => {
    const client = read("server/stripeClient.ts");
    expect(client).toContain("new Stripe(ENV.stripeSecretKey");
    expect(client).toContain("Raw card data never reaches LeadFlow");
  });
});
