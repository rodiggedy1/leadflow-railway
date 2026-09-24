import { describe, expect, it } from "vitest";
import { dashboardServiceCategory, dashboardSourceLabel, percentChange, summarizeDashboardServices, summarizeDashboardSources } from "./dashboardAnalyticsPresentation";

describe("Operations Dashboard analytics presentation", () => {
  it("uses the persisted lead and UTM fields for compact source labels", () => {
    expect(dashboardSourceLabel({ leadSource: "thumbtack-sms", utmSource: "thumbtack-sms", gclid: null })).toBe("Thumbtack");
    expect(dashboardSourceLabel({ leadSource: "form", utmSource: null, gclid: null })).toBe("Website / AI");
    expect(dashboardSourceLabel({ leadSource: "email", utmSource: null, gclid: "gclid" })).toBe("Google");
    expect(dashboardSourceLabel({ leadSource: null, utmSource: null, gclid: null })).toBe("Direct");
  });

  it("compares the current and prior 30-day source windows without changing records", () => {
    const summary = summarizeDashboardSources(
      [
        { leadSource: "thumbtack", utmSource: "thumbtack", gclid: null, count: 8 },
        { leadSource: "form", utmSource: null, gclid: null, count: 5 },
      ],
      [
        { leadSource: "thumbtack", utmSource: "thumbtack", gclid: null, count: 4 },
        { leadSource: "form", utmSource: null, gclid: null, count: 10 },
      ],
    );
    expect(summary).toEqual([
      { source: "Thumbtack", count: 8, previousCount: 4 },
      { source: "Website / AI", count: 5, previousCount: 10 },
    ]);
    expect(percentChange(8, 4)).toBe(100);
    expect(percentChange(5, 10)).toBe(-50);
    expect(percentChange(5, 0)).toBeNull();
  });

  it("collapses verbose imported service names into the approved fixed card categories", () => {
    expect(dashboardServiceCategory("3 bedroom")).toBe("Cleaning");
    expect(dashboardServiceCategory("Hourly Service - $35 per hour per maid")).toBe("Cleaning");
    expect(dashboardServiceCategory("Move-out clean")).toBe("Move Out");
    expect(dashboardServiceCategory("Junk hauling")).toBe("Junk Removal");
    const services = summarizeDashboardServices([
      { serviceName: "3 bedroom", count: 4 },
      { serviceName: "Hourly Service - $35 per hour per maid", count: 2 },
      { serviceName: "Move-out clean", count: 1 },
    ]);
    expect(services).toEqual([
      { label: "Cleaning", count: 6 },
      { label: "Move Out", count: 1 },
      { label: "Junk Removal", count: 0 },
      { label: "Lawn Care", count: 0 },
      { label: "Handyman", count: 0 },
      { label: "Other", count: 0 },
    ]);
  });
});
