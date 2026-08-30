import { beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { NATIVE_BOOKING_PRICING_VERSION, type PrepareBookingInput } from "../shared/booking";
import { NativeBookingIdempotencyConflictError, NativeBookingInputError, buildPreparedNativeBooking, prepareNativeBooking, type PersistPreparedBooking, type PersistedBookingIdentity } from "./bookingsService";
import { assertBookingPrepareRateLimit, resetBookingPrepareRateLimitForTests } from "./bookingsRouter";
import { businessLocalDateTimeToUtcMs } from "./utils/businessTime";

const NOW = Date.UTC(2026, 7, 29, 12, 0, 0);
const input = (overrides: Partial<PrepareBookingInput> = {}): PrepareBookingInput => ({
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  surface: "full_page",
  customer: { fullName: "Rohan Gilkes", phone: "202-555-0182", email: "ROHAN@example.com" },
  service: { serviceId: "deep", bedrooms: 2, bathrooms: 2, extras: [{ id: "inside-fridge", quantity: 1 }], specialRequestNotes: ["  Please text before arrival.  "] },
  address: " 1501 Canyon Ledge Court ",
  requestedSchedule: { localDate: "2026-08-31", localTime: "09:00" },
  recurrence: "weekly",
  acceptedPricing: { version: NATIVE_BOOKING_PRICING_VERSION, totalCents: 34_100 },
  ...overrides,
});

function memoryRepository() {
  const rows = new Map<string, PersistedBookingIdentity>();
  let inserts = 0;
  const persist: PersistPreparedBooking = async (prepared) => {
    await Promise.resolve();
    const existing = rows.get(prepared.idempotencyKey);
    if (existing) return { booking: existing, created: false };
    const booking = { publicBookingNumber: prepared.publicBookingNumber, commandHash: prepared.commandHash };
    rows.set(prepared.idempotencyKey, booking);
    inserts += 1;
    return { booking, created: true };
  };
  return { persist, rows, inserts: () => inserts };
}

describe("native LeadFlow booking preparation", () => {
  it("recalculates authoritative prices and stores a durable recurring intent only", () => {
    const result = buildPreparedNativeBooking(input(), { nowMs: NOW, timeZone: "America/New_York" });
    expect(result.type).toBe("ready");
    if (result.type !== "ready") return;
    expect(result.prepared.firstCleaningTotalCents).toBe(34_100);
    expect(result.prepared.futureVisitTotalCents).toBe(27_300);
    expect(result.prepared.recurringIntentStatus).toBe("intent_pending");
    expect(result.prepared.expiresAt).toBeNull();
  });

  it("returns changed pricing without persistence", async () => {
    let persisted = false;
    const result = await prepareNativeBooking(input({ acceptedPricing: { version: "old", totalCents: 100 } }), { nowMs: NOW, timeZone: "America/New_York", persist: async () => { persisted = true; throw new Error("must not persist"); } });
    expect(result).toMatchObject({ type: "price_changed", pricingVersion: NATIVE_BOOKING_PRICING_VERSION, totalCents: 34_100 });
    expect(persisted).toBe(false);
  });

  it("creates exactly once under concurrent retries and returns the original booking", async () => {
    const repo = memoryRepository();
    const options = { nowMs: NOW, timeZone: "America/New_York", persist: repo.persist };
    const [first, second] = await Promise.all([prepareNativeBooking(input(), options), prepareNativeBooking(input(), options)]);
    expect(repo.inserts()).toBe(1);
    expect(repo.rows.size).toBe(1);
    expect(first.type).toBe("prepared");
    expect(second.type).toBe("prepared");
    if (first.type === "prepared" && second.type === "prepared") expect(first.publicBookingNumber).toBe(second.publicBookingNumber);
  });

  it("replays the same command across surfaces but rejects materially different payloads", async () => {
    const repo = memoryRepository();
    const options = { nowMs: NOW, timeZone: "America/New_York", persist: repo.persist };
    await prepareNativeBooking(input({ surface: "popup" }), options);
    await prepareNativeBooking(input({ surface: "full_page" }), options);
    expect(repo.inserts()).toBe(1);
    await expect(prepareNativeBooking(input({ address: "999 Different Street" }), options)).rejects.toBeInstanceOf(NativeBookingIdempotencyConflictError);
  });

  it("rejects invalid phones and past requested times", () => {
    expect(() => buildPreparedNativeBooking(input({ customer: { fullName: "Rohan Gilkes", phone: "123", email: "rohan@example.com" } }), { nowMs: NOW, timeZone: "America/New_York" })).toThrow(NativeBookingInputError);
    expect(() => buildPreparedNativeBooking(input({ requestedSchedule: { localDate: "2026-08-01", localTime: "09:00" } }), { nowMs: NOW, timeZone: "America/New_York" })).toThrow("Requested time must be in the future.");
  });

  it("handles daylight-saving offsets and nonexistent local times", () => {
    expect(businessLocalDateTimeToUtcMs("2026-03-07", "09:00", "America/New_York")).toBe(Date.UTC(2026, 2, 7, 14, 0));
    expect(businessLocalDateTimeToUtcMs("2026-03-09", "09:00", "America/New_York")).toBe(Date.UTC(2026, 2, 9, 13, 0));
    expect(() => businessLocalDateTimeToUtcMs("2026-03-08", "02:30", "America/New_York")).toThrow("does not exist");
  });

  it("returns only safe public fields", async () => {
    const repo = memoryRepository();
    const result = await prepareNativeBooking(input(), { nowMs: NOW, timeZone: "America/New_York", persist: repo.persist });
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("customerEmail");
    expect(result).not.toHaveProperty("customerPhone");
  });
});

describe("booking prepare rate limit", () => {
  beforeEach(() => resetBookingPrepareRateLimitForTests());
  it("rejects the attempt after the narrow window limit", () => {
    for (let attempt = 0; attempt < 20; attempt += 1) assertBookingPrepareRateLimit("203.0.113.10", NOW);
    expect(() => assertBookingPrepareRateLimit("203.0.113.10", NOW)).toThrow(TRPCError);
  });
});
