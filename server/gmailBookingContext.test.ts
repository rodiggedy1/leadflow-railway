import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routerSource = readFileSync(resolve(process.cwd(), "server/gmailRouter.ts"), "utf8");
const bookingContextSource = routerSource.slice(
  routerSource.indexOf("  getBookingContext: agentProcedure"),
  routerSource.indexOf("  /**\n   * Read the LeadFlow-owned inbound email captured"),
);
const prohibitedLegacySymbol = ["cleaner", "Jobs"].join("");
const prohibitedLegacyTable = ["cleaner", "_jobs"].join("");

describe("Gmail booking context", () => {
  it("uses exact inbound email identities and LeadFlow-owned booking records only", () => {
    expect(routerSource).toContain("replyToEmail: z.string().trim().email().max(320).nullable()");
    expect(routerSource).toContain("senderEmail: z.string().trim().email().max(320).nullable()");
    expect(bookingContextSource).toContain("leadflowJobs.customerEmail");
    expect(bookingContextSource).toContain("bookings.customerEmail");
    expect(bookingContextSource).toContain("LOWER(${leadflowJobs.bookingStatus}) NOT IN ('cancelled', 'rescheduled', 'missing_from_launch27', 'completed')");
    expect(bookingContextSource).toContain("LOWER(${bookings.status}) NOT IN ('cancelled', 'canceled', 'completed')");
    expect(bookingContextSource).toContain("matchRank");
    expect(bookingContextSource).toContain("bookingContextRank");
  });

  it("remains read-only and excludes the prohibited legacy job path", () => {
    expect(bookingContextSource).not.toContain("db.insert(");
    expect(bookingContextSource).not.toContain("db.update(");
    expect(bookingContextSource).not.toContain("db.delete(");
    expect(bookingContextSource).not.toContain(prohibitedLegacySymbol);
    expect(bookingContextSource).not.toContain(prohibitedLegacyTable);
  });
});
