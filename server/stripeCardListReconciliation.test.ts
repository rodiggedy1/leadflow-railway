import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Cards on File reconciliation", () => {
  it("repairs only verified, profile-only cards into the existing Cards on File source", () => {
    const source = read("server/stripeCardListReconciliation.ts");
    expect(source).toContain('eq(bookingPaymentProfiles.paymentStatus, "card_on_file")');
    expect(source).toContain("isNotNull(bookingPaymentProfiles.stripeCustomerId)");
    expect(source).toContain("isNotNull(bookingPaymentProfiles.stripePaymentMethodId)");
    expect(source).toContain("isNotNull(bookingPaymentProfiles.cardLast4)");
    expect(source).toContain("leftJoin(stripeCustomers, eq(stripeCustomers.phone, bookings.customerPhone))");
    expect(source).toContain("await db.insert(stripeCustomers).values({");
    expect(source).toContain("onDuplicateKeyUpdate({ set:");
    expect(source).not.toContain("insert(bookings)");
    expect(source).not.toContain("update(bookings)");
    expect(source).not.toContain("update(bookingPaymentProfiles)");
    expect(source).not.toContain("cleanerJobs");
    expect(source).not.toContain("cleaner_jobs");
  });

  it("runs as part of the existing Cards on File list read and preserves the list if a historical repair fails", () => {
    const router = read("server/stripeRouter.ts");
    const listProcedure = router.slice(router.indexOf("listAllCustomers: agentProcedure"), router.indexOf("// 11. listAllCardAuthTokens"));
    expect(listProcedure).toContain("reconcileMissingStripeCustomerCards(db)");
    expect(listProcedure).toContain("[StripeCards] Cards on File reconciliation complete");
    expect(listProcedure).toContain("[StripeCards] Cards on File reconciliation failed");
    expect(listProcedure).toContain("const rows = await db");
  });
});
