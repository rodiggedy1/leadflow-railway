import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Review Workspace live destinations", () => {
  it("keeps review links for static pages and uses live routes for completed exact migrations", () => {
    const nav = read("client/src/components/ReviewWorkspaceNav.tsx");
    const app = read("client/src/App.tsx");

    expect(nav).toContain('liveHref: "/admin/bookings"');
    expect(nav).toContain('liveHref: "/admin/customer-profile"');
    expect(nav).toContain('liveHref: "/admin/confirmation-calls"');
    expect(nav).toContain('liveHref: "/admin/invoices"');
    expect(nav).toContain('const settingsHref = useLiveDestinations ? "/admin/settings" : "/review/settings";');
    expect(nav).toContain('const href = useLiveDestinations ? item.liveHref ?? item.href : item.href;');
    expect(nav).toContain('href={href}');
    expect(nav).toContain('href: "/review/payments"');
    expect(nav).toContain('href: "/review/schedule-crm"');

    expect(app).toContain('<Route path={"/admin/bookings"} component={AdminBookingsCRMExactReviewRoute} />');
    expect(app).toContain('<Route path={"/admin/customer-profile"} component={AdminCustomerProfileExactReviewRoute} />');
    expect(app).toContain('<Route path={"/admin/confirmation-calls"} component={AdminConfirmationCallsExactReviewRoute} />');
    expect(app).toContain('<Route path={"/admin/invoices"} component={AdminInvoicesExactReviewRoute} />');
    expect(app).toContain('<Route path={"/admin/settings"} component={AdminSettingsReviewRoute} />');
  });
});
