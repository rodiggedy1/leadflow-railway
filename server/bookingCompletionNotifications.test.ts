import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dispatcher = readFileSync(resolve(import.meta.dirname, "bookingCompletionNotifications.ts"), "utf8");

describe("booking completion notifications", () => {
  it("keeps delayed card wording and makes the Cash App payment status truthful", () => {
    expect(dispatcher).toContain("Nothing is charged until your cleaning is complete. We'll text you closer to your appointment with updates from your cleaning team.");
    expect(dispatcher).toContain('booking.paymentMethod === "cashapp"');
    expect(dispatcher).toContain("was paid today with Cash App for your first cleaning.");
    expect(dispatcher).toContain("Cash App paid ${amount} today");
    expect(dispatcher).not.toContain("paymentIntents.capture");
    expect(dispatcher).not.toContain("createPaymentIntent");
  });
});
