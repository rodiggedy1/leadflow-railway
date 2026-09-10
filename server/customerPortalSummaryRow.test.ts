import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Customer Portal home summary row", () => {
  const home = read("client/src/pages/CustomerPortalHome.tsx");
  const portal = read("client/src/pages/CustomerPortal.tsx");
  const styles = read("client/src/pages/customer-portal-summary-row.css");

  it("replaces the timeline with the compact four-item home summary row", () => {
    expect(home).toContain('className="mib-customer-home__summary-row"');
    expect(home).toContain("Total bookings");
    expect(home).toContain("Next visit");
    expect(home).toContain("Payment method");
    expect(home).toContain("Messages");
    expect(home).not.toContain("mib-customer-home__timeline");
    expect(styles).toContain("grid-template-columns:repeat(4,minmax(0,1fr))");
    expect(styles).toContain("@media(max-width:720px)");
  });

  it("uses only existing truthful booking, payment, and navigation data", () => {
    expect(portal).toContain("const totalBookingCount = portal.data.cleanings.length + portal.data.leadflowJobs.length;");
    expect(portal).toContain("totalBookingCount={totalBookingCount}");
    expect(portal).toContain("paymentMethodLabel={savedCardLabel}");
    expect(home).toContain('onGoToPage("bookings")');
    expect(home).toContain('onGoToPage("payments")');
    expect(home).toContain('onGoToPage("messages")');
    expect(home).not.toMatch(/Average rating|Refer a friend|Give \$50|get \$50/);
  });
});
