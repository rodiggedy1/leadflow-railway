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
