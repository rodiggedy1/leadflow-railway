import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CUSTOMER_PORTAL_SERVICES, calculateCustomerPortalEstimate, validateCustomerPortalSelections } from "../shared/customerPortalServices";

const root = resolve(import.meta.dirname, "..");
const source = (file: string) => readFileSync(resolve(root, file), "utf8");

describe("Maids in Black customer portal service catalog", () => {
  it("imports exactly the 12 non-cleaning Joe AI service forms", () => {
    expect(CUSTOMER_PORTAL_SERVICES).toHaveLength(12);
    expect(CUSTOMER_PORTAL_SERVICES.map((service) => service.name)).toEqual([
      "TV mounting", "Furniture assembly", "Picture hanging", "Minor home repairs", "Handyman visit", "Plumbing help",
      "Electrical & lighting", "Interior painting", "Moving help", "Lawn & yard care", "Junk removal", "Pressure washing",
    ]);
    expect(new Set(CUSTOMER_PORTAL_SERVICES.map((service) => service.id)).size).toBe(12);
  });

  it("accepts only complete option values from the imported service form definitions", () => {
    for (const service of CUSTOMER_PORTAL_SERVICES) {
      const validSelections = Object.fromEntries(service.fields.map((field) => [field.label, field.type === "text" ? "A shelf needs to be safely installed." : field.options?.[0] ?? ""]));
      expect(validateCustomerPortalSelections(service, validSelections)).toBeNull();
      const missingOne = { ...validSelections, [service.fields[0].label]: "" };
      expect(validateCustomerPortalSelections(service, missingOne)).toContain(service.fields[0].label);
    }
  });

  it("calculates request estimates from server-owned service rules rather than a browser-supplied total", () => {
    const base = calculateCustomerPortalEstimate("tv-mounting", { "TV count": "One TV", "TV size": "Up to 43 inches", "Wall & mount": "Drywall and I have a mount" });
    const expanded = calculateCustomerPortalEstimate("tv-mounting", { "TV count": "Two TVs", "TV size": "44–65 inches", "Wall & mount": "Drywall and I have a mount" });
    expect(base).toEqual({ estimatedTotalCents: 14_900, requiresReview: false });
    expect(expanded).toEqual({ estimatedTotalCents: 29_300, requiresReview: false });
  });
});

describe("Maids in Black customer portal boundaries", () => {
  it("uses a separate portal session and single-use handoff without mixing staff authentication", () => {
    const auth = source("server/_core/customerPortalAuth.ts");
    const router = source("server/customerPortalRouter.ts");
    expect(auth).toContain("CUSTOMER_PORTAL_COOKIE_NAME");
    expect(router).toContain("redeemHandoff");
    expect(router).toContain("ensureFromFunnel");
    expect(router).toContain("createPortalHandoffForBookingCustomer");
    expect(router).not.toContain("sendBookingCompletionNotifications");
    expect(router).not.toContain("sendLeadCreatedNotifications");
  });

  it("retains the real cleaning booking path and sends non-cleaning requests to the existing staff Booking section refresh", () => {
    const bookNow = source("client/src/pages/BookNow.tsx");
    const portal = source("client/src/pages/CustomerPortal.tsx");
    const workspace = source("client/src/components/NativeBookingsWorkspace.tsx");
    expect(bookNow).toContain("BookingPaymentCheckout");
    expect(bookNow).toContain("ensurePortalFromFunnelMutation");
    expect(bookNow).toContain("mib-customer-portal-open");
    expect(bookNow).toContain("const parentOrigin = document.referrer ? new URL(document.referrer).origin : window.location.origin");
    expect(portal).toContain("href=\"/book-now\"");
    expect(portal).toContain("CUSTOMER_PORTAL_SERVICES.map");
    expect(portal).toContain("REVIEW YOUR REQUEST");
    expect(portal).toContain("Send request");
    expect(workspace).toContain('source: "portal_request"');
    expect(workspace).toContain('const portalRequestRows = status === "All"');
    expect(workspace).toContain("portalRequestListQuery.refetch()");
  });
});
