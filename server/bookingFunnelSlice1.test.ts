import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BookingFunnelInputError,
  createBookingFunnelMutationToken,
  isDuplicateBookingFunnelEntry,
  normalizeBookingFunnelLead,
  verifyBookingFunnelMutationToken,
} from "./bookingFunnelService";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("native booking funnel slice 1", () => {
  it("normalizes equivalent phone/name input to one material command hash", () => {
    const first = normalizeBookingFunnelLead({
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      source: "book-page",
      customerName: "  Rohan   Gilkes ",
      customerPhone: "(302) 981-6191",
    });
    const replay = normalizeBookingFunnelLead({
      idempotencyKey: first.idempotencyKey,
      source: "book-page",
      customerName: "Rohan Gilkes",
      customerPhone: "+13029816191",
    });
    expect(first.customerName).toBe("Rohan Gilkes");
    expect(first.customerPhone).toBe("+13029816191");
    expect(first.commandHash).toBe(replay.commandHash);
    expect(first.stage).toBe("lead");
  });

  it("rejects invalid U.S. phone input before persistence", () => {
    expect(() => normalizeBookingFunnelLead({
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      source: "widget-popup",
      customerName: "Test Person",
      customerPhone: "123",
    })).toThrow(BookingFunnelInputError);
  });

  it("signs mutation access for one funnel identity", () => {
    const token = createBookingFunnelMutationToken("test-secret", "MIB-FABC123", "11111111-1111-4111-8111-111111111111");
    expect(verifyBookingFunnelMutationToken("test-secret", token, "MIB-FABC123", "11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(verifyBookingFunnelMutationToken("test-secret", token, "MIB-FOTHER", "11111111-1111-4111-8111-111111111111")).toBe(false);
  });

  it("recognizes direct and Drizzle-wrapped duplicate entry errors", () => {
    expect(isDuplicateBookingFunnelEntry({ code: "ER_DUP_ENTRY" })).toBe(true);
    expect(isDuplicateBookingFunnelEntry({ message: "Failed query", cause: { errno: 1062 } })).toBe(true);
    expect(isDuplicateBookingFunnelEntry(new Error("unrelated"))).toBe(false);
  });

  it("keeps customer writes public and administrative reads protected", () => {
    const routerSource = read("server/bookingFunnelRouter.ts");
    const appRouterSource = read("server/routers.ts");
    expect(routerSource).toMatch(/begin:\s*publicProcedure/);
    expect(routerSource).toMatch(/update:\s*publicProcedure/);
    expect(routerSource).toMatch(/reserve:\s*publicProcedure/);
    expect(routerSource).toMatch(/list:\s*adminAgentProcedure/);
    expect(routerSource).toMatch(/get:\s*adminAgentProcedure/);
    expect(routerSource).toContain("BOOKING_FUNNEL_VERSION_CONFLICT");
    expect(routerSource).toContain("IDEMPOTENCY_CONFLICT");
    expect(appRouterSource).toContain("bookingFunnel: bookingFunnelRouter");
  });

  it("reserves the same token-bound row through one atomic forward transition", () => {
    const sharedSource = read("shared/bookingFunnel.ts");
    const routerSource = read("server/bookingFunnelRouter.ts");
    expect(sharedSource).toContain("reserveBookingFunnelInputSchema");
    expect(sharedSource).toContain("patch: progressiveFieldsSchema.refine");
    expect(routerSource).toContain("verifyBookingFunnelMutationToken");
    expect(routerSource).toContain('existing.stage === "payment_incomplete" || existing.stage === "booked"');
    expect(routerSource).toContain('if (existing.stage !== "lead")');
    expect(routerSource).toContain('stage: "payment_incomplete"');
    expect(routerSource).toContain("...input.patch");
    expect(routerSource).toContain("eq(bookingFunnelRecords.version, input.expectedVersion)");
    expect(routerSource).not.toContain("prepareNativeBooking");
    expect(routerSource).not.toContain("stripePaymentMethod");
  });

  it("registers one checksum-locked, additive-only create-table migration", () => {
    const sql = read("server/versioned-migrations/0009_create_booking_funnel_records.sql");
    const postconditions = JSON.parse(read("server/versioned-migrations/0009_create_booking_funnel_records.postconditions.json"));
    const manifest = JSON.parse(read("server/versioned-migrations/manifest.json"));
    const entry = manifest.migrations.find((migration: { id: string }) => migration.id === "0009_create_booking_funnel_records");
    expect(entry).toEqual(expect.objectContaining({
      mode: "create-table",
      sqlFile: "0009_create_booking_funnel_records.sql",
      postconditionsFile: "0009_create_booking_funnel_records.postconditions.json",
      replayMode: "verified-idempotent",
    }));
    expect(entry.sha256).toBe(createHash("sha256").update(sql).digest("hex"));
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `booking_funnel_records`");
    expect(sql).not.toMatch(/^\s*(DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/im);
    expect(postconditions.table).toBe("booking_funnel_records");
    expect(postconditions.columns).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "customerEmail", nullable: true }),
      expect.objectContaining({ name: "address", nullable: true }),
      expect.objectContaining({ name: "stripePaymentMethodId", nullable: true }),
    ]));
  });

  it("changes no client source in slice 1", () => {
    expect(read("server/bookingFunnelRouter.ts")).not.toContain("notifyOwner");
    expect(read("server/bookingFunnelRouter.ts")).not.toContain("sendSms");
    expect(read("server/bookingFunnelRouter.ts")).not.toContain("stripe");
  });
});
