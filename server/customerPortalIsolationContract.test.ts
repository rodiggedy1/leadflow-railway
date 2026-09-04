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

  it("shows the approved six-service portal preview with the remaining catalog behind View all services", async () => {
    const source = await readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8");
    const expectedFeaturedIds = ["furniture-assembly", "moving-help", "lawn-yard-care", "junk-removal", "pressure-washing"];
    expect(CUSTOMER_PORTAL_SERVICES.filter(service => expectedFeaturedIds.includes(service.id)).map(service => service.id)).toEqual(expectedFeaturedIds);
    expect(CUSTOMER_PORTAL_SERVICES.find(service => service.id === "moving-help")?.detail).toBe("One helper for two hours · no truck");
    expect(CUSTOMER_PORTAL_SERVICES.find(service => service.id === "lawn-yard-care")?.detail).toBe("Small maintained lawn · mow, edge, and blow");
    expect(CUSTOMER_PORTAL_SERVICES.find(service => service.id === "junk-removal")?.detail).toBe("Small curbside or one-eighth truckload pickup");
    expect(CUSTOMER_PORTAL_SERVICES.find(service => service.id === "pressure-washing")?.detail).toBe("Small ground-level patio or walkway");
    expect(source).toContain('const FEATURED_SERVICE_IDS = ["furniture-assembly", "moving-help", "lawn-yard-care", "junk-removal", "pressure-washing"] as const;');
    expect(source).toContain("const visibleServices = showAllServices ? CUSTOMER_PORTAL_SERVICES : featuredServices;");
    expect(source).toContain('>Home cleaning</strong>');
    expect(source).toContain('"View all services"');
    expect(source).toContain(">Start request <ArrowRight /></em>");
  });

  it("uses the established Maids in Black warm-coral palette without changing portal behavior", async () => {
    const css = await readFile(path.resolve(root, "client/src/pages/customer-portal.css"), "utf8");
    expect(css).toContain("--mib-coral:#e8603c");
    expect(css).toContain("--mib-coral-dark:#c94a28");
    expect(css).toContain("--mib-warm-bg:#fff8f5");
    expect(css).toContain("--mib-peach:#fff0ec");
    expect(css).not.toContain("#173829");
    expect(css).not.toContain("#41654c");
  });

  it("keeps staff portal-request failure outside the existing Bookings and Leads load/error gate", async () => {
    const source = await readFile(path.resolve(root, "client/src/components/NativeBookingsWorkspace.tsx"), "utf8");
    expect(source).toContain("trpc.customerPortal.staffRequests.useQuery");
    expect(source).toContain("(listQuery.isLoading || funnelListQuery.isLoading)");
    expect(source).toContain("(listQuery.error || funnelListQuery.error)");
    expect(source).not.toContain("portalRequestsQuery.isLoading ||");
    expect(source).not.toContain("portalRequestsQuery.error ||");
  });

  it("uses Joe-style same-response portal sessions only for direct book-now completions while preserving widget handoff", async () => {
    const [payment, checkout, bookingPage, widget, portalPage] = await Promise.all([
      readFile(path.resolve(root, "server/bookingPaymentRouter.ts"), "utf8"),
      readFile(path.resolve(root, "client/src/components/BookingPaymentCheckout.tsx"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/BookNow.tsx"), "utf8"),
      readFile(path.resolve(root, "server/widgetEmbed.ts"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8"),
    ]);
    expect(payment).toContain('if (record.source !== "book-page") return false;');
    expect(payment).toContain("ensureCustomerPortalAccount(db");
    expect(payment).toContain("signCustomerPortalSession({");
    expect(payment).toContain("ctx.res.cookie(CUSTOMER_PORTAL_COOKIE_NAME, sessionToken");
    expect(payment).toContain("...getSessionCookieOptions(ctx.req)");
    expect(payment).toContain("Direct customer portal session creation failed");
    const startSetup = payment.slice(payment.indexOf("startSetup:"), payment.indexOf("confirmSetup:"));
    const confirmSetup = payment.slice(payment.indexOf("confirmSetup:"));
    expect(startSetup.indexOf("const directPortalSessionReady = await establishDirectPortalSession(ctx, db, record);")).toBeGreaterThan(startSetup.indexOf('if (target.profile.paymentStatus === "card_on_file")'));
    expect(confirmSetup.indexOf("const directPortalSessionReady = await establishDirectPortalSession(ctx, db, record);")).toBeGreaterThan(confirmSetup.indexOf("await db.transaction"));
    expect(payment).toContain("portalAccessCode");
    expect(payment).toContain('if (target.profile.paymentStatus === "card_on_file")');
    expect(payment).toContain('if (record.source !== "book-page") try {');
    expect(payment).toContain('return { alreadyComplete: true, bookingId: target.bookingId, paymentStatus: "card_on_file" as const, portalAccessCode, directPortalSessionReady }');
    expect(checkout).toContain('portalAccessCode: result.portalAccessCode');
    expect(checkout).toContain("directPortalSessionReady: result.directPortalSessionReady");
    expect(checkout).toContain("onComplete(result)");
    expect(bookingPage).toContain('if (result.directPortalSessionReady) { window.location.assign("/my-home"); }');
    expect(bookingPage).toContain('"https://maidsinblack.com"');
    expect(bookingPage).toContain('if (embedded && window.parent !== window) { if (!result.portalAccessCode) return;');
    expect(bookingPage).not.toContain("/customer-portal/handoff?access=");
    expect(widget).toContain("event.data.type === 'mib-booking-widget-portal'");
    expect(widget).toContain("event.source === bookingFrame.contentWindow");
    expect(widget).toContain("/customer-portal/handoff?access=");
    expect(widget).toContain("event.data.type !== 'mib-booking-widget-close'");
    expect(portalPage).not.toContain("redeemHandoff.useMutation");
    expect(portalPage).not.toContain('get("access")');
  });

  it("keeps customer portal procedures limited to the dedicated router and route", async () => {
    const [app, router] = await Promise.all([readFile(path.resolve(root, "client/src/App.tsx"), "utf8"), readFile(path.resolve(root, "server/routers.ts"), "utf8")]);
    expect(app).toContain('const CustomerPortal = lazy(() => import("./pages/CustomerPortal"));');
    expect(app).toContain('<Route path={"/my-home"} component={CustomerPortal} />');
    expect(router).toContain("customerPortal: customerPortalRouter");
  });
});
