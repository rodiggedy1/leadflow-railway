import { readFile } from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";
import { CUSTOMER_PORTAL_SERVICES } from "../shared/customerPortalServices";

const root = process.cwd();

describe("customer portal isolation", () => {
  it("contains the complete twelve-service catalog with service-specific form fields", () => {
    expect(CUSTOMER_PORTAL_SERVICES).toHaveLength(12);
    expect(CUSTOMER_PORTAL_SERVICES.map(service => service.id)).toEqual(["tv-mounting", "furniture-assembly", "picture-hanging", "minor-home-repairs", "handyman", "plumbing", "electrical-lighting", "interior-painting", "moving-help", "lawn-yard-care", "junk-removal", "pressure-washing"]);
    expect(CUSTOMER_PORTAL_SERVICES.every(service => service.fields.length > 0)).toBe(true);
  });

  it("keeps staff portal-request failure outside the existing Bookings and Leads load/error gate", async () => {
    const source = await readFile(path.resolve(root, "client/src/components/NativeBookingsWorkspace.tsx"), "utf8");
    expect(source).toContain("trpc.customerPortal.staffRequests.useQuery");
    expect(source).toContain("(listQuery.isLoading || funnelListQuery.isLoading)");
    expect(source).toContain("(listQuery.error || funnelListQuery.error)");
    expect(source).not.toContain("portalRequestsQuery.isLoading ||");
    expect(source).not.toContain("portalRequestsQuery.error ||");
  });

  it("makes portal access fail open only after the verified card transaction and preserves widget close behavior", async () => {
    const [payment, bookingPage, widget] = await Promise.all([
      readFile(path.resolve(root, "server/bookingPaymentRouter.ts"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/BookNow.tsx"), "utf8"),
      readFile(path.resolve(root, "server/widgetEmbed.ts"), "utf8"),
    ]);
    expect(payment.lastIndexOf("createCustomerPortalHandoff(")).toBeGreaterThan(payment.indexOf("await db.transaction"));
    expect(payment).toContain("Customer portal handoff creation failed");
    expect(payment).toContain("portalAccessCode");
    expect(bookingPage).toContain("setCardOnFile(true); if (!result.portalAccessCode) return;");
    expect(widget).toContain("event.data.type === 'mib-booking-widget-portal'");
    expect(widget).toContain("event.data.type !== 'mib-booking-widget-close'");
  });

  it("keeps customer portal procedures limited to the dedicated router and route", async () => {
    const [app, router] = await Promise.all([readFile(path.resolve(root, "client/src/App.tsx"), "utf8"), readFile(path.resolve(root, "server/routers.ts"), "utf8")]);
    expect(app).toContain('const CustomerPortal = lazy(() => import("./pages/CustomerPortal"));');
    expect(app).toContain('<Route path={"/my-home"} component={CustomerPortal} />');
    expect(router).toContain("customerPortal: customerPortalRouter");
  });
});
